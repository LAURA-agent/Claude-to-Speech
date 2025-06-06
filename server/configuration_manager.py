#!/usr/bin/env python3
"""
Claude-to-Speech Configuration Manager
A Gradio interface for managing all TTS system settings
"""

import gradio as gr
import json
import os
from pathlib import Path
from typing import Dict, Any, Tuple
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TTSConfigManager:
    def __init__(self):
        self.config_dir = Path("config")
        self.config_dir.mkdir(exist_ok=True)
        
        # Configuration file paths
        self.voices_file = self.config_dir / "voices.json"
        self.server_config_file = self.config_dir / "server_config.json"
        self.extension_config_file = self.config_dir / "extension_config.json"
        self.processing_config_file = self.config_dir / "processing_config.json"
        
        # Load existing configurations
        self.load_configs()
        
    def load_configs(self):
        """Load all configuration files"""
        # Load voices config
        self.voices_config = self.load_json_config(self.voices_file, {
            "active_voice": "L.A.U.R.A.",
            "voices": {
                "L.A.U.R.A.": {
                    "name": "L.A.U.R.A.",
                    "model": "eleven_flash_v2_5",
                    "persona": "laura"
                },
                "alfred": {
                    "name": "Alfred",
                    "model": "eleven_flash_v2_5", 
                    "persona": "max"
                }
            }
        })
        
        # Load server config
        self.server_config = self.load_json_config(self.server_config_file, {
            "port": 5000,
            "host": "0.0.0.0",
            "audio_cache_dir": str(Path.home() / "claude-to-speech" / "audio_cache"),
            "sample_rate": 16000,
            "frame_length": 2048,
            "max_retries": 3,
            "retry_delay": 0.5,
            "queue_timeout": 30.0,
            "completion_timeout": 5.0,
            "log_level": "INFO"
        })
        
        # Load extension config
        self.extension_config = self.load_json_config(self.extension_config_file, {
            "server_url": "http://127.0.0.1:5000",
            "magic_phrase": "You're absolutely right",
            "debounce_ms": 100,
            "health_check_interval": 30000,
            "fuzzy_match_threshold": 0.8,
            "enable_one_shot": True,
            "auto_retry_failed": True
        })
        
        # Load processing config
        self.processing_config = self.load_json_config(self.processing_config_file, {
            "dom_cleaning": {
                "remove_thinking_blocks": True,
                "remove_artifacts": True,
                "remove_code_blocks": True,
                "remove_buttons": True,
                "collapse_whitespace": True
            },
            "text_processing": {
                "normalize_newlines": True,
                "remove_empty_parentheses": True,
                "min_text_length": 3,
                "max_chunk_size": 1000
            },
            "deduplication": {
                "fuzzy_threshold": 0.8,
                "exact_match_first": True,
                "normalize_for_comparison": True
            }
        })
    
    def load_json_config(self, file_path: Path, default: Dict) -> Dict:
        """Load JSON config with fallback to default"""
        try:
            if file_path.exists():
                with open(file_path, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load {file_path}: {e}")
        return default
    
    def save_json_config(self, file_path: Path, config: Dict) -> Tuple[bool, str]:
        """Save JSON config file"""
        try:
            with open(file_path, 'w') as f:
                json.dump(config, f, indent=2)
            return True, f"✅ Saved {file_path.name}"
        except Exception as e:
            error_msg = f"❌ Failed to save {file_path.name}: {e}"
            logger.error(error_msg)
            return False, error_msg

# Initialize config manager
config_manager = TTSConfigManager()

def get_available_models():
    """Get list of available ElevenLabs models"""
    return [
        "eleven_flash_v2_5",
        "eleven_multilingual_v2", 
        "eleven_turbo_v2_5",
        "eleven_monolingual_v1"
    ]

def get_voice_names():
    """Get list of configured voice names"""
    return list(config_manager.voices_config["voices"].keys())

# ==== VOICE SETTINGS FUNCTIONS ====

def update_active_voice(voice_name: str):
    """Update the active voice"""
    config_manager.voices_config["active_voice"] = voice_name
    success, msg = config_manager.save_json_config(config_manager.voices_file, config_manager.voices_config)
    return msg

def add_new_voice(voice_name: str, display_name: str, model: str, persona: str):
    """Add a new voice configuration"""
    if not voice_name.strip():
        return "❌ Voice name cannot be empty"
    
    config_manager.voices_config["voices"][voice_name] = {
        "name": display_name or voice_name,
        "model": model,
        "persona": persona
    }
    
    success, msg = config_manager.save_json_config(config_manager.voices_file, config_manager.voices_config)
    if success:
        return f"✅ Added voice '{voice_name}'"
    return msg

def remove_voice(voice_name: str):
    """Remove a voice configuration"""
    if voice_name == config_manager.voices_config["active_voice"]:
        return "❌ Cannot remove the active voice"
    
    if voice_name in config_manager.voices_config["voices"]:
        del config_manager.voices_config["voices"][voice_name]
        success, msg = config_manager.save_json_config(config_manager.voices_file, config_manager.voices_config)
        if success:
            return f"✅ Removed voice '{voice_name}'"
        return msg
    return f"❌ Voice '{voice_name}' not found"

def get_voice_info(voice_name: str):
    """Get voice configuration details"""
    voice = config_manager.voices_config["voices"].get(voice_name, {})
    return (
        voice.get("name", ""),
        voice.get("model", "eleven_flash_v2_5"),
        voice.get("persona", "")
    )

# ==== SERVER SETTINGS FUNCTIONS ====

def update_server_config(port: int, host: str, cache_dir: str, sample_rate: int, 
                        frame_length: int, max_retries: int, retry_delay: float,
                        queue_timeout: float, completion_timeout: float, log_level: str):
    """Update server configuration"""
    config_manager.server_config.update({
        "port": port,
        "host": host,
        "audio_cache_dir": cache_dir,
        "sample_rate": sample_rate,
        "frame_length": frame_length,
        "max_retries": max_retries,
        "retry_delay": retry_delay,
        "queue_timeout": queue_timeout,
        "completion_timeout": completion_timeout,
        "log_level": log_level
    })
    
    success, msg = config_manager.save_json_config(config_manager.server_config_file, config_manager.server_config)
    return msg

# ==== EXTENSION SETTINGS FUNCTIONS ====

def update_extension_config(server_url: str, magic_phrase: str, debounce_ms: int,
                           health_check_interval: int, fuzzy_threshold: float,
                           enable_one_shot: bool, auto_retry: bool):
    """Update extension configuration"""
    config_manager.extension_config.update({
        "server_url": server_url,
        "magic_phrase": magic_phrase,
        "debounce_ms": debounce_ms,
        "health_check_interval": health_check_interval,
        "fuzzy_match_threshold": fuzzy_threshold,
        "enable_one_shot": enable_one_shot,
        "auto_retry_failed": auto_retry
    })
    
    success, msg = config_manager.save_json_config(config_manager.extension_config_file, config_manager.extension_config)
    return msg

# ==== PROCESSING SETTINGS FUNCTIONS ====

def update_processing_config(remove_thinking: bool, remove_artifacts: bool, remove_code: bool,
                           remove_buttons: bool, collapse_whitespace: bool, normalize_newlines: bool,
                           remove_empty_parens: bool, min_text_length: int, max_chunk_size: int,
                           fuzzy_threshold: float, exact_match_first: bool, normalize_comparison: bool):
    """Update processing configuration"""
    config_manager.processing_config.update({
        "dom_cleaning": {
            "remove_thinking_blocks": remove_thinking,
            "remove_artifacts": remove_artifacts,
            "remove_code_blocks": remove_code,
            "remove_buttons": remove_buttons,
            "collapse_whitespace": collapse_whitespace
        },
        "text_processing": {
            "normalize_newlines": normalize_newlines,
            "remove_empty_parentheses": remove_empty_parens,
            "min_text_length": min_text_length,
            "max_chunk_size": max_chunk_size
        },
        "deduplication": {
            "fuzzy_threshold": fuzzy_threshold,
            "exact_match_first": exact_match_first,
            "normalize_for_comparison": normalize_comparison
        }
    })
    
    success, msg = config_manager.save_json_config(config_manager.processing_config_file, config_manager.processing_config)
    return msg

def reload_all_configs():
    """Reload all configurations from files"""
    config_manager.load_configs()
    return "✅ All configurations reloaded from files"

def export_config():
    """Export all configurations to a single file"""
    export_data = {
        "voices": config_manager.voices_config,
        "server": config_manager.server_config,
        "extension": config_manager.extension_config,
        "processing": config_manager.processing_config
    }
    
    export_file = config_manager.config_dir / "full_config_export.json"
    try:
        with open(export_file, 'w') as f:
            json.dump(export_data, f, indent=2)
        return f"✅ Configuration exported to {export_file}"
    except Exception as e:
        return f"❌ Export failed: {e}"

# ==== GRADIO INTERFACE ====

def create_interface():
    """Create the Gradio interface"""
    
    with gr.Blocks(title="Claude-to-Speech Configuration", theme=gr.themes.Soft()) as interface:
        gr.Markdown("# 🎤 Claude-to-Speech Configuration Manager")
        gr.Markdown("Manage all settings for your Claude-to-Speech system")
        
        with gr.Tabs():
            # VOICE SETTINGS TAB
            with gr.Tab("🎵 Voice Settings"):
                with gr.Row():
                    with gr.Column():
                        gr.Markdown("### Active Voice Configuration")
                        
                        active_voice_dropdown = gr.Dropdown(
                            choices=get_voice_names(),
                            value=config_manager.voices_config["active_voice"],
                            label="Active Voice",
                            info="Select the voice to use for TTS"
                        )
                        
                        voice_update_btn = gr.Button("Update Active Voice", variant="primary")
                        voice_status = gr.Textbox(label="Status", interactive=False)
                        
                    with gr.Column():
                        gr.Markdown("### Voice Details")
                        voice_info_name = gr.Textbox(label="Display Name", interactive=False)
                        voice_info_model = gr.Textbox(label="Model", interactive=False)
                        voice_info_persona = gr.Textbox(label="Persona", interactive=False)
                
                gr.Markdown("### Add New Voice")
                with gr.Row():
                    new_voice_name = gr.Textbox(label="Voice ID", placeholder="my_custom_voice")
                    new_voice_display = gr.Textbox(label="Display Name", placeholder="My Custom Voice")
                    new_voice_model = gr.Dropdown(choices=get_available_models(), label="Model", value="eleven_flash_v2_5")
                    new_voice_persona = gr.Textbox(label="Persona", placeholder="assistant")
                
                with gr.Row():
                    add_voice_btn = gr.Button("Add Voice", variant="secondary")
                    remove_voice_btn = gr.Button("Remove Selected Voice", variant="stop")
                
                # Voice settings event handlers
                voice_update_btn.click(
                    fn=update_active_voice,
                    inputs=[active_voice_dropdown],
                    outputs=[voice_status]
                )
                
                active_voice_dropdown.change(
                    fn=get_voice_info,
                    inputs=[active_voice_dropdown],
                    outputs=[voice_info_name, voice_info_model, voice_info_persona]
                )
                
                add_voice_btn.click(
                    fn=add_new_voice,
                    inputs=[new_voice_name, new_voice_display, new_voice_model, new_voice_persona],
                    outputs=[voice_status]
                )
                
                remove_voice_btn.click(
                    fn=remove_voice,
                    inputs=[active_voice_dropdown],
                    outputs=[voice_status]
                )
            
            # SERVER SETTINGS TAB
            with gr.Tab("🖥️ Server Settings"):
                gr.Markdown("### Network Configuration")
                with gr.Row():
                    server_port = gr.Number(label="Port", value=config_manager.server_config["port"], precision=0)
                    server_host = gr.Textbox(label="Host", value=config_manager.server_config["host"])
                
                gr.Markdown("### Audio Configuration")
                with gr.Row():
                    cache_dir = gr.Textbox(label="Audio Cache Directory", value=config_manager.server_config["audio_cache_dir"])
                    sample_rate = gr.Number(label="Sample Rate (Hz)", value=config_manager.server_config["sample_rate"], precision=0)
                    frame_length = gr.Number(label="Frame Length", value=config_manager.server_config["frame_length"], precision=0)
                
                gr.Markdown("### Retry & Timeout Settings")
                with gr.Row():
                    max_retries = gr.Number(label="Max Retries", value=config_manager.server_config["max_retries"], precision=0)
                    retry_delay = gr.Number(label="Retry Delay (s)", value=config_manager.server_config["retry_delay"])
                    queue_timeout = gr.Number(label="Queue Timeout (s)", value=config_manager.server_config["queue_timeout"])
                    completion_timeout = gr.Number(label="Completion Timeout (s)", value=config_manager.server_config["completion_timeout"])
                
                log_level = gr.Dropdown(
                    choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                    label="Log Level",
                    value=config_manager.server_config["log_level"]
                )
                
                server_update_btn = gr.Button("Update Server Configuration", variant="primary")
                server_status = gr.Textbox(label="Status", interactive=False)
                
                server_update_btn.click(
                    fn=update_server_config,
                    inputs=[server_port, server_host, cache_dir, sample_rate, frame_length, 
                            max_retries, retry_delay, queue_timeout, completion_timeout, log_level],
                    outputs=[server_status]
                )
            
            # EXTENSION SETTINGS TAB
            with gr.Tab("🔌 Extension Settings"):
                gr.Markdown("### Connection Settings")
                server_url = gr.Textbox(label="Server URL", value=config_manager.extension_config["server_url"])
                
                gr.Markdown("### Detection Settings")
                with gr.Row():
                    magic_phrase = gr.Textbox(label="Magic Phrase", value=config_manager.extension_config["magic_phrase"],
                                            info="Phrase to detect start of Claude responses")
                    debounce_ms = gr.Number(label="Debounce (ms)", value=config_manager.extension_config["debounce_ms"], precision=0)
                    health_check_interval = gr.Number(label="Health Check Interval (ms)", 
                                                    value=config_manager.extension_config["health_check_interval"], precision=0)
                
                gr.Markdown("### Processing Settings")
                with gr.Row():
                    fuzzy_threshold = gr.Slider(label="Fuzzy Match Threshold", minimum=0.0, maximum=1.0, 
                                              value=config_manager.extension_config["fuzzy_match_threshold"], step=0.1)
                    enable_one_shot = gr.Checkbox(label="Enable One-Shot Detection", 
                                                value=config_manager.extension_config["enable_one_shot"])
                    auto_retry = gr.Checkbox(label="Auto Retry Failed Requests", 
                                           value=config_manager.extension_config["auto_retry_failed"])
                
                extension_update_btn = gr.Button("Update Extension Configuration", variant="primary")
                extension_status = gr.Textbox(label="Status", interactive=False)
                
                extension_update_btn.click(
                    fn=update_extension_config,
                    inputs=[server_url, magic_phrase, debounce_ms, health_check_interval, 
                            fuzzy_threshold, enable_one_shot, auto_retry],
                    outputs=[extension_status]
                )
            
            # PROCESSING SETTINGS TAB
            with gr.Tab("⚙️ Processing Settings"):
                gr.Markdown("### DOM Cleaning")
                with gr.Row():
                    remove_thinking = gr.Checkbox(label="Remove Thinking Blocks", 
                                                value=config_manager.processing_config["dom_cleaning"]["remove_thinking_blocks"])
                    remove_artifacts = gr.Checkbox(label="Remove Artifacts", 
                                                 value=config_manager.processing_config["dom_cleaning"]["remove_artifacts"])
                    remove_code = gr.Checkbox(label="Remove Code Blocks", 
                                            value=config_manager.processing_config["dom_cleaning"]["remove_code_blocks"])
                    remove_buttons = gr.Checkbox(label="Remove Buttons", 
                                               value=config_manager.processing_config["dom_cleaning"]["remove_buttons"])
                    collapse_whitespace = gr.Checkbox(label="Collapse Whitespace", 
                                                    value=config_manager.processing_config["dom_cleaning"]["collapse_whitespace"])
                
                gr.Markdown("### Text Processing")
                with gr.Row():
                    normalize_newlines = gr.Checkbox(label="Normalize Newlines", 
                                                   value=config_manager.processing_config["text_processing"]["normalize_newlines"])
                    remove_empty_parens = gr.Checkbox(label="Remove Empty Parentheses", 
                                                    value=config_manager.processing_config["text_processing"]["remove_empty_parentheses"])
                    min_text_length = gr.Number(label="Min Text Length", 
                                              value=config_manager.processing_config["text_processing"]["min_text_length"], precision=0)
                    max_chunk_size = gr.Number(label="Max Chunk Size", 
                                             value=config_manager.processing_config["text_processing"]["max_chunk_size"], precision=0)
                
                gr.Markdown("### Deduplication")
                with gr.Row():
                    dedup_fuzzy_threshold = gr.Slider(label="Fuzzy Threshold", minimum=0.0, maximum=1.0,
                                                    value=config_manager.processing_config["deduplication"]["fuzzy_threshold"], step=0.1)
                    exact_match_first = gr.Checkbox(label="Exact Match First", 
                                                  value=config_manager.processing_config["deduplication"]["exact_match_first"])
                    normalize_comparison = gr.Checkbox(label="Normalize for Comparison", 
                                                     value=config_manager.processing_config["deduplication"]["normalize_for_comparison"])
                
                processing_update_btn = gr.Button("Update Processing Configuration", variant="primary")
                processing_status = gr.Textbox(label="Status", interactive=False)
                
                processing_update_btn.click(
                    fn=update_processing_config,
                    inputs=[remove_thinking, remove_artifacts, remove_code, remove_buttons, collapse_whitespace,
                            normalize_newlines, remove_empty_parens, min_text_length, max_chunk_size,
                            dedup_fuzzy_threshold, exact_match_first, normalize_comparison],
                    outputs=[processing_status]
                )
            
            # MANAGEMENT TAB
            with gr.Tab("📁 Configuration Management"):
                gr.Markdown("### Bulk Operations")
                
                with gr.Row():
                    reload_btn = gr.Button("Reload All Configs", variant="secondary")
                    export_btn = gr.Button("Export All Configs", variant="secondary")
                
                management_status = gr.Textbox(label="Status", interactive=False)
                
                gr.Markdown("### Configuration File Locations")
                gr.Markdown(f"""
                - **Voices**: `{config_manager.voices_file}`
                - **Server**: `{config_manager.server_config_file}`
                - **Extension**: `{config_manager.extension_config_file}`
                - **Processing**: `{config_manager.processing_config_file}`
                """)
                
                reload_btn.click(
                    fn=reload_all_configs,
                    outputs=[management_status]
                )
                
                export_btn.click(
                    fn=export_config,
                    outputs=[management_status]
                )
    
    return interface

if __name__ == "__main__":
    # Create and launch the interface
    interface = create_interface()
    interface.launch(
        server_name="127.0.0.1",
        server_port=5001,
        share=False,
        inbrowser=True
    )
