#!/usr/bin/env python3

import sys
import json
import struct
import os
import time
import traceback
from pathlib import Path

# Debug log
DEBUG_LOG = os.path.expanduser("~/bridge_debug.log")

def log_debug(message):
    with open(DEBUG_LOG, "a") as f:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        f.write(f"[{timestamp}] {message}\n")

# Log startup info
log_debug("===== BRIDGE STARTUP =====")
log_debug(f"Python version: {sys.version}")
log_debug(f"Working directory: {os.getcwd()}")
log_debug(f"Script path: {os.path.abspath(__file__)}")
log_debug(f"Arguments: {sys.argv}")
log_debug(f"Environment PATH: {os.environ.get('PATH', 'Not found')}")

# Try importing elevenlabs
try:
    from elevenlabs.client import ElevenLabs
    log_debug("Successfully imported elevenlabs")
except Exception as e:
    log_debug(f"Error importing elevenlabs: {e}")
    log_debug(traceback.format_exc())
    sys.exit(1)

CONFIG = {
    "tts_engine": "elevenlabs",
    "elevenlabs_key": "sk_2e9430dbeccdecec954973179fe998b4bec86ba9c081f300",  # Replace with your actual key
    "voice": "L.A.U.R.A.",
    "elevenlabs_model": "eleven_flash_v2_5",
    "output_dir": str(Path.home() / "claude_audio")
}

class ClaudeTTSBridge:
    def __init__(self):
        # Create output directory if it doesn't exist
        os.makedirs(CONFIG["output_dir"], exist_ok=True)
        
        # Initialize ElevenLabs client
        self.eleven = ElevenLabs(api_key=CONFIG["elevenlabs_key"])
        
    def generate_audio(self, text):
        """Generate audio using ElevenLabs API"""
        if not text.strip():
            print("Warning: Empty text received", file=sys.stderr)
            return None
            
        try:
            print(f"Generating audio for: {text[:50]}...", file=sys.stderr)
            
            audio = b"".join(self.eleven.generate(
                text=text,
                voice=CONFIG["voice"],
                model=CONFIG["elevenlabs_model"],
                output_format="mp3_44100_128"
            ))
            
            return audio
        except Exception as e:
            print(f"Error generating audio: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return None
    
    def play_audio(self, audio_data):
        """Save audio to temp file and play it"""
        if not audio_data:
            return False
            
        # Create unique filename based on timestamp
        timestamp = int(time.time())
        filepath = Path(CONFIG["output_dir"]) / f"claude_speech_{timestamp}.mp3"
        
        try:
            # Save audio to file
            with open(filepath, "wb") as f:
                f.write(audio_data)
                f.flush()
                os.fsync(f.fileno())
            
            # Play audio using mpg123
            subprocess.run(['/usr/bin/mpg123', '-q', str(filepath)], 
                          stdout=subprocess.DEVNULL, 
                          stderr=subprocess.DEVNULL)
            
            return True
        except Exception as e:
            print(f"Error playing audio: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return False
    
    def read_message(self):
        """Read a message from Chrome extension through stdin"""
        try:
            # First 4 bytes are the message length
            length_bytes = sys.stdin.buffer.read(4)
            if not length_bytes:
                return None
            
            # Convert to integer
            message_length = struct.unpack('i', length_bytes)[0]
            
            # Read the JSON message
            message_json = sys.stdin.buffer.read(message_length).decode('utf-8')
            
            # Parse JSON
            return json.loads(message_json)
        except Exception as e:
            print(f"Error reading message: {e}", file=sys.stderr)
            return None
    
    def process_message(self, message):
        """Process a message from Chrome extension"""
        try:
            # Extract text from message
            text = message.get('text', '')
            
            if not text.strip():
                print("Received empty text", file=sys.stderr)
                return
            
            # Generate and play audio
            audio_data = self.generate_audio(text)
            if audio_data:
                self.play_audio(audio_data)
                
        except Exception as e:
            print(f"Error processing message: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
    
    def run(self):
        """Main processing loop"""
        try:
            log_debug("Claude TTS Bridge started")
            print("Claude TTS Bridge started", file=sys.stderr)
            
            while True:
                log_debug("Waiting for message...")
                # Read message from Chrome extension
                message = self.read_message()
                
                if message is None:
                    log_debug("End of input stream, exiting")
                    print("End of input stream, exiting", file=sys.stderr)
                    break
                
                log_debug(f"Received message: {message}")
                # Process message (no response needed)
                self.process_message(message)
                
        except KeyboardInterrupt:
            log_debug("Process terminated by user")
            print("Process terminated by user", file=sys.stderr)
        except Exception as e:
            log_debug(f"Fatal error: {e}")
            print(f"Fatal error: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            traceback_str = traceback.format_exc()
            log_debug(traceback_str)

if __name__ == "__main__":
    bridge = ClaudeTTSBridge()
    bridge.run()
