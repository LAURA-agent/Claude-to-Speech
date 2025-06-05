# smart_streaming_processor.py
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
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler("tts_server.log", mode='a'),
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

    async def process_chunk(self, text_content: str, full_response_id: str, is_complete: bool):
        """
        Processes a text chunk received from the client.
        """
        if not self.audio_manager:
            logger.error(f"Audio manager not available. Cannot process chunk for {full_response_id}.")
            return

        logger.info(f"Received chunk for {full_response_id}: '{text_content[:75]}...', complete: {is_complete}")

        base_id = self._get_base_response_id(full_response_id)

        if not is_complete and "oneshot" in full_response_id:
            # This is the raw one-shot - store it and queue for TTS
            self.oneshot_raw_texts[base_id] = text_content
            logger.info(f"Storing raw one-shot for {base_id}: '{text_content[:50]}...'")
            
            # Clean and queue the one-shot
            cleaned_oneshot = self._clean_text_for_tts(text_content)
            if cleaned_oneshot:
                await self._queue_for_tts(cleaned_oneshot, full_response_id)
            
        elif is_complete:
            # This is the DOM-cleaned full response
            text_to_process = text_content
            
            # Check if we have a one-shot to deduplicate
            if base_id in self.oneshot_raw_texts:
                stored_oneshot = self.oneshot_raw_texts[base_id]
                
                # Use fuzzy matching to find where one-shot appears in full text
                from difflib import SequenceMatcher
                s = SequenceMatcher(None, stored_oneshot.lower(), text_content.lower())
                match = s.find_longest_match(0, len(stored_oneshot), 0, len(text_content))
                
                # If we find a good match (>80% of one-shot length)
                if match.size > len(stored_oneshot) * 0.8:
                    # Remove the matched portion from the full text
                    delta_text = text_content[match.b + match.size:].strip()
                    
                    if delta_text:
                        logger.info(f"Found one-shot match at position {match.b}, removing {match.size} chars")
                        text_to_process = delta_text
                    else:
                        logger.info(f"No delta after removing one-shot")
                        del self.oneshot_raw_texts[base_id]
                        return
                else:
                    logger.info(f"One-shot not found via fuzzy match (best match: {match.size}/{len(stored_oneshot)} chars), processing full text")
                
                # Clean up stored one-shot
                del self.oneshot_raw_texts[base_id]
            else:
                # No one-shot stored - process the full text
                logger.info(f"No one-shot found for {base_id}. Processing full text.")
            
            # Clean and queue whatever we decided to process
            cleaned_text = self._clean_text_for_tts(text_to_process)
            if cleaned_text:
                await self._queue_for_tts(cleaned_text, full_response_id)

    async def _queue_for_tts(self, text: str, response_id: str):
        """Helper to queue text for TTS"""
        try:
            await self.audio_manager.queue_audio(generated_text=text, delete_after_play=True)
            logger.info(f"Queued for TTS (ID: {response_id}): '{text[:75]}...'")
        except Exception as e:
            logger.error(f"Error queuing audio for {response_id}: {e}", exc_info=True)

    async def reset_conversation(self, response_id: Optional[str] = None):
        """
        Resets the state for a new conversation or on client request.
        """
        context = f" (context: {response_id})" if response_id else ""
        logger.info(f"Resetting conversation state{context}")
        
        # Clear stored one-shots
        self.oneshot_raw_texts.clear()

        if self.audio_manager:
            await self.audio_manager.clear_queue()
            await self.audio_manager.stop_current_audio()
            logger.info(f"Audio manager queue cleared and audio stopped during reset{context}.")
        else:
            logger.warning(f"Audio manager not available during reset_conversation{context}.")
        
        logger.info(f"Conversation reset complete{context}.")
