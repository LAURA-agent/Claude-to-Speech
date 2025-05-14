#!/usr/bin/env python3
import re
import asyncio
import time
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass

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
    
    def __init__(self, audio_manager):
        self.processor = SmartStreamProcessor()
        self.tts_manager = TTSChunkManager(audio_manager)
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
