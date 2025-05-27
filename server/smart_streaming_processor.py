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
        self.processing_lock = False # This lock might be redundant if Quart handles requests concurrently
        self.current_response_base_id = None
        self.response_chunks = {}  # Store chunks by response base ID
        self.chunk_counter = {}  # Track chunk sequences per response
        
    async def process_stream_chunk(self, text: str, is_complete: bool = False, response_id: str = None):
        base_id, sequence_num = self._parse_response_id(response_id)
        
        if response_id in self.processed_response_ids:
            logger.warning(f"⚠️ Skipping duplicate chunk: {response_id}")
            return
            
        logger.info(f"📥 Processing chunk [{response_id}]: {len(text)} chars, sequence: {sequence_num}, complete: {is_complete}")
        
        self.processed_response_ids.add(response_id)
        
        chunk = TextChunk(
            content=text.strip(),
            response_id=response_id,
            sequence_number=sequence_num,
            is_complete=is_complete,
            timestamp=time.time()
        )
        
        if base_id not in self.response_chunks:
            self.response_chunks[base_id] = []
            self.chunk_counter[base_id] = 0 # Initialize counter for the base_id
            if base_id.startswith('batch-'):
                logger.info(f"🚢 Starting new batch: {base_id}")
            elif base_id.startswith('activation-'):
                logger.info(f"📦 Processing activation batch: {base_id}")
            else:
                logger.info(f"🆕 Starting new response: {base_id}")
        
        self.response_chunks[base_id].append(chunk)
        # self.chunk_counter[base_id] = max(self.chunk_counter[base_id], sequence_num) # Keep track of highest sequence
        
        try:
            if chunk.content and len(chunk.content) > 5: # Basic validation
                logger.info(f"🔊 Sending to TTS (sequence {sequence_num}): {chunk.content[:100]}...")
                
                await self.audio_manager.queue_audio(
                    generated_text=chunk.content,
                    delete_after_play=True, # Assuming this is desired
                )
                
                logger.info(f"✅ TTS queued for {response_id}")
            else:
                logger.warning(f"⚠️ Skipping empty or too short chunk: {response_id}")
                
        except Exception as e:
            logger.error(f"❌ TTS Error for {response_id}: {e}", exc_info=True)
            self.processed_response_ids.discard(response_id) # Allow reprocessing if TTS failed
            
        if is_complete:
            await self._finalize_response(base_id)
    
    def _parse_response_id(self, response_id: str) -> Tuple[str, int]:
        if not response_id:
            return f"unknown-{int(time.time())}", 0
            
        try:
            parts = response_id.rsplit('-', 1)
            sequence_num_str = parts[-1]
            
            if sequence_num_str.isdigit():
                sequence_num = int(sequence_num_str)
                base_id_parts = parts[0].split('-')
            else: # No sequence number if last part is not digit
                sequence_num = 0 # Default sequence
                base_id_parts = response_id.split('-')

            # Heuristic: base ID is usually `resp-${position}-${hash}` or `manual-${hash}-${timestamp}`
            # We want to group by the core identifier before type/sequence
            # Example: resp-0-12345-final-0 -> base: resp-0-12345
            # Example: manual-abc-123-tts-0 -> base: manual-abc-123
            
            # Try to find a consistent base:
            # Handle new batch-raft format: batch-1-raft-2
            if base_id_parts[0] == 'batch' and len(base_id_parts) >= 2:
                clean_base_id = '-'.join(base_id_parts[:2]) # batch-1
            # If it starts with 'resp-' and has at least 3 parts (resp, pos, hash) 
            elif base_id_parts[0] == 'resp' and len(base_id_parts) >= 3:
                clean_base_id = '-'.join(base_id_parts[:3]) # resp-pos-hash
            # If it starts with 'manual-' and has at least 2 parts (manual, hash/ts)
            elif base_id_parts[0] == 'manual' and len(base_id_parts) >=2:
                 clean_base_id = '-'.join(base_id_parts[:2]) # manual-hash (or part of ts)
            else:
                # Fallback: use the part before sequence number, or full ID if no sequence
                clean_base_id = parts[0] if sequence_num_str.isdigit() and len(parts) > 1 else response_id


            # logger.debug(f"Parsed response_id '{response_id}' -> base_id: '{clean_base_id}', sequence: {sequence_num}")
            return clean_base_id, sequence_num
            
        except Exception as e:
            logger.warning(f"Error parsing response ID '{response_id}': {e}. Using full ID as base.")
            return response_id, 0 # Fallback
    
    async def _finalize_response(self, base_id: str):
        if base_id not in self.response_chunks:
            return
            
        chunks = self.response_chunks[base_id]
        total_chars = sum(len(chunk.content) for chunk in chunks)
        
        logger.info(f"🏁 Response {base_id} complete: {len(chunks)} chunks, {total_chars} total characters")
        
        asyncio.create_task(self._cleanup_response(base_id, delay=300))
    
    async def _cleanup_response(self, base_id: str, delay: int = 300):
        await asyncio.sleep(delay)
        
        if base_id in self.response_chunks:
            chunk_count = len(self.response_chunks[base_id])
            del self.response_chunks[base_id]
            if base_id in self.chunk_counter: # Ensure counter is also cleaned up
                del self.chunk_counter[base_id]
            logger.debug(f"🧹 Cleaned up response {base_id} ({chunk_count} chunks)")
    
    async def reset_conversation(self, response_id: str = None): # response_id for logging context
        logger.info(f"🔄 Reset conversation requested (context: {response_id})")
        
        self.processed_response_ids.clear()
        self.response_chunks.clear()
        self.chunk_counter.clear()
        self.current_response_base_id = None 
        # self.processing_lock = False # Reset lock if it was used
        
        if self.audio_manager:
            await self.audio_manager.clear_queue()
            await self.audio_manager.stop_current_audio() # Also stop any playing audio
        
        logger.info(f"✅ Conversation reset complete (context: {response_id})")
