# tts_server.py
#!/usr/bin/env python3

import asyncio
import sys 
import os
import time
import traceback
import logging
from pathlib import Path

# Configure logging for the server
logging.basicConfig(
    level=logging.INFO, # Can be DEBUG for more verbosity
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("tts_server.log", mode='a'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Suppress verbose logs from Quart framework
logging.getLogger('quart.app').setLevel(logging.WARNING)
logging.getLogger('quart.serving').setLevel(logging.WARNING)

from quart import Quart, request, jsonify
from quart_cors import cors
from audio_manager_plugin import AudioManager
from smart_streaming_processor import SimplifiedTTSProcessor # Updated import

CONFIG = {
    "output_dir": str(Path.home() / "Desktop" / "laura" / "audio_cache"), # Consolidated audio cache location
    "max_retries": 3,
    "retry_delay": 0.5
}

os.makedirs(CONFIG["output_dir"], exist_ok=True)

app = Quart(__name__)
app = cors(app, allow_origin="*") # Allow all origins for browser extension

audio_manager = None
tts_processor = None # Renamed from streaming_handler

@app.before_serving
async def startup():
    global audio_manager, tts_processor
    logger.info("Server startup: Initializing audio manager...")
    try:
        audio_manager = AudioManager()
        if hasattr(audio_manager, 'initialize_input') and asyncio.iscoroutinefunction(audio_manager.initialize_input):
            await audio_manager.initialize_input()
        elif hasattr(audio_manager, 'initialize_input'):
            audio_manager.initialize_input() # Synchronous call if not async
            
        if audio_manager.is_initialized():
            logger.info("Audio manager initialized successfully.")
            tts_processor = SimplifiedTTSProcessor(audio_manager) # Use the new simplified processor
            logger.info("SimplifiedTTSProcessor initialized.")
        else:
            logger.error("Audio manager failed to initialize properly. TTS functionality will be impaired.")
            # tts_processor will remain None if audio_manager fails
            
    except Exception as e:
        logger.error(f"Fatal error during audio manager startup: {e}", exc_info=True)
        audio_manager = None 
        tts_processor = None

@app.route('/stream', methods=['POST'])
async def stream_text():
    global tts_processor
    if not tts_processor:
        logger.error("TTS Processor not available for /stream request.")
        return jsonify({"success": False, "error": "TTS Processor not initialized"}), 500

    try:
        data = await request.get_json()
        text = data.get('text', '')
        is_complete = data.get('is_complete', False)
        response_id = data.get('response_id', f'stream-{int(time.time())}')
        source = data.get('source', 'claude')  # NEW: Track where this came from

        # Log differently based on source
        if source == 'gemini':
            logger.info(f"🎭 Received ArgoVox chunk for [{response_id}]: {len(text)} chars, complete: {is_complete}")
        else:
            logger.info(f"📥 Received Claude chunk for [{response_id}]: {len(text)} chars, complete: {is_complete}")
        
        # Process the chunk normally - your existing processor handles everything
        await tts_processor.process_chunk(
            text_content=text,
            full_response_id=response_id,
            is_complete=is_complete
        )
        
        # If this chunk is marked as complete, wait for audio processing
        if is_complete and audio_manager:
            logger.info(f"Final chunk for {response_id}. Waiting for audio queue to process...")
            await audio_manager.wait_for_queue_empty(timeout=30.0) 
            await audio_manager.wait_for_audio_completion(timeout=5.0)
            logger.info(f"Audio completion wait finished for {response_id}.")

        return jsonify({
            "success": True,
            "processed": True,
            "response_id": response_id,
            "source": source  # Echo back so client knows we got it
        })

    except asyncio.TimeoutError:
        logger.warning(f"Timeout waiting for audio completion for final chunk {response_id}")
        return jsonify({"success": True, "message": "Processing initiated, audio completion timed out", "response_id": response_id}), 202
    except Exception as e:
        logger.error(f"❌ Stream error for {response_id}: {e}", exc_info=True)
        return jsonify({"error": str(e), "success": False}), 500

@app.route('/stop_audio', methods=['POST'])
async def stop_audio():
    if audio_manager:
        try:
            logger.info("Received /stop_audio request")
            await audio_manager.stop_current_audio()
            # Optionally, also clear the queue if stop means discard pending
            await audio_manager.clear_queue() 
            logger.info("Audio stopped and queue cleared successfully via /stop_audio.")
            return jsonify({"success": True, "message": "Audio stopped and queue cleared"})
        except Exception as e:
            logger.error(f"Error stopping audio: {e}", exc_info=True)
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        logger.warning("Audio manager not available for /stop_audio")
        return jsonify({"success": False, "error": "Audio manager not available"}), 500

@app.route('/reset_conversation', methods=['POST'])
async def reset_conversation():
    global tts_processor
    try:
        data = await request.get_json()
        response_id_context = data.get('response_id', f'reset-{int(time.time())}')
        
        logger.info(f"🔄 Reset conversation requested (context: {response_id_context})")
        
        if tts_processor:
            await tts_processor.reset_conversation(response_id_context)
        elif audio_manager: # Fallback if processor somehow not init but audio_manager is
             await audio_manager.clear_queue()
             await audio_manager.stop_current_audio()
             logger.info("Audio queue cleared and audio stopped during reset (processor not available).")
        else:
            logger.warning("Neither TTS processor nor audio manager available for reset.")


        return jsonify({
            "success": True, 
            "response_id": response_id_context,
            "message": f"Conversation reset successfully (context: {response_id_context})"
        })
    except Exception as e:
        logger.error(f"❌ Reset error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/tts', methods=['POST'])
async def text_to_speech_manual():
    global tts_processor
    if not tts_processor:
        logger.error("TTS Processor not available for /tts (manual) request.")
        return jsonify({"success": False, "error": "TTS Processor not initialized"}), 500

    try:
        data = await request.get_json()
        text = data.get('text', '')
        response_id = data.get('response_id', f'manual-{int(time.time())}')
        
        if not text.strip():
            logger.warning(f"Empty text provided for manual TTS {response_id}, skipping.")
            return jsonify({"error": "No text provided"}), 400

        logger.info(f"📤 Manual TTS [{response_id}]: {len(text)} chars")
        await tts_processor.process_chunk(
            text_content=text,
            full_response_id=response_id,
            is_complete=True # Manual TTS is always a complete, single unit
        )
        
        if audio_manager:
            logger.info(f"Manual TTS {response_id}. Waiting for audio completion (timeout 30s).")
            await audio_manager.wait_for_audio_completion(timeout=30.0)
            logger.info(f"Audio completion wait finished for manual TTS {response_id}.")

        return jsonify({
            "success": True, 
            "processed": True,
            "response_id": response_id,
            "message": "Manual TTS processed"
        })

    except asyncio.TimeoutError:
        logger.warning(f"Timeout waiting for audio completion for manual TTS {response_id}")
        return jsonify({"success": True, "message": "Manual TTS initiated, audio completion timed out", "response_id": response_id}), 202
    except Exception as e:
        logger.error(f"❌ Manual TTS ERROR for {response_id}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
async def health_check():
    audio_manager_status = "not initialized"
    if audio_manager:
        audio_manager_status = "ready" if audio_manager.is_initialized() else "initialization_failed_or_pending"
        
    return jsonify({
        "status": "ok",
        "server": "Claude-to-Speech TTS Server",
        "version": "2.5.0-simplified", # Version update
        "audio_manager": audio_manager_status,
        "tts_processor": "SimplifiedTTSProcessor" if tts_processor else "not_initialized",
        "features": {
            "one_shot_mode": "client_driven",
            "delta_processing": "client_driven",
            "server_text_cleaning": True,
            "zone_filtering": "client_driven (server trusts client chunks)"
        },
        "timestamp": time.time()
    })

@app.route('/status', methods=['GET'])
async def playback_status():
    """
    Check current playback status - used by reachy-mini mood plugin
    Returns whether audio is currently playing
    """
    is_playing = False
    current_file = None

    if audio_manager and hasattr(audio_manager, 'state'):
        is_playing = getattr(audio_manager.state, 'is_playing', False)
        current_file = getattr(audio_manager.state, 'current_audio_file', None)

    return jsonify({
        "is_playing": is_playing,
        "current_file": current_file,
        "timestamp": time.time()
    })

@app.route('/')
async def home():
    return "Claude-to-Speech TTS Server (Simplified Processor) is running!"

@app.route('/reload_voice', methods=['POST']) # Reload voice config and reinitialize
async def reload_voice():
    global audio_manager, tts_processor
    logger.info("Received /reload_voice request. Reloading voice configuration...")
    try:
        # Reload the voice configuration
        import importlib
        from config import tts_config
        importlib.reload(tts_config)

        logger.info(f"Voice config reloaded. Active voice: {tts_config.ACTIVE_VOICE}")

        # Shutdown current audio manager
        if audio_manager:
            if hasattr(audio_manager, 'shutdown') and asyncio.iscoroutinefunction(audio_manager.shutdown):
                await audio_manager.shutdown()

        # Reinitialize with new voice settings
        audio_manager = AudioManager()
        if hasattr(audio_manager, 'initialize_input') and asyncio.iscoroutinefunction(audio_manager.initialize_input):
            await audio_manager.initialize_input()
        elif hasattr(audio_manager, 'initialize_input'):
            audio_manager.initialize_input()

        if audio_manager.is_initialized():
            tts_processor = SimplifiedTTSProcessor(audio_manager)
            logger.info(f"Audio system reinitialized with voice: {tts_config.ACTIVE_VOICE}")
            return jsonify({
                "success": True,
                "message": "Voice configuration reloaded successfully.",
                "active_voice": tts_config.ACTIVE_VOICE
            })
        else:
            logger.error("Audio system reinitialization failed.")
            tts_processor = None
            return jsonify({"success": False, "error": "Audio system reinitialization failed."}), 500

    except Exception as e:
        logger.error(f"Error during voice reload: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/reset_audio', methods=['POST']) # For full audio system re-init
async def reset_audio_system():
    global audio_manager, tts_processor
    logger.info("Received /reset_audio request. Attempting to reinitialize audio system.")
    try:
        if audio_manager:
            if hasattr(audio_manager, 'shutdown') and asyncio.iscoroutinefunction(audio_manager.shutdown):
                await audio_manager.shutdown()
            # No explicit else for non-async shutdown, assuming __del__ or manual stop handles it
        
        # Reinitialize audio_manager and tts_processor
        audio_manager = AudioManager() # This might re-run pygame.mixer.init()
        if hasattr(audio_manager, 'initialize_input') and asyncio.iscoroutinefunction(audio_manager.initialize_input):
            await audio_manager.initialize_input()
        elif hasattr(audio_manager, 'initialize_input'):
             audio_manager.initialize_input()


        if audio_manager.is_initialized():
            tts_processor = SimplifiedTTSProcessor(audio_manager)
            logger.info("Audio system and SimplifiedTTSProcessor reinitialized successfully.")
            return jsonify({"success": True, "message": "Audio system reinitialized successfully."})
        else:
            logger.error("Audio system reinitialization failed.")
            tts_processor = None
            return jsonify({"success": False, "error": "Audio system reinitialization failed."}), 500
            
    except Exception as e:
        logger.error(f"Error during audio system reset: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.after_serving
async def shutdown_server(): # Renamed to avoid conflict with audio_manager.shutdown
    global audio_manager
    logger.info("Server shutdown: Cleaning up resources...")
    if audio_manager:
        if hasattr(audio_manager, 'shutdown') and asyncio.iscoroutinefunction(audio_manager.shutdown):
            logger.info("Shutting down audio manager...")
            await audio_manager.shutdown()
    logger.info("Server shutdown complete.")

if __name__ == '__main__':
    logger.info("Starting Claude-to-Speech TTS Server (Simplified Processor) on http://0.0.0.0:5001")
    # debug=True enables reloader, which can be problematic for resources like pygame audio.
    # use_reloader=False is generally safer for applications with external resource management.
    app.run(host='0.0.0.0', port=5001, debug=False, use_reloader=False)
