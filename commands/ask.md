---
description: Ask behavioral and workflow questions before proceeding
argument-hint: [optional initial message]
---

You are now in **ask mode** - ask questions before taking action.

## When to Use Two-Response Protocol

**ONLY use the two-response interruption protocol if you were actively working on something.**

### If Interrupted Mid-Work:

**First Response: Acknowledgment (TTS-only, NO TOOLS)**
```
<!-- TTS: "OK, I'm stopping. Is there something we need to change?" -->
```
or
```
<!-- TTS: "I just finished updating the auth handler but it looks like you want to talk, what's up?" -->
```
or
```
<!-- TTS: "I was about to run the tests. Do we need to course correct?" -->
```

**Second Response:** Wait for user to tell you what to ask about, then ask your question.

### If Already in Conversation (Not Mid-Work):

**Just acknowledge the mode switch and wait:**
```
<!-- TTS: "Switching to ask mode" -->
```
or just use `<!-- TTS: SILENT -->` and wait for the user to specify what to ask about.

**IMPORTANT:** Acknowledgment responses must:
- Contain ONLY a TTS marker (and minimal text if needed)
- Use NO TOOLS whatsoever
- The TTS hook only works on responses without tool calls

## Question Format

**One sentence only**

**Focus on:** Behavioral and high-level workflow concepts
- "Should we log this error before returning?"
- "Do you want this to run on startup or on-demand?"
- "Should failed requests retry automatically?"
- "Do you want to fail fast here or handle errors gracefully?"

**NOT for:** Technical implementation choices (those are your responsibility)
- ❌ "Should I use async/await or promises?"
- ❌ "Should I use let or const?"
- ❌ "Should I use a Map or an Object?"
- ❌ "Should I add a type annotation here?"

## TTS Alignment

The TTS should match the question text:

```
Should we log this error before returning?

<!-- TTS: "Should we log this error before returning?" -->
```

## After Asking

**WAIT for the user's answer before proceeding.**

Do not:
- Make assumptions
- Provide multiple options
- Start implementing while waiting
- Ask follow-up questions immediately

## Example Flow

**User invokes:** `/claude-to-speech:ask` (while you're working on a feature)

**Your first response:**
```
<!-- TTS: "I was about to add the validation logic. What's up?" -->
```

**User:** "Yeah, continue"

**Your second response:**
```
Should we validate the input data before processing or trust the upstream service?

<!-- TTS: "Should we validate the input data before processing or trust the upstream service?" -->
```

**User:** "Validate it"

**Your next response:**
```
Adding input validation now...
[proceeds with implementation]
```

---

Remember: Ask meaningful questions about behavior and workflow, not technical details.

$ARGUMENTS
