#!/bin/bash
#
# Claude Code Stop Hook - Automatic TTS
# Fires after Claude finishes responding
# Extracts and speaks TTS markers from response
#

# Debug logging (set DEBUG=1 in .env to enable)
DEBUG="${DEBUG:-0}"
DEBUG_FILE="/tmp/claude_stop_hook.log"

# Get the plugin directory (parent of hooks directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# Path to claude_speak.py
SPEAK_SCRIPT="$PLUGIN_DIR/scripts/claude_speak.py"

# Debug path resolution
[ "$DEBUG" = "1" ] && echo "SCRIPT_DIR: $SCRIPT_DIR" >> "$DEBUG_FILE"
[ "$DEBUG" = "1" ] && echo "PLUGIN_DIR: $PLUGIN_DIR" >> "$DEBUG_FILE"
[ "$DEBUG" = "1" ] && echo "SPEAK_SCRIPT: $SPEAK_SCRIPT" >> "$DEBUG_FILE"

# Read the JSON input from stdin
INPUT=$(cat)

# Debug the raw input
[ "$DEBUG" = "1" ] && echo "=== Stop Hook Fired at $(date) ===" >> "$DEBUG_FILE"
[ "$DEBUG" = "1" ] && echo "Raw input: $INPUT" >> "$DEBUG_FILE"

# Extract the transcript path from JSON
TRANSCRIPT_PATH=$(echo "$INPUT" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)

[ "$DEBUG" = "1" ] && echo "Transcript path: $TRANSCRIPT_PATH" >> "$DEBUG_FILE"

# Read the last assistant message from the transcript
if [ -f "$TRANSCRIPT_PATH" ]; then
    # Get the last line (latest message) from the transcript
    LAST_MESSAGE=$(tail -1 "$TRANSCRIPT_PATH")
    [ "$DEBUG" = "1" ] && echo "Last message JSON: ${LAST_MESSAGE:0:200}..." >> "$DEBUG_FILE"

    # Extract content from the JSON - content is an array of objects
    RESPONSE=$(echo "$LAST_MESSAGE" | python3 -c "
import sys, json
try:
    msg = json.load(sys.stdin)
    content = msg.get('message', {}).get('content', [])
    if isinstance(content, list) and len(content) > 0:
        # Get the first text block
        for block in content:
            if block.get('type') == 'text':
                print(block.get('text', ''))
                break
except:
    pass
" 2>/dev/null || echo "")

    [ "$DEBUG" = "1" ] && echo "Extracted response length: ${#RESPONSE} chars" >> "$DEBUG_FILE"
    [ "$DEBUG" = "1" ] && echo "First 200 chars: ${RESPONSE:0:200}" >> "$DEBUG_FILE"
else
    [ "$DEBUG" = "1" ] && echo "Transcript file not found: $TRANSCRIPT_PATH" >> "$DEBUG_FILE"
    exit 0
fi

# Check if response explicitly marks SILENT (handle both escaped and unescaped)
if echo "$RESPONSE" | grep -qE "(<\\!--|<!--) TTS: SILENT (-->|-->)"; then
    # Explicitly marked as silent - do nothing
    [ "$DEBUG" = "1" ] && echo "Found SILENT marker, skipping TTS" >> "$DEBUG_FILE"
    exit 0
fi

# Extract TTS text if present (handle both escaped and unescaped markers)
TTS_TEXT=$(echo "$RESPONSE" | sed -n 's/.*<\\!-- TTS: "\([^"]*\)".*/\1/p' | head -1)
[ "$DEBUG" = "1" ] && echo "Escaped pattern result: '$TTS_TEXT'" >> "$DEBUG_FILE"

if [ -z "$TTS_TEXT" ]; then
    # Try unescaped version as fallback
    TTS_TEXT=$(echo "$RESPONSE" | sed -n 's/.*<!-- TTS: "\([^"]*\)".*/\1/p' | head -1)
    [ "$DEBUG" = "1" ] && echo "Unescaped pattern result: '$TTS_TEXT'" >> "$DEBUG_FILE"
fi

# If we found TTS text, speak it
if [ -n "$TTS_TEXT" ]; then
    [ "$DEBUG" = "1" ] && echo "Extracted TTS text: $TTS_TEXT" >> "$DEBUG_FILE"

    # Check if speak script exists and is executable
    if [ -x "$SPEAK_SCRIPT" ]; then
        # Call the speak script with the extracted text
        python3 "$SPEAK_SCRIPT" --conversation "$TTS_TEXT" 2>&1 | while IFS= read -r line; do
            [ "$DEBUG" = "1" ] && echo "TTS output: $line" >> "$DEBUG_FILE"
        done
    else
        [ "$DEBUG" = "1" ] && echo "ERROR: $SPEAK_SCRIPT not found or not executable" >> "$DEBUG_FILE"
    fi
else
    # No TTS marker found - silent by default
    [ "$DEBUG" = "1" ] && echo "No TTS marker found, defaulting to silent" >> "$DEBUG_FILE"
fi

exit 0