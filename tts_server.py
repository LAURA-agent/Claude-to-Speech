#!/usr/bin/env python3

import sys
import os
import time
import traceback
from pathlib import Path
import logging
logging.getLogger('quart.app').setLevel(logging.WARNING)

from quart import Quart, request, jsonify
from quart_cors import cors

# Import your audio and streaming handler modules
sys.path.insert(0, "/home/user/claude-to-speech/LAURA_scripts")
from audio_manager_plugin import AudioManager
from smart_streaming_processor import StreamingTTSHandler

# Configuration - only server-side settings
CONFIG = {
    "output_dir": str(Path.home() / "LAURA" / "audio_cache")
}

os.makedirs(CONFIG["output_dir"], exist_ok=True)

app = Quart(__name__)
cors(app, allow_origin="*")

audio_manager = None
streaming_handler = None

@app.route('/stop_audio', methods=['POST'])
async def stop_audio():
    if audio_manager:
        try:
            await audio_manager.stop_current_audio()
            await audio_manager.clear_queue()
            return jsonify({"success": True, "message": "Audio stopped"})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        return jsonify({"success": False, "error": "Audio manager not available"}), 500

@app.route('/stream', methods=['POST'])
async def handle_stream():
    """
    Handle streaming text chunks from browser extension with response ID tracking.
    """
    global streaming_handler
    if not streaming_handler:
        streaming_handler = StreamingTTSHandler(audio_manager)

    try:
        data = await request.json
        text = data.get('text', '')
        is_complete = data.get('is_complete', False)
        response_id = data.get('response_id', f'unknown-{int(time.time())}')

        if not text:
            return jsonify({"error": "No text provided"}), 400

        print(f"📥 Stream chunk [{response_id}]: {len(text)} chars, complete: {is_complete}")

        # Pass response_id to the handler for state tracking
        await streaming_handler.process_stream_chunk(text, is_complete, response_id)

        return jsonify({
            "success": True,
            "processed": True,
            "text_length": len(text),
            "is_complete": is_complete,
            "response_id": response_id
        })

    except Exception as e:
        print(f"❌ Stream error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/reset_conversation', methods=['POST'])
async def reset_conversation():
    """
    Resets the conversation state and audio queue with response ID tracking.
    """
    global streaming_handler
    try:
        data = await request.json
        response_id = data.get('response_id', f'reset-{int(time.time())}')
        
        print(f"🔄 Reset conversation for response: {response_id}")
        
        # Reset with response ID for better state management
        if streaming_handler:
            streaming_handler.processed_response_ids.clear()
            await streaming_handler.reset_conversation(response_id)
        if audio_manager:
            await audio_manager.clear_queue()
            
        return jsonify({
            "success": True, 
            "response_id": response_id,
            "message": f"Reset conversation state for {response_id}"
        })
    except Exception as e:
        print(f"❌ Reset error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/tts', methods=['POST'])
async def text_to_speech():
    """
    Handle manual TTS requests (single-shot, not streaming) with response ID.
    """
    global streaming_handler
    try:
        data = await request.json
        text = data.get('text', '')
        response_id = data.get('response_id', f'manual-{int(time.time())}')
        
        if not text:
            return jsonify({"error": "No text provided"}), 400

        if not streaming_handler:
            streaming_handler = StreamingTTSHandler(audio_manager)

        print(f"📤 Manual TTS [{response_id}]: {len(text)} chars")
        
        # Treat manual requests as complete chunks with response ID
        await streaming_handler.process_stream_chunk(text, is_complete=True, response_id=response_id)

        return jsonify({
            "success": True, 
            "processed": True,
            "response_id": response_id
        })

    except Exception as e:
        print(f"❌ ERROR: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/')
def home():
    return "Claude-to-Speach TTS Server is running!"

@app.before_serving
async def startup():
    global audio_manager
    print("Initializing audio manager...")
    audio_manager = AudioManager()
    try:
        await audio_manager.initialize_input()
        print("Audio manager initialized successfully")
    except Exception as e:
        print(f"Error initializing audio manager: {e}")
        audio_manager = None

@app.after_serving
async def shutdown():
    global audio_manager
    if audio_manager:
        print("Shutting down audio manager...")
        await audio_manager.stop_audio_queue()

if __name__ == '__main__':
    print("Starting Smart TTS Server on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=False)
