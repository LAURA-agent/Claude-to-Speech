#!/usr/bin/env python3
from quart import Quart, request, jsonify
from quart_cors import cors
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import time
import hashlib
import asyncio
from audio_manager_vosk import AudioManager
from pathlib import Path
import traceback
from collections import defaultdict

try:
    # Import ElevenLabs
    from elevenlabs.client import ElevenLabs
    print("Successfully imported ElevenLabs")
except ImportError as e:
    print(f"Error importing ElevenLabs: {e}")
    print("Make sure you're running this script within the virtual environment (venv)")
    sys.exit(1)

# Configuration
CONFIG = {
    "tts_engine": "elevenlabs",
    "elevenlabs_key": "sk_2e9430dbeccdecec954973179fe998b4bec86ba9c081f300",
    "voice": "L.A.U.R.A.",
    "elevenlabs_model": "eleven_flash_v2_5",
    "output_dir": str(Path.home() / "LAURA" / "audio_cache")
}

# Create output directory
os.makedirs(CONFIG["output_dir"], exist_ok=True)

# Initialize Flask app
app = Quart(__name__)
cors(app)

# Initialize ElevenLabs
eleven = ElevenLabs(api_key=CONFIG["elevenlabs_key"])

# Initialize AudioManager as a global variable
audio_manager = None

# Request tracking
request_cache = {}
client_requests = defaultdict(list)
CACHE_DURATION = 300  # 5 minutes
REQUEST_COOLDOWN = 2  # 2 seconds between similar requests
DUPLICATE_THRESHOLD = 3.0  # 3 seconds to catch duplicates

def cleanup_old_requests():
    """Remove old requests from cache and tracking"""
    current_time = time.time()
    
    # Clean up cache
    expired_keys = [k for k, v in request_cache.items() 
                    if current_time - v['timestamp'] > CACHE_DURATION]
    for key in expired_keys:
        del request_cache[key]
    
    # Clean up client tracking
    for client_ip in list(client_requests.keys()):
        client_requests[client_ip] = [
            req for req in client_requests[client_ip] 
            if current_time - req['timestamp'] < REQUEST_COOLDOWN
        ]

@app.route('/')
def home():
    return "Claude TTS Server is running!"

@app.route('/tts', methods=['POST'])
async def text_to_speech(): 
    try:
        # Clean up old requests
        cleanup_old_requests()
        
        # Get client IP
        client_ip = request.remote_addr
        current_time = time.time()
        
        # Get text from request
        data = await request.json
        text = data.get('text', '')
        save_timestamp = data.get('save_timestamp', False)
        
        if not text:
            return jsonify({"error": "No text provided"}), 400
        
        # Generate request hash - use content only for better deduplication
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        request_hash = f"{client_ip}:{text_hash}"
        
        # Check for duplicates with longer timeout
        if request_hash in request_cache:
            cache_time = request_cache[request_hash]['timestamp']
            if current_time - cache_time < DUPLICATE_THRESHOLD:
                print(f"Duplicate text detected (within {DUPLICATE_THRESHOLD}s), skipping: {text[:30]}...")
                return jsonify({
                    "success": True,
                    "file_path": request_cache[request_hash]['file_path'],
                    "skipped": "duplicate"
                })
        
        # Check for rapid requests from same client
        recent_requests = [req for req in client_requests[client_ip] 
                          if current_time - req['timestamp'] < REQUEST_COOLDOWN]
        
        if len(recent_requests) > 0:
            print(f"Rate limiting client {client_ip}")
            return jsonify({"error": "Request too frequent, please wait"}), 429
        
        # Record this request
        client_requests[client_ip].append({
            'timestamp': current_time,
            'hash': request_hash
        })
        
        print(f"Received TTS request from {client_ip}: {text[:50]}...")
        
        # Generate audio
        print("Generating audio with ElevenLabs...")
        audio = b"".join(eleven.generate(
            text=text,
            voice=CONFIG["voice"],
            model=CONFIG["elevenlabs_model"],
            output_format="mp3_44100_128"
        ))
        
        # Determine file path based on timestamp preference
        if save_timestamp:
            # Save with timestamp in filename
            timestamp = int(current_time)
            file_path = os.path.join(CONFIG["output_dir"], f"claude_speech_{timestamp}.mp3")
        else:
            # Overwrite the same file
            file_path = os.path.join(CONFIG["output_dir"], "current_speech.mp3")
        
        # Save audio to file
        with open(file_path, 'wb') as f:
            f.write(audio)
        
        # Cache the result
        request_cache[request_hash] = {
            'file_path': file_path,
            'timestamp': current_time
        }
        
        print(f"Audio saved to: {file_path}")
        
        # Play the audio if audio manager is available
        if audio_manager:
            try:
                await audio_manager.queue_audio(file_path)
                print("Audio queued for playback")
            except Exception as e:
                print(f"Error playing audio: {e}")
        else:
            print("Audio manager not initialized - skipping playback")
        
        return jsonify({
            "success": True,
            "file_path": file_path
        })
        
    except Exception as e:
        print(f"Error in TTS endpoint: {e}")
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/stop_audio', methods=['POST'])
async def stop_audio():
    """Endpoint to stop current audio playback"""
    if audio_manager:
        try:
            await audio_manager.stop_current_audio()
            return jsonify({"success": True, "message": "Audio stopped"})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        return jsonify({"success": False, "error": "Audio manager not available"}), 500

@app.before_serving
async def startup():
    """Initialize audio manager before serving requests"""
    global audio_manager
    print("Initializing audio manager...")
    audio_manager = AudioManager()
    try:
        await audio_manager.initialize_input()
        print("Audio manager initialized successfully")
    except Exception as e:
        print(f"Error initializing audio manager: {e}")
        audio_manager = None

if __name__ == '__main__':
    print("Starting TTS Server on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
