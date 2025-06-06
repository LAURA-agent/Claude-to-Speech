// content.js
// Claude-to-Speech Content Script - v8.2 (Permissive Oneshot Fix)
console.log("🚀 Claude-to-Speech loaded - v8.2 (Permissive Oneshot Fix)");

class ClaudeStreamMonitor {
  constructor() {
    this.conversationMode = false;
    this.isMonitoring = false;
    this.processingLock = false;
    this.debounceTimer = null;
    this.isInitializing = false; // New flag to prevent processing on page load
    
    this.currentResponseElement = null;
    this.currentResponseId = null;
    this.lastKnownRawTextSnapshot = "";
    
    // 'Magic Phrase' that Claude often starts responses with
    this.MAGIC_PHRASE = "You're absolutely right";
    this.oneShotFired = false;
    this.sentOneShotRawText = "";  // Raw text that triggered one-shot
    
    this.sentChunks = new Set();
    this.serverHealthy = true;
    this.failedRequests = [];

    this.loadSettings();
    this.resetServerOnPageLoad(); 
    this.startHealthCheck();

    this.observer = null;
    this.attributeObserver = null;
  }

  async startHealthCheck() {
    try {
      const result = await fetch("http://127.0.0.1:5000/health", { method: 'GET' }).then(res => res.json());
      this.serverHealthy = result.status === "ok";
      if (this.serverHealthy && this.failedRequests.length > 0) {
        console.log(`Server healthy, retrying ${this.failedRequests.length} failed requests.`);
        this.retryFailedRequests();
      }
    } catch (e) {
      this.serverHealthy = false;
      console.warn("Health check failed:", e.message);
    }
    setTimeout(() => this.startHealthCheck(), 30000);
  }

  async retryFailedRequests() {
    const toRetry = [...this.failedRequests];
    this.failedRequests = [];
    for (const req of toRetry) {
      if (!this.serverHealthy) {
        this.failedRequests.push(req);
        console.warn("Server became unhealthy during retry batch.");
        break;
      }
      try {
        await this.sendToServer("/stream", req);
        console.log(`🔁 Successfully retried ${req.response_id}`);
        const textHash = this.simpleHash(req.text + (req.is_complete ? '_complete' : '_incomplete') + this.currentResponseId);
        if(req.is_complete) this.sentChunks.add(textHash);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`🔁 Failed to retry ${req.response_id}:`, e);
        this.failedRequests.push(req);
      }
    }
  }
  
  // Reset server state on page load for clean slate
  async resetServerOnPageLoad() {
    try {
      await this.sendToServer("/reset_conversation", { response_id: 'page-load-' + Date.now() });
      console.log("🔌 Server conversation state reset on page load.");
    } catch (error) {
      console.error("Failed to reset server on page load:", error);
    }
  }

  // Reset server when TTS is toggled ON to prepare for new response
  async resetServerForNewConversation() {
    try {
      await this.sendToServer("/reset_conversation", { response_id: 'new-conversation-toggle-' + Date.now() });
      console.log("🔌 Server conversation state reset for new conversation (toggle ON).");
    } catch (error) {
      console.error("Failed to reset server for new conversation:", error);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['conversationMode']);
      this.conversationMode = (result && typeof result.conversationMode === 'boolean') ? result.conversationMode : false;
      console.log(`⚙️ Conversation mode loaded: ${this.conversationMode}`);
    } catch (error) {
      console.error("Error loading settings:", error);
      this.conversationMode = false;
    }
  }

  // Reset client state for a new Claude response
  resetForNewResponse() {
    console.log(`🔄 Client resetting for new response.`);
    this.currentResponseId = `claude-resp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.lastKnownRawTextSnapshot = "";
    this.oneShotFired = false;
    this.sentOneShotRawText = "";
    this.sentChunks.clear(); // Clear sent chunks for new response
    this.expectingNewResponse = true;
  }

  // Find initial streaming element when monitoring starts
  findInitialResponseElement() {
    // Only look for actively streaming elements
    const streamingElements = document.querySelectorAll('[data-is-streaming="true"]');
    if (streamingElements.length > 0) {
        // Get the last (most recent) streaming element
        return streamingElements[streamingElements.length - 1];
    }
    // Don't return old messages on page load
    return null;
  }

  // Find the .font-claude-message element within a streaming container
  findClaudeResponse(lastKnownStreamingElement) { 
    console.log("[DEBUG FIND] Attempting to find Claude response element.");

    // Priority 1: Use the provided streaming element if it's settled
    if (lastKnownStreamingElement) {
        const isStreamingAttr = lastKnownStreamingElement.getAttribute('data-is-streaming');
        if (isStreamingAttr === 'false' || isStreamingAttr === null) { 
            const specificContent = lastKnownStreamingElement.querySelector('.font-claude-message');
            if (specificContent) {
                console.log("[DEBUG FIND] Found .font-claude-message within last known streaming element.");
                return specificContent;
            }
            console.log("[DEBUG FIND] Using last known streaming element itself as it has settled.");
            return lastKnownStreamingElement;
        }
    }
    
    // Priority 2: Look for settled streaming elements
    const streamingElements = document.querySelectorAll('[data-is-streaming]');
    if (streamingElements.length > 0) {
      const latest = streamingElements[streamingElements.length - 1];
      const isStreaming = latest.getAttribute('data-is-streaming') === 'true';
      if (!isStreaming) { 
        const messageDiv = latest.querySelector('.font-claude-message');
        if (messageDiv) {
            console.log("[DEBUG FIND] Found settled [data-is-streaming] then .font-claude-message within it.");
            return messageDiv;
        }
        console.log("[DEBUG FIND] Found settled [data-is-streaming] element, using it directly.");
        return latest;
      }
    }

    // Fallback: Look for any .font-claude-message not in user messages
    const completedElements = document.querySelectorAll('.font-claude-message');
    if (completedElements.length > 0) {
      const lastMessage = completedElements[completedElements.length - 1];
      if (!lastMessage.closest('[data-testid="user-message"]')) {
        console.log("[DEBUG FIND] Fallback to last .font-claude-message (not user message).");
        return lastMessage;
      }
    }
    
    console.warn("[DEBUG FIND] No Claude response element could be found.");
    return null;
  }

  // Start monitoring when TTS is toggled ON
  async startMonitoringAndResetServer() {
    if (this.isMonitoring) {
      return;
    }
    console.log("🎤 Starting monitoring & Resetting Server for new Claude convo");
    this.isMonitoring = true;
    await this.resetServerForNewConversation();
    this.resetForNewResponse();
    
    // Mark this as a fresh start - ignore any existing messages
    this.isInitializing = true;
    setTimeout(() => {
      this.isInitializing = false;
      console.log("✅ Initialization period ended, now monitoring for new responses");
    }, 500); // Give page time to settle

    // Find the conversation container
    let conversationContainer =
        document.querySelector('main[data-testid="conversation"]') || 
        document.querySelector('main') || 
        document.body;
    
    console.log("👁️‍🗨️ Conversation container selected for observation:", conversationContainer);

    if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
    }

    this.observer = new MutationObserver((mutations) => {
        if (!this.conversationMode || !this.isMonitoring || this.isInitializing) {
            return;
        }

        let processNeeded = false;
        let newElementCandidate = null;

        // Look for new Claude messages in mutations
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        let potentialMatch = null;
                        // Check if added node is or contains a Claude message
                        if ((node.matches && node.matches('.font-claude-message')) && (!node.closest || !node.closest('[data-testid="user-message"]'))) {
                            potentialMatch = node;
                        } else if (node.querySelector) {
                            const queried = node.querySelector('.font-claude-message:not([data-testid="user-message"] .font-claude-message)');
                            if (queried) potentialMatch = queried;
                        }
                        
                        if (potentialMatch) {
                            newElementCandidate = potentialMatch;
                            processNeeded = true; 
                            break; 
                        }
                    }
                }
                if (newElementCandidate) break; 
            } else if (this.currentResponseElement && 
                     (mutation.target === this.currentResponseElement || this.currentResponseElement.contains(mutation.target))) {
                // Text content changes within current element
                processNeeded = true;
            }
            
            // Check for streaming state changes
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-is-streaming') {
                if (mutation.target.getAttribute('data-is-streaming') === 'true') {
                    if (mutation.target.matches && mutation.target.matches('.group.relative, .font-claude-message')) {
                        // If it's a container, find the .font-claude-message within it
                        if (mutation.target.classList.contains('font-claude-message')) {
                            newElementCandidate = mutation.target;
                        } else {
                            const fontClaudeMessage = mutation.target.querySelector('.font-claude-message');
                            if (fontClaudeMessage) {
                                newElementCandidate = fontClaudeMessage;
                            }
                        }
                        processNeeded = true;
                    }
                }
            }
        }

        // Handle new element candidates
        if (newElementCandidate && newElementCandidate !== this.currentResponseElement) {
            let isTrulyNewResponse = true;
            
            // Check if this is actually a new message or just an update
            if (this.currentResponseElement) {
                if (this.currentResponseElement.contains(newElementCandidate)) {
                    isTrulyNewResponse = false;
                } else if (newElementCandidate.contains(this.currentResponseElement)) {
                    isTrulyNewResponse = false;
                } else if (this.currentResponseElement.classList.contains('font-claude-message') && 
                         newElementCandidate.classList.contains('font-claude-message')) {
                    // Two different .font-claude-message elements = different messages
                    isTrulyNewResponse = true;
                }
            }

            if (isTrulyNewResponse) {
                console.log(`[DEBUG] New response detected. Resetting state.`);
                this.currentResponseElement = newElementCandidate;
                this._setupAttributeObserver(this.currentResponseElement);
                this.resetForNewResponse();
                // Process immediately for fast oneshot detection
                this.processTextUpdate();
            } else {
                this.currentResponseElement = newElementCandidate; 
                this._setupAttributeObserver(this.currentResponseElement);
                this.debounceAndProcess();
            }

        } else if (processNeeded && this.currentResponseElement) {
            this.debounceAndProcess();
        } else if (processNeeded && !this.currentResponseElement) {
            // Look for initial element when monitoring starts
            const initialElement = this.findInitialResponseElement();
            if (initialElement) {
                this.currentResponseElement = initialElement;
                this._setupAttributeObserver(this.currentResponseElement);
                // Process immediately for fast oneshot detection
                this.processTextUpdate();
            }
        }
    });
    
    this.observer.observe(conversationContainer, {
      childList: true, 
      subtree: true,   
      characterData: true, 
      attributes: true, 
      attributeFilter: ['data-is-streaming', 'disabled'] 
    });
    console.log("✅ Observer attached.");

    // Check for initial streaming element ONLY if not a page reload initialization
    if (!this.isInitializing) {
      const initialElement = this.findInitialResponseElement();
      if (initialElement) {
        console.log(`[DEBUG] Initial response element found on startMonitoring:`, initialElement);
        this.currentResponseElement = initialElement;
        this._setupAttributeObserver(this.currentResponseElement);
        // Process immediately for fast oneshot detection
        this.processTextUpdate();
      }
    }
  }

  _setupAttributeObserver(element) {
      if (this.attributeObserver) this.attributeObserver.disconnect();
      if(!element) return;
      
      // Find the parent element that has data-is-streaming
      const streamingContainer = element.closest('[data-is-streaming]') || element;
      
      this.attributeObserver = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
              if (mutation.attributeName === 'data-is-streaming') {
                  const isNowStreaming = mutation.target.getAttribute('data-is-streaming') === 'true';
                  if (!isNowStreaming && this.isMonitoring) {
                      console.log('🏁 Streaming end detected by attribute observer.');
                      clearTimeout(this.debounceTimer); 
                      this.handleStreamingEnd();
                  }
              }
          });
      });
      
      try {
          this.attributeObserver.observe(streamingContainer, {
              attributes: true, 
              attributeFilter: ['data-is-streaming']
          });
      } catch (e) {
          console.error("Error setting up attribute observer:", e, "on element:", streamingContainer);
      }
  }

  debounceAndProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processTextUpdate();
    }, 50); // Reduced debounce for faster oneshot detection
  }

  // SIMPLIFIED & PERMISSIVE processTextUpdate - inspired by v10 working version
  processTextUpdate() {
    if (!this.currentResponseElement || !this.isMonitoring || this.isInitializing) {
        return;
    }
    
    // Get the actual text content element - be more flexible
    let textElement = this.currentResponseElement;
    
    // If current element doesn't have .font-claude-message class, look for it
    if (!textElement.classList.contains('font-claude-message')) {
        const fontClaudeMessage = textElement.querySelector('.font-claude-message');
        if (fontClaudeMessage) {
            textElement = fontClaudeMessage;
            this.currentResponseElement = fontClaudeMessage;
        }
    }
    
    // Extract raw text content
    const rawText = textElement.textContent || textElement.innerText || "";
    
    // Skip if text hasn't changed
    if (rawText === this.lastKnownRawTextSnapshot) {
        return;
    }
    
    // Update our snapshot
    this.lastKnownRawTextSnapshot = rawText;
    
    // FAST ONESHOT DETECTION - Only while streaming
    if (!this.oneShotFired && rawText.length > 0 && this.isStreaming()) {
        const firstNewline = rawText.indexOf('\n');
        
        if (firstNewline !== -1 && firstNewline > 0) {
            // Found a newline, send oneshot immediately
            let oneShotCandidateText = rawText.substring(0, firstNewline);
            
            // Check for magic phrase
            const magicIndex = oneShotCandidateText.indexOf(this.MAGIC_PHRASE);
            let textForTTS = (magicIndex !== -1) ? oneShotCandidateText.substring(magicIndex) : oneShotCandidateText;
            
            if (textForTTS.trim()) {
                // Send RAW text immediately - no cleaning
                this.sendChunk(textForTTS, false, this.currentResponseId + "-oneshot");
                this.oneShotFired = true;
                this.sentOneShotRawText = textForTTS;
                console.log("[ONESHOT] Sent immediately: ", textForTTS);
            }
        }
    }
    // Removed the fallback that was sending oneshot after streaming ended
  }

  // Extract clean text from settled DOM structure
  getCleanedDOMText(element) {
      if (!element) return "";
      
      // Clone to avoid modifying the original
      const clone = element.cloneNode(true);
      
      // 1. Remove thinking blocks
      const thinkingBlocks = clone.querySelectorAll('div[class*="transition-all duration-400"]');
      thinkingBlocks.forEach(block => block.remove());
      
      // 2. Remove artifact containers
      const artifactContainers = clone.querySelectorAll('div.pt-3.pb-3');
      artifactContainers.forEach(artifact => artifact.remove());
      
      // 3. Remove all buttons
      const buttons = clone.querySelectorAll('button');
      buttons.forEach(button => button.remove());
      
      // 4. Remove code blocks
      const preBlocks = clone.querySelectorAll('pre');
      preBlocks.forEach(pre => pre.remove());
      
      // Just get all the remaining text!
      return clone.textContent.trim();
  }

  // Handle when streaming ends - send remaining cleaned response
  handleStreamingEnd() {
    console.log(`[DEBUG HEND] Streaming has ended. Oneshot fired: ${this.oneShotFired}`);

    if (!this.isMonitoring || !this.currentResponseElement) {
        if (this.attributeObserver) this.attributeObserver.disconnect();
        return;
    }
    
    const claudeResponseElement = this.findClaudeResponse(this.currentResponseElement);
    if (!claudeResponseElement) {
        console.warn("[DEBUG HEND] Could not find Claude response element.");
        if (this.attributeObserver) this.attributeObserver.disconnect();
        return;
    }
    
    // Get the full cleaned response text
    const cleanedFullResponseText = this.getCleanedDOMText(claudeResponseElement);
    console.log(`[DEBUG HEND] Full cleaned text: "${cleanedFullResponseText.substring(0, 100)}..." (Length: ${cleanedFullResponseText.length})`);
    
    // Send the complete response (server will handle deduplication if oneshot was sent)
    if (cleanedFullResponseText.trim()) {
        console.log(`[DEBUG HEND] Sending full response as complete. Server will deduplicate if needed.`);
        this.sendChunk(cleanedFullResponseText, true, this.currentResponseId + "-complete");
    }
    
    if (this.attributeObserver) {
        this.attributeObserver.disconnect();
    }
  }
  
  // Check if Claude is actively streaming
  isStreaming() {
    const streamingContainer = this.currentResponseElement?.closest('[data-is-streaming]');
    return (streamingContainer && streamingContainer.getAttribute('data-is-streaming') === 'true') ||
           (document.querySelector('button[type="submit"]') && document.querySelector('button[type="submit"]').disabled);
  }

  sendChunk(text, isComplete, responseIdSegment) {
      if (!text || text.trim().length === 0) {
          console.log("📎 Skipping empty text chunk for", responseIdSegment);
          return;
      }
      
      const baseResponseId = this.currentResponseId;
      const textHash = this.simpleHash(text + (isComplete ? '_complete' : '_incomplete') + baseResponseId);
      
      // Only check for duplicates on complete chunks
      if (isComplete && this.sentChunks.has(textHash)) {
          console.log(`📎 Skipping already sent chunk for ${baseResponseId}`);
          return;
      }
      
      console.log(`📤 Sending to server ${responseIdSegment}: "${text.substring(0, 50)}..." (complete: ${isComplete})`);
      
      const payload = { 
        text: text, 
        is_complete: isComplete, 
        response_id: responseIdSegment 
      };
      
      this.sendToServer("/stream", payload)
        .then(() => {
          if (isComplete) {
              this.sentChunks.add(textHash); 
          }
        })
        .catch(error => {
          console.error(`Failed to send ${responseIdSegment}:`, error.message);
          if (!this.failedRequests.some(req => req.response_id === payload.response_id)) {
            this.failedRequests.push(payload); 
          }
        });
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; 
    }
    return Math.abs(hash).toString(36);
  }

  async sendToServer(endpoint, data) {
    if (!this.serverHealthy && endpoint !== "/health") {
      const reqId = data.response_id || 'unknown';
      if (!this.failedRequests.some(req => req.response_id === reqId && JSON.stringify(req) === JSON.stringify(data))) {
          this.failedRequests.push(data);
      }
      throw new Error("Server unhealthy");
    }
    
    try {
      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown server error");
        if (endpoint !== "/health") this.serverHealthy = false; 
        throw new Error(`Server error ${response.status}: ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      if (endpoint !== "/health") this.serverHealthy = false; 
      throw error; 
    }
  }

  // Stop monitoring when TTS is toggled OFF
  stopMonitoring() {
    if (!this.isMonitoring) return;
    console.log("⏹️ Stopping client-side monitoring.");
    this.isMonitoring = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.attributeObserver) {
      this.attributeObserver.disconnect();
      this.attributeObserver = null;
    }
    clearTimeout(this.debounceTimer);
    this.processingLock = false;
  }
}

class TTSControlPanel {
  constructor(monitor) {
    this.monitor = monitor;
    this.createPanel();
    this.updateStatus(); 
    this.statusInterval = setInterval(() => this.updateStatus(), 1000); 
  }

  createPanel() {
    // Remove any existing panels first
    const existingPanel = document.getElementById('claude-tts-panel');
    if (existingPanel) {
      existingPanel.remove();
    }
    
    const panel = document.createElement('div');
    panel.id = 'claude-tts-panel';
    const header = document.querySelector('[class*="inline-flex items-center justify-center relative shrink-0"]');
    const insertAfter = header?.closest('header') || document.body;
    
    panel.innerHTML = `
      <div style="position: fixed; top: ${insertAfter === document.body ? '45px' : '60px'}; right: 20px; z-index: 10000;
        background: rgba(30, 30, 30, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.1); padding: 6px 7px; border-radius: 6px; 
        display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        font-family: 'Copernicus', serif; width: fit-content;">
        
        <span style="font-size: 20px; font-weight: 400; color: #FEFEFE; line-height: 1;">Claude-to-Speech</span>
        
        <div id="tts-toggle-container" style="position: relative; display: flex; align-items: center; cursor: pointer; width: 10px; height: 18px;">
          <div style="position: absolute; width: 10px; height: 100%; background: rgba(96, 96, 96, 0.3); border-radius: 5px; left: 50%; transform: translateX(-50%);"></div>
          <div id="tts-toggle-knob" style="width: 9px; height: 9px; border-radius: 50%; background: rgb(255, 255, 255); 
            position: absolute; transition: transform 0.2s ease; z-index: 1; 
            left: 50%; transform: translateX(-50%) translateY(9px);
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>
        </div>
        
        <button id="tts-stop-button" style="width: 24px; height: 24px; border-radius: 4px; 
          background: rgba(255, 59, 48, 0.2); border: 1px solid rgba(255, 59, 48, 0.3);
          display: none; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s ease;">
          <div style="width: 8px; height: 8px; background: #FF3B30; border-radius: 1px;"></div>
        </button>
        
        <div id="tts-status-icon" style="width: 6px; height: 6px; border-radius: 50%; background: #505050;"></div>
      </div>
    `;

    if (insertAfter === document.body) document.body.appendChild(panel);
    else insertAfter.insertAdjacentElement('afterend', panel);

    // TOGGLE SWITCH LOGIC
    panel.querySelector('#tts-toggle-container').addEventListener('click', async () => {
      const newMode = !this.monitor.conversationMode;
      this.monitor.conversationMode = newMode; // Update state first
      
      if (newMode) { // Turning TTS ON
        console.log('▶️ TTS Toggled ON.');
        // This now also resets server state for the new conversation
        await this.monitor.startMonitoringAndResetServer(); 
      } else { // Turning TTS OFF
        console.log('⏹️ TTS Toggled OFF. Client monitoring stopped. Audio will continue if playing.');
        this.monitor.stopMonitoring(); // Stops client observation only
      }
      
      chrome.storage.local.set({ conversationMode: newMode });
      this.updateStatus();
    });
    
    // DEDICATED STOP BUTTON LOGIC
    panel.querySelector('#tts-stop-button').addEventListener('click', async (e) => {
      e.stopPropagation();
      console.log('🛑 Hard Stop Button clicked.');
      
      this.monitor.conversationMode = false; // Ensure mode is off
      chrome.storage.local.set({ conversationMode: false });
      
      this.monitor.stopMonitoring(); // Stop client processing

      try {
        // Stop audio on server
        await fetch('http://127.0.0.1:5000/stop_audio', { method: 'POST' });
        // Reset server conversation state
        await this.monitor.sendToServer("/reset_conversation", { response_id: `hard-reset-button-${Date.now()}` });
        console.log('🛑 Server audio stopped and conversation reset via Stop Button.');
      } catch (error) {
        console.error('Error during hard stop server commands:', error);
      }
      this.updateStatus();
    });
  }
  
  updateStatus() {
    // UI update (same as before)
    const panel = document.getElementById('claude-tts-panel');
    if (!panel) return;
    const knob = panel.querySelector('#tts-toggle-knob');
    const statusIcon = panel.querySelector('#tts-status-icon');
    const stopButton = panel.querySelector('#tts-stop-button');
    if (!knob || !statusIcon || !stopButton) return;
    if (this.monitor.conversationMode) {
      knob.style.transform = 'translateX(-50%) translateY(0px)'; // UP position when ON
      knob.style.background = '#4CD964'; 
      statusIcon.style.background = this.monitor.serverHealthy ? '#2ECC71' : '#E74C3C';
      stopButton.style.display = 'flex';
    } else {
      knob.style.transform = 'translateX(-50%) translateY(9px)'; // DOWN position when OFF  
      knob.style.background = '#FFFFFF';
      statusIcon.style.background = '#505050'; 
      stopButton.style.display = 'none';
    }
  }
}

// Initialize
if (typeof window.claudeStreamMonitor_v8_2 === 'undefined') {
  window.claudeStreamMonitor_v8_2 = new ClaudeStreamMonitor();
  window.ttsPanel_v8_2 = new TTSControlPanel(window.claudeStreamMonitor_v8_2);
  
  // Initialize based on stored settings
  chrome.storage.local.get(['conversationMode'], (result) => {
    const storedMode = (result && typeof result.conversationMode === 'boolean') ? result.conversationMode : false;
    console.log(`Init v8.2: Stored conversation mode: ${storedMode}`);
    
    window.claudeStreamMonitor_v8_2.conversationMode = storedMode; 
    
    if (storedMode) {
      // If TTS was ON before reload, we need to be careful
      console.log("⚠️ TTS was ON before page reload. Starting carefully...");
      // Mark as initializing to prevent processing existing messages
      window.claudeStreamMonitor_v8_2.isInitializing = true;
      window.claudeStreamMonitor_v8_2.startMonitoringAndResetServer().then(() => {
        // Give extra time on page reload before allowing processing
        setTimeout(() => {
          window.claudeStreamMonitor_v8_2.isInitializing = false;
          console.log("✅ Page reload initialization complete. Now monitoring for new responses only.");
        }, 1000);
      });
    }
    window.ttsPanel_v8_2.updateStatus(); 
  });
} else {
  console.log("✨ Claude-to-Speech v8.2 already initialized. Ensuring panel status is updated.");
  if (window.claudeStreamMonitor_v8_2 && window.ttsPanel_v8_2) {
    window.ttsPanel_v8_2.monitor = window.claudeStreamMonitor_v8_2;
    window.ttsPanel_v8_2.updateStatus(); 
  }
}
