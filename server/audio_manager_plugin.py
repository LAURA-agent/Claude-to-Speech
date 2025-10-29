#!/usr/bin/env python3

import os
import time
import asyncio
import uuid
import pygame
from mutagen.mp3 import MP3
from asyncio import Event
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
import ctypes
import datetime
import threading

try:
    from elevenlabs.client import ElevenLabs
except ImportError:
    ElevenLabs = None  # Will raise at runtime if used without install

# ====== CONFIGURATION SECTION ======
try:
    from config.tts_config import ELEVENLABS_API_KEY, ACTIVE_VOICE, VOICES_DATA
    # Access voices nested under "voices" key
    voices = VOICES_DATA.get("voices", {})
    ELEVENLABS_VOICE = voices.get(ACTIVE_VOICE, {}).get("name", ACTIVE_VOICE)
    ELEVENLABS_MODEL = voices.get(ACTIVE_VOICE, {}).get("model", "eleven_flash_v2_5")
    print(f"✅ Loaded from tts_config: Voice={ELEVENLABS_VOICE}, Model={ELEVENLABS_MODEL}")
except ImportError:
    print("⚠️ Failed to import from config.tts_config. Using environment variables.")
    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
    ELEVENLABS_VOICE = os.environ.get("ELEVENLABS_VOICE", "L.A.U.R.A.")
    ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_flash_v2_5")
except Exception as e:
    print(f"⚠️ Config error: {e}. Using environment variables.")
    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
    ELEVENLABS_VOICE = os.environ.get("ELEVENLABS_VOICE", "L.A.U.R.A.")
    ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_flash_v2_5")

if not ELEVENLABS_API_KEY:
    print("❌ CRITICAL: ElevenLabs API key not found!")
    raise ValueError("ELEVENLABS_API_KEY must be set in config/secret.py or environment")

# Audio cache directory
AUDIO_CACHE_DIR = os.path.expanduser("~/claude-to-speech/audio_cache")
os.makedirs(AUDIO_CACHE_DIR, exist_ok=True)

print(f"🎵 Audio setup: Cache={AUDIO_CACHE_DIR}, Using pygame for cross-platform playback")
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
        self._initialized = False # Attribute to track initialization status

        os.makedirs('logs', exist_ok=True)
        log_file = f"logs/audio_init_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

        # Initialize pygame mixer for cross-platform audio
        try:
            pygame.mixer.pre_init(frequency=24000, size=-16, channels=1, buffer=4096)
            pygame.mixer.init()
            print("🎵 Pygame audio mixer initialized successfully!")
        except Exception as e:
            print(f"❌ CRITICAL: Failed to initialize pygame audio mixer: {e}")
            return

        # ALSA error handler (Linux only, but won't break other systems)
        if os.name == 'posix':  # Only on Unix-like systems
            ERROR_HANDLER_FUNC = ctypes.CFUNCTYPE(None, ctypes.c_char_p, ctypes.c_int,
                                                 ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p)
            def py_error_handler(filename, line, function, err, fmt):
                log_message = f'ALSA: {function.decode("utf-8") if isinstance(function, bytes) else function} {fmt.decode("utf-8") if isinstance(fmt, bytes) else fmt}\n'
                with open(log_file, 'a') as f:
                    f.write(log_message)
            c_error_handler = ERROR_HANDLER_FUNC(py_error_handler)
            try:
                asound = ctypes.CDLL('libasound.so.2')
                asound.snd_lib_error_set_handler(c_error_handler)
            except Exception as e:
                print(f"Could not set ALSA error handler: {e}")

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
        self.playback_thread = None
        self.stop_playback_event = threading.Event()

        if ElevenLabs is None:
            print("CRITICAL: ElevenLabs package is not installed. TTS functionality will fail.")
            return

        try:
            self.eleven = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        except Exception as e:
            print(f"CRITICAL: Failed to initialize ElevenLabs client: {e}. TTS functionality will fail.")
            return

        print(f"\n=== Audio System Initialization ===")
        print(f"Sample Rate: {self.sample_rate} Hz")
        print(f"Frame Length: {self.frame_length} samples")
        print(f"Audio debug logs: {log_file}")
        print("=================================\n")
        self._initialized = True

    def is_initialized(self) -> bool:
        """Check if the audio manager has been successfully initialized."""
        return self._initialized

    async def hard_reset(self):
        await self.stop_current_audio()
        await self.stop_audio_queue()
        await self.clear_queue()
        self.state = AudioManagerState()
        if hasattr(self, 'processed_response_ids'):
            self.processed_response_ids.clear()
        if not self.is_processing_queue:
            self.queue_processor_task = asyncio.create_task(self.process_audio_queue())

    async def queue_audio(self, audio_file: Optional[str] = None, generated_text: Optional[str] = None, delete_after_play: bool = False):
        if not self._initialized:
            print("AudioManager is not initialized. Cannot queue audio.")
            return

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
            elif self.queue_processor_task and self.queue_processor_task.done():
                print("Restarting completed queue processor task")
                self.queue_processor_task = asyncio.create_task(self.process_audio_queue())
        else:
            print("No audio file or text provided to queue_audio.")

    def _generate_unique_audio_filename(self, ext="mp3") -> str:
        ts = int(time.time() * 1000)
        unique = uuid.uuid4().hex
        return os.path.join(AUDIO_CACHE_DIR, f"tts_{ts}_{unique}.{ext}")

    async def _save_tts_to_file(self, text: str, file_path: str):
        if not self._initialized or self.eleven is None:
            print("ElevenLabs client not available. Cannot save TTS.")
            raise RuntimeError("ElevenLabs client not initialized.")

        print(f"🔊 [AudioManager] Generating TTS MP3 for: {text[:64]}...")
        
        try:
            # Using the new ElevenLabs v2 API
            audio_stream = self.eleven.text_to_speech.convert(
                text=text,
                voice_id=ELEVENLABS_VOICE,
                model_id=ELEVENLABS_MODEL,
                output_format="mp3_24000_48"  # Lower sample rate for warmer, robotic character
            )
            
            # Collect audio chunks
            audio_data_chunks = []
            for chunk in audio_stream:
                if chunk:
                    audio_data_chunks.append(chunk)
            
            audio_bytes = b"".join(audio_data_chunks)

            if not audio_bytes:
                print("❌ [AudioManager] ElevenLabs generated no audio data.")
                raise RuntimeError("ElevenLabs generated empty audio.")
            
            print(f"🎵 [AudioManager] ElevenLabs generated {len(audio_bytes)} bytes")
            
            with open(file_path, 'wb') as f:
                f.write(audio_bytes)
                f.flush()
                os.fsync(f.fileno())
                
            print(f"✅ [AudioManager] Saved TTS audio to: {file_path}")
            
        except Exception as e:
            print(f"❌ [AudioManager] ElevenLabs error during TTS generation or saving: {e}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as rm_e:
                    print(f"Failed to remove partially saved file {file_path}: {rm_e}")
            raise

    async def process_audio_queue(self):
        if not self._initialized:
            print("AudioManager not initialized. Cannot process audio queue.")
            self.is_processing_queue = False
            return

        self.is_processing_queue = True
        print("Audio queue processor started.")
        try:
            while self.is_processing_queue:
                try:
                    audio_file, _, delete_after_play = await self.audio_queue.get()
                    if audio_file:
                        print(f"Processing from queue: {audio_file}")
                        await self.play_audio(audio_file, delete_after_play)
                        async with self.state_lock:
                            self.state.currently_queued_files.discard(audio_file)
                    self.audio_queue.task_done()
                except asyncio.TimeoutError:
                    if self.audio_queue.empty() and not self.is_processing_queue:
                        break
                    continue 
                except Exception as e:
                    print(f"Error processing audio queue item: {e}")
                    await asyncio.sleep(0.1)
                    continue
        finally:
            self.is_processing_queue = False
            print("Audio queue processor stopped.")

    def _pygame_playback_worker(self, audio_file: str):
        """Worker function to handle pygame playback in a separate thread"""
        try:
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.play()
            
            # Wait for playback to finish
            while pygame.mixer.music.get_busy() and not self.stop_playback_event.is_set():
                time.sleep(0.1)
                
        except Exception as e:
            print(f"Error in pygame playback worker: {e}")

    async def play_audio(self, audio_file: str, delete_after_play: bool = False):
        if not self._initialized:
            print("AudioManager is not initialized. Cannot play audio.")
            return
        if not os.path.exists(audio_file):
            print(f"Audio file not found: {audio_file}")
            return

        async with self.playback_lock:
            async with self.state_lock:
                self.state.is_speaking = True
                self.state.is_playing = True
                self.state.playback_start_time = time.time()
                self.state.current_audio_file = audio_file
            
            self.audio_complete.clear()
            self.stop_playback_event.clear()
            print(f"Playing audio: {audio_file}")

            try:
                # Get audio duration for timing
                try:
                    audio_info = MP3(audio_file)
                    async with self.state_lock:
                        self.state.expected_duration = audio_info.info.length
                except Exception as e:
                    print(f"Warning: Error calculating audio duration for {audio_file}: {e}")
                    async with self.state_lock:
                        self.state.expected_duration = 2.0

                # Start playback in a separate thread
                self.playback_thread = threading.Thread(
                    target=self._pygame_playback_worker, 
                    args=(audio_file,)
                )
                self.playback_thread.start()

                # Wait for playback to complete
                while self.playback_thread.is_alive():
                    await asyncio.sleep(0.1)
                    
                self.playback_thread.join()

            except Exception as e:
                print(f"Error in play_audio for {audio_file}: {e}")
            finally:
                async with self.state_lock:
                    self.state.is_speaking = False
                    self.state.is_playing = False
                    self.state.playback_start_time = None
                    self.state.current_audio_file = None
                    self.state.expected_duration = None
                
                self.audio_complete.set()
                await self.audio_state_changed.put(('audio_completed', True))
                print(f"Finished playing: {audio_file}")

                if delete_after_play and os.path.exists(audio_file):
                    try:
                        os.remove(audio_file)
                        print(f"Deleted audio file: {audio_file}")
                    except Exception as e:
                        print(f"Error deleting audio file {audio_file}: {e}")

    async def stop_current_audio(self):
        print("Stopping current audio...")
        
        # Signal the playback thread to stop
        self.stop_playback_event.set()
        
        # Stop pygame playback
        try:
            pygame.mixer.music.stop()
        except Exception as e:
            print(f"Error stopping pygame playback: {e}")
        
        # Wait for playback thread to finish
        if self.playback_thread and self.playback_thread.is_alive():
            self.playback_thread.join(timeout=2.0)
            if self.playback_thread.is_alive():
                print("Warning: Playback thread did not stop gracefully")

        async with self.state_lock:
            if self.state.is_playing:
                self.state.is_speaking = False
                self.state.is_playing = False
                self.state.playback_start_time = None
                self.state.current_audio_file = None
                self.state.expected_duration = None
        
        self.audio_complete.set()
        await self.audio_state_changed.put(('audio_stopped', True))
        print("Audio stop sequence complete.")

    async def stop_audio_queue(self):
        print("Attempting to stop audio queue processor...")
        self.is_processing_queue = False
        if self.queue_processor_task and not self.queue_processor_task.done():
            try:
                await self.audio_queue.put((None, None, False))
                await asyncio.wait_for(self.queue_processor_task, timeout=5.0)
                print("Audio queue processor task joined.")
            except asyncio.TimeoutError:
                print("Timeout waiting for queue processor task to stop. Cancelling.")
                self.queue_processor_task.cancel()
                try:
                    await self.queue_processor_task
                except asyncio.CancelledError:
                    print("Queue processor task was cancelled.")
            except Exception as e:
                print(f"Exception during queue processor stop: {e}")
        self.queue_processor_task = None

    async def clear_queue(self):
        print("Clearing audio queue...")
        cleared_count = 0
        while not self.audio_queue.empty():
            try:
                item = self.audio_queue.get_nowait()
                self.audio_queue.task_done()
                cleared_count += 1
            except asyncio.QueueEmpty:
                break
        async with self.state_lock:
            self.state.currently_queued_files.clear()
        print(f"Audio queue cleared. {cleared_count} items removed.")

    async def wait_for_audio_completion(self, timeout: Optional[float] = None):
        if self.state.is_playing:
            print("Waiting for current audio to complete...")
            try:
                await asyncio.wait_for(self.audio_complete.wait(), timeout=timeout)
                print("Audio reported complete.")
            except asyncio.TimeoutError:
                print(f"Timeout waiting for audio completion after {timeout}s.")
        else:
            print("No audio currently playing to wait for.")

    async def wait_for_queue_empty(self, timeout: Optional[float] = None):
        print("Waiting for audio queue to be empty...")
        try:
            await asyncio.wait_for(self.audio_queue.join(), timeout=timeout)
            print("Audio queue is empty.")
        except asyncio.TimeoutError:
             print(f"Timeout waiting for audio queue to empty after {timeout}s. {self.audio_queue.qsize()} items remaining.")

    async def initialize_input(self):
        print("AudioManager: initialize_input() called (placeholder).")
        if not self._initialized:
            print("Warning: initialize_input called but core AudioManager not initialized.")
        pass

    def reset_audio_state(self):
        print("Resetting audio state...")
        asyncio.create_task(self.stop_current_audio())
        asyncio.create_task(self.clear_queue())
        
        self.state = AudioManagerState()
        
        if not self.audio_complete.is_set():
            self.audio_complete.set()
        print("Audio state reset.")

    def __del__(self):
        print("AudioManager.__del__ called. Cleaning up pygame.")
        self.is_processing_queue = False
        
        try:
            pygame.mixer.quit()
            print("Pygame mixer terminated.")
        except Exception as e:
            print(f"Exception during pygame cleanup in __del__: {e}")

    async def shutdown(self):
        """Gracefully shutdown the AudioManager."""
        print("AudioManager: Initiating shutdown...")
        await self.stop_current_audio()
        await self.stop_audio_queue()
        await self.clear_queue()
        
        try:
            pygame.mixer.quit()
            print("AudioManager: Pygame mixer terminated during shutdown.")
        except Exception as e:
            print(f"Exception during pygame shutdown: {e}")
            
        print("AudioManager: Shutdown complete.")
