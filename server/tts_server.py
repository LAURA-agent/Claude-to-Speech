#!/usr/bin/env python3

import asyncio
import sys
import os
import time
import traceback
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("tts_server.log", mode='a'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

logging.getLogger('quart.app').setLevel(logging.WARNING)
logging.getLogger('quart.serving').setLevel(logging.WARNING)

from quart import Quart, request, jsonify
from quart_cors import cors

# Ensure LAURA_scripts is in the Python path
# This assumes tts_server.py is in claude-to-speech and LAURA_scripts is a sibling or specified path
script_dir = Path(__file__).resolve().parent
laura_scripts_path = script_dir.parent / "LAURA_scripts" # Adjust if LAURA_scripts is elsewhere
if str(laura_scripts_path) not in sys.path:
    sys.path.insert(0, str(laura_scripts_path))
# Fallback if the above structure isn't fixed, use the original hardcoded path as a last resort
if not (laura_scripts_path / "audio_manager_plugin.py").exists():
     # Original path, adjust if your structure is different
    original_laura_path = "/home/user/claude-to-speech/LAURA_scripts"
    if original_laura_path not in sys.path:
        sys.path.insert(0, original_laura_path)


from audio_manager_plugin import AudioManager
from smart_streaming_processor import StreamingTTSHandler

CONFIG = {
    "output_dir": str(Path.home() / "LAURA" / "audio_cache"), # Ensure this path is correct
    "max_retries": 3,
    "retry_delay": 0.5
}

os.makedirs(CONFIG["output_dir"], exist_ok=True)

app = Quart(__name__)
app = cors(app, allow_origin="*") # Ensure CORS is applied correctly

audio_manager = None
streaming_handler = None

@app.route('/stop_audio', methods=['POST'])
async def stop_audio():
    if audio_manager:
        try:
            logger.info("Received /stop_audio request")
            await audio_manager.stop_current_audio()
            await audio_manager.clear_queue()
            logger.info("Audio stopped and queue cleared successfully")
            return jsonify({"success": True, "message": "Audio stopped and queue cleared"})
        except Exception as e:
            logger.error(f"Error stopping audio: {e}", exc_info=True)
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        logger.warning("Audio manager not available for /stop_audio")
        return jsonify({"success": False, "error": "Audio manager not available"}), 500

@app.route('/stream', methods=['POST'])
async def handle_stream():
    global streaming_handler
    if not streaming_handler: # Initialize if not already done
        if not audio_manager: # Should have been initialized at startup
            logger.error("Audio manager not initialized before stream handling!")
            return jsonify({"success": False, "error": "Audio manager not initialized"}), 500
        streaming_handler = StreamingTTSHandler(audio_manager)

    try:
        data = await request.json
        text = data.get('text', '')
        is_complete = data.get('is_complete', False)
        response_id = data.get('response_id', f'unknown-{int(time.time())}')

        if not text.strip(): # Check for empty or whitespace-only text
            logger.warning(f"Empty text provided for stream chunk {response_id}")
            return jsonify({"success": True, "message": "Empty text, skipped", "response_id": response_id}), 200 # Success, but did nothing

        logger.info(f"📥 Stream chunk [{response_id}]: {len(text)} chars, complete: {is_complete}")

        # No need to create a separate task if Quart handles requests concurrently
        # Directly await the processing
        await streaming_handler.process_stream_chunk(text, is_complete, response_id)
        
        # The logic for waiting for audio completion on final chunks might be better inside process_stream_chunk
        # or handled by the audio_manager itself if it has such a feature.
        # For now, keeping it here as per original structure.
        if is_complete and audio_manager:
            logger.info(f"Final chunk {response_id}, waiting for audio completion if queue is active.")
            # This wait might be very long if many items are queued. Consider timeout.
            await audio_manager.wait_for_audio_completion(timeout=30.0) # Added a timeout
            logger.info(f"Audio completion wait finished for {response_id}.")

        return jsonify({
            "success": True,
            "processed": True, # Indicates the server attempted to process
            "text_length": len(text),
            "is_complete": is_complete,
            "response_id": response_id
        })

    except asyncio.TimeoutError: # Specifically for wait_for_audio_completion
        logger.warning(f"Timeout waiting for audio completion for final chunk {response_id}")
        return jsonify({"success": True, "processed": True, "message": "Processing initiated, audio completion timed out", "response_id": response_id}), 202
    except Exception as e:
        logger.error(f"❌ Stream error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/reset_conversation', methods=['POST'])
async def reset_conversation():
    global streaming_handler
    try:
        data = await request.json
        response_id = data.get('response_id', f'reset-{int(time.time())}') # For logging context
        
        logger.info(f"🔄 Reset conversation requested (context: {response_id})")
        
        if streaming_handler:
            await streaming_handler.reset_conversation(response_id) # Pass context
        elif audio_manager: # If handler not init'd, still try to clear audio
             await audio_manager.clear_queue()
             await audio_manager.stop_current_audio()
             logger.info("Audio queue cleared and audio stopped during reset (handler not initialized).")

        return jsonify({
            "success": True, 
            "response_id": response_id,
            "message": f"Conversation reset successfully (context: {response_id})"
        })
    except Exception as e:
        logger.error(f"❌ Reset error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/tts', methods=['POST'])
async def text_to_speech():
    global streaming_handler
    if not streaming_handler: # Initialize if not already done
        if not audio_manager:
            logger.error("Audio manager not initialized before TTS handling!")
            return jsonify({"success": False, "error": "Audio manager not initialized"}), 500
        streaming_handler = StreamingTTSHandler(audio_manager)

    try:
        data = await request.json
        text = data.get('text', '')
        response_id = data.get('response_id', f'manual-{int(time.time())}')
        
        if not text.strip():
            logger.warning(f"Empty text provided for manual TTS {response_id}")
            return jsonify({"error": "No text provided"}), 400

        logger.info(f"📤 Manual TTS [{response_id}]: {len(text)} chars")
        
        # For manual TTS, it's typically a single complete phrase.
        # Process it as a complete chunk.
        await streaming_handler.process_stream_chunk(text, is_complete=True, response_id=response_id)
        
        # Optionally wait for this single audio to complete before responding fully
        if audio_manager:
            await audio_manager.wait_for_audio_completion(timeout=30.0)

        return jsonify({
            "success": True, 
            "processed": True,
            "response_id": response_id,
            "message": "Manual TTS processed"
        })

    except asyncio.TimeoutError:
        logger.warning(f"Timeout waiting for audio completion for manual TTS {response_id}")
        return jsonify({"success": True, "processed": True, "message": "Manual TTS initiated, audio completion timed out", "response_id": response_id}), 202
    except Exception as e:
        logger.error(f"❌ Manual TTS ERROR: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
async def health_check():
    try:
        # Basic check for audio manager
        audio_manager_status = "not initialized"
        if audio_manager:
            audio_manager_status = "ready" if audio_manager.is_initialized() else "initialization_failed_or_pending"
            
        return jsonify({
            "status": "ok",
            "server": "Claude-to-Speech TTS Server",
            "version": "2.1", # Incremented version
            "audio_manager": audio_manager_status,
            "timestamp": time.time()
        })
    except Exception as e:
        logger.error(f"Health check error: {e}", exc_info=True)
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/')
async def home():
    return "Claude-to-Speech TTS Server is running!"

@app.before_serving
async def startup():
    global audio_manager, streaming_handler
    logger.info("Server startup: Initializing audio manager...")
    try:
        audio_manager = AudioManager() # Initialize AudioManager
        # AudioManager's own initialize_input or similar method should be called if it exists
        # For example, if AudioManager has an async init:
        # await audio_manager.async_initialize() 
        # Or if it's synchronous and called within constructor or a specific method:
        # audio_manager.initialize_input() # Assuming this is synchronous or handled by AudioManager
        
        # Check if AudioManager has an explicit initialization method
        if hasattr(audio_manager, 'initialize_input') and asyncio.iscoroutinefunction(audio_manager.initialize_input):
            await audio_manager.initialize_input()
        elif hasattr(audio_manager, 'initialize_input'):
             audio_manager.initialize_input()

        if audio_manager.is_initialized(): # Add an is_initialized method to AudioManager
            logger.info("Audio manager initialized successfully.")
            streaming_handler = StreamingTTSHandler(audio_manager) # Init handler after audio_manager
            logger.info("StreamingTTSHandler initialized.")
        else:
            logger.error("Audio manager failed to initialize properly.")
            audio_manager = None # Set to None if init failed
            
    except Exception as e:
        logger.error(f"Fatal error during audio manager startup: {e}", exc_info=True)
        audio_manager = None # Ensure it's None if startup fails

@app.after_serving
async def shutdown():
    global audio_manager
    logger.info("Server shutdown: Cleaning up resources...")
    if audio_manager and hasattr(audio_manager, 'stop_audio_queue') and asyncio.iscoroutinefunction(audio_manager.stop_audio_queue):
        logger.info("Shutting down audio manager queue...")
        await audio_manager.stop_audio_queue()
    elif audio_manager and hasattr(audio_manager, 'cleanup'): # Generic cleanup
        if asyncio.iscoroutinefunction(audio_manager.cleanup):
            await audio_manager.cleanup()
        else:
            audio_manager.cleanup()
    logger.info("Server shutdown complete.")

if __name__ == '__main__':
    logger.info("Starting Smart TTS Server on http://127.0.0.1:5000")
    # Set debug=False for production/stable use
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
