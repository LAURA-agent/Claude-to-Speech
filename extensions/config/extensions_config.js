// Extension configuration for Claude TTS
const CLAUDE_TTS_CONFIG = {
  server: {
    host: "127.0.0.1",
    port: 5000,
    endpoints: {
      stream: "/stream",
      tts: "/tts", 
      health: "/health",
      reset: "/reset_conversation"
    }
  },
  
  streaming: {
    debounceMs: 250,
    chunkMinLength: 5,
    healthCheckIntervalMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 750
  },
  
  ui: {
    panelPosition: "bottom-right",
    quiet_mode: true
  }
};

// Make config available globally
window.CLAUDE_TTS_CONFIG = CLAUDE_TTS_CONFIG;
