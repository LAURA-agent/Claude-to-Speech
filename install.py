#!/usr/bin/env python3

import json
import os
from pathlib import Path

def install_native_messaging_host(extension_id=None):
    """Create and install the native messaging host manifest"""
    # Get script directory and bridge path
    script_dir = Path(__file__).resolve().parent
    bridge_path = script_dir / 'claude_tts_bridge.py'
    
    # Make bridge script executable
    os.chmod(bridge_path, 0o755)
    
    # If extension ID not provided, use a placeholder
    if not extension_id:
        extension_id = input("Enter your Chrome extension ID (or press Enter for placeholder): ")
        if not extension_id:
            extension_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            print(f"Using placeholder extension ID: {extension_id}")
            print("You'll need to update the manifest file later with your actual extension ID")
    
    # Create manifest content
    manifest = {
        "name": "com.claude.tts_bridge",
        "description": "Claude to Speech Bridge",
        "path": str(bridge_path.absolute()),
        "type": "stdio",
        "allowed_origins": [
            f"chrome-extension://{extension_id}/"
        ]
    }
    
    # Create Chrome/Chromium native messaging directory
    for browser in ['google-chrome', 'chromium']:
        nm_dir = Path.home() / '.config' / browser / 'NativeMessagingHosts'
        nm_dir.mkdir(parents=True, exist_ok=True)
        
        manifest_path = nm_dir / 'com.claude.tts_bridge.json'
        
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        
        print(f"Installed native messaging host manifest for {browser} at {manifest_path}")
    
    print("\nInstallation complete!")
    print("Next steps:")
    print("1. Make sure you've replaced 'YOUR_ELEVENLABS_API_KEY_HERE' in the bridge script")
    print("2. Install the Chrome extension in Developer mode")
    print("3. If you used a placeholder extension ID, update the manifest with your actual ID")

if __name__ == "__main__":
    install_native_messaging_host()
