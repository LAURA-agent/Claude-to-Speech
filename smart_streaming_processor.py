#!/usr/bin/env python3
import re
import asyncio
import time
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass

@dataclass
class TextChunk:
   content: str
   chunk_type: str  # 'paragraph', 'code', 'artifact'
   is_complete: bool
   position: int

class SmartStreamProcessor:
    def __init__(self):
        self.full_text = ""
        self.processed_paragraphs = 0
        self.inside_code_block = False
        self.inside_artifact = False
        
        # Patterns for detection
        self.code_start_pattern = re.compile(r'```[a-z]*\n?', re.IGNORECASE)
        self.code_end_pattern = re.compile(r'```')
        self.artifact_pattern = re.compile(r'<function_calls>|<invoke>|</invoke>|</function_calls>', re.IGNORECASE)
    
    def append_text(self, new_text: str) -> List[TextChunk]:
        self.full_text += new_text
        
        # Split entire text into paragraphs (consistent with get_final_chunks)
        paragraphs = [p.strip() for p in self.full_text.split('\n\n') if p.strip()]
        
        with open('debug_log.txt', 'a') as f:
            f.write(f"DEBUG: Found {len(paragraphs)} paragraphs, processed {self.processed_paragraphs}\n")
            for i, p in enumerate(paragraphs):
                f.write(f"  P{i}: '{p[:150]}...'\n")
            f.write("---\n")
        
        chunks = []
        # Process only new paragraphs
        for i in range(self.processed_paragraphs, len(paragraphs)):
            paragraph = paragraphs[i]
            if self._get_paragraph_type(paragraph) == 'text':
                chunks.append(TextChunk(paragraph, 'paragraph', True, i))
                self.processed_paragraphs = i + 1
        
        return chunks
    
    def _get_paragraph_type(self, paragraph: str) -> str:
        if self.code_start_pattern.search(paragraph) or self.code_end_pattern.search(paragraph):
            return 'code'
        if self.artifact_pattern.search(paragraph):
            return 'artifact'
        return 'text'

    def get_final_chunks(self) -> List[TextChunk]:
        """Get any remaining unprocessed paragraphs when response is complete."""
        # Use same splitting logic as append_text for consistency
        paragraphs = [p.strip() for p in self.full_text.split('\n\n') if p.strip()]
        
        chunks = []
        # Process ALL unprocessed paragraphs in order
        for i in range(self.processed_paragraphs, len(paragraphs)):
            paragraph = paragraphs[i]
            if self._get_paragraph_type(paragraph) == 'text':
                chunks.append(TextChunk(paragraph, 'paragraph', True, i))
        
        # Update processed count to include all paragraphs
        self.processed_paragraphs = len(paragraphs)
        
        with open('debug_log.txt', 'a') as f:
            f.write(f"FINAL_CHUNKS: Returning {len(chunks)} chunks\n")
            for i, chunk in enumerate(chunks):
                f.write(f"  Chunk {i}: '{chunk.content[:100]}...'\n")
            f.write("===\n")
        
        return chunks

    # Deprecated - kept for backward compatibility
    def get_final_chunk(self) -> Optional[TextChunk]:
        """Deprecated: Use get_final_chunks() instead."""
        chunks = self.get_final_chunks()
        return chunks[0] if chunks else None

class TTSChunkManager:
   def __init__(self, audio_manager):
       self.audio_manager = audio_manager
       self.paragraph_queue = []
       
   async def add_paragraph(self, paragraph: str):
       """Add a paragraph directly to TTS - one chunk per paragraph."""
       await self._generate_and_queue_tts(paragraph)
   
   async def finalize_response(self):
       """Nothing to do - paragraphs are processed immediately."""
       pass
   
   async def _generate_and_queue_tts(self, text: str):
       """Generate TTS for a text chunk and queue for playback."""
       if not text or len(text.strip()) < 5:
           return
       
       try:
           print(f"🔊 Generating TTS for: {text[:50]}...")
           await self.audio_manager.queue_audio(
               generated_text=text,
               delete_after_play=True
           )
       except Exception as e:
           print(f"❌ TTS generation error: {e}")



class StreamingTTSHandler:
    def __init__(self, audio_manager):
        self.audio_manager = audio_manager
        self.processed_response_ids = set()
        self.processing_lock = False
        self.current_response_id = None
        
    async def process_stream_chunk(self, text: str, is_complete: bool = False, response_id: str = None):
        # Immediate duplicate check
        if response_id in self.processed_response_ids:
            print(f"⚠️ Skipping duplicate response: {response_id}")
            return
            
        # Processing lock to prevent concurrent execution
        if self.processing_lock:
            print(f"⚠️ Already processing, skipping {response_id}")
            return
            
        self.processing_lock = True
        
        try:
            print(f"📥 Processing: {response_id} ({len(text)} chars, complete: {is_complete})")
            
            # Only handle complete responses
            if is_complete and text.strip():
                # Mark as processed immediately to prevent duplicates
                self.processed_response_ids.add(response_id)
                self.current_response_id = response_id
                
                # Generate TTS directly
                print(f"🔊 Sending to TTS: {text[:100]}...")
                await self.audio_manager.queue_audio(
                    generated_text=text,
                    delete_after_play=True
                )
                print(f"✅ TTS queued for {response_id}")
            else:
                print(f"⚠️ Skipping incomplete or empty response")
                
        except Exception as e:
            print(f"❌ TTS Error for {response_id}: {e}")
            # Remove from processed set if it failed
            self.processed_response_ids.discard(response_id)
            
        finally:
            self.processing_lock = False
    
    async def reset_conversation(self, response_id: str = None):
        """Reset conversation state and clear audio queue"""
        print(f"🔄 Reset conversation for: {response_id}")
        
        # Clear processed IDs to allow new conversation
        self.processed_response_ids.clear()
        self.current_response_id = response_id
        self.processing_lock = False
        
        # Clear audio queue
        if self.audio_manager:
            await self.audio_manager.clear_queue()
        
        print(f"✅ Conversation reset complete")
