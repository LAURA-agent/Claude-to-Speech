// Smart Streaming Content Script for Claude - Version 3.3 - CLEANED
console.log("🚀 Smart Streaming Claude TTS loaded - Version 3.3");

class ClaudeStreamMonitor {
  constructor() {
    this.conversationMode = false;
    this.lastResponseText = "";
    this.lastResponseId = null;
    this.isMonitoring = false;
    this.debounceTimer = null;
    this.streamingActive = false;
    this.processingLock = false;
    this.currentResponseElement = null;
    this.lastProcessedResponseId = null;
    this.conversationModeStartTime = null;
    this.processedChunks = new Map();
    this.currentResponseText = "";
    this.lastSentLength = 0;
    this.pendingRetries = [];
    this.isRetrying = false;
    this.serverHealthy = true;
    this.failedRequests = [];
    
    // Load settings and reset server
    this.loadSettings();
    this.resetServerOnPageLoad();
    
    // Start health check polling
    this.startHealthCheck();
  }

  // Improved health check polling
  async startHealthCheck() {
    try {
      const result = await fetch("http://127.0.0.1:5000/health", {
        method: 'GET',
      }).then(res => res.json());
      
      if (result.status === "ok") {
        console.log("✅ TTS Server is healthy");
        this.serverHealthy = true;
        
        // If server just came back online, retry failed requests
        if (this.failedRequests.length > 0 && !this.isRetrying) {
          this.retryFailedRequests();
        }
      } else {
        console.error("❌ TTS Server reported unhealthy status:", result);
        this.serverHealthy = false;
      }
    } catch (e) {
      console.error("❌ TTS Server health check failed:", e);
      this.serverHealthy = false;
    }
    
    // Poll every 10 seconds
    setTimeout(() => this.startHealthCheck(), 10000);
  }
  
  // Retry mechanism for failed requests
  async retryFailedRequests() {
    if (this.isRetrying || this.failedRequests.length === 0) return;
    
    this.isRetrying = true;
    console.log(`🔄 Retrying ${this.failedRequests.length} failed requests`);
    
    const requests = [...this.failedRequests];
    this.failedRequests = [];
    
    for (const req of requests) {
      try {
        console.log(`🔄 Retrying request for ${req.responseId}`);
        await this.sendStreamChunk(req.text, req.isComplete, req.responseId);
        await new Promise(resolve => setTimeout(resolve, 500)); // Space out retries
      } catch (e) {
        console.error(`❌ Retry failed for ${req.responseId}:`, e);
        // Don't re-add to failed requests to avoid infinite loops
      }
    }
    
    this.isRetrying = false;
  }

  // Improved reset method for new responses
  resetForNewResponse() {
    console.log("🔄 Resetting for new response");
    this.currentResponseElement = null;
    this.currentResponseText = "";
    this.lastSentLength = 0;
    this.processedChunks.clear();
    
    // Send any final fragments that might be pending
    this.sendFinalChunk();
  }

  // Send any final text that hasn't been sent yet
  sendFinalChunk() {
    // Final safety check - if there's remaining text, send it
    if (this.currentResponseText.length > 0 && 
        this.lastSentLength < this.currentResponseText.length) {
      
      const remaining = this.currentResponseText.substring(this.lastSentLength);
      if (remaining.trim()) {
        const responseId = `${this.generateResponseId(this.currentResponseElement)}-final`;
        console.log(`📤 Sending final chunk: ${remaining.substring(0, 50)}... (${remaining.length} chars)`);
        this.sendStreamChunk(remaining, true, responseId);
      }
    }
  }

  // Find the latest Claude response
  findClaudeResponse() {
    // Look for any element with data-is-streaming attribute (works for both modes)
    const streamingElements = document.querySelectorAll('[data-is-streaming]');
    if (streamingElements.length > 0) {
      const latest = streamingElements[streamingElements.length - 1];
      
      // Check if it's still streaming
      const isStreaming = latest.getAttribute('data-is-streaming') === 'true';
      
      if (isStreaming) {
        console.log("🔄 Claude is currently streaming...");
        // For extended thinking: return streaming element
        // For normal mode: return the main element (it will update in-place)
        return latest;
      } else {
        console.log("✅ Claude response complete");
        // Look for the font-claude-message child (works for both modes)
        const messageDiv = latest.querySelector('.font-claude-message');
        return messageDiv || latest;
      }
    }
    
    // Fallback to existing logic if no streaming elements found
    const completedElements = document.querySelectorAll('.font-claude-message');
    if (completedElements.length > 0) {
      return completedElements[completedElements.length - 1];
    }
    
    return null;
  }

  // Reset server state on page load
  async resetServerOnPageLoad() {
    // Give page a moment to fully load
    setTimeout(async () => {
      try {
        const result = await this.sendToServer("/reset_conversation", {
          client_ip: 'browser',
          response_id: 'page-refresh-' + Date.now()
        });
        
        if (result.success) {
          console.log("🔄 Cleared server state after page load");
        } else {
          console.error("❌ Failed to reset server state:", result.error);
        }
      } catch (error) {
        console.error("❌ Error resetting server:", error);
      }
    }, 1000);
  }
    
  // Load user settings from storage
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['conversationMode']);
      this.conversationMode = result.conversationMode || false;
      console.log(`📊 Loaded conversation mode: ${this.conversationMode}`);
    } catch (error) {
      console.error("❌ Error loading settings:", error);
      this.conversationMode = false;
    }
  }
    
  // Start the monitoring system
  startMonitoring() {
    if (this.isMonitoring) return;
    
    console.log("🔄 Starting smart stream monitoring");
    this.isMonitoring = true;
    this.conversationModeStartTime = Date.now();
    
    // Set up mutation observer
    this.observer = new MutationObserver((mutations) => {
      if (!this.conversationMode || this.processingLock) return;
      
      // Check if any mutations involve Claude messages
      const hasClaudeMessage = mutations.some(mutation => {
        return Array.from(mutation.addedNodes).some(node => {
          return node.nodeType === 1 && (
            node.classList?.contains('font-claude-message') ||
            node.querySelector?.('.font-claude-message') ||
            node.hasAttribute?.('data-message-author-role') && 
            node.getAttribute('data-message-author-role') === 'assistant' ||
            node.querySelector?.('[data-message-author-role="assistant"]')
          );
        });
      });
      
      if (hasClaudeMessage) {
        this.debounceAndProcess();
      }
    });
    
    // Try different container options
    const possibleContainers = [
      // Try XPath first (most specific)
      document.evaluate(
        '/html/body/div[2]/div[2]/div/div[1]/div/div/div[1]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue,
      // Then try various selectors
      document.querySelector('main'),
      document.querySelector('.conversation-container'),
      document.querySelector('[data-testid="conversation-main"]'),
      // Fallback to body if nothing else works
      document.body
    ];
    
    // Use the first valid container
    const target = possibleContainers.find(container => container !== null);
    
    if (target) {
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
      console.log("✅ Observer attached to container:", target);
      
      // Process any existing response immediately
      this.processStreamUpdate();
    } else {
      console.error("❌ Could not find any suitable container for observing");
    }
  }

  // Stop monitoring
  stopMonitoring() {
    console.log("⏹️ Stopping stream monitoring");
    this.isMonitoring = false;
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    clearTimeout(this.debounceTimer);
  }
    
  // Debounce function to avoid too many processing calls
  debounceAndProcess() {
    // Debounce to avoid processing every tiny DOM change
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processStreamUpdate();
    }, 300);
  }
    
  // Main function to process Claude's response - COMPLETE REWRITE
async processStreamUpdate() {
  if (!this.conversationMode) return;
  
  if (this.processingLock) {
    setTimeout(() => this.processStreamUpdate(), 500);
    return;
  }
  
  this.processingLock = true;
  
  try {
    const response = this.findClaudeResponse();
    if (!response) {
      this.processingLock = false;
      return;
    }
    
    // Check if new response
    if (response !== this.currentResponseElement) {
      this.currentResponseElement = response;
      this.lastSentLength = 0;
    }
    
    const currentText = response.textContent || "";
    const isStreaming = this.isClaudeTyping(response);
    
    // Only send if we have new text
    if (currentText.length > this.lastSentLength) {
      const newText = currentText.substring(this.lastSentLength);
      
      if (isStreaming) {
        // While streaming - look for sentence endings
        const match = newText.match(/^.*?[.!?]\s+/);
        if (match && match[0].length > 25) {
          const sentence = match[0].trim();
          const responseId = `${Date.now()}-sentence`;
          
          await this.sendStreamChunk(sentence, false, responseId);
          this.lastSentLength += match[0].length;
        }
      } else {
        // Response complete - send everything remaining
        if (newText.trim().length > 10) {
          const responseId = `${Date.now()}-final`;
          await this.sendStreamChunk(newText.trim(), true, responseId);
          this.lastSentLength = currentText.length;
          
          // Reset for next response
          setTimeout(() => {
            this.currentResponseElement = null;
            this.lastSentLength = 0;
          }, 1000);
        }
      }
    }
    
  } catch (error) {
    console.error("❌ Process error:", error);
  } finally {
    this.processingLock = false;
  }
}

  // Find the next boundary (code block, artifact, etc.)
  findNextBoundary(text, startPosition) {
    const textToCheck = text.substring(startPosition);
    
    // Define boundary patterns and their handlers
    const boundaries = [
      {
        name: 'code_block_start',
        pattern: /```/,
        handler: (match, fullText, pos) => {
          // Find the closing ```
          const closingPos = fullText.indexOf('```', pos + 3);
          if (closingPos !== -1) {
            return { position: pos, endPosition: closingPos + 3, type: 'code_block' };
          }
          return { position: pos, endPosition: pos + 3, type: 'code_block_unclosed' };
        }
      },
      {
        name: 'artifact_start',
        pattern: /<function_calls>/i,
        handler: (match, fullText, pos) => {
          // Find the closing tag
          const closingPos = fullText.indexOf('</function_calls>', pos);
          if (closingPos !== -1) {
            return { position: pos, endPosition: closingPos + 17, type: 'artifact' };
          }
          return { position: pos, endPosition: pos + 100, type: 'artifact_unclosed' };
        }
      },
      {
        name: 'artifact_block',
        pattern: /\[artifact[^\]]*\]/i,
        handler: (match, fullText, pos) => {
          // Artifacts are usually self-contained
          return { position: pos, endPosition: pos + match[0].length, type: 'artifact_block' };
        }
      }
    ];
    
    let nearestBoundary = null;
    let nearestPosition = Infinity;
    
    // Check each boundary type
    for (const boundary of boundaries) {
      const match = textToCheck.match(boundary.pattern);
      if (match && match.index < nearestPosition) {
        const absolutePosition = startPosition + match.index;
        nearestBoundary = boundary.handler(match, text, absolutePosition);
        nearestPosition = match.index;
      }
    }
    
    if (nearestBoundary) {
      console.log(`🎯 Found ${nearestBoundary.type} boundary at position ${nearestBoundary.position}`);
      return { found: true, ...nearestBoundary };
    }
    
    return { found: false };
  }

    // Find a complete sentence in the new text
  findCompleteSentence(text) {
    // Simple approach - just wait for sentence endings
    const match = text.match(/^.*?[.!?]\s*/);
  
    if (match && match[0].length > 15) {
      return {
        found: true,
        text: match[0].trim(),
        endPosition: match[0].length
      };
    }
  
    return { found: false };
  }

  // Simple text extraction for manual detection
  extractText(element) {
    if (!element) return null;
    
    try {
      // Clone the element to avoid modifying the original
      const clone = element.cloneNode(true);

      // Remove code blocks and artifacts
      const codeBlocks = clone.querySelectorAll('pre, code');
      codeBlocks.forEach(block => block.remove());

      const artifacts = clone.querySelectorAll('[data-testid*="artifact"], .artifact-block');
      artifacts.forEach(artifact => artifact.remove());

      let text = clone.textContent.trim();
      
      // Basic validation
      if (text.length < 5) return null;
      
      return text;
    } catch (error) {
      console.error("Error extracting text:", error);
      return null;
    }
  }

  // Get timestamp for response
  getResponseTimestamp(element) {
    // Use DOM position as a proxy for creation time
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    return this.conversationModeStartTime + Array.from(allResponses).indexOf(element);
  }

  // Detect if Claude is still typing
  isClaudeTyping(responseElement) {
    try {
      // Check for typing indicators
      const typingIndicators = [
        '.typing-indicator',
        '.loading',
        '[class*="typing"]',
        '[class*="loading"]',
        '.animate-pulse',
        '[class*="cursor"]',
        '.blinking-cursor'
      ];
      
      for (const indicator of typingIndicators) {
        if (responseElement.querySelector(indicator)) {
          return true;
        }
      }
      
      // Check if the send button is disabled (Claude is responding)
      const sendButton = document.querySelector('button[type="submit"], button[aria-label*="Send"], button[aria-label*="send"]');
      if (sendButton && sendButton.disabled) {
        return true;
      }
      
      // Check for streaming indicators in parent containers
      const streamingContainer = responseElement.closest('[class*="streaming"], [class*="generating"]');
      if (streamingContainer) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("Error checking if Claude is typing:", error);
      return false;
    }
  }
    
  // Generate a unique ID for each response
  generateResponseId(element) {
    if (!element) return `unknown-${Date.now()}`;
    
    try {
      // Use timestamp for uniqueness
      const timestamp = Date.now();
      
      // Get position among all assistant responses
      const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
      const position = Array.from(allResponses).indexOf(element);
      
      // Create hash from first 100 chars
      const content = element.textContent.trim().substring(0, 100);
      const contentHash = this.simpleHash(content);
      
      return `${timestamp}-${position}-${contentHash}`;
    } catch (error) {
      console.error("Error generating response ID:", error);
      return `r${Date.now()}`;
    }
  }
    
  // Simple hash function for text
  simpleHash(str) {
    if (!str) return '0';
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
    
  // Improved sendStreamChunk with retry mechanism
  async sendStreamChunk(text, isComplete, responseId, retryCount = 0) {
    if (!text || text.trim().length === 0) {
      console.log(`🔄 Skipping empty chunk ${responseId}`);
      return { success: false, error: "Empty text" };
    }
    
    // Don't retry endlessly
    if (retryCount > 3) {
      console.error(`❌ Giving up after ${retryCount} retries for ${responseId}`);
      return { success: false, error: "Max retries exceeded" };
    }

    const payload = {
      text: text,
      is_complete: isComplete,
      conversation_mode: true,
      timestamp: Date.now(),
      response_id: responseId
    };

    console.log(`🔄 Sending chunk ${responseId}: ${text.substring(0, 50)}... (total: ${text.length} chars)`);

    // Add a small delay to let UI settle
    await new Promise(resolve => setTimeout(resolve, 200));
    
    try {
      const result = await this.sendToServer("/stream", payload);
      
      if (result.success) {
        // Update last processed response ID only if successful
        this.lastProcessedResponseId = responseId;
        return result;
      } else {
        // If server returned error but is reachable, retry
        console.warn(`⚠️ Server returned error for ${responseId}: ${result.error}`);
        
        if (retryCount < 3) {
          console.log(`⚠️ Retrying in 500ms... (attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return this.sendStreamChunk(text, isComplete, responseId, retryCount + 1);
        }
        
        return result;
      }
    } catch (error) {
      console.error(`❌ Failed to send chunk ${responseId}:`, error);
      
      // Store failed request for potential retry
      this.failedRequests.push({
        text,
        isComplete,
        responseId,
        timestamp: Date.now()
      });
      
      // If it seems like a connection issue and we have retries left, try again
      if (retryCount < 3) {
        console.log(`⚠️ Connection error, retrying in 1000ms... (attempt ${retryCount + 1})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.sendStreamChunk(text, isComplete, responseId, retryCount + 1);
      }
      
      return { success: false, error: error.toString() };
    }
  }
    
  // More resilient server communication
  async sendToServer(endpoint, data) {
    if (!this.serverHealthy && endpoint !== "/health") {
      console.warn(`⚠️ Server appears to be down, not sending to ${endpoint}`);
      return { success: false, error: "Server is not responding" };
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Server response: ${endpoint}`, 
          endpoint === "/stream" ? 
            `${result.processed ? "Processed" : "Not processed"} ${data.text?.length || 0} chars` : 
            result
        );
      } else {
        console.error(`❌ Server error: ${endpoint}`, result.error);
      }
      
      return result;
    } catch (error) {
      // Handle aborts separately
      if (error.name === 'AbortError') {
        console.error(`⏱️ Request timeout: ${endpoint}`);
        this.serverHealthy = false; // Mark server as potentially down
        return { success: false, error: "Request timeout" };
      }
      
      console.error(`❌ Request failed: ${endpoint}`, error);
      return { success: false, error: error.message };
    }
  }
    
  // Manual TTS for testing
  async sendManualTTS(text) {
    console.log(`📤 Manual TTS: ${text.substring(0, 50)}...`);
    
    // Generate response ID for manual requests
    const responseId = `manual-${Date.now()}`;
    
    return this.sendToServer("/tts", {
      text: text,
      conversation_mode: false,
      timestamp: Date.now(),
      response_id: responseId
    });
  }
}

// Control Panel
class TTSControlPanel {
  constructor(monitor) {
    this.monitor = monitor;
    this.currentText = "";
    this.createPanel();
    window.claudeTTSControlPanel = this;
  }
  
  createPanel() {
    if (document.getElementById('claude-tts-controls')) return;
    
    const panel = document.createElement('div');
    panel.id = 'claude-tts-controls';
    panel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      background-color: #1C1C1C; color: white; padding: 16px;
      border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; gap: 12px;
      width: 320px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border: 1px solid #333;
    `;
    
    // Title with LAURA signature
    const title = document.createElement('div');
    title.textContent = ' Claude-to-Speech ';
    title.style.cssText = `
      font-size: 36px; font-weight: 500; text-align: center; margin-bottom: 4px;
      padding-bottom: 4px; border-bottom: 1px solid #D4A574;
      font-family: 'Copernicus', serif; color: white; letter-spacing: 0.5px;
      position: relative;
    `;
    
    const lauraSignature = document.createElement('div');
    lauraSignature.innerHTML = 'from LAURA with ♥';
    lauraSignature.style.cssText = `
      font-size: 10px; color: #666; position: absolute;
      bottom: -14px; right: 4px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    title.appendChild(lauraSignature);
    panel.appendChild(title);
    
    // Status indicator with more detailed states
    const statusDiv = document.createElement('div');
    statusDiv.id = 'status';
    statusDiv.textContent = 'Ready';
    statusDiv.style.cssText = `
      font-size: 12px; color: #D4A574; text-align: center; margin-top: 4px;
      font-weight: 500;
    `;
    panel.appendChild(statusDiv);
    
    // Processing lock indicator
    const lockDiv = document.createElement('div');
    lockDiv.id = 'processing-lock';
    lockDiv.style.cssText = `
      font-size: 10px; color: #666; text-align: center; margin-top: 2px;
      display: none;
    `;
    panel.appendChild(lockDiv);
    
    // Server status indicator
    const serverStatus = document.createElement('div');
    serverStatus.id = 'server-status';
    serverStatus.style.cssText = `
      font-size: 10px; color: #666; text-align: center; margin-top: 2px;
    `;
    serverStatus.textContent = 'Checking server status...';
    panel.appendChild(serverStatus);
    
    // Conversation mode toggle (improved styling)
    this.addConversationModeToggle(panel);
    
    // Detect button (dark grey)
    const detectBtn = document.createElement('button');
    detectBtn.textContent = 'Detect Claude Response';
    detectBtn.style.cssText = `
      background-color: #333333; color: white; border: none; border-radius: 8px;
      padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600;
      transition: all 0.2s ease; margin-top: 4px;
    `;
    detectBtn.onmouseover = () => {
      detectBtn.style.backgroundColor = '#404040';
      detectBtn.style.transform = 'translateY(-1px)';
    };
    detectBtn.onmouseout = () => {
      detectBtn.style.backgroundColor = '#333333';
      detectBtn.style.transform = 'translateY(0)';
    };
    detectBtn.onclick = () => this.detectAndDisplay();
    panel.appendChild(detectBtn);
    
    // Preview area (improved styling)
    const previewArea = document.createElement('div');
    previewArea.style.cssText = `
      margin-top: 4px; border: 1px solid #D4A574; border-radius: 8px;
      background-color: #1F2020; padding: 12px;
    `;
    
    const previewLabel = document.createElement('div');
    previewLabel.textContent = 'Detected Text Preview:';
    previewLabel.style.cssText = `
      font-size: 12px; margin-bottom: 8px; color: #D4A574; font-weight: 500;
    `;
    
    const previewText = document.createElement('div');
    previewText.id = 'text-preview';
    previewText.style.cssText = `
      max-height: 120px; overflow-y: auto; font-size: 13px;
      white-space: pre-wrap; word-break: break-word;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      padding: 10px; background-color: #2A2A2A; border-radius: 6px;
      color: #F5E6D3; line-height: 1.4;
    `;
    previewText.textContent = 'No text detected';
    
    previewArea.appendChild(previewLabel);
    previewArea.appendChild(previewText);
    panel.appendChild(previewArea);

    // Create the TTS button
    const ttsBtn = this.createAnimatedTTSButton();
    ttsBtn.onclick = () => {
      if (this.currentText) {
        this.monitor.sendManualTTS(this.currentText);
      }
    };
    ttsBtn.disabled = true;
    ttsBtn.style.opacity = '0.5';
    panel.appendChild(ttsBtn);

    // Stop button 
    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏸️ Stop Audio';
    stopBtn.style.cssText = `
      background-color: #B91C1C; color: white; border: none; border-radius: 8px;
      padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600;
      transition: all 0.2s ease; margin-top: 4px;
    `;
    stopBtn.onclick = () => this.stopAudio();
    panel.appendChild(stopBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      position: absolute; top: 12px; right: 12px;
      background: none; border: none; color: #666; cursor: pointer;
      font-size: 18px; padding: 4px; width: 24px; height: 24px;
      border-radius: 4px; display: flex; align-items: center; justify-content: center;
    `;
    closeBtn.onmouseover = () => closeBtn.style.color = '#999';
    closeBtn.onmouseout = () => closeBtn.style.color = '#666';
    closeBtn.onclick = () => panel.remove();
    panel.appendChild(closeBtn);
    
    document.body.appendChild(panel);
    
    if (this.monitor.conversationMode) {
      console.log("🔄 Starting monitoring from panel creation");
      this.monitor.startMonitoring();
      this.updateStatus('Monitoring active');
    }
    
    // Update processing lock status periodically
    setInterval(() => this.updateProcessingStatus(), 1000);
    
    // Update server status periodically
    setInterval(() => this.updateServerStatus(), 2000);
  }
  
  createAnimatedTTSButton() {
    const button = document.createElement('button');
    button.id = 'claude-tts-btn';
    button.style.cssText = `
      width: 60px; height: 60px; border-radius: 50%;
      background-color: #1a1a1a; border: 1px solid #333;
      cursor: pointer; position: relative; overflow: hidden;
      transition: all 0.2s ease;
    `;
    
    // Load and position the SVGs
    const svgs = [
      { name: 'claudestar.svg', class: 'star-element' },
      { name: 'small.svg', class: 'arc1-element' },
      { name: 'medium.svg', class: 'arc2-element' },
      { name: 'large.svg', class: 'arc3-element' }
    ];
    
    svgs.forEach((svg, index) => {
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL(`icons/svgs/${svg.name}`);
      img.className = svg.class;
      img.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: ${10 - index};
        width: 20px;
        height: 20px;
      `;
      
      img.onerror = () => {
        console.error(`Failed to load SVG: ${svg.name}`);
      };
      
      button.appendChild(img);
    });
    
    // Add the color filters and animations
    const styleId = 'claude-tts-animations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .star-element {
          filter: brightness(0) saturate(100%) invert(48%) sepia(89%) saturate(2074%) hue-rotate(359deg) brightness(95%) contrast(90%);
          animation: starWiggle 3s ease-in-out infinite;
        }
        
        .arc1-element, .arc2-element, .arc3-element {
          filter: brightness(0) saturate(100%) invert(100%);
        }
        
        .arc1-element { animation: arc1Wiggle 2.5s ease-in-out infinite; }
        .arc2-element { animation: arc2Wiggle 3.2s ease-in-out infinite; }
        .arc3-element { animation: arc3Wiggle 4s ease-in-out infinite; }
        
        @keyframes starWiggle {
          0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
          25% { transform: translate(-50%, -50%) rotate(2deg); }
          75% { transform: translate(-50%, -50%) rotate(-2deg); }
        }
        
        @keyframes arc1Wiggle {
          0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
          33% { transform: translate(-50%, -50%) rotate(3deg); }
          66% { transform: translate(-50%, -50%) rotate(-3deg); }
        }
        
        @keyframes arc2Wiggle {
          0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
          40% { transform: translate(-50%, -50%) rotate(-2deg); }
          80% { transform: translate(-50%, -50%) rotate(2deg); }
        }
        
        @keyframes arc3Wiggle {
          0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
          50% { transform: translate(-50%, -50%) rotate(4deg); }
        }
      `;
      document.head.appendChild(style);
    }
    return button;
  }
  
  addConversationModeToggle(container) {
    const toggle = document.createElement('label');
    toggle.style.cssText = `
      display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0;
    `;
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'conversation-toggle';
    input.checked = this.monitor.conversationMode;
    input.style.cssText = `height: 0; width: 0; visibility: hidden; margin: 0;`;
    
    const slider = document.createElement('span');
    slider.style.cssText = `
      position: relative; display: inline-block; width: 40px; height: 20px;
      background-color: ${this.monitor.conversationMode ? '#EF7D21' : '#666666'};
      border-radius: 20px; transition: 0.4s;
    `;
    
    const circle = document.createElement('span');
    circle.style.cssText = `
      position: absolute; height: 16px; width: 16px; left: 2px; bottom: 2px;
      background-color: white; border-radius: 50%; transition: 0.4s;
      transform: ${this.monitor.conversationMode ? 'translateX(20px)' : 'translateX(0)'};
    `;
    slider.appendChild(circle);
    
    const text = document.createElement('span');
    text.textContent = 'Conversation Mode';
    text.style.cssText = 'color: #F5E6D3; font-weight: bold; font-size: 14px;';
    
    input.addEventListener('change', () => {
        this.monitor.conversationMode = input.checked;
        circle.style.transform = input.checked ? 'translateX(20px)' : 'translateX(0)';
        slider.style.backgroundColor = input.checked ? '#EF7D21' : '#666666';
        
        chrome.storage.local.set({ conversationMode: input.checked });
        
        if (input.checked) {
            this.monitor.conversationModeStartTime = Date.now();
            this.monitor.startMonitoring();
            this.updateStatus('Monitoring active');
        } else {
            this.monitor.conversationModeStartTime = null;
            this.monitor.stopMonitoring();
            this.updateStatus('Manual mode');
        }
    });
    
    toggle.appendChild(input);
    toggle.appendChild(slider);
    toggle.appendChild(text);
    container.appendChild(toggle);
  }
  
  detectAndDisplay() {
    const response = this.monitor.findClaudeResponse();
    
    if (!response) {
      this.updatePreview('❌ No Claude response found');
      this.updateStatus('No response detected');
      return;
    }
    
    // Use the simple extractText method
    const text = this.monitor.extractText(response);
    
    if (!text) {
      this.updatePreview('❌ Failed to extract valid text');
      this.updateStatus('Text extraction failed');
      return;
    }
    
    this.currentText = text;
    this.updatePreview(text);
    this.updateStatus(`Detected ${text.length} characters`);
  }
  
  updatePreview(text) {
    const preview = document.getElementById('text-preview');
    if (!preview) return;
    
    // Store the full text
    this.currentText = text;
    
    // Display truncated version if too long
    let displayText = text;
    if (text.length > 500) {
      displayText = text.substring(0, 500) + `...\n\n(${text.length} characters total)`;
    }
    
    preview.textContent = displayText || 'No text detected';
    
    // Enable/disable manual TTS button
    const ttsBtn = document.getElementById('claude-tts-btn');
    if (ttsBtn) {
      if (text && text !== 'No text detected' && !text.startsWith('❌')) {
        ttsBtn.disabled = false;
        ttsBtn.style.opacity = '1';
      } else {
        ttsBtn.disabled = true;
        ttsBtn.style.opacity = '0.5';
      }
    }
  }
  
  updateStatus(message) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.style.color = message.includes('❌') ? '#ff6b6b' : 
                          message.includes('✅') || message.includes('Monitoring') ? '#D4A574' : 
                          '#D4A574';
    }
  }
  
  updateProcessingStatus() {
    const lockDiv = document.getElementById('processing-lock');
    if (lockDiv && this.monitor) {
      if (this.monitor.processingLock) {
        lockDiv.textContent = '🔒 Processing locked';
        lockDiv.style.display = 'block';
        lockDiv.style.color = '#ff6b6b';
      } else {
        lockDiv.style.display = 'none';
      }
    }
  }
  
  updateServerStatus() {
    const statusDiv = document.getElementById('server-status');
    if (statusDiv && this.monitor) {
      if (this.monitor.serverHealthy) {
        statusDiv.textContent = '🟢 Server online';
        statusDiv.style.color = '#4ade80';
      } else {
        statusDiv.textContent = '🔴 Server offline';
        statusDiv.style.color = '#ff6b6b';
      }
      
      // Show failed requests if any
      if (this.monitor.failedRequests.length > 0) {
        statusDiv.textContent += ` (${this.monitor.failedRequests.length} pending)`;
      }
    }
  }

  stopAudio() {
    // Updated to match server endpoint
    this.monitor.sendToServer("/stop_audio", { timestamp: Date.now() });
    this.updateStatus('Audio stopped');
  }
}

// Initialize
const monitor = new ClaudeStreamMonitor();
const controlPanel = new TTSControlPanel(monitor);

// Export for debugging
window.claudeTTSMonitor = monitor;
