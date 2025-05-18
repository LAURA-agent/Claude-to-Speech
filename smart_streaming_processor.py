#!/usr/bin/env python3
import re
import asyncio
import time
import logging
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("tts_server.log", mode='a'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class TextChunk:
    content: str
    response_id: str
    sequence_number: int
    is_complete: bool
    timestamp: float

class StreamingTTSHandler:
    def __init__(self, audio_manager):
        self.audio_manager = audio_manager
        self.processed_response_ids = set()
        self.processing_lock = False
        self.current_response_base_id = None
        self.response_chunks = {}  # Store chunks by response base ID
        self.chunk_counter = {}  # Track chunk sequences per response
        
    async def process_stream_chunk(self, text: str, is_complete: bool = False, response_id: str = None):
        # Extract base response ID and sequence number
        base_id, sequence_num = self._parse_response_id(response_id)
        
        # Immediate duplicate check using full response_id
        if response_id in self.processed_response_ids:
            logger.warning(f"⚠️ Skipping duplicate chunk: {response_id}")
            return
            
        logger.info(f"📥 Processing chunk [{response_id}]: {len(text)} chars, sequence: {sequence_num}, complete: {is_complete}")
        
        # Mark as processed immediately to prevent duplicates
        self.processed_response_ids.add(response_id)
        
        # Store chunk information
        chunk = TextChunk(
            content=text.strip(),
            response_id=response_id,
            sequence_number=sequence_num,
            is_complete=is_complete,
            timestamp=time.time()
        )
        
        # Initialize response tracking if new
        if base_id not in self.response_chunks:
            self.response_chunks[base_id] = []
            self.chunk_counter[base_id] = 0
            logger.info(f"🆕 Starting new response: {base_id}")
        
        # Add chunk to response
        self.response_chunks[base_id].append(chunk)
        
        try:
            # Since content script now handles boundaries, text should be clean
            # No need to check for code blocks - just process directly
            if chunk.content and len(chunk.content) > 5:
                logger.info(f"🔊 Sending to TTS (sequence {sequence_num}): {chunk.content[:100]}...")
                
                # Queue with sequence information for proper ordering
                await self.audio_manager.queue_audio(
                    generated_text=chunk.content,
                    delete_after_play=True,
                )
                
                logger.info(f"✅ TTS queued for {response_id}")
            else:
                logger.warning(f"⚠️ Skipping empty or too short chunk: {response_id}")
                
        except Exception as e:
            logger.error(f"❌ TTS Error for {response_id}: {e}", exc_info=True)
            # Remove from processed set if it failed
            self.processed_response_ids.discard(response_id)
            
        # Check if this response is complete
        if is_complete:
            await self._finalize_response(base_id)
    
    def _parse_response_id(self, response_id: str) -> Tuple[str, int]:
        """
        Parse response ID to extract base ID and sequence number.
        Expected format: base_id-chunk-timestamp-sequence
        """
        if not response_id:
            return f"unknown-{int(time.time())}", 0
            
        try:
            # Split by last dash to get sequence number
            parts = response_id.rsplit('-', 1)
            if len(parts) == 2 and parts[1].isdigit():
                base_id = parts[0]
                sequence_num = int(parts[1])
            else:
                # No sequence number found, treat as sequence 0
                base_id = response_id
                sequence_num = 0
                
            # Extract the actual base (remove chunk/delta/final suffixes)
            base_parts = base_id.split('-')
            # Remove common suffixes
            filtered_parts = []
            skip_next = False
            for part in base_parts:
                if skip_next:
                    skip_next = False
                    continue
                if part in ['chunk', 'delta', 'final']:
                    skip_next = True  # Skip the timestamp after these keywords
                    continue
                filtered_parts.append(part)
            
            clean_base_id = '-'.join(filtered_parts[:3])  # Keep first 3 parts typically timestamp-position-hash
            
            return clean_base_id, sequence_num
            
        except Exception as e:
            logger.warning(f"Error parsing response ID {response_id}: {e}")
            return response_id, 0
    
    async def _finalize_response(self, base_id: str):
        """
        Handle response completion - log statistics and cleanup.
        """
        if base_id not in self.response_chunks:
            return
            
        chunks = self.response_chunks[base_id]
        total_chars = sum(len(chunk.content) for chunk in chunks)
        
        logger.info(f"🏁 Response {base_id} complete: {len(chunks)} chunks, {total_chars} total characters")
        
        # Optional: Schedule cleanup after some time to free memory
        asyncio.create_task(self._cleanup_response(base_id, delay=300))  # Clean up after 5 minutes
    
    async def _cleanup_response(self, base_id: str, delay: int = 300):
        """
        Clean up old response data to prevent memory leaks.
        """
        await asyncio.sleep(delay)
        
        if base_id in self.response_chunks:
            chunk_count = len(self.response_chunks[base_id])
            del self.response_chunks[base_id]
            del self.chunk_counter[base_id]
            logger.debug(f"🧹 Cleaned up response {base_id} ({chunk_count} chunks)")
    
    async def reset_conversation(self, response_id: str = None):
        """Reset conversation state and clear audio queue"""
        logger.info(f"🔄 Reset conversation for: {response_id}")
        
        # Clear all state
        self.processed_response_ids.clear()
        self.response_chunks.clear()
        self.chunk_counter.clear()
        self.current_response_base_id = None
        self.processing_lock = False
        
        # Clear audio queue
        if self.audio_manager:
            await self.audio_manager.clear_queue()
        
        logger.info(f"✅ Conversation reset complete")

# Remove the old TTSChunkManager class - no longer needed
# The StreamingTTSHandler now handles everything
