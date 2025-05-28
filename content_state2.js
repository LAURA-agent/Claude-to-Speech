// Claude TTS Stream Monitor - Content-Aware State Management
console.log("🚀 Claude TTS Stream Monitor - Content-Aware Version");

class ClaudeStreamMonitor {
  constructor() {
    this.conversationMode = false;
    this.isMonitoring = false;
    this.debounceTimer = null;
    this.completionTimer = null;
    this.processingLock = false;
    
    // Response Processing State
    this.baseline = ""; // Everything we've processed so far
    this.ttsAccumulator = ""; // Clean conversational text being built
    this.conversationalDebounceCount = 0; // Counter for conversational content only
    this.currentRaft = 1;
    this.responsePhase = 'IDLE'; // IDLE, THINKING, RESPONDING, COMPLETE
    
    // Server communication
    this.serverHealthy = true;
    this.failedRequests = [];
    this.isRetrying = false;
    
    this.loadSettings();
    this.resetServerOnPageLoad();
    this.startHealthCheck();
  }

  async startHealthCheck() {
    try {
      const result = await fetch("http://127.0.0.1:5000/health", { method: 'GET' }).then(res => res.json());
      if (result.status === "ok") {
        if (!this.serverHealthy) console.log("✅ TTS Server healthy");
        this.serverHealthy = true;
        if (this.failedRequests.length > 0 && !this.isRetrying) {
          this.retryFailedRequests();
        }
      } else {
        this.serverHealthy = false;
      }
    } catch (e) {
      this.serverHealthy = false;
    }
    setTimeout(() => this.startHealthCheck(), 10000);
  }

  async retryFailedRequests() {
    if (this.isRetrying || this.failedRequests.length === 0 || !this.serverHealthy) return;
    this.isRetrying = true;
    
    const requestsToRetry = [...this.failedRequests];
    this.failedRequests = [];
    
    for (const req of requestsToRetry) {
      if (!this.serverHealthy) {
        this.failedRequests.unshift(...requestsToRetry.slice(requestsToRetry.indexOf(req)));
        break;
      }
      try {
        await this.sendStreamChunk(req.text, req.isComplete, req.responseId, 0, true);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`❌ Retry failed for ${req.responseId}:`, e);
      }
    }
    this.isRetrying = false;
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['conversationMode']);
      const newMode = result.conversationMode || false;

      if (newMode !== this.conversationMode) {
        this.conversationMode = newMode;
        if (newMode && !this.isMonitoring) {
          this.startMonitoring();
        } else if (!newMode && this.isMonitoring) {
          this.stopMonitoring();
        }
      }
      
      if (window.ttsPanel) {
        window.ttsPanel.updateToggleVisuals(this.conversationMode);
        window.ttsPanel.updateStatusDisplay();
      }
    } catch (error) {
      console.error("❌ Error loading settings:", error);
      this.conversationMode = false;
    }
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    console.log("🔄 Starting stream monitoring");
    this.isMonitoring = true;
    this.conversationMode = true;

    this.observer = new MutationObserver(() => {
      if (this.conversationMode && !this.processingLock) {
        this.debounceAndProcess();
      }
    });

    const container = document.body;
    this.observer.observe(container, { childList: true, subtree: true, characterData: true });
    this.setBaseline();
  }

  stopMonitoring() {
    console.log("⏹️ Stopping stream monitoring");
    this.isMonitoring = false;
    this.conversationMode = false;
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    clearTimeout(this.debounceTimer);
    clearTimeout(this.completionTimer);
    
    if (this.responsePhase !== 'IDLE') {
      this.completeResponse();
    }
  }

  findClaudeResponse() {
    const claudeMessages = document.querySelectorAll('.font-claude-message');
    return claudeMessages.length > 0 ? claudeMessages[claudeMessages.length - 1] : null;
  }

  setBaseline() {
    const element = this.findClaudeResponse();
    if (element) {
      this.baseline = element.textContent || "";
      console.log(`📸 Baseline set: ${this.baseline.length} chars`);
    } else {
      this.baseline = "";
      console.log("📸 No existing response - baseline cleared");
    }
    
    this.resetResponseState();
  }

  resetResponseState() {
    this.ttsAccumulator = "";
    this.conversationalDebounceCount = 0;
    this.currentRaft = 1;
    this.responsePhase = 'IDLE';
    console.log("🔄 Response state reset");
  }

  resetForNewResponse() {
    console.log("🔄 Manual baseline reset");
    this.completeResponse();
    this.setBaseline();
  }

  debounceAndProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processContent();
    }, 500); // 500ms debounce as discussed
  }

  // Content Classification Engine
  classifyContent(rawNewContent, element) {
    const result = {
      type: 'unknown', // 'thinking', 'conversational', 'code', 'artifact'
      cleanContent: "",
      shouldSkipTTS: false
    };
    
    if (!rawNewContent) return result;
    
    // Check for thinking sections in the element
    if (element) {
      const thinkingSections = element.querySelectorAll('.transition-all.duration-400');
      for (const section of thinkingSections) {
        if (section.textContent && section.textContent.includes('Thought process')) {
          result.type = 'thinking';
          result.shouldSkipTTS = true;
          result.cleanContent = rawNewContent; // Keep for baseline extension
          return result;
        }
      }
      
      // Check for code blocks and artifacts
      const codeElements = element.querySelectorAll('pre, code, .artifact-block-cell, [data-artifact-title]');
      if (codeElements.length > 0) {
        result.type = 'code';
        result.shouldSkipTTS = true;
        // Extract conversational text that comes before code blocks
        let conversationalPart = rawNewContent;
        codeElements.forEach(codeEl => {
          const codeText = codeEl.textContent;
          if (codeText) {
            conversationalPart = conversationalPart.replace(codeText, '');
          }
        });
        result.cleanContent = this.normalizeText(conversationalPart);
        return result;
      }
    }
    
    // Default to conversational content
    result.type = 'conversational';
    result.shouldSkipTTS = false;
    result.cleanContent = this.normalizeText(rawNewContent);
    
    return result;
  }
  
  normalizeText(text) {
    if (!text) return "";
    
    // Remove function calls and results via text patterns
    text = text.replace(/<function_calls>[\s\S]*?<\/antml:function_calls>/gi, '');
    text = text.replace(/<fnr>[\s\S]*?<\/function_results>/gi, '');
    
    // Normalize whitespace
    return text.replace(/\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  processContent() {
    if (this.processingLock) return;
    this.processingLock = true;

    try {
      const element = this.findClaudeResponse();
      if (!element) {
        this.processingLock = false;
        return;
      }

      const currentRawContent = element.textContent || "";
      
      // Calculate new content beyond baseline
      let newRawContent = "";
      if (currentRawContent.startsWith(this.baseline)) {
        newRawContent = currentRawContent.substring(this.baseline.length);
      } else {
        // Content structure changed - reset and process all
        console.log("📝 Content structure changed - full reprocess");
        this.baseline = "";
        this.resetResponseState();
        newRawContent = currentRawContent;
      }

      if (!newRawContent.trim()) {
        this.processingLock = false;
        return;
      }

      // Classify the new content
      const classification = this.classifyContent(newRawContent, element);
      console.log(`📝 Content type: ${classification.type}, length: ${newRawContent.length}`);

      // Handle based on content type and current phase
      this.handleContentByType(classification, newRawContent);

      // Reset completion timer
      clearTimeout(this.completionTimer);
      this.completionTimer = setTimeout(() => {
        this.completeResponse();
      }, 2000);

    } catch (error) {
      console.error("❌ Processing error:", error);
      this.responsePhase = 'IDLE';
    } finally {
      this.processingLock = false;
    }
  }

  handleContentByType(classification, rawContent) {
    switch (classification.type) {
      case 'thinking':
        console.log("🧠 Thinking phase detected");
        this.responsePhase = 'THINKING';
        this.extendBaseline(rawContent);
        break;
        
      case 'conversational':
        if (this.responsePhase === 'THINKING' || this.responsePhase === 'IDLE') {
          console.log("💬 Conversational phase started");
          this.responsePhase = 'RESPONDING';
        }
        this.handleConversationalContent(classification.cleanContent, rawContent);
        break;
        
      case 'code':
        console.log("🚧 Code boundary detected");
        this.handleCodeBoundary(classification.cleanContent, rawContent);
        break;
    }
  }

  handleConversationalContent(cleanContent, rawContent) {
    if (cleanContent && cleanContent.trim()) {
      // Add to accumulator
      this.ttsAccumulator += (this.ttsAccumulator ? " " : "") + cleanContent;
      
      // Increment conversational debounce count
      this.conversationalDebounceCount++;
      console.log(`💬 Conversational debounce: ${this.conversationalDebounceCount}, accumulator: ${this.ttsAccumulator.length} chars`);
      
      // Check if ready to send first chunk (4th conversational debounce)
      if (this.conversationalDebounceCount >= 4) {
        this.sendChunkAtNaturalBreak("4th_conversational_debounce");
        this.extendBaseline(rawContent);
      }
    }
  }

  handleCodeBoundary(conversationalContent, rawContent) {
    // Add any conversational content before the code block
    if (conversationalContent && conversationalContent.trim()) {
      this.ttsAccumulator += (this.ttsAccumulator ? " " : "") + conversationalContent;
    }
    
    // Send accumulated content if we have any
    if (this.ttsAccumulator.trim()) {
      this.sendChunkAtNaturalBreak("code_boundary");
    }
    
    // Extend baseline to include everything (conversational + boundary)
    this.extendBaseline(rawContent);
  }

  sendChunkAtNaturalBreak(reason) {
    if (!this.ttsAccumulator.trim()) return;
    
    // Find natural break point - prefer paragraph breaks, fallback to sentences
    let contentToSend = this.ttsAccumulator;
    const lastParagraphBreak = this.ttsAccumulator.lastIndexOf('\n\n');
    const lastSentenceEnd = Math.max(
      this.ttsAccumulator.lastIndexOf('. '),
      this.ttsAccumulator.lastIndexOf('! '),
      this.ttsAccumulator.lastIndexOf('? ')
    );
    
    if (lastParagraphBreak > 0) {
      contentToSend = this.ttsAccumulator.substring(0, lastParagraphBreak + 2);
    } else if (lastSentenceEnd > 0) {
      contentToSend = this.ttsAccumulator.substring(0, lastSentenceEnd + 2);
    }
    
    // Send to TTS
    const chunkId = `raft-${this.currentRaft}`;
    console.log(`🚢 RAFT ${this.currentRaft} (${reason}): ${contentToSend.length} chars`);
    this.sendStreamChunk(contentToSend, false, chunkId);
    
    // Clear accumulator and reset counter
    this.ttsAccumulator = "";
    this.conversationalDebounceCount = 0;
    this.currentRaft++;
  }

  extendBaseline(processedContent) {
    this.baseline += processedContent;
    console.log(`📸 Baseline extended: +${processedContent.length} chars (total: ${this.baseline.length})`);
  }

  completeResponse() {
    console.log("⏰ Completing response");
    
    // Send any remaining accumulated content
    if (this.ttsAccumulator.trim()) {
      this.sendChunkAtNaturalBreak("response_complete");
    }
    
    // Set baseline to entire current response for next response
    const element = this.findClaudeResponse();
    if (element) {
      this.baseline = element.textContent || "";
      console.log("📸 Response complete - baseline set to full response");
    }
    
    // Reset for next response
    this.resetResponseState();
  }

  // Server communication (unchanged)
  async sendStreamChunk(text, isComplete, responseId, retryAttempt = 0, isRetryOfFailed = false) {
    if (!text || text.trim().length === 0) {
      return { success: true, error: "Empty text, skipped" };
    }

    const MAX_RETRIES = 3;
    if (retryAttempt > MAX_RETRIES) {
      if (!isRetryOfFailed) {
        this.failedRequests.push({ text, isComplete, responseId, timestamp: Date.now() });
      }
      return { success: false, error: "Max retries exceeded" };
    }

    const payload = {
      text: text,
      is_complete: isComplete,
      conversation_mode: true,
      timestamp: Date.now(),
      response_id: responseId
    };

    try {
      const result = await this.sendToServer("/stream", payload);
      if (result.success) {
        return result;
      } else {
        await new Promise(resolve => setTimeout(resolve, (retryAttempt + 1) * 750));
        return this.sendStreamChunk(text, isComplete, responseId, retryAttempt + 1, isRetryOfFailed);
      }
    } catch (error) {
      this.serverHealthy = false;
      if (retryAttempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, (retryAttempt + 1) * 1000));
        return this.sendStreamChunk(text, isComplete, responseId, retryAttempt + 1, isRetryOfFailed);
      } else {
        if (!isRetryOfFailed) {
          this.failedRequests.push({ text, isComplete, responseId, timestamp: Date.now() });
        }
        return { success: false, error: error.toString() };
      }
    }
  }

  async sendToServer(endpoint, data) {
    if (!this.serverHealthy && endpoint !== "/health" && endpoint !== "/reset_conversation") {
      if (endpoint === "/stream" && data && data.response_id) {
        this.failedRequests.push({
          text: data.text,
          isComplete: data.is_complete,
          responseId: data.response_id,
          timestamp: data.timestamp || Date.now()
        });
      }
      return { success: false, error: "Server is not responding" };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      let result;
      try {
        result = await response.json();
      } catch (e) {
        this.serverHealthy = false;
        return { success: false, error: `Non-JSON response (${response.status})` };
      }

      if (!response.ok) {
        if (response.status >= 500) this.serverHealthy = false;
        return { success: false, error: result.error || `Server error ${response.status}` };
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        this.serverHealthy = false;
        return { success: false, error: "Request timeout" };
      }
      this.serverHealthy = false;
      return { success: false, error: error.message };
    }
  }

  async resetServerOnPageLoad() {
    setTimeout(async () => {
      try {
        const result = await this.sendToServer("/reset_conversation", {
          client_ip: 'browser',
          response_id: 'page-refresh-' + Date.now()
        });
        if (result.success) console.log("🔄 Server state cleared");
      } catch (error) { 
        console.error("❌ Error resetting server:", error); 
      }
    }, 1000);
  }

  async sendManualTTS(text) {
    const responseId = `manual-${Date.now()}`;
    const payload = {
      text: text,
      conversation_mode: false,
      timestamp: Date.now(),
      response_id: responseId,
      is_complete: true
    };

    if (!this.serverHealthy) {
      this.failedRequests.push({ ...payload });
      return { success: false, error: "Server down, request queued" };
    }
    return this.sendToServer("/tts", payload);
  }
}

class TTSControlPanel {
  constructor(monitor) {
    this.monitor = monitor;
    this.createPanel();
    window.ttsPanel = this;
  }

  createPanel() {
    if (document.getElementById('claude-tts-controls')) return;

    const panel = document.createElement('div');
    panel.id = 'claude-tts-controls';
    panel.style.cssText = `
      position: fixed; top: 60px; right: 20px; z-index: 9999;
      background-color: #1C1C1C; color: white; padding: 12px;
      border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 8px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border: 1px solid #333;
      font-size: 14px;
    `;

    // Compact title with original styling
    const title = document.createElement('div');
    title.textContent = 'Claude-to-Speech';
    title.style.cssText = `
      font-weight: 600; color: white; font-size: 14px;
      font-family: 'Copernicus', serif; letter-spacing: 0.5px;
    `;
    panel.appendChild(title);

    // Server health indicator
    const healthIndicator = document.createElement('div');
    healthIndicator.id = 'health-indicator';
    healthIndicator.style.cssText = `
      width: 8px; height: 8px; border-radius: 50%;
      background-color: #86E0A2; margin: 0 4px;
    `;
    panel.appendChild(healthIndicator);

    // Conversation mode toggle (no text)
    const toggleSwitch = document.createElement('div');
    this.toggleSwitchElement = toggleSwitch;
    toggleSwitch.style.cssText = `
      width: 36px; height: 20px; background-color: #555; border-radius: 10px;
      position: relative; cursor: pointer; transition: background-color 0.3s;
    `;
    const toggleKnob = document.createElement('div');
    this.toggleKnobElement = toggleKnob;
    toggleKnob.style.cssText = `
      width: 16px; height: 16px; background-color: white; border-radius: 50%;
      position: absolute; top: 2px; left: 2px; transition: transform 0.3s;
    `;
    toggleSwitch.appendChild(toggleKnob);
    
    this.updateToggleVisuals(this.monitor.conversationMode);

    toggleSwitch.onclick = () => {
      const newMode = !this.monitor.conversationMode;
      chrome.storage.local.set({ conversationMode: newMode }, () => {
        this.monitor.conversationMode = newMode; 
        this.updateToggleVisuals(newMode);

        if (newMode) {
          if (!this.monitor.isMonitoring) {
            this.monitor.startMonitoring();
          }
        } else {
          if (this.monitor.isMonitoring) {
            this.monitor.stopMonitoring();
          }
        }
      });
    };
    panel.appendChild(toggleSwitch);

    // Detect button
    const detectBtn = document.createElement('button');
    detectBtn.textContent = 'Detect';
    detectBtn.style.cssText = `
      background-color: #333333; color: white; border: none; border-radius: 6px;
      padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 500;
      transition: background-color 0.2s;
    `;
    detectBtn.onmouseover = () => detectBtn.style.backgroundColor = '#404040';
    detectBtn.onmouseout = () => detectBtn.style.backgroundColor = '#333333';
    detectBtn.onclick = () => this.monitor.resetForNewResponse();
    panel.appendChild(detectBtn);

    document.body.appendChild(panel);
    this.updateStatusDisplay();
  }

  updateToggleVisuals(isActive) {
    if (this.toggleSwitchElement && this.toggleKnobElement) {
      if (isActive) {
        this.toggleSwitchElement.style.backgroundColor = '#D4A574'; 
        this.toggleKnobElement.style.transform = 'translateX(16px)';
      } else {
        this.toggleSwitchElement.style.backgroundColor = '#555'; 
        this.toggleKnobElement.style.transform = 'translateX(0px)';
      }
    }
  }

  updateStatusDisplay() {
    const healthIndicator = document.getElementById('health-indicator');
    if (healthIndicator) {
      healthIndicator.style.backgroundColor = this.monitor.serverHealthy ? '#86E0A2' : '#E07A7A';
    }
  }

  initPeriodicUpdates() {
    setInterval(() => {
      this.updateStatusDisplay();
    }, 1000);
  }
}

// Global instantiation
if (typeof claudeStreamMonitor === 'undefined' || !claudeStreamMonitor) {
  var claudeStreamMonitor = new ClaudeStreamMonitor();
  var ttsPanel = new TTSControlPanel(claudeStreamMonitor);
  ttsPanel.initPeriodicUpdates();
}
