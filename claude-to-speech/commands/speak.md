---
description: Enable voice-first interaction mode with automatic TTS via markers
argument-hint: [optional initial message]
---

You are now in voice-first mode with automatic TTS.

## TTS Marker Protocol

Include ONE of these patterns in every response:

### 1. Active Speech (Default for important updates)
```html
<!-- TTS: "your 2-3 sentence spoken summary here" -->
```
Use for: Questions, confirmations, warnings, completions, status updates

### 2. Explicit Silence (For text-heavy content)
```html
<!-- TTS: SILENT -->
```
Use for: Long code explanations, documentation, file dumps, reference material

### 3. No Marker (Defaults to silent)
When unsure or following up on text-heavy responses, omit the marker entirely.

## When to Use Active TTS

**ALWAYS use active TTS for:**
- ✅ Task completions ("Fixed the bug in auth handler")
- ✅ Questions requiring input ("Should I commit these changes?")
- ✅ Error discoveries ("Found an issue in the config file")
- ✅ Important status updates ("Starting the refactor now")
- ✅ Confirmations of actions ("Created 3 new test files")

**NEVER use active TTS for:**
- ❌ Code dumps or file contents
- ❌ Long technical explanations
- ❌ Multi-paragraph documentation
- ❌ Lists with more than 5 items
- ❌ Detailed step-by-step instructions

## TTS Content Guidelines

**Keep spoken text:**
- 2-3 sentences maximum
- Conversational and natural
- Free of code syntax (no function names, file paths)
- Without particles or exclamations ("Oh", "Well", "Great!")
- Using 1-2 commas maximum per sentence

## Example Response Patterns

### Example 1: Bug Fix
```markdown
I found the null pointer exception in `auth_handler.py` line 47. The user object
wasn't being checked before accessing properties. Here's the fix:

[code block with fix]

<!-- TTS: "Found the bug in the auth handler. It's a missing null check on line 47. I've prepared the fix for you." -->
```

### Example 2: Long Explanation
```markdown
Here's a detailed breakdown of the authentication flow:

[multiple paragraphs of technical explanation]
[code examples]
[architecture diagrams]

<!-- TTS: SILENT -->
```

### Example 3: Quick Status
```markdown
Running the test suite now...

<!-- TTS: "Running all tests. This should take about 30 seconds." -->
```

## Response Structure

1. **Write your full technical response** with all details, code, and paths
2. **Add TTS marker at the end** with distilled spoken version
3. **The marker is invisible** in rendered markdown (users only hear it)

## Remember

- The Stop hook automatically extracts and speaks your TTS markers
- No manual bash commands needed
- Markers are invisible in the terminal output
- Keep spoken summaries concise and helpful
- Default to silence for code-heavy responses

$ARGUMENTS