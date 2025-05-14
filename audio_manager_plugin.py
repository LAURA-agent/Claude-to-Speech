#!/usr/bin/env python3

import os
import time
import asyncio
import uuid
import pyaudio
from mutagen.mp3 import MP3
from asyncio import Event
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

try:
    from elevenlabs.client import ElevenLabs
except ImportError:
    ElevenLabs = None  # Will raise at runtime if used without install

# ====== CONFIGURATION SECTION ======
# You may want to load these from a config module or environment in production
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "sk_2e9430dbeccdecec954973179fe998b4bec86ba9c081f300")
ELEVENLABS_VOICE = os.environ.get("ELEVENLABS_VOICE", "L.A.U.R.A.")
ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_flash_v2_5")
AUDIO_CACHE_DIR = os.path.expanduser("~/LAURA/audio_cache")
os.makedirs(AUDIO_CACHE_DIR, exist_ok=True)
# ===================================

@dataclass
class AudioManagerState:
    is_playing: bool = False
    is_speaking: bool = False
    is_listening: bool = False
    playback_start_time: Optional[float] = None
    current_audio_file: Optional[str] = None
    expected_duration: Optional[float] = None
    currently_queued_files: set = field(default_factory=set)

class AudioManager:
    def __init__(self, pv_access_key=None):
        import ctypes
        import datetime

        os.makedirs('logs', exist_ok=True)
        log_file = f"logs/audio_init_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

        ERROR_HANDLER_FUNC = ctypes.CFUNCTYPE(None, ctypes.c_char_p, ctypes.c_int,
                                             ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p)
        def py_error_handler(filename, line, function, err, fmt):
            with open(log_file, 'a') as f:
                f.write(f'ALSA: {function} {fmt}\n')
        c_error_handler = ERROR_HANDLER_FUNC(py_error_handler)
        try:
            asound = ctypes.CDLL('libasound.so.2')
            asound.snd_lib_error_set_handler(c_error_handler)
        except:
            pass

        self.pa = pyaudio.PyAudio()
        self.audio_stream = None
        self.current_process = None
        self.audio_complete = Event()
        self.audio_complete.set()
        self.audio_state_changed = asyncio.Queue()
        self.activation_lock = asyncio.Lock()
        self.playback_lock = asyncio.Lock()
        self.state_lock = asyncio.Lock()
        self.state = AudioManagerState()
        self.audio_queue = asyncio.Queue()
        self.queue_processor_task = None
        self.is_processing_queue = False
        self.sample_rate = 16000
        self.frame_length = 2048

        # ElevenLabs client
        if ElevenLabs is None:
            raise RuntimeError("ElevenLabs package is not installed.")
        self.eleven = ElevenLabs(api_key=ELEVENLABS_API_KEY)

        print(f"\n=== Audio System Initialization ===")
        print(f"Sample Rate: {self.sample_rate} Hz")
        print(f"Frame Length: {self.frame_length} samples")
        print(f"Audio debug logs: {log_file}")
        print("=================================\n")

    async def queue_audio(self, audio_file: Optional[str] = None, generated_text: Optional[str] = None, delete_after_play: bool = False):
        """
        Add audio to playback queue with deduplication.
        If generated_text is provided, synthesize TTS to a unique temp file first.
        """
        if generated_text and not audio_file:
            unique_file = self._generate_unique_audio_filename()
            try:
                await self._save_tts_to_file(generated_text, unique_file)
                audio_file = unique_file
            except Exception as e:
                print(f"Error generating TTS audio: {e}")
                return

        if audio_file:
            async with self.state_lock:
                if audio_file in self.state.currently_queued_files or audio_file == self.state.current_audio_file:
                    print(f"Audio file already queued/playing, skipping: {audio_file}")
                    return
                self.state.currently_queued_files.add(audio_file)

        await self.audio_queue.put((audio_file, None, delete_after_play))

        if not self.is_processing_queue:
            self.queue_processor_task = asyncio.create_task(self.process_audio_queue())

    def _generate_unique_audio_filename(self, ext="mp3") -> str:
        ts = int(time.time() * 1000)
        unique = uuid.uuid4().hex
        return os.path.join(AUDIO_CACHE_DIR, f"tts_{ts}_{unique}.{ext}")

    async def _save_tts_to_file(self, text: str, file_path: str):
        """
        Uses ElevenLabs to generate TTS and save to file_path.
        Follows the proven TTSHandler pattern with proper file sync.
        """
        print(f"🔊 [AudioManager] Generating TTS MP3 for: {text[:64]}...")
        
        try:
            # ElevenLabs API is synchronous, so run in a thread
            loop = asyncio.get_event_loop()
            audio_bytes = await loop.run_in_executor(
                None,
                lambda: b"".join(self.eleven.generate(
                    text=text,
                    voice=ELEVENLABS_VOICE,
                    model=ELEVENLABS_MODEL,
                    output_format="mp3_44100_128"
                ))
            )
            
            print(f"🎵 [AudioManager] ElevenLabs generated {len(audio_bytes)} bytes")
            
            # Save to file with proper sync (following TTSHandler pattern)
            with open(file_path, 'wb') as f:
                f.write(audio_bytes)
                f.flush()
                os.fsync(f.fileno())  # Ensure file is fully written
                
            print(f"✅ [AudioManager] Saved TTS audio to: {file_path}")
            
        except Exception as e:
            print(f"❌ [AudioManager] ElevenLabs error: {e}")
            raise

    async def process_audio_queue(self):
        """Persistent queue processor with timeout polling and error handling."""
        self.is_processing_queue = True
        try:
            while self.is_processing_queue:
                try:
                    # Wait for next item, timeout allows periodic shutdown check
                    audio_file, _, delete_after_play = await asyncio.wait_for(
                        self.audio_queue.get(), timeout=1.0
                    )
                    if audio_file:
                        await self.play_audio(audio_file, delete_after_play)
                        async with self.state_lock:
                            self.state.currently_queued_files.discard(audio_file)
                    self.audio_queue.task_done()
                except asyncio.TimeoutError:
                    # Timeout is normal - allows checking is_processing_queue flag
                    continue
                except Exception as e:
                    print(f"Error processing audio queue item: {e}")
                    await asyncio.sleep(0.1)  # Brief backoff on errors
                    continue
        finally:
            self.is_processing_queue = False

    async def stop_audio_queue(self):
        """Gracefully stop the queue processor."""
        self.is_processing_queue = False
        if self.queue_processor_task:
            await self.queue_processor_task
            self.queue_processor_task = None

    async def play_audio(self, audio_file: str, delete_after_play: bool = False):
        """
        Play audio file with state tracking and resource management.
        """
        async with self.playback_lock:
            async with self.state_lock:
                self.state.is_speaking = True
                self.state.is_playing = True
                self.state.playback_start_time = time.time()
                self.state.current_audio_file = audio_file
            self.audio_complete.clear()

            try:
                try:
                    audio = MP3(audio_file)
                    async with self.state_lock:
                        self.state.expected_duration = audio.info.length
                except Exception as e:
                    print(f"Error calculating audio duration: {e}")
                    async with self.state_lock:
                        self.state.expected_duration = 2.0

                self.current_process = await asyncio.create_subprocess_shell(
                    f'/usr/bin/mpg123 -q "{audio_file}"',
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
                await self.current_process.wait()
                await asyncio.sleep(0.7)

            except Exception as e:
                print(f"Error in play_audio: {e}")
            finally:
                self.current_process = None
                async with self.state_lock:
                    self.state.is_speaking = False
                    self.state.is_playing = False
                    self.state.playback_start_time = None
                    self.state.current_audio_file = None
                    self.state.expected_duration = None
                self.audio_complete.set()
                await self.audio_state_changed.put(('audio_completed', True))

                if delete_after_play and os.path.exists(audio_file):
                    try:
                        os.remove(audio_file)
                        print(f"Deleted audio file: {audio_file}")
                    except Exception as e:
                        print(f"Error deleting audio file {audio_file}: {e}")

    async def stop_current_audio(self):
        """Stop currently playing audio."""
        if self.current_process:
            try:
                self.current_process.terminate()
                await self.current_process.wait()
                print("Stopped current audio playback")
            except Exception as e:
                print(f"Error stopping audio: {e}")

    async def clear_queue(self):
        """Clear the audio queue."""
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
                self.audio_queue.task_done()
            except asyncio.QueueEmpty:
                break
        async with self.state_lock:
            self.state.currently_queued_files.clear()
        print("Audio queue cleared")

    async def wait_for_audio_completion(self):
        """Wait for current audio to complete."""
        if self.state.is_playing:
            await self.audio_complete.wait()

    async def wait_for_queue_empty(self):
        """Wait for the audio queue to be empty."""
        await self.audio_queue.join()

    async def initialize_input(self):
        """Initialize audio input if needed (placeholder)."""
        # This method exists for compatibility with other systems
        # that may expect it. Add actual input initialization if needed.
        pass

    def reset_audio_state(self):
        """Reset audio state (for cleanup)."""
        self.state = AudioManagerState()
        if self.current_process:
            try:
                self.current_process.terminate()
            except:
                pass
        self.current_process = None

    def __del__(self):
        """Cleanup on deletion."""
        if hasattr(self, 'pa') and self.pa:
            try:
                self.pa.terminate()
            except:
                pass
