#!/usr/bin/env python3

import sys
import os
import time
import hashlib
import asyncio
import re
sys.path.insert(0, "/home/user/claude-to-speech/LAURA_scripts")
from audio_manager_plugin import AudioManager
from pathlib import Path
import traceback
from collections import defaultdict
import logging
logging.getLogger('quart.app').setLevel(logging.WARNING)
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass
from quart import Quart, request, jsonify
from quart_cors import cors
from smart_streaming_processor import StreamingTTSHandler, SmartStreamProcessor, TTSChunkManager


try:
    from elevenlabs.client import ElevenLabs
    print("Successfully imported ElevenLabs")
except ImportError as e:
    print(f"Error importing ElevenLabs: {e}")
    sys.exit(1)

# Configuration
CONFIG = {
    "tts_engine": "elevenlabs",
    "elevenlabs_key": "sk_2e9430dbeccdecec954973179fe998b4bec86ba9c081f300",
    "voice": "L.A.U.R.A.",
    "elevenlabs_model": "eleven_flash_v2_5",
    "output_dir": str(Path.home() / "LAURA" / "audio_cache")
}

os.makedirs(CONFIG["output_dir"], exist_ok=True)

app = Quart(__name__)
cors(app)
streaming_handler = None
eleven = ElevenLabs(api_key=CONFIG["elevenlabs_key"])
audio_manager = None

# Conversation state tracking
conversation_states = {}

@dataclass
class TextChunk:
    content: str
    chunk_type: str  # 'sentence', 'code', 'artifact', 'list'
    is_complete: bool
    position: int

class SmartStreamProcessor:
    """
    Real-time text processor that detects code blocks, artifacts, and lists,
    while extracting speakable content in sentence chunks.
    """
    
    def __init__(self):
        self.full_text = ""
        self.processed_position = 0
        self.inside_code_block = False
        self.inside_artifact = False
        self.sentence_buffer = ""
        self.complete_sentences = []
        self.pending_tts_queue = []
        
        # Patterns for detection
        self.code_start_pattern = re.compile(r'```[a-z]*\n?', re.IGNORECASE)
        self.code_end_pattern = re.compile(r'```')
        self.artifact_pattern = re.compile(r'<function_calls>|<invoke>|</invoke>|</function_calls>', re.IGNORECASE)
        
        # Sentence ending patterns - enhanced for better detection
        self.sentence_endings = re.compile(r'[.!?]+(?=\s+[A-Z]|\s*$)')
        
        # List patterns
        self.list_patterns = [
            re.compile(r'^\s*\d+\.\s+'),  # 1. numbered
            re.compile(r'^\s*[-*]\s+'),   # - or * bullets
            re.compile(r'^\s*•\s+')       # bullet points
        ]
    
    def append_text(self, new_text: str) -> List[TextChunk]:
        """
        Process new text chunk and return any complete sentences ready for TTS.
        """
        self.full_text += new_text
        
        # Process only the new portion
        unprocessed_text = self.full_text[self.processed_position:]
        chunks = []
        
        # Split into lines for easier processing
        lines = unprocessed_text.split('\n')
        current_line_start = self.processed_position
        
        for i, line in enumerate(lines):
            line_chunks = self._process_line(line, current_line_start)
            chunks.extend(line_chunks)
            current_line_start += len(line) + 1  # +1 for newline
        
        # Update processed position
        self.processed_position = len(self.full_text)
        
        # Extract complete sentences from the accumulated buffer
        sentence_chunks = self._extract_complete_sentences()
        chunks.extend(sentence_chunks)
        
        return chunks
    
    def _process_line(self, line: str, position: int) -> List[TextChunk]:
        """Process a single line and return chunks."""
        chunks = []
        
        # Check for code block markers
        if self.code_start_pattern.search(line):
            self.inside_code_block = True
            return [TextChunk(line, 'code', True, position)]
        
        if self.inside_code_block:
            if self.code_end_pattern.search(line):
                self.inside_code_block = False
            return [TextChunk(line, 'code', True, position)]
        
        # Check for artifacts
        if self.artifact_pattern.search(line):
            self.inside_artifact = not self.inside_artifact
            return [TextChunk(line, 'artifact', True, position)]
        
        if self.inside_artifact:
            return [TextChunk(line, 'artifact', True, position)]
        
        # Check for list items
        for pattern in self.list_patterns:
            if pattern.match(line.strip()):
                # Convert list item to natural speech
                natural_text = self._convert_list_to_speech(line)
                self.sentence_buffer += natural_text + " "
                return [TextChunk(line, 'list', True, position)]
        
        # Regular text - add to sentence buffer
        self.sentence_buffer += line + " "
        
        return []
    
    def _convert_list_to_speech(self, list_item: str) -> str:
        """Convert list items to natural speech."""
        # Remove list markers and clean up
        for pattern in self.list_patterns:
            list_item = pattern.sub('', list_item)
        
        # Add natural transitions
        transitions = ["Next,", "Also,", "Additionally,", "Furthermore,"]
        # Simple rotation based on list count
        transition = transitions[len(self.complete_sentences) % len(transitions)]
        
        return f"{transition} {list_item.strip()}"
    
    def _extract_complete_sentences(self) -> List[TextChunk]:
        """Extract complete sentences from the buffer."""
        sentences = []
        
        # Find sentence boundaries in the buffer
        matches = list(self.sentence_endings.finditer(self.sentence_buffer))
        
        if not matches:
            return []
        
        # Process each complete sentence
        last_end = 0
        for match in matches:
            sentence = self.sentence_buffer[last_end:match.end()].strip()
            if sentence and len(sentence) > 10:  # Only meaningful sentences
                sentences.append(TextChunk(sentence, 'sentence', True, 0))
                self.complete_sentences.append(sentence)
            last_end = match.end()
        
        # Keep remaining incomplete text in buffer
        self.sentence_buffer = self.sentence_buffer[last_end:].strip()
        
        return sentences
    
    def get_final_chunk(self) -> Optional[TextChunk]:
        """Get any remaining text as final chunk when response is complete."""
        if self.sentence_buffer.strip():
            final_text = self.sentence_buffer.strip()
            self.sentence_buffer = ""
            return TextChunk(final_text, 'sentence', True, 0)
        return None

class TTSChunkManager:
    """
    Manages TTS queuing with intelligent batching for optimal audio streaming.
    Ensures no perceived delays by processing the first two sentences immediately.
    """
    
    def __init__(self, audio_manager):
        self.audio_manager = audio_manager
        self.sentence_queue = []
        self.processing_queue = []
        self.is_processing = False
        self.first_chunk_sent = False
        
    async def add_sentence(self, sentence: str):
        """Add a sentence to the TTS queue."""
        self.sentence_queue.append(sentence)
        
        # Process first two sentences immediately for minimal delay
        if not self.first_chunk_sent and len(self.sentence_queue) >= 2:
            first_two = " ".join(self.sentence_queue[:2])
            self.sentence_queue = self.sentence_queue[2:]
            await self._generate_and_queue_tts(first_two)
            self.first_chunk_sent = True
        
        # For subsequent sentences, batch into pairs
        elif self.first_chunk_sent and len(self.sentence_queue) >= 2:
            next_two = " ".join(self.sentence_queue[:2])
            self.sentence_queue = self.sentence_queue[2:]
            await self._generate_and_queue_tts(next_two)
    
    async def finalize_response(self):
        """Process any remaining sentences when response is complete."""
        if self.sentence_queue:
            remaining = " ".join(self.sentence_queue)
            self.sentence_queue.clear()
            await self._generate_and_queue_tts(remaining)
        self.first_chunk_sent = False
    
    async def _generate_and_queue_tts(self, text: str):
        """Generate TTS for a text chunk and queue for playback."""
        if not text or len(text.strip()) < 5:
            return
        
        try:
            # Generate TTS (using your existing ElevenLabs integration)
            print(f"🔊 Generating TTS for: {text[:50]}...")
            
            # Add to audio manager queue
            await self.audio_manager.queue_audio(
                generated_text=text,
                delete_after_play=True
            )
            
        except Exception as e:
            print(f"❌ TTS generation error: {e}")

# Integration with TTS Server
class StreamingTTSHandler:
    """
    Handles streaming text from browser and coordinates with TTS generation.
    """
    
    def __init__(self, audio_manager, eleven_client):
        self.processor = SmartStreamProcessor()
        self.tts_manager = TTSChunkManager(audio_manager)
        self.eleven_client = eleven_client
        self.conversation_active = False
    
    async def process_stream_chunk(self, text: str, is_complete: bool = False):
        """
        Process incoming text chunk from browser.
        
        Args:
            text: New text content from Claude
            is_complete: Whether this is the final chunk
        """
        print(f"📝 Processing chunk: {text[:50]}... (complete: {is_complete})")
        
        # Process the text and get any complete sentences
        chunks = self.processor.append_text(text)
        
        # Handle each chunk based on type
        for chunk in chunks:
            if chunk.chunk_type == 'sentence':
                await self.tts_manager.add_sentence(chunk.content)
            elif chunk.chunk_type in ['code', 'artifact']:
                print(f"⚠️ Skipping {chunk.chunk_type} block")
            elif chunk.chunk_type == 'list':
                # List items are converted to speech in the processor
                pass
        
        # If response is complete, finalize any remaining content
        if is_complete:
            final_chunk = self.processor.get_final_chunk()
            if final_chunk:
                await self.tts_manager.add_sentence(final_chunk.content)
            await self.tts_manager.finalize_response()
            print("✅ Response processing complete")
    
    async def reset_conversation(self):
        """Reset state for new conversation."""
        self.processor = SmartStreamProcessor()
        self.tts_manager = TTSChunkManager(self.tts_manager.audio_manager)
        print("🔄 Conversation state reset")

# Usage in TTS Server
async def handle_streaming_request(data, streaming_handler):
    """Handle streaming text request from browser."""
    text = data.get('text', '')
    is_complete = data.get('is_complete', False)
    
    if not text:
        return {"error": "No text provided"}
    
    await streaming_handler.process_stream_chunk(text, is_complete)
    
    return {
        "success": True,
        "processed": True,
        "chunks_queued": len(streaming_handler.tts_manager.sentence_queue)
    }

class ConversationState:
    def __init__(self, conversation_id):
        self.conversation_id = conversation_id
        self.processed_texts = []  # List of already spoken text segments
        self.current_full_text = ""
        self.last_update_time = time.time()
        
    def has_spoken(self, text):
        """Check if text is already contained in spoken segments"""
        text_clean = text.strip().lower()
        for spoken in self.processed_texts:
            if text_clean in spoken.lower() or spoken.lower() in text_clean:
                return True
        return False
    
    def add_spoken_text(self, text):
        """Add text to spoken segments"""
        self.processed_texts.append(text.strip())
        # Keep only last 10 segments to prevent memory bloat
        if len(self.processed_texts) > 10:
            self.processed_texts.pop(0)
        self.last_update_time = time.time()

def get_conversation_state(client_ip):
    """Get or create conversation state for client"""
    if client_ip not in conversation_states:
        conversation_states[client_ip] = ConversationState(client_ip)
    return conversation_states[client_ip]

def extract_text_segments(text):
    """Split text around artifacts and return speakable segments"""
    
    # Define artifact boundary patterns
    artifact_patterns = [
        r'.*?Code\s*\n',  # Artifact headers ending with "Code"
        r'.*?Script\s*-\s*.*?\n',  # Script titles
        r'```[\s\S]*?```',  # Code blocks
        r'Drafting artifact.*?\n'  # Drafting messages
    ]
    
    # Split text around all artifact patterns
    segments = [text]
    for pattern in artifact_patterns:
        new_segments = []
        for segment in segments:
            parts = re.split(pattern, segment, flags=re.MULTILINE | re.DOTALL)
            new_segments.extend(parts)
        segments = new_segments
    
    # Clean and filter segments
    clean_segments = []
    for segment in segments:
        cleaned = segment.strip()
        
        # Skip empty or very short segments
        if len(cleaned) < 20:
            continue
            
        # Remove any remaining inline code
        cleaned = re.sub(r'`[^`]+`', '', cleaned)
        
        # Clean up text
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        if cleaned:
            clean_segments.append(cleaned)
    
    return clean_segments

def split_into_speakable_chunks(segments):
    """Take text segments and split long ones into sentences"""
    final_chunks = []
    
    for segment in segments:
        # If segment is short enough, use as-is
        if len(segment) <= 500:
            final_chunks.append(segment)
        else:
            # Split long segments by sentences
            sentences = re.split(r'(?<=[.!?])\s+', segment)
            for sentence in sentences:
                sentence = sentence.strip()
                if sentence and len(sentence) > 10:
                    final_chunks.append(sentence)
    return final_chunks

async def _generate_and_queue_tts(self, text: str):
    """Generate TTS for a text chunk and queue for playback."""
    if not text or len(text.strip()) < 5:
        return

    try:
        print(f"🔊 Generating TTS for: {text[:50]}...")
        
        # Generate audio using ElevenLabs (matching your existing pattern)
        audio = b"".join(eleven.generate(
            text=text,
            voice=CONFIG["voice"],
            model=CONFIG["elevenlabs_model"],
            output_format="mp3_44100_128"
        ))
        
        # Save with timestamp
        timestamp = int(time.time() * 1000)
        file_path = os.path.join(CONFIG["output_dir"], f"stream_{timestamp}.mp3")
        
        with open(file_path, 'wb') as f:
            f.write(audio)
        
        # Queue the actual file for playback
        await self.audio_manager.queue_audio(file_path, delete_after_play=True)
        
    except Exception as e:
        print(f"❌ TTS generation error: {e}")

@app.route('/stream', methods=['POST'])
async def handle_stream():
    global streaming_handler
    
    if not streaming_handler:
        streaming_handler = StreamingTTSHandler(audio_manager, eleven)
    
    try:
        data = await request.json
        text = data.get('text', '')
        is_complete = data.get('is_complete', False)
        client_ip = request.remote_addr
        
        if not text:
            return jsonify({"error": "No text provided"}), 400
        
        print(f"📥 Stream chunk: {len(text)} chars, complete: {is_complete}")
        
        # Process the streaming chunk
        await streaming_handler.process_stream_chunk(text, is_complete)
        
        return jsonify({
            "success": True,
            "processed": True,
            "text_length": len(text),
            "is_complete": is_complete
        })
        
    except Exception as e:
        print(f"❌ Stream error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/tts', methods=['POST'])
async def text_to_speech():
    try:
        data = await request.json
        text = data.get('text', '')
        conversation_mode = data.get('conversation_mode', False)
        client_ip = request.remote_addr
        
        if not text:
            return jsonify({"error": "No text provided"}), 400
        
        # IMPORTANT: Only auto-process in conversation mode
        # If not in conversation mode, this should be a manual request
        print(f"📝 Request: conversation_mode={conversation_mode}, text_length={len(text)}")
        
        # Get conversation state
        conv_state = get_conversation_state(client_ip)
        
        # Extract segments around code blocks
        segments = extract_text_segments(text)
        if not segments:
            print("⚠️  No speakable content found")
            return jsonify({"success": True, "skipped": "no_speakable_content"})
        
        # Further split into speakable chunks
        chunks = split_into_speakable_chunks(segments)
        
        # Process each chunk
        for chunk in chunks:
            # In conversation mode, check for duplicates
            # In manual mode, always process (user explicitly requested it)
            if conversation_mode and conv_state.has_spoken(chunk):
                print(f"⏭️  Skipping already spoken chunk (conversation mode)")
                continue
            
            await generate_and_queue_tts(chunk, conv_state)
            
            # Add delay between chunks
            if conversation_mode:
                await asyncio.sleep(0.3)  # Shorter delay for auto-mode
            else:
                await asyncio.sleep(0.1)  # Minimal delay for manual mode
        
        return jsonify({"success": True, "processed": True})
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
        
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

@app.route('/reset_conversation', methods=['POST'])
async def reset_conversation():
    global streaming_handler
    
    try:
        data = await request.json
        client_ip = data.get('client_ip', request.remote_addr)
        
        # Reset conversation state
        if client_ip in conversation_states:
            del conversation_states[client_ip]
        
        # Reset streaming handler
        if streaming_handler:
            await streaming_handler.reset_conversation()
        
        # Clear audio queue
        if audio_manager:
            await audio_manager.clear_queue()
        
        print(f"🔄 Reset conversation and streaming for {client_ip}")
        return jsonify({"success": True})
        
    except Exception as e:
        print(f"❌ Reset error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/')
def home():
    return "Smart Claude TTS Server is running!"

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

if __name__ == '__main__':
    print("Starting Smart TTS Server on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=False)
