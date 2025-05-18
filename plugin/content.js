// Smart Streaming Content Script for Claude - Version 3.4 - Enhanced Processing Logic
console.log("🚀 Smart Streaming Claude TTS loaded - Version 3.4");

class ClaudeStreamMonitor {
  constructor() {
    this.conversationMode = false;
    this.lastResponseText = ""; // Full text of the current response element being processed
    this.isMonitoring = false;
    this.debounceTimer = null;
    this.processingLock = false;
    this.currentResponseElement = null; // The DOM element currently being observed for text
    this.conversationModeStartTime = null;
    this.processedChunks = new Map(); // Stores chunks sent for currentResponseElement to avoid resending *exact* same text block
    this.currentResponseText = ""; // Mirrors currentResponseElement.textContent
    this.lastSentLength = 0; // How much of currentResponseText has been processed (sent or skipped)
    this.chunkCounterForElement = 0; // Sequence number for chunks of currentResponseElement

    this.isRetrying = false; 
    this.serverHealthy = true;
    this.failedRequests = []; // Stores requests that failed due to server/network issues
    
    this.loadSettings();
    this.resetServerOnPageLoad();
    this.startHealthCheck();
  }

  async startHealthCheck() {
    try {
      const result = await fetch("http://127.0.0.1:5000/health", {
        method: 'GET',
      }).then(res => res.json());
      
      if (result.status === "ok") {
        if (!this.serverHealthy) console.log("✅ TTS Server is healthy");
        this.serverHealthy = true;
        if (this.failedRequests.length > 0 && !this.isRetrying) {
          this.retryFailedRequests();
        }
      } else {
        if (this.serverHealthy) console.error("❌ TTS Server reported unhealthy status:", result);
        this.serverHealthy = false;
      }
    } catch (e) {
      if (this.serverHealthy) console.error("❌ TTS Server health check failed:", e);
      this.serverHealthy = false;
    }
    setTimeout(() => this.startHealthCheck(), 10000);
  }
  
  async retryFailedRequests() {
    if (this.isRetrying || this.failedRequests.length === 0 || !this.serverHealthy) return;
    
    this.isRetrying = true;
    console.log(`🔄 Retrying ${this.failedRequests.length} failed requests`);
    
    const requestsToRetry = [...this.failedRequests];
    this.failedRequests = []; 
    
    for (const req of requestsToRetry) {
      if (!this.serverHealthy) {
          console.warn("❌ Server unhealthy, pausing retries.");
          this.failedRequests.unshift(...requestsToRetry.slice(requestsToRetry.indexOf(req))); 
          break;
      }
      try {
        console.log(`🔄 Retrying request for ${req.responseId} (Attempt after failure)`);
        await this.sendStreamChunk(req.text, req.isComplete, req.responseId, 0, true); 
        await new Promise(resolve => setTimeout(resolve, 500)); 
      } catch (e) {
        console.error(`❌ Retry attempt failed for ${req.responseId}:`, e);
      }
    }
    this.isRetrying = false;
  }

  resetForNewResponse() {
    console.log("🔄 Resetting for new response (explicit call)");
    if (this.currentResponseElement && this.currentResponseText.length > this.lastSentLength) {
        this.sendFinalChunk(); 
    }
    this.currentResponseElement = null;
    this.currentResponseText = "";
    this.lastSentLength = 0;
    this.chunkCounterForElement = 0;
    this.processedChunks.clear(); 
  }

  sendFinalChunk() {
    if (this.currentResponseElement && this.currentResponseText.length > 0 && 
        this.lastSentLength < this.currentResponseText.length) {
      
      const remainingFullText = this.currentResponseText.substring(this.lastSentLength);
      let textToActuallySend = "";
      let currentInternalPos = 0;

      while(currentInternalPos < remainingFullText.length) {
          const absolutePosInCurrentText = this.lastSentLength + currentInternalPos;
          const boundary = this.findNextBoundary(this.currentResponseText, absolutePosInCurrentText);

          let segmentBeforeBoundary;
          if (boundary.found && boundary.position === absolutePosInCurrentText) {
              currentInternalPos += (boundary.endPosition - absolutePosInCurrentText);
              continue; 
          }
          
          if (boundary.found) {
              segmentBeforeBoundary = this.currentResponseText.substring(absolutePosInCurrentText, boundary.position);
          } else {
              segmentBeforeBoundary = this.currentResponseText.substring(absolutePosInCurrentText);
          }

          if (segmentBeforeBoundary.trim().length > 0) {
              textToActuallySend += segmentBeforeBoundary.trim() + " ";
          }
          currentInternalPos += segmentBeforeBoundary.length; 
          
          if (segmentBeforeBoundary.length === 0 && currentInternalPos < remainingFullText.length) {
              if (/\s/.test(remainingFullText[currentInternalPos])) {
                currentInternalPos++;
              } else {
                console.warn("sendFinalChunk got stuck processing remaining text. Breaking.");
                break; 
              }
          }
      }
      
      textToActuallySend = textToActuallySend.trim();
      if (textToActuallySend.length > 0) {
        const baseId = this.generateResponseId(this.currentResponseElement);
        const responseId = `${baseId}-final-${this.chunkCounterForElement++}`;
        console.log(`📤 Sending final chunk (via sendFinalChunk): ${textToActuallySend.substring(0, 50)}... (${textToActuallySend.length} chars)`);
        this.sendStreamChunk(textToActuallySend, true, responseId); 
        this.lastSentLength = this.currentResponseText.length; 
      }
    }
  }

  findClaudeResponse() {
    const streamingElements = document.querySelectorAll('[data-is-streaming]');
    if (streamingElements.length > 0) {
      const latest = streamingElements[streamingElements.length - 1];
      const isStreaming = latest.getAttribute('data-is-streaming') === 'true';
      if (isStreaming) return latest;
      const messageDiv = latest.querySelector('.font-claude-message');
      return messageDiv || latest; 
    }
    
    const completedElements = document.querySelectorAll('.font-claude-message');
    if (completedElements.length > 0) {
      return completedElements[completedElements.length - 1];
    }
    
    const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (assistantMessages.length > 0) {
        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        const messageContent = lastAssistantMessage.querySelector('.font-claude-message') || 
                               lastAssistantMessage.querySelector('div[data-is-response]') || 
                               lastAssistantMessage; 
        return messageContent;
    }
    return null;
  }

  async resetServerOnPageLoad() {
    setTimeout(async () => {
      try {
        const result = await this.sendToServer("/reset_conversation", {
          client_ip: 'browser',
          response_id: 'page-refresh-' + Date.now()
        });
        if (result.success) console.log("🔄 Cleared server state after page load");
        else console.error("❌ Failed to reset server state:", result.error);
      } catch (error) { console.error("❌ Error resetting server:", error); }
    }, 1000);
  }
    
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
    
  startMonitoring() {
    if (this.isMonitoring) return;
    console.log("🔄 Starting smart stream monitoring");
    this.isMonitoring = true;
    this.conversationModeStartTime = Date.now();
    
    this.observer = new MutationObserver((mutations) => {
      if (!this.conversationMode || this.processingLock) return;
      
      const hasClaudeMessageChanges = mutations.some(mutation => {
        if (mutation.target === this.currentResponseElement || (this.currentResponseElement && this.currentResponseElement.contains(mutation.target))) {
            return true; 
        }
        return Array.from(mutation.addedNodes).some(node => 
            node.nodeType === 1 && (
                node.classList?.contains('font-claude-message') || 
                node.querySelector?.('.font-claude-message') ||
                (node.hasAttribute?.('data-message-author-role') && node.getAttribute('data-message-author-role') === 'assistant') ||
                node.querySelector?.('[data-message-author-role="assistant"]') ||
                node.hasAttribute?.('data-is-streaming') 
            )
        ) || (mutation.type === 'characterData' && mutation.target.parentElement && 
              (mutation.target.parentElement.closest?.('.font-claude-message') || mutation.target.parentElement.closest?.('[data-message-author-role="assistant"]'))
        );
      });
      
      if (hasClaudeMessageChanges) {
        this.debounceAndProcess();
      }
    });
    
    const possibleContainers = [
      document.evaluate('/html/body/div[2]/div[2]/div/div[1]/div/div/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue,
      document.querySelector('main'),
      document.querySelector('.conversation-container'),
      document.querySelector('[data-testid="conversation-main"]'),
      document.body
    ];
    const target = possibleContainers.find(container => container !== null);
    
    if (target) {
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
      console.log("✅ Observer attached to container:", target);
      this.processStreamUpdate(); 
    } else {
      console.error("❌ Could not find any suitable container for observing");
    }
  }

  stopMonitoring() {
    console.log("⏹️ Stopping stream monitoring");
    this.isMonitoring = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    clearTimeout(this.debounceTimer);
  }
    
  debounceAndProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processStreamUpdate();
    }, 250); 
  }
    
async processStreamUpdate() {
  if (!this.conversationMode) {
    if (this.processingLock) this.processingLock = false;
    return;
  }
  
  if (this.processingLock) {
    return;
  }
  
  this.processingLock = true;
  
  try {
    const responseElement = this.findClaudeResponse();
    if (!responseElement) {
      if (this.currentResponseElement) {
          this.sendFinalChunk();
      }
      this.processingLock = false;
      return;
    }
    
    if (responseElement !== this.currentResponseElement) {
      if (this.currentResponseElement) {
        this.sendFinalChunk(); 
      }
      this.currentResponseElement = responseElement;
      this.currentResponseText = ""; 
      this.lastSentLength = 0;
      this.chunkCounterForElement = 0;
      this.processedChunks.clear(); 
      console.log("🔄 Switched to new response element. State reset for new element.");
    }

    const fullText = responseElement.textContent || "";
    this.currentResponseText = fullText; 

    const isStreaming = this.isClaudeTyping(responseElement);
    
    if (this.lastSentLength >= fullText.length && isStreaming) {
        this.processingLock = false;
        return;
    }
     if (this.lastSentLength >= fullText.length && !isStreaming) {
        this.processingLock = false;
        return;
    }

    let currentParsePos = this.lastSentLength; 

    while (currentParsePos < fullText.length) {
      const boundary = this.findNextBoundary(fullText, currentParsePos);

      if (boundary.found && boundary.position === currentParsePos) {
        console.log(`🚧 Boundary ${boundary.type} found at current position ${currentParsePos}. Skipping to ${boundary.endPosition}.`);
        currentParsePos = boundary.endPosition;
        this.lastSentLength = currentParsePos; 
        continue; 
      }

      let textSegmentToAnalyze;
      let endOfThisSegmentInFullText;

      if (boundary.found) {
        textSegmentToAnalyze = fullText.substring(currentParsePos, boundary.position);
        endOfThisSegmentInFullText = boundary.position;
      } else {
        textSegmentToAnalyze = fullText.substring(currentParsePos);
        endOfThisSegmentInFullText = fullText.length;
      }

      if (textSegmentToAnalyze.trim().length > 0) {
        let textToSend = textSegmentToAnalyze.trim();
        let sendNow = false;
        let markCompleteOnSend = !isStreaming && (endOfThisSegmentInFullText === fullText.length); 

        if (isStreaming) {
          const sentenceMatch = this.findCompleteSentence(textSegmentToAnalyze); 
          if (sentenceMatch.found) {
            textToSend = sentenceMatch.text; 
            currentParsePos += sentenceMatch.endPosition; 
            sendNow = true;
            markCompleteOnSend = false; 
          } else if (!boundary.found && textSegmentToAnalyze.length < 70) { 
            break; 
          } else {
            textToSend = textSegmentToAnalyze.trim();
            currentParsePos += textSegmentToAnalyze.length; 
            sendNow = true;
            markCompleteOnSend = !isStreaming && (currentParsePos === fullText.length);
          }
        } else {
          textToSend = textSegmentToAnalyze.trim();
          currentParsePos += textSegmentToAnalyze.length; 
          sendNow = true;
          markCompleteOnSend = (currentParsePos === fullText.length); 
        }

        if (sendNow && textToSend.length > 0) {
          const baseId = this.generateResponseId(this.currentResponseElement);
          const chunkIdSuffix = markCompleteOnSend ? "final" : "stream";
          const responseId = `${baseId}-${chunkIdSuffix}-${this.chunkCounterForElement++}`;
          
          if (!this.processedChunks.has(responseId) || this.processedChunks.get(responseId) !== textToSend) {
            console.log(`📤 Sending ${markCompleteOnSend ? "final" : "stream"} chunk: "${textToSend.substring(0,50)}..." (Len: ${textToSend.length}) ID: ${responseId}`);
            await this.sendStreamChunk(textToSend, markCompleteOnSend, responseId);
            this.processedChunks.set(responseId, textToSend);
            this.lastSentLength = currentParsePos; 
          } else {
            console.log(`⏭️ Skipping already processed/sent chunk: ${responseId}`);
            this.lastSentLength = currentParsePos; 
          }
        } else if (textToSend.length === 0 && currentParsePos < endOfThisSegmentInFullText) {
            currentParsePos = endOfThisSegmentInFullText;
            this.lastSentLength = currentParsePos;
        }

      } else {
        currentParsePos = endOfThisSegmentInFullText;
        this.lastSentLength = currentParsePos; 
      }
      
      if (this.lastSentLength === currentParsePos && currentParsePos < fullText.length && textSegmentToAnalyze.length === 0 && !(boundary.found && boundary.position === currentParsePos)) {
           if (fullText.substring(currentParsePos).trim().length === 0) { 
               this.lastSentLength = fullText.length;
               currentParsePos = fullText.length;
           } else {
               break; 
           }
      }
    } 

    if (!isStreaming && this.lastSentLength >= fullText.length) {
      // console.log(`✅ Fully processed response element ${this.generateResponseId(this.currentResponseElement)}.`);
    }

  } catch (error) {
    console.error("❌ Process error in processStreamUpdate:", error);
  } finally {
    this.processingLock = false;
  }
}

  findNextBoundary(text, startPosition) {
    const textToCheck = text.substring(startPosition);
    const boundaries = [
      { name: 'code_block_start', pattern: /```/,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /```/.exec(fullText.substring(absMatchStart + 3));
          if (closingMatch) return { position: absMatchStart, endPosition: absMatchStart + 3 + closingMatch.index + 3, type: 'code_block' };
          return { position: absMatchStart, endPosition: fullText.length, type: 'code_block_unclosed' }; 
        }},
      { name: 'artifact_start_func_calls', pattern: /<function_calls>/i,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /<\/function_calls>/i.exec(fullText.substring(absMatchStart + match[0].length));
          if (closingMatch) return { position: absMatchStart, endPosition: absMatchStart + match[0].length + closingMatch.index + closingMatch[0].length, type: 'artifact_function_calls' };
          return { position: absMatchStart, endPosition: fullText.length, type: 'artifact_function_calls_unclosed' };
        }},
      { name: 'artifact_block_generic', pattern: /\[artifact[^\]]*\]/i, 
        handler: (match, fullText, absMatchStart) => {
          return { position: absMatchStart, endPosition: absMatchStart + match[0].length, type: 'artifact_block' };
        }}
    ];
    
    let nearestBoundary = { found: false, position: Infinity, endPosition: Infinity, type: '' };
    
    for (const boundaryDef of boundaries) {
      const match = boundaryDef.pattern.exec(textToCheck);
      if (match) {
        const absolutePosition = startPosition + match.index;
        if (absolutePosition < nearestBoundary.position) {
          const boundaryDetails = boundaryDef.handler(match, text, absolutePosition);
          nearestBoundary = { found: true, ...boundaryDetails };
        }
      }
    }
    
    if (nearestBoundary.found) {
      return nearestBoundary;
    }
    return { found: false };
  }

  findCompleteSentence(text) {
    const match = text.match(/^.*?[.!?]\s*/);
    if (match && match[0].trim().length > 10) { 
      return { found: true, text: match[0].trim(), endPosition: match[0].length };
    }
    return { found: false };
  }

  extractText(element) { return (element && typeof element.textContent === 'string') ? element.textContent.trim() : null; }
  
  getResponseTimestamp(element) { 
    if (!element) return Date.now();
    // Fallback to Date.now() if element is not found in the list, or list is empty.
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    const index = Array.from(allResponses).indexOf(element);
    return (this.conversationModeStartTime || Date.now()) + (index !== -1 ? index : allResponses.length);
  }

  isClaudeTyping(responseElement) {
    if (!responseElement) return false;
    if (responseElement.getAttribute('data-is-streaming') === 'true') return true;
    if (responseElement.closest('[data-is-streaming="true"]')) return true;

    const typingSelectors = [ '.typing-indicator', '.claude-typing-indicator', '.animate-pulse', '[class*="cursor"]', '.blinking-cursor', '[class*="streaming"]', '[class*="generating"]'];
    for (const selector of typingSelectors) {
      if (responseElement.querySelector(selector) || responseElement.closest(selector)) return true;
    }
    const sendButton = document.querySelector('button[type="submit"]:disabled, button[aria-label*="Send"]:disabled, button[aria-label*="send"]:disabled');
    if (sendButton) return true;
    
    return false;
  }
    
  generateResponseId(element) {
    if (!element) return `unknown-${Date.now()}`;
    try {
      const timestamp = this.getResponseTimestamp(element);
      const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
      const position = Array.from(allResponses).indexOf(element);
      const content = (element.textContent || "").trim().substring(0, 50); 
      const contentHash = this.simpleHash(content);
      return `${timestamp}-${position === -1 ? 'new' : position}-${contentHash}`;
    } catch (error) {
      console.error("Error generating response ID:", error);
      return `err-${Date.now()}`;
    }
  }
    
  simpleHash(str) { if (!str) return '0'; let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash = hash & hash; } return Math.abs(hash).toString(36); }
    
  async sendStreamChunk(text, isComplete, responseId, retryAttempt = 0, isRetryOfFailed = false) {
    if (!text || text.trim().length === 0) {
      return { success: true, error: "Empty text, skipped" }; 
    }
    
    const MAX_RETRIES = 3;
    if (retryAttempt > MAX_RETRIES) {
      console.error(`❌ Giving up after ${retryAttempt} retries for ${responseId}. Adding to failed queue.`);
      if (!isRetryOfFailed) { 
          this.failedRequests.push({ text, isComplete, responseId, timestamp: Date.now() });
      }
      return { success: false, error: "Max retries exceeded" };
    }

    const payload = {
      text: text, is_complete: isComplete, conversation_mode: true, 
      timestamp: Date.now(), response_id: responseId
    };
    
    try {
      const result = await this.sendToServer("/stream", payload);
      if (result.success) {
        return result;
      } else {
        console.warn(`⚠️ Server returned error for ${responseId} (Attempt ${retryAttempt}): ${result.error}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, (retryAttempt + 1) * 750)); 
        return this.sendStreamChunk(text, isComplete, responseId, retryAttempt + 1, isRetryOfFailed);
      }
    } catch (error) { 
      console.error(`❌ Failed to send chunk ${responseId} (Attempt ${retryAttempt}):`, error.message);
      this.serverHealthy = false; 
      if (retryAttempt < MAX_RETRIES) {
        console.log(`🔌 Connection error, retrying in ${ (retryAttempt + 1) * 1000}ms... (attempt ${retryAttempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, (retryAttempt + 1) * 1000));
        return this.sendStreamChunk(text, isComplete, responseId, retryAttempt + 1, isRetryOfFailed);
      } else {
        console.error(`❌ Max retries for connection error on ${responseId}. Adding to failed queue.`);
        if (!isRetryOfFailed) {
            this.failedRequests.push({ text, isComplete, responseId, timestamp: Date.now() });
        }
        return { success: false, error: error.toString() };
      }
    }
  }
    
  async sendToServer(endpoint, data) {
    if (!this.serverHealthy && endpoint !== "/health" && endpoint !== "/reset_conversation") {
      console.warn(`⚠️ Server appears to be down, not sending to ${endpoint}. Queuing if applicable.`);
      if (endpoint === "/stream" && data && data.response_id && !this.failedRequests.find(fr => fr.responseId === data.response_id)) {
          this.failedRequests.push({
              text: data.text,
              isComplete: data.is_complete,
              responseId: data.response_id,
              timestamp: data.timestamp || Date.now()
          });
           console.log(`Queued failed request ${data.response_id} due to server health.`);
      }
      return { success: false, error: "Server is not responding" };
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); 
      
      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify(data), signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      let result;
      try {
          result = await response.json();
      } catch (e) {
          const textResponse = await response.text();
          console.error(`❌ Server response not JSON for ${endpoint}: ${response.status}`, textResponse.substring(0,500));
          this.serverHealthy = false; 
          return { success: false, error: `Server returned non-JSON response (status ${response.status})` };
      }
      
      if (!response.ok) { 
          console.error(`❌ Server error: ${endpoint} (Status: ${response.status})`, result.error || result);
          if (response.status >= 500) this.serverHealthy = false; 
          return { success: false, error: result.error || `Server error status ${response.status}` , ...result };
      }
      return result; 
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`⏱️ Request timeout: ${endpoint}`);
        this.serverHealthy = false; 
        return { success: false, error: "Request timeout" };
      }
      console.error(`❌ Request failed: ${endpoint}`, error.message);
      this.serverHealthy = false; 
      return { success: false, error: error.message };
    }
  }
    
  async sendManualTTS(text) { 
    console.log(`📤 Manual TTS: ${text.substring(0, 50)}...`);
    const responseId = `manual-${this.simpleHash(text.substring(0,50))}-${Date.now()}`;
    const payload = { text: text, conversation_mode: false, timestamp: Date.now(), response_id: responseId, is_complete: true };
    
    if (!this.serverHealthy) {
        console.warn("Server down, queuing manual TTS request.");
        this.failedRequests.push({ ...payload }); 
        return { success: false, error: "Server down, request queued" };
    }
    return this.sendToServer("/tts", payload); 
  }
}

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
    
    const statusDiv = document.createElement('div');
    statusDiv.id = 'status';
    statusDiv.textContent = 'Ready';
    statusDiv.style.cssText = `
      font-size: 12px; color: #D4A574; text-align: center; margin-top: 4px;
      font-weight: 500;
    `;
    panel.appendChild(statusDiv);
    
    const lockDiv = document.createElement('div');
    lockDiv.id = 'processing-lock';
    lockDiv.style.cssText = `
      font-size: 10px; color: #666; text-align: center; margin-top: 2px;
      display: none;
    `;
    panel.appendChild(lockDiv);
    
    const serverStatus = document.createElement('div');
    serverStatus.id = 'server-status';
    serverStatus.style.cssText = `
      font-size: 10px; color: #666; text-align: center; margin-top: 2px;
    `;
    serverStatus.textContent = 'Checking server status...';
    panel.appendChild(serverStatus);
    
    this.addConversationModeToggle(panel);
    
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

    const ttsBtn = this.createAnimatedTTSButton();
    ttsBtn.onclick = () => {
      if (this.currentText && this.currentText.trim().length > 0 && !this.currentText.startsWith('❌')) {
        this.monitor.sendManualTTS(this.currentText.trim());
      }
    };
    ttsBtn.disabled = true;
    ttsBtn.style.opacity = '0.5';
    panel.appendChild(ttsBtn);

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏸️ Stop Audio';
    stopBtn.style.cssText = `
      background-color: #B91C1C; color: white; border: none; border-radius: 8px;
      padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600;
      transition: all 0.2s ease; margin-top: 4px;
    `;
    stopBtn.onclick = () => this.stopAudio();
    panel.appendChild(stopBtn);

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
      this.monitor.startMonitoring();
      this.updateStatus('Monitoring active');
    }
    
    setInterval(() => this.updateProcessingStatus(), 1000);
    setInterval(() => this.updateServerStatus(), 2000);
  }
  
  createAnimatedTTSButton() {
    const button = document.createElement('button');
    button.id = 'claude-tts-btn';
    button.style.cssText = `
      width: 60px; height: 60px; border-radius: 50%;
      background-color: #1a1a1a; border: 1px solid #333;
      cursor: pointer; position: relative; overflow: hidden;
      transition: all 0.2s ease; margin: 0 auto; /* Center button */
    `;
    
    const svgs = [
      { name: 'claudestar.svg', class: 'star-element' }, { name: 'small.svg', class: 'arc1-element' },
      { name: 'medium.svg', class: 'arc2-element' }, { name: 'large.svg', class: 'arc3-element' }
    ];
    
    svgs.forEach((svg, index) => {
      const img = document.createElement('img');
      try {
        img.src = chrome.runtime.getURL(`icons/svgs/${svg.name}`);
      } catch (e) { console.error("Error getting SVG URL:", e); }
      img.className = svg.class;
      img.style.cssText = `
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%); z-index: ${10 - index};
        width: 20px; height: 20px;
      `;
      img.onerror = () => console.error(`Failed to load SVG: ${svg.name}`);
      button.appendChild(img);
    });
    
    const styleId = 'claude-tts-animations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .star-element { filter: brightness(0) saturate(100%) invert(48%) sepia(89%) saturate(2074%) hue-rotate(359deg) brightness(95%) contrast(90%); animation: starWiggle 3s ease-in-out infinite; }
        .arc1-element, .arc2-element, .arc3-element { filter: brightness(0) saturate(100%) invert(100%); }
        .arc1-element { animation: arc1Wiggle 2.5s ease-in-out infinite; } .arc2-element { animation: arc2Wiggle 3.2s ease-in-out infinite; } .arc3-element { animation: arc3Wiggle 4s ease-in-out infinite; }
        @keyframes starWiggle { 0%, 100% { transform: translate(-50%, -50%) rotate(0deg); } 25% { transform: translate(-50%, -50%) rotate(2deg); } 75% { transform: translate(-50%, -50%) rotate(-2deg); } }
        @keyframes arc1Wiggle { 0%, 100% { transform: translate(-50%, -50%) rotate(0deg); } 33% { transform: translate(-50%, -50%) rotate(3deg); } 66% { transform: translate(-50%, -50%) rotate(-3deg); } }
        @keyframes arc2Wiggle { 0%, 100% { transform: translate(-50%, -50%) rotate(0deg); } 40% { transform: translate(-50%, -50%) rotate(-2deg); } 80% { transform: translate(-50%, -50%) rotate(2deg); } }
        @keyframes arc3Wiggle { 0%, 100% { transform: translate(-50%, -50%) rotate(0deg); } 50% { transform: translate(-50%, -50%) rotate(4deg); } }
      `;
      document.head.appendChild(style);
    }
    return button;
  }
  
  addConversationModeToggle(container) {
    const toggle = document.createElement('label');
    toggle.style.cssText = `display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0;`;
    
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = 'conversation-toggle';
    input.checked = this.monitor.conversationMode;
    input.style.cssText = `height: 0; width: 0; visibility: hidden; margin: 0;`;
    
    const slider = document.createElement('span');
    slider.style.cssText = `position: relative; display: inline-block; width: 40px; height: 20px; background-color: ${this.monitor.conversationMode ? '#EF7D21' : '#666666'}; border-radius: 20px; transition: 0.4s;`;
    
    const circle = document.createElement('span');
    circle.style.cssText = `position: absolute; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; border-radius: 50%; transition: 0.4s; transform: ${this.monitor.conversationMode ? 'translateX(20px)' : 'translateX(0)'};`;
    slider.appendChild(circle);
    
    const text = document.createElement('span');
    text.textContent = 'Conversation Mode';
    text.style.cssText = 'color: #F5E6D3; font-weight: bold; font-size: 14px;';
    
    input.addEventListener('change', () => {
        this.monitor.conversationMode = input.checked;
        circle.style.transform = input.checked ? 'translateX(20px)' : 'translateX(0)';
        slider.style.backgroundColor = input.checked ? '#EF7D21' : '#666666';
        try {
            chrome.storage.local.set({ conversationMode: input.checked });
        } catch(e) { console.error("Error saving to chrome.storage.local", e); }
        
        if (input.checked) {
            this.monitor.conversationModeStartTime = Date.now();
            this.monitor.startMonitoring(); this.updateStatus('Monitoring active');
        } else {
            this.monitor.conversationModeStartTime = null;
            this.monitor.stopMonitoring(); this.updateStatus('Manual mode');
        }
    });
    toggle.appendChild(input); toggle.appendChild(slider); toggle.appendChild(text);
    container.appendChild(toggle);
  }
  
  detectAndDisplay() {
    const response = this.monitor.findClaudeResponse();
    if (!response) {
      this.updatePreview('❌ No Claude response found'); this.updateStatus('No response detected'); return;
    }
    const text = this.monitor.extractText(response);
    if (!text) {
      this.updatePreview('❌ Failed to extract valid text'); this.updateStatus('Text extraction failed'); return;
    }
    this.updatePreview(text); 
    this.updateStatus(`Detected ${text.length} characters`);
  }
  
  updatePreview(text) {
    const preview = document.getElementById('text-preview');
    if (!preview) return;
    this.currentText = text; // Store full text for manual TTS
    let displayText = text;
    if (text.length > 500) displayText = text.substring(0, 500) + `...\n\n(${text.length} characters total)`;
    preview.textContent = displayText || 'No text detected';
    
    const ttsBtn = document.getElementById('claude-tts-btn');
    if (ttsBtn) {
      if (text && text.trim() !== '' && !text.startsWith('❌')) {
        ttsBtn.disabled = false; ttsBtn.style.opacity = '1';
      } else {
        ttsBtn.disabled = true; ttsBtn.style.opacity = '0.5';
      }
    }
  }
  
  updateStatus(message) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.style.color = message.includes('❌') ? '#ff6b6b' : message.includes('✅') || message.includes('Monitoring') ? '#D4A574' : '#D4A574';
    }
  }
  
  updateProcessingStatus() {
    const lockDiv = document.getElementById('processing-lock');
    if (lockDiv && this.monitor) {
      if (this.monitor.processingLock) {
        lockDiv.textContent = '🔒 Processing locked'; lockDiv.style.display = 'block'; lockDiv.style.color = '#ff6b6b';
      } else { lockDiv.style.display = 'none'; }
    }
  }
  
  updateServerStatus() {
    const statusDiv = document.getElementById('server-status');
    if (statusDiv && this.monitor) {
      if (this.monitor.serverHealthy) {
        statusDiv.textContent = '🟢 Server online'; statusDiv.style.color = '#4ade80';
      } else {
        statusDiv.textContent = '🔴 Server offline'; statusDiv.style.color = '#ff6b6b';
      }
      if (this.monitor.failedRequests.length > 0) {
        statusDiv.textContent += ` (${this.monitor.failedRequests.length} pending)`;
      }
    }
  }

  stopAudio() {
    this.monitor.sendToServer("/stop_audio", { timestamp: Date.now() });
    this.updateStatus('Audio stopped');
  }
}

const monitor = new ClaudeStreamMonitor();
const controlPanel = new TTSControlPanel(monitor); 
window.claudeTTSMonitor = monitor; 
window.claudeTTSControlPanel = controlPanel;
