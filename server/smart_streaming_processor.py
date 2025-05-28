import asyncio
import time
import logging
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass
import hashlib

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
    is_complete: bool
    timestamp: float

class StreamingTTSHandler:
    """
    Handles streaming TTS chunks, deduplication, and chunk sequencing.
    Deduplication is by (base_id, content_hash), so reused chunk labels don't cause missed content.
    """
    def __init__(self, audio_manager):
        self.audio_manager = audio_manager
        # Deduplicate by (base_id, content_hash) for each parent response
        self.processed_chunks = set()
        self.response_chunks: Dict[str, List[TextChunk]] = {}
        self.cleanup_tasks: Dict[str, asyncio.Task] = {}

    def _hash_content(self, text: str) -> str:
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

    def _parse_response_id(self, response_id: str) -> str:
        """
        Extract a base_id from a response_id like 'resp-abcdef-raft-2' or just 'raft-1'.
        If the id has dashes, drop the trailing dash/number. Otherwise use as is.
        """
        if not response_id:
            return f"unknown-{int(time.time())}"
        parts = response_id.rsplit('-', 1)
        # If the last part is numeric, treat what's before as base
        if len(parts) == 2 and parts[1].isdigit():
            return parts[0]
        return response_id

    async def process_stream_chunk(self, text: str, is_complete: bool = False, response_id: str = None):
        base_id = self._parse_response_id(response_id)
        content_hash = self._hash_content(text.strip())
        chunk_key = (base_id, content_hash)

        if chunk_key in self.processed_chunks:
            logger.warning(f"⚠️ Skipping duplicate chunk for base_id: {base_id} (hash: {content_hash[:8]})")
            return

        logger.info(f"📥 Processing chunk [{response_id}]: {len(text)} chars, base_id: {base_id}, hash: {content_hash[:8]}, complete: {is_complete}")
        self.processed_chunks.add(chunk_key)
        chunk = TextChunk(
            content=text.strip(),
            response_id=response_id,
            is_complete=is_complete,
            timestamp=time.time()
        )

        # Track all chunks for this base_id
        if base_id not in self.response_chunks:
            self.response_chunks[base_id] = []
            logger.info(f"🆕 Starting new response stream: {base_id}")

        self.response_chunks[base_id].append(chunk)

        try:
            if chunk.content and len(chunk.content) > 5:
                logger.info(f"🔊 Sending to TTS: {chunk.content[:80]}...")
                await self.audio_manager.queue_audio(
                    generated_text=chunk.content,
                    delete_after_play=True,
                )
                logger.info(f"✅ TTS queued for {response_id}")
            else:
                logger.warning(f"⚠️ Skipping empty/short chunk: {response_id}")
        except Exception as e:
            logger.error(f"❌ TTS error for {response_id}: {e}", exc_info=True)
            self.processed_chunks.discard(chunk_key) # Allow retry if TTS fails

        if is_complete:
            await self._finalize_response(base_id)

    async def _finalize_response(self, base_id: str):
        """Called when a response stream is marked complete."""
        if base_id not in self.response_chunks:
            return
        chunks = self.response_chunks[base_id]
        total_chars = sum(len(chunk.content) for chunk in chunks)
        logger.info(f"🏁 Response {base_id} complete: {len(chunks)} chunks, {total_chars} total characters")
        # Schedule cleanup of state for this response after a timeout
        if base_id in self.cleanup_tasks:
            self.cleanup_tasks[base_id].cancel()
        self.cleanup_tasks[base_id] = asyncio.create_task(self._cleanup_response(base_id, delay=300))

    async def _cleanup_response(self, base_id: str, delay: int = 300):
        """Cleans up state for a finished response after delay (default 5 min)."""
        await asyncio.sleep(delay)
        removed = 0
        # Remove processed_chunks associated with this base_id
        for chunk in self.response_chunks.get(base_id, []):
            content_hash = self._hash_content(chunk.content)
            chunk_key = (base_id, content_hash)
            if chunk_key in self.processed_chunks:
                self.processed_chunks.discard(chunk_key)
                removed += 1
        if base_id in self.response_chunks:
            chunk_count = len(self.response_chunks[base_id])
            del self.response_chunks[base_id]
        else:
            chunk_count = 0
        logger.debug(f"🧹 Cleaned up response {base_id} ({chunk_count} chunks, {removed} dedupe keys)")

    async def reset_conversation(self, response_id: str = None):
        logger.info(f"🔄 Reset conversation requested (context: {response_id})")
        self.processed_chunks.clear()
        self.response_chunks.clear()
        for task in self.cleanup_tasks.values():
            task.cancel()
        self.cleanup_tasks.clear()
        if self.audio_manager:
            await self.audio_manager.clear_queue()
            await self.audio_manager.stop_current_audio()
        logger.info(f"✅ Conversation reset complete (context: {response_id})")
