# smart_streaming_processor.py - DEBUG VERSION
import asyncio
import time
import logging
import re
from typing import Optional
from difflib import SequenceMatcher

# Configure logging
logger = logging.getLogger(__name__)
# Basic config if not configured by main server script
if not logger.handlers:
    logging.basicConfig(
        level=logging.DEBUG,  # Changed to DEBUG
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler("tts_server_debug.log", mode='a'),
            logging.StreamHandler()
        ]
    )

class SimplifiedTTSProcessor:
    """
    A simplified processor that takes text chunks (one-shot or full response) from the client,
    handles deduplication, and queues them for TTS.
    """
    def __init__(self, audio_manager):
        self.audio_manager = audio_manager
        # Store raw one-shot text per base response ID for delta calculation
        self.oneshot_raw_texts = {}  # {base_response_id: raw_oneshot_text}
        logger.info("SimplifiedTTSProcessor initialized.")

    def _clean_text_for_tts(self, text_from_client: str) -> str:
        """
        Light cleaning for TTS - client has already done heavy lifting for full responses
        """
        if not text_from_client:
            return ""
        
        cleaned_text = text_from_client.strip()
        
        # Just handle basic formatting for TTS
        # Replace double newlines with periods
        cleaned_text = cleaned_text.replace('\n\n', '. ')
        # Replace single newlines with spaces
        cleaned_text = cleaned_text.replace('\n', ' ')
        # Collapse multiple spaces
        cleaned_text = re.sub(r'\s+', ' ', cleaned_text)
        # Remove empty parentheses
        cleaned_text = re.sub(r'\(\s*\)', '', cleaned_text)
        
        return cleaned_text.strip()

    def _get_base_response_id(self, full_response_id: str) -> str:
        """
        Extracts the base part of the response ID.
        e.g., "claude-resp-XYZ-oneshot" -> "claude-resp-XYZ"
        e.g., "claude-resp-XYZ-complete" -> "claude-resp-XYZ"
        """
        parts = full_response_id.split('-')
        known_suffixes = ["oneshot", "delta", "complete", "full", "finalized", "stop"]
        
        if len(parts) > 2 and parts[-1] in known_suffixes:
            # Handle compound suffixes like "oneshot-finalized"
            if len(parts) > 3 and parts[-2] in known_suffixes:
                return '-'.join(parts[:-2])
            return '-'.join(parts[:-1])
        return full_response_id

    def _normalize_for_comparison(self, text: str) -> str:
        """Normalize text for comparison by removing formatting differences"""
        if not text:
            return ""
        
        # Remove all newlines and extra spaces (like DOM cleaning does)
        normalized = re.sub(r'\s+', ' ', text)
        
        # Strip quotes and whitespace
        normalized = normalized.strip().lstrip('"\'`')
        
        # Remove common DOM artifacts
        normalized = re.sub(r'\s*\.\s*$', '', normalized)  # Remove trailing periods
        normalized = re.sub(r'\s+', ' ', normalized)  # Collapse spaces again
        
        return normalized.strip()

    def _find_and_remove_oneshot_overlap(self, oneshot_text: str, full_text: str) -> str:
        """
        Find where the oneshot appears in the full text and return only the non-overlapping portion.
        Uses both exact matching and fuzzy matching for robust detection.
        """
        if not oneshot_text or not full_text:
            logger.debug(f"[DEDUP] Empty text - oneshot empty: {not oneshot_text}, full empty: {not full_text}")
            return full_text
        
        # Normalize both texts for comparison
        oneshot_normalized = self._normalize_for_comparison(oneshot_text)
        full_normalized = self._normalize_for_comparison(full_text)
        
        logger.debug(f"[DEDUP] Oneshot normalized: '{oneshot_normalized[:100]}...'")
        logger.debug(f"[DEDUP] Full normalized: '{full_normalized[:100]}...'")
        
        # Try exact match first (most reliable)
        if full_normalized.startswith(oneshot_normalized):
            logger.info(f"[DEDUP] ✅ Exact match found at start, removing {len(oneshot_text)} chars")
            # Find the actual position in the original text by length ratio
            ratio = len(oneshot_text) / len(oneshot_normalized) if len(oneshot_normalized) > 0 else 1
            cutoff = int(len(oneshot_normalized) * ratio)
            remaining = full_text[cutoff:].strip()
            logger.debug(f"[DEDUP] Remaining text after exact match: '{remaining[:100]}...'")
            return remaining
        
        # Try fuzzy matching with sequence matcher
        matcher = SequenceMatcher(None, oneshot_normalized.lower(), full_normalized.lower())
        match = matcher.find_longest_match(0, len(oneshot_normalized), 0, len(full_normalized))
        
        # Require a strong match (at least 80% of oneshot length)
        match_quality = match.size / len(oneshot_normalized) if len(oneshot_normalized) > 0 else 0
        
        logger.debug(f"[DEDUP] Fuzzy match quality: {match_quality:.2f}, match size: {match.size}")
        
        if match_quality >= 0.7:
            logger.info(f"[DEDUP] ✅ Fuzzy match found: quality={match_quality:.2f}, removing overlap")
            
            # Calculate position in original text based on normalized match
            char_ratio = len(full_text) / len(full_normalized) if len(full_normalized) > 0 else 1
            start_pos = int(match.b * char_ratio)
            end_pos = int((match.b + match.size) * char_ratio)
            
            # Remove the matched portion
            remaining_text = (full_text[:start_pos] + full_text[end_pos:]).strip()
            
            if remaining_text:
                logger.info(f"[DEDUP] Removed fuzzy match, {len(remaining_text)} chars remaining")
                logger.debug(f"[DEDUP] Remaining text: '{remaining_text[:100]}...'")
                return remaining_text
            else:
                logger.info("[DEDUP] ⚠️ No remaining text after fuzzy match removal")
                return ""
        
        # No good match found, return full text
        logger.warning(f"[DEDUP] ❌ No reliable match found (best quality: {match_quality:.2f}), keeping full text")
        return full_text

    async def process_chunk(self, text_content: str, full_response_id: str, is_complete: bool):
        """
        Processes a text chunk received from the client.
        """
        if not self.audio_manager:
            logger.error(f"Audio manager not available. Cannot process chunk for {full_response_id}.")
            return

        logger.info(f"[PROCESS] Received chunk for {full_response_id}: '{text_content[:75]}...', complete: {is_complete}")

        base_id = self._get_base_response_id(full_response_id)
        logger.debug(f"[PROCESS] Extracted base_id: {base_id} from {full_response_id}")

        if not is_complete and "oneshot" in full_response_id:
            # This is the raw one-shot - store it and queue for TTS
            self.oneshot_raw_texts[base_id] = text_content
            logger.info(f"[PROCESS] 📝 Storing raw one-shot for {base_id}: '{text_content[:50]}...'")
            logger.debug(f"[PROCESS] Current stored oneshots: {list(self.oneshot_raw_texts.keys())}")
            
            # Clean and queue the one-shot
            cleaned_oneshot = self._clean_text_for_tts(text_content)
            if cleaned_oneshot:
                logger.info(f"[PROCESS] 🔊 Queueing oneshot for TTS: '{cleaned_oneshot[:50]}...'")
                await self._queue_for_tts(cleaned_oneshot, full_response_id)
            
        elif is_complete:
            # This is the DOM-cleaned full response
            logger.info(f"[PROCESS] 📄 Processing complete response for {base_id}")
            logger.debug(f"[PROCESS] Stored oneshots available: {list(self.oneshot_raw_texts.keys())}")
            
            text_to_process = text_content
            
            # Check if we have a one-shot to deduplicate
            if base_id in self.oneshot_raw_texts:
                stored_oneshot = self.oneshot_raw_texts[base_id]
                logger.info(f"[PROCESS] 🔍 Found stored oneshot for deduplication")
                logger.debug(f"[PROCESS] Stored oneshot: '{stored_oneshot[:100]}...'")
                logger.debug(f"[PROCESS] Full text: '{text_content[:100]}...'")
                
                # Use improved fuzzy matching to remove overlap
                text_to_process = self._find_and_remove_oneshot_overlap(stored_oneshot, text_content)
                
                # Clean up stored one-shot
                del self.oneshot_raw_texts[base_id]
                logger.debug(f"[PROCESS] Deleted oneshot for {base_id}, remaining: {list(self.oneshot_raw_texts.keys())}")
                
                if not text_to_process.strip():
                    logger.info(f"[PROCESS] ⚠️ No remaining content after deduplication for {base_id}")
                    return
            else:
                # No one-shot stored - process the full text
                logger.warning(f"[PROCESS] ❌ No one-shot found for {base_id}. Processing full text.")
            
            # Clean and queue whatever we decided to process
            cleaned_text = self._clean_text_for_tts(text_to_process)
            if cleaned_text:
                logger.info(f"[PROCESS] 🔊 Queueing complete response for TTS: '{cleaned_text[:50]}...'")
                await self._queue_for_tts(cleaned_text, full_response_id)
            else:
                logger.warning(f"[PROCESS] No text to queue after cleaning for {full_response_id}")

    async def _queue_for_tts(self, text: str, response_id: str):
        try:
            logger.debug(f"[QUEUE] Queueing text for TTS (ID: {response_id}), length: {len(text)}")
            await self.audio_manager.queue_audio(generated_text=text, delete_after_play=True)
            logger.info(f"[QUEUE] ✅ Successfully queued for TTS (ID: {response_id})")
        except Exception as e:
            logger.error(f"[QUEUE] ❌ Error queuing audio for {response_id}: {e}", exc_info=True)

    async def reset_conversation(self, response_id: Optional[str] = None):
        """
        Resets the state for a new conversation or on client request.
        """
        context = f" (context: {response_id})" if response_id else ""
        logger.info(f"[RESET] 🔄 Resetting conversation state{context}")
        
        # Log what we're clearing
        if self.oneshot_raw_texts:
            logger.debug(f"[RESET] Clearing stored oneshots: {list(self.oneshot_raw_texts.keys())}")
        
        # Clear stored one-shots
        self.oneshot_raw_texts.clear()

        if self.audio_manager:
            await self.audio_manager.clear_queue()
            await self.audio_manager.stop_current_audio()
            logger.info(f"[RESET] ✅ Audio manager queue cleared and audio stopped{context}.")
        else:
            logger.warning(f"[RESET] ⚠️ Audio manager not available during reset{context}.")
        
        logger.info(f"[RESET] ✅ Conversation reset complete{context}.")
