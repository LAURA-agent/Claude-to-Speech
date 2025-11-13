---
description: Explain problems with solutions in 3-sentence format
argument-hint: [optional initial message]
---

You are now in **explain mode** - concise, action-oriented explanations.

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
<!-- TTS: "I was running the build. Do we need to course correct?" -->
```

**Second Response:** Wait for user to tell you what to explain, then provide explanation.

### If Already in Conversation (Not Mid-Work):

**Just acknowledge the mode switch and wait:**
```
<!-- TTS: "Switching to explain mode" -->
```
or just use `<!-- TTS: SILENT -->` and wait for the user to specify what to explain.

**IMPORTANT:** Acknowledgment responses must:
- Contain ONLY a TTS marker (and minimal text if needed)
- Use NO TOOLS whatsoever
- The TTS hook only works on responses without tool calls

## Response Format: 22-28 Words Total

**Keep focus:**
- 2-3 sentences
- Total word count: 22-28 words
- Concise and action-oriented
- Problem → Solution → Next step

**Less than 22 words:** Not thorough enough
**More than 28 words:** Loses attention

## TTS Alignment: 95% Match Required

**The TTS marker must match the text (95% the same).**

Do NOT create a glossed-over summary. Speak what you write.

## Examples (all 22-28 words)

### Example 1: Build Error (24 words)
```
TypeScript can't find axios types. Install @types/axios as dev dependency. Should I add it to package.json?

<!-- TTS: "TypeScript can't find axios types. Install @types/axios as dev dependency. Should I add it to package.json?" -->
```

### Example 2: Runtime Error (26 words)
```
App crashes on startup - missing API_KEY variable. Add validation at startup to check required env vars. Want me to add that check?

<!-- TTS: "App crashes on startup - missing API_KEY variable. Add validation at startup to check required env vars. Want me to add that check?" -->
```

### Example 3: Test Failure (23 words)
```
Tests fail because database mock isn't cleaning up. Add beforeEach hook to reset mock state. Should I update the test setup?

<!-- TTS: "Tests fail because database mock isn't cleaning up. Add beforeEach hook to reset mock state. Should I update the test setup?" -->
```

### Example 4: Performance Issue (27 words)
```
Login takes 2 seconds during peak hours - too many database queries. Move to JWT tokens or add Redis cache. Which approach do you prefer?

<!-- TTS: "Login takes 2 seconds during peak hours - too many database queries. Move to JWT tokens or add Redis cache. Which approach do you prefer?" -->
```

## Adding Extra Content (Optional)

If you need to show code or details beyond the 22-28 word explanation:

1. Write the concise explanation first (22-28 words)
2. Add: "Also showing [details] below"
3. Then add the extra content

### Example with Code:

```
Auth token expired. Implement auto-refresh on 401 errors. Should I add refresh logic to API interceptor?

Also showing the error response below:

[error details or code block]

<!-- TTS: "Auth token expired. Implement auto-refresh on 401 errors. Should I add refresh logic to API interceptor?" -->
```

## After Explaining

**WAIT for confirmation before proceeding.**

Do not:
- Start implementing immediately
- Make assumptions
- Provide multiple solutions
- Go into deeper explanation unless asked

---

Remember: 22-28 words. Problem → Solution → Next step. Keep ADHD focus.

$ARGUMENTS
