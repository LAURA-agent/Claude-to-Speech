# integrated_tts_launcher.py
#!/usr/bin/env python3
"""
Integrated TTS Server + Configuration Manager Launcher
One script to rule them all!
"""

import asyncio
import threading
import time
import sys
import logging
from pathlib import Path

# Your existing TTS server imports
from tts_server import app as tts_app, logger as tts_logger
from configuration_manager import create_interface

def start_config_manager():
    """Start the Gradio config interface in a separate thread"""
    print("🎛️ Starting Configuration Manager on http://127.0.0.1:5001")
    
    interface = create_interface()
    interface.launch(
        server_name="127.0.0.1",
        server_port=5001,
        share=False,
        inbrowser=False,  # Don't auto-open browser
        show_error=True,
        quiet=True  # Reduce Gradio logs
    )

def start_tts_server():
    """Start the TTS server"""
    try:
        from config.tts_config import SERVER_CONFIG
        host = SERVER_CONFIG.get('host', '0.0.0.0')
        port = SERVER_CONFIG.get('port', 5000)
    except ImportError:
        host = '0.0.0.0'
        port = 5000
    
    print(f"🎤 Starting TTS Server on http://{host}:{port}")
    tts_app.run(host=host, port=port, debug=False, use_reloader=False)

def main():
    print("🚀 Claude-to-Speech Integrated System Starting...")
    print("=" * 50)
    
    # Start config manager in background thread
    config_thread = threading.Thread(target=start_config_manager, daemon=True)
    config_thread.start()
    
    # Give Gradio a moment to start
    time.sleep(2)
    
    print("✅ Configuration Manager: http://127.0.0.1:5001")
    print("🎛️ Manage voices, settings, and configurations there")
    print("=" * 50)
    
    # Start TTS server in main thread (this blocks)
    try:
        start_tts_server()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down integrated system...")
        sys.exit(0)

if __name__ == "__main__":
    main()
