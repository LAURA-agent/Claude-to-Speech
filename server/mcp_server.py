#!/usr/bin/env python3
"""
MCP Server for Claude-to-Speech TTS System
Provides programmatic access to TTS functionality for AI assistants
"""

import asyncio
import json
import aiohttp
import logging
from mcp.server import Server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource
from mcp.server.stdio import stdio_server
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TTSMCPServer:
    def __init__(self):
        self.server = Server("claude-to-speech")
        self.tts_base_url = "http://127.0.0.1:5000"
        self.config_dir = Path("config")
        
        # Register handlers
        self.register_handlers()
    
    def register_handlers(self):
        """Register all MCP handlers"""
        
        @self.server.list_tools()
        async def list_tools():
            return [
                Tool(
                    name="text_to_speech",
                    description="Convert text to speech using the configured voice. Great for making Claude responses audible!",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string", 
                                "description": "Text to convert to speech"
                            },
                            "response_id": {
                                "type": "string",
                                "description": "Optional response ID for tracking (auto-generated if not provided)"
                            }
                        },
                        "required": ["text"]
                    }
                ),
                Tool(
                    name="stream_text_to_speech",
                    description="Stream text to speech as it's being generated (for real-time TTS)",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text chunk to stream to TTS"
                            },
                            "response_id": {
                                "type": "string", 
                                "description": "Response ID for this streaming session"
                            },
                            "is_complete": {
                                "type": "boolean",
                                "description": "Whether this is the final chunk",
                                "default": False
                            }
                        },
                        "required": ["text", "response_id"]
                    }
                ),
                Tool(
                    name="stop_audio",
                    description="Stop currently playing audio and clear the queue",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False
                    }
                ),
                Tool(
                    name="get_voice_config",
                    description="Get current voice configuration and available voices",
                    inputSchema={
                        "type": "object", 
                        "properties": {},
                        "additionalProperties": False
                    }
                ),
                Tool(
                    name="set_active_voice",
                    description="Change the active voice for TTS",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "voice_name": {
                                "type": "string",
                                "description": "Name of the voice to activate"
                            }
                        },
                        "required": ["voice_name"]
                    }
                ),
                Tool(
                    name="add_voice",
                    description="Add a new voice configuration",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "voice_id": {
                                "type": "string",
                                "description": "Unique identifier for the voice"
                            },
                            "display_name": {
                                "type": "string", 
                                "description": "Human-readable name for the voice"
                            },
                            "model": {
                                "type": "string",
                                "description": "ElevenLabs model to use",
                                "enum": ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_monolingual_v1"]
                            },
                            "persona": {
                                "type": "string",
                                "description": "Voice persona/character name"
                            }
                        },
                        "required": ["voice_id", "display_name", "model", "persona"]
                    }
                ),
                Tool(
                    name="health_check",
                    description="Check the health status of the TTS system",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False  
                    }
                )
            ]

        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict):
            try:
                if name == "text_to_speech":
                    return await self.handle_text_to_speech(arguments)
                elif name == "stream_text_to_speech":
                    return await self.handle_stream_text(arguments)
                elif name == "stop_audio":
                    return await self.handle_stop_audio()
                elif name == "get_voice_config":
                    return await self.handle_get_voice_config()
                elif name == "set_active_voice":
                    return await self.handle_set_active_voice(arguments)
                elif name == "add_voice":
                    return await self.handle_add_voice(arguments)
                elif name == "health_check":
                    return await self.handle_health_check()
                else:
                    return [TextContent(type="text", text=f"Unknown tool: {name}")]
            except Exception as e:
                logger.error(f"Error in tool {name}: {e}")
                return [TextContent(type="text", text=f"Error: {str(e)}")]

    async def handle_text_to_speech(self, arguments: dict):
        """Handle manual text-to-speech conversion"""
        text = arguments["text"]
        response_id = arguments.get("response_id", f"mcp-{int(asyncio.get_event_loop().time())}")
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self.tts_base_url}/tts", json={
                "text": text,
                "response_id": response_id
            }) as response:
                result = await response.json()
                
                if result.get("success"):
                    return [TextContent(
                        type="text", 
                        text=f"✅ Text converted to speech successfully!\nResponse ID: {response_id}\nText length: {len(text)} characters"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text=f"❌ TTS failed: {result.get('error', 'Unknown error')}"
                    )]

    async def handle_stream_text(self, arguments: dict):
        """Handle streaming text to speech"""
        text = arguments["text"]
        response_id = arguments["response_id"] 
        is_complete = arguments.get("is_complete", False)
        
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self.tts_base_url}/stream", json={
                "text": text,
                "response_id": response_id,
                "is_complete": is_complete,
                "source": "mcp"
            }) as response:
                result = await response.json()
                
                status = "🎤 Streaming" if not is_complete else "✅ Stream complete"
                return [TextContent(
                    type="text",
                    text=f"{status}\nResponse ID: {response_id}\nChunk length: {len(text)} characters\nSuccess: {result.get('success', False)}"
                )]

    async def handle_stop_audio(self):
        """Handle stopping audio playback"""
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self.tts_base_url}/stop_audio") as response:
                result = await response.json()
                
                if result.get("success"):
                    return [TextContent(type="text", text="🛑 Audio stopped and queue cleared")]
                else:
                    return [TextContent(type="text", text=f"❌ Failed to stop audio: {result.get('error')}")]

    async def handle_get_voice_config(self):
        """Get current voice configuration"""
        voices_file = self.config_dir / "voices.json"
        
        try:
            if voices_file.exists():
                with open(voices_file, 'r') as f:
                    config = json.load(f)
                
                active_voice = config.get("active_voice", "Unknown")
                voices = config.get("voices", {})
                
                voice_list = "\n".join([
                    f"  • {name}: {info.get('name', name)} ({info.get('model', 'unknown')})" 
                    for name, info in voices.items()
                ])
                
                return [TextContent(
                    type="text",
                    text=f"🎵 Voice Configuration\n\nActive Voice: {active_voice}\n\nAvailable Voices:\n{voice_list}"
                )]
            else:
                return [TextContent(type="text", text="❌ Voice configuration file not found")]
        except Exception as e:
            return [TextContent(type="text", text=f"❌ Error reading voice config: {e}")]

    async def handle_set_active_voice(self, arguments: dict):
        """Set the active voice"""
        voice_name = arguments["voice_name"]
        voices_file = self.config_dir / "voices.json"
        
        try:
            if voices_file.exists():
                with open(voices_file, 'r') as f:
                    config = json.load(f)
                
                if voice_name in config.get("voices", {}):
                    config["active_voice"] = voice_name
                    
                    with open(voices_file, 'w') as f:
                        json.dump(config, f, indent=2)
                    
                    return [TextContent(type="text", text=f"✅ Active voice changed to: {voice_name}")]
                else:
                    available = list(config.get("voices", {}).keys())
                    return [TextContent(
                        type="text", 
                        text=f"❌ Voice '{voice_name}' not found. Available: {', '.join(available)}"
                    )]
            else:
                return [TextContent(type="text", text="❌ Voice configuration file not found")]
        except Exception as e:
            return [TextContent(type="text", text=f"❌ Error setting active voice: {e}")]

    async def handle_add_voice(self, arguments: dict):
        """Add a new voice configuration"""
        voice_id = arguments["voice_id"]
        display_name = arguments["display_name"]
        model = arguments["model"]
        persona = arguments["persona"]
        
        voices_file = self.config_dir / "voices.json"
        
        try:
            # Load existing config or create new
            if voices_file.exists():
                with open(voices_file, 'r') as f:
                    config = json.load(f)
            else:
                config = {"active_voice": voice_id, "voices": {}}
            
            # Add new voice
            config["voices"][voice_id] = {
                "name": display_name,
                "model": model,
                "persona": persona
            }
            
            # Save config
            self.config_dir.mkdir(exist_ok=True)
            with open(voices_file, 'w') as f:
                json.dump(config, f, indent=2)
            
            return [TextContent(type="text", text=f"✅ Added voice '{voice_id}' ({display_name})")]
            
        except Exception as e:
            return [TextContent(type="text", text=f"❌ Error adding voice: {e}")]

    async def handle_health_check(self):
        """Check TTS system health"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.tts_base_url}/health") as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        status_text = f"""🏥 TTS System Health Check
                        
Status: {result.get('status', 'unknown')}
Server: {result.get('server', 'unknown')}
Version: {result.get('version', 'unknown')}
Audio Manager: {result.get('audio_manager', 'unknown')}
TTS Processor: {result.get('tts_processor', 'unknown')}

Features:
• One-shot mode: {result.get('features', {}).get('one_shot_mode', 'unknown')}
• Delta processing: {result.get('features', {}).get('delta_processing', 'unknown')}
• Text cleaning: {result.get('features', {}).get('server_text_cleaning', 'unknown')}"""

                        return [TextContent(type="text", text=status_text)]
                    else:
                        return [TextContent(type="text", text=f"❌ Health check failed: HTTP {response.status}")]
        except Exception as e:
            return [TextContent(type="text", text=f"❌ Cannot connect to TTS server: {e}")]

async def main():
    """Main entry point for the MCP server"""
    server_instance = TTSMCPServer()
    
    # Run the server using stdio transport
    async with stdio_server() as (read_stream, write_stream):
        await server_instance.server.run(
            read_stream,
            write_stream,
            server_instance.server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
