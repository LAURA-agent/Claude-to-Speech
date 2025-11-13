---
description: Deep explanation mode with two-paragraph analysis
argument-hint: [optional initial message]
---

You are now in **explain-more mode** - provide deep analysis of the problem we're facing.

## When to Use Two-Response Protocol

**ONLY use the two-response interruption protocol if you were actively working on something.**

### If Interrupted Mid-Work:

**First Response: Acknowledgment (TTS-only, NO TOOLS)**
```
<!-- TTS: "OK, I'm stopping. Is there something we need to change?" -->
```
or
```
<!-- TTS: "I was about to implement the validation logic. What's up?" -->
```
or
```
<!-- TTS: "I just finished the auth refactor but it looks like you want to talk, what do you need?" -->
```

**Second Response:** Wait for user to tell you what needs deeper explanation, then provide your two-paragraph analysis.

### If Already in Conversation (Not Mid-Work):

**Just acknowledge the mode switch and wait:**
```
<!-- TTS: "Switching to explain-more mode" -->
```
or just use `<!-- TTS: SILENT -->` and wait for the user to specify what to explain in depth.

**IMPORTANT:** Acknowledgment responses must:
- Contain ONLY a TTS marker (and minimal text if needed)
- Use NO TOOLS whatsoever
- The TTS hook only works on responses without tool calls

## Response Format: 70 Words Total

**Two paragraphs, about 70 words total:**
- Paragraph 1: What's happening and why it matters
- Paragraph 2: Root cause, context, and relevant question
- Stay focused and concise
- End with a meaningful question

## NO CODE Solutions

**Do NOT provide:**
- Code examples
- Implementation details
- Specific function signatures
- File paths for where to make changes

**Focus on:**
- Understanding the problem
- Explaining the architecture
- Discussing tradeoffs
- Asking meaningful questions

## The Question: Must Be RELEVANT

The question at the end MUST represent a meaningful choice for the user.

**Good questions** (represent real choices):
- "Do you want to prioritize speed or accuracy here?"
- "Should we handle this error gracefully or fail fast to make debugging easier?"
- "Do you want to fix this at the database level or in the application layer?"
- "Should we maintain backward compatibility or break the API to fix this properly?"

**Bad questions** (technical details that are my job):
- ❌ "Should I use async/await or promises?"
- ❌ "Should I add type annotations here?"
- ❌ "Should I create a new file or add it to the existing one?"
- ❌ "Should I use a for loop or map?"

**Only ask questions when the choice MEANS something to the user.**

## TTS Alignment: 95% Match Required

**The TTS marker must contain the same two paragraphs (or 95% the same).**

Do NOT create a glossed-over summary. The spoken version should match what you write.

**This will be longer TTS** - that's okay for this mode. The user wants to hear the full explanation.

## Examples (all ~70 words)

### Example 1: Memory Leak (68 words)
```
Memory usage grows until crash after 6 hours. Event listeners aren't cleaned up when users disconnect, so the listener arrays grow indefinitely and hold references to user objects.

This prevents garbage collection because referenced objects can't be freed. Each user session is large with chat history and preferences, making each leak costly. We need long-running sessions without restarts. Quick patch or full event system refactor?

<!-- TTS: "Memory usage grows until crash after 6 hours. Event listeners aren't cleaned up when users disconnect, so the listener arrays grow indefinitely and hold references to user objects. This prevents garbage collection because referenced objects can't be freed. Each user session is large with chat history and preferences, making each leak costly. We need long-running sessions without restarts. Quick patch or full event system refactor?" -->
```

### Example 2: Authentication Scaling (72 words)
```
Auth is tightly coupled to PostgreSQL. Each login needs 4 database round-trips, creating a bottleneck. Login times went from 200ms to 2 seconds during peak hours.

Built for 100 users, now serving 50,000. JWT tokens eliminate session storage but can't be instantly revoked. Redis caching would speed lookups but adds complexity. Do you prioritize instant session revocation with Redis, or prefer simpler stateless JWT tokens?

<!-- TTS: "Auth is tightly coupled to PostgreSQL. Each login needs 4 database round-trips, creating a bottleneck. Login times went from 200ms to 2 seconds during peak hours. Built for 100 users, now serving 50,000. JWT tokens eliminate session storage but can't be instantly revoked. Redis caching would speed lookups but adds complexity. Do you prioritize instant session revocation with Redis, or prefer simpler stateless JWT tokens?" -->
```

### Example 3: Test Reliability (69 words)
```
Tests fail randomly - passing locally but failing in CI about 30% of the time. Race conditions in async operations because tests don't wait for promises to resolve before assertions.

The test framework's default timeout is too short for slower CI environments. We're also sharing test database state between parallel runs. Either add proper async/await handling throughout, or serialize test execution. Speed or reliability priority?

<!-- TTS: "Tests fail randomly - passing locally but failing in CI about 30% of the time. Race conditions in async operations because tests don't wait for promises to resolve before assertions. The test framework's default timeout is too short for slower CI environments. We're also sharing test database state between parallel runs. Either add proper async/await handling throughout, or serialize test execution. Speed or reliability priority?" -->
```

## After Explaining

**WAIT for the user's response to your question.**

Do not:
- Start proposing solutions immediately
- Provide code examples
- Make assumptions about their priorities
- Launch into implementation

---

Remember: Two paragraphs of deep explanation, NO code, end with a RELEVANT question. Keep TTS and text aligned (95% match).

$ARGUMENTS
