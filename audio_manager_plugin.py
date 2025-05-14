#!/usr/bin/env python3

import os
import time
import asyncio
import pyaudio
from mutagen.mp3 import MP3
from asyncio import Event
import numpy as np
from dataclasses import dataclass
from typing import Optional, Dict, Any
from dataclasses import dataclass, field

@dataclass
class AudioManagerState:
    """
    Centralized state tracking for audio system.
    
    Attributes:
        is_playing (bool): Indicates if any audio is currently playing
        is_speaking (bool): Indicates if TTS audio is currently playing
        is_listening (bool): Indicates if audio input is being captured
        playback_start_time (float): Timestamp when current audio started
        current_audio_file (str): Path to currently playing audio file
        expected_duration (float): Expected duration of current audio in seconds
    """
    is_playing: bool = False
    is_speaking: bool = False
    is_listening: bool = False
    playback_start_time: Optional[float] = None
    current_audio_file: Optional[str] = None
    expected_duration: Optional[float] = None
    currently_queued_files: set = field(default_factory=set)
    
class AudioManager:
    """
    Manages audio input/output operations with proper state tracking and resource management.
    
    This class handles:
    - Audio input capture for speech recognition
    - Audio playback for TTS and notification sounds
    - Queue management for sequential audio playback
    - State tracking for coordination with other system components
    """
    
    def __init__(self, pv_access_key=None):
        """
        Initialize AudioManager with required resources and state tracking.
        
        Args:
            pv_access_key: Optional key for Picovoice integration (unused in current version)
        """
        # Redirect ALSA/JACK messages to log file
        import ctypes
        import datetime
        
        # Create logs directory if it doesn't exist
        os.makedirs('logs', exist_ok=True)
        
        # Create log file with timestamp
        log_file = f"logs/audio_init_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        
        # Load ALSA error handler
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
            pass  # Silently continue if ALSA redirection fails
        
        # Initialize PyAudio for audio I/O
        self.pa = pyaudio.PyAudio()
        self.audio_stream = None
        self.current_process = None
        
        # Event and state management
        self.audio_complete = Event()
        self.audio_complete.set()
        self.audio_state_changed = asyncio.Queue()
        
        # Locks for thread safety
        self.activation_lock = asyncio.Lock()
        self.playback_lock = asyncio.Lock()
        self.state_lock = asyncio.Lock()
        
        # Centralized state tracking
        self.state = AudioManagerState()
        
        # Audio queue for sequential playback
        self.audio_queue = asyncio.Queue()
        self.queue_processor_task = None
        self.is_processing_queue = False
        
        # Audio frame configuration
        self.sample_rate = 16000  # Standard sample rate for speech recognition
        self.frame_length = 2048  # Buffer size for audio frames
        
        print(f"\n=== Audio System Initialization ===")
        print(f"Sample Rate: {self.sample_rate} Hz")
        print(f"Frame Length: {self.frame_length} samples")
        print(f"Audio debug logs: {log_file}")
        print("=================================\n")

    async def clear_queue(self):
        """
        Clear the audio playback queue and stop any currently playing audio.
        
        This ensures that no old or pending audio is played if a new context or system command occurs.
        """
        # Clear all items in the queue
        if hasattr(self, 'audio_queue'):
            try:
                while not self.audio_queue.empty():
                    self.audio_queue.get_nowait()
                    self.audio_queue.task_done()
            except Exception as e:
                print(f"Error clearing audio queue: {e}")
        
        # Stop current playback if any
        await self.stop_current_audio()

    async def get_state(self) -> Dict[str, Any]:
        """
        Get current audio system state in a thread-safe manner.
        
        Returns:
            Dict containing current state values for all tracked attributes
        """
        async with self.state_lock:
            return {
                "is_playing": self.state.is_playing,
                "is_speaking": self.state.is_speaking,
                "is_listening": self.state.is_listening,
                "playback_start_time": self.state.playback_start_time,
                "current_audio_file": self.state.current_audio_file,
                "expected_duration": self.state.expected_duration
            }

    @property
    def is_playing(self):
        """Property accessor for state.is_playing"""
        return self.state.is_playing
        
    @property
    def is_speaking(self):
        """Property accessor for state.is_speaking"""
        return self.state.is_speaking
    
    @property
    def is_listening(self):
        """Property accessor for state.is_listening"""
        return self.state.is_listening
    
    @property
    def playback_start_time(self):
        """Property accessor for state.playback_start_time"""
        return self.state.playback_start_time
    
    @property
    def current_audio_file(self):
        """Property accessor for state.current_audio_file"""
        return self.state.current_audio_file
    
    @property
    def expected_duration(self):
        """Property accessor for state.expected_duration"""
        return self.state.expected_duration
                
    async def initialize_input(self):
        """
        Initialize audio input stream for capturing speech.
        
        Raises:
            Exception: If audio device initialization fails
        """
        async with self.activation_lock:
            try:
                if self.audio_stream is None:
                    self.audio_stream = self.pa.open(
                        rate=self.sample_rate,
                        channels=1,
                        format=pyaudio.paInt16,
                        input=True,
                        frames_per_buffer=self.frame_length
                    )
                await self.audio_state_changed.put(('input_initialized', True))
            except Exception as e:
                await self.audio_state_changed.put(('error', str(e)))
                print(f"Error initializing input devices: {e}")
                await self.cleanup()
                raise

    async def start_listening(self):
        """
        Start audio input capture for speech recognition.
        
        Waits for any current speech playback to complete before starting input.
        
        Returns:
            Tuple of (audio_stream, None) - None is placeholder for future metadata
        """
        if self.state.is_speaking:
            await self.audio_complete.wait()
        
        await self.initialize_input()
        async with self.state_lock:
            self.state.is_listening = True
        return self.audio_stream, None

    async def stop_listening(self):
        """
        Stop audio input capture and cleanup resources.
        
        This method ensures proper cleanup of audio input resources
        even if errors occur during shutdown.
        """
        async with self.state_lock:
            self.state.is_listening = False
        if self.audio_stream:
            try:
                self.audio_stream.stop_stream()
                self.audio_stream.close()
            except Exception as e:
                print(f"ERROR: Failed to close audio stream: {e}")
            finally:
                self.audio_stream = None

    # Replace the queue_audio method with this improved version:
    async def queue_audio(self, audio_file: Optional[str] = None, generated_text: Optional[str] = None, delete_after_play: bool = False):
        """
        Add audio to playback queue with deduplication.
        """
        # Check if this exact file is already queued or playing
        if audio_file:
            async with self.state_lock:
                if audio_file in self.state.currently_queued_files or audio_file == self.state.current_audio_file:
                    print(f"Audio file already queued/playing, skipping: {audio_file}")
                    return
                self.state.currently_queued_files.add(audio_file)
        
        await self.audio_queue.put((audio_file, generated_text, delete_after_play))
        
        # Start queue processor if not already running
        if not self.is_processing_queue:
            self.queue_processor_task = asyncio.create_task(self.process_audio_queue())

    # Update process_audio_queue to remove from tracking:
    async def process_audio_queue(self):
        """Process queued audio files with proper cleanup."""
        self.is_processing_queue = True
        try:
            while True:
                try:
                    audio_file, generated_text, delete_after_play = await self.audio_queue.get()
                    
                    if audio_file:
                        await self.play_audio(audio_file, delete_after_play)
                        # Remove from queued tracking
                        async with self.state_lock:
                            self.state.currently_queued_files.discard(audio_file)
                            
                    self.audio_queue.task_done()
                    
                    if self.audio_queue.empty():
                        break
                        
                except Exception as e:
                    print(f"Error processing audio queue item: {e}")
                    continue
                    
        finally:
            self.is_processing_queue = False

    async def play_audio(self, audio_file: str, delete_after_play: bool = False):
        """
        Play audio file with state tracking and resource management.
        
        Args:
            audio_file: Path to MP3 file to play
            delete_after_play: Whether to delete the file after playback
                
        This method handles:
        - State updates for playback tracking
        - Duration calculation for timing coordination
        - Process management for mpg123 playback
        - Cleanup after playback completion
        """
        async with self.playback_lock:
            async with self.state_lock:
                self.state.is_speaking = True
                self.state.is_playing = True
                self.state.playback_start_time = time.time()
                self.state.current_audio_file = audio_file
            self.audio_complete.clear()
            
            try:
                # Calculate audio duration for timing coordination
                try:
                    audio = MP3(audio_file)
                    async with self.state_lock:
                        self.state.expected_duration = audio.info.length
                except Exception as e:
                    print(f"Error calculating audio duration: {e}")
                    async with self.state_lock:
                        self.state.expected_duration = 2.0
                
                # Play audio using mpg123 (external process)
                self.current_process = await asyncio.create_subprocess_shell(
                    f'/usr/bin/mpg123 -q {audio_file}',
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
                
                await self.current_process.wait()
                await asyncio.sleep(0.7)  # Buffer time for audio device release
                
            except Exception as e:
                print(f"Error in play_audio: {e}")
            finally:
                # Cleanup and state reset
                self.current_process = None
                async with self.state_lock:
                    self.state.is_speaking = False
                    self.state.is_playing = False
                    self.state.playback_start_time = None
                    self.state.current_audio_file = None
                    self.state.expected_duration = None
                self.audio_complete.set()
                await self.audio_state_changed.put(('audio_completed', True))
                
                # Delete file if requested
                if delete_after_play and os.path.exists(audio_file):
                    try:
                        os.remove(audio_file)
                        print(f"Deleted audio file: {audio_file}")
                    except Exception as e:
                        print(f"Error deleting audio file {audio_file}: {e}")

    async def stop_current_audio(self):
        """
        Stop currently playing audio and reset state.
        
        This method ensures proper cleanup of audio playback resources
        and state reset even if errors occur during shutdown.
        """
        if self.current_process and self.state.is_speaking:
            try:
                self.current_process.terminate()
                await self.current_process.wait()
            except Exception as e:
                print(f"Error stopping current audio: {e}")
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

    async def wait_for_audio_completion(self):
        """
        Wait for current audio playback to complete.
        
        This method blocks until the audio_complete event is set,
        indicating that playback has finished.
        """
        await self.audio_complete.wait()

    async def wait_for_queue_empty(self):
        """
        Wait for audio queue to be completely processed.
        
        This method blocks until all queued audio files have been
        played and the queue is empty.
        """
        if hasattr(self, 'audio_queue'):
            await self.audio_queue.join()

    async def reset_audio_state(self):
        """
        Reset all audio states to initial values.
        
        This method performs a complete reset of the audio system,
        stopping input capture and clearing all state flags.
        """
        await self.stop_listening()
        async with self.state_lock:
            self.state = AudioManagerState()
        self.audio_complete.set()

    async def cleanup(self):
        """
        Clean up all audio resources.
        
        This method ensures proper shutdown of all audio components
        and should be called before program termination.
        """
        await self.stop_listening()
        try:
            self.pa.terminate()
        except Exception as e:
            print(f"Error terminating PyAudio: {e}")

    def read_audio_frame(self, frame_size: Optional[int] = None) -> Optional[bytes]:
        """
        Read a frame of audio data from the input stream.
        
        Args:
            frame_size: Optional custom frame size (defaults to self.frame_length)
            
        Returns:
            bytes containing audio data or None if error occurs
            
        This method is used by speech recognition systems to obtain
        raw audio data for processing.
        """
        if not self.audio_stream:
            return None
            
        if not frame_size:
            frame_size = self.frame_length
            
        try:
            return self.audio_stream.read(frame_size, exception_on_overflow=False)
        except Exception as e:
            print(f"Error reading audio frame: {e}")
            return None
