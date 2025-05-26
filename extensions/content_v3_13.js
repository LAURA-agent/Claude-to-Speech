// Smart Streaming Content Script for Claude - Version 3.4 - Enhanced Processing Logic
console.log("🚀 Smart Streaming Claude TTS loaded - Version 3.4 (Patched)");
const QUIET_MODE = true;

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
    this.currentResponseText = ""; // Mirrors currentResponseElement.textContent, but cleaned (raw DOM text for current cycle)
    this.lastSentLength = 0; // How much of currentResponseText has been processed (sent or skipped) - less relevant with new logic
    this.chunkCounterForElement = 0; // Sequence number for chunks of currentResponseElement
    this.lastProcessedText = ""; // The exact textToProcess (cleaned) from the last successful processing run for the current logical response
    this.isRetrying = false;
    this.serverHealthy = true;
    this.failedRequests = []; // Stores requests that failed due to server/network issues
    this.lastCleanedText = ""; // The accumulated *cleaned* text that has been sent to TTS for the current logical response
    this.isInitializing = false;
    this.loadSettings(); // This will trigger startMonitoring if mode is true
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
    setTimeout(() => this.startHealthCheck(), 30000);
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
    // This function is called when "Detect Claude Response" is clicked.
    console.log("🔄 Resetting for new response (explicit call via Detect Button)");
    if (this.currentResponseElement) {
        const currentElementCleanedFullText = this.lastProcessedText;
        if (currentElementCleanedFullText && currentElementCleanedFullText.length > this.lastCleanedText.length) {
            const remainingTextToSend = currentElementCleanedFullText.substring(this.lastCleanedText.length).trim();
            if (remainingTextToSend.length > 0) {
                const baseId = this.generateResponseId(this.currentResponseElement); // Uses full ID for chunk
                const responseId = `${baseId}-final-ondetect-${this.chunkCounterForElement++}`;
                console.log(`📤 Sending final chunk due to Detect button: "${remainingTextToSend.substring(0, 50)}..."`);
                this.sendStreamChunk(remainingTextToSend, true, responseId);
            }
        }
    }
    // Full reset of state for the new detection
    this.currentResponseElement = null;
    this.currentResponseText = "";
    this.lastSentLength = 0;
    this.chunkCounterForElement = 0;
    this.processedChunks.clear();
    this.lastProcessedText = "";
    this.lastCleanedText = "";
  }

  sendFinalChunk() {
    if (this.currentResponseElement && this.lastProcessedText) {
        const finalCleanedFullText = this.lastProcessedText;
        if (finalCleanedFullText.length > this.lastCleanedText.length) {
            const remainingTextToSend = finalCleanedFullText.substring(this.lastCleanedText.length).trim();
            if (remainingTextToSend.length > 0) {
                const baseId = this.generateResponseId(this.currentResponseElement); // Uses full ID for chunk
                const responseId = `${baseId}-prevfinal-${this.chunkCounterForElement++}`;
                console.log(`📤 Sending final chunk for previous response (via sendFinalChunk): "${remainingTextToSend.substring(0, 50)}..." (${remainingTextToSend.length} chars)`);
                this.sendStreamChunk(remainingTextToSend, true, responseId);
            }
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
    if (this.isInitializing) {
        console.log("loadSettings: Already initializing, skipping.");
        return;
    }
    this.isInitializing = true;
    console.log("loadSettings: Starting to load settings.");
    try {
      const result = await chrome.storage.local.get(['conversationMode']);
      const newMode = result.conversationMode || false;
      console.log(`📊 Loaded conversation mode from storage: ${newMode}`);

      if (newMode !== this.conversationMode || (newMode && !this.isMonitoring) || (!newMode && this.isMonitoring)) {
        this.conversationMode = newMode;
        if (this.conversationMode) {
            if (!this.isMonitoring) this.startMonitoring();
        } else {
            if (this.isMonitoring) this.stopMonitoringAndFinalize();
        }
      } else {
        console.log("loadSettings: No change in conversation mode or monitoring state required.");
      }
      
      if (window.ttsPanel) {
        window.ttsPanel.updateToggleVisuals(this.conversationMode);
        window.ttsPanel.updateStatusDisplay();
      }
    } catch (error) {
      console.error("❌ Error loading settings:", error);
      this.conversationMode = false;
    } finally {
        this.isInitializing = false;
        console.log("loadSettings: Finished loading settings.");
    }
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    console.log("🔄 Starting smart stream monitoring");
    this.isMonitoring = true;
    this.conversationMode = true; // Ensure mode is true when monitoring starts
    this.conversationModeStartTime = Date.now();

    this.observer = new MutationObserver((mutations) => {
      if (!this.conversationMode || this.processingLock) return;
      const hasClaudeMessageChanges = mutations.some(mutation => { /* ... (as before) ... */
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
      if (hasClaudeMessageChanges) this.debounceAndProcess();
    });

    const possibleContainers = [ /* ... (as before) ... */
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

      // Initial state reset for a new monitoring session
      this.currentResponseElement = null;
      this.currentResponseText = "";
      this.lastCleanedText = "";
      this.lastProcessedText = "";
      this.chunkCounterForElement = 0;
      this.processedChunks.clear();

      const existingResponse = this.findClaudeResponse();
      if (existingResponse) {
        console.log("🔍 Found existing response on start, processing...");
        this.processStreamUpdate(); // This will handle it as a new response due to resets
      } else {
        console.log("📝 No existing response found on start - observer ready for new content");
      }
    } else {
      console.error("❌ Could not find any suitable container for observing");
    }
  }

  stopMonitoringAndFinalize() {
    console.log("⏹️ Stopping stream monitoring and finalizing.");
    this.isMonitoring = false;
    this.conversationMode = false; // Ensure mode is false
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    clearTimeout(this.debounceTimer);

    // Finalize any pending text for the current response being monitored
    if (this.currentResponseElement) {
      const currentElementCleanedFullText = this.lastProcessedText;
      if (currentElementCleanedFullText && currentElementCleanedFullText.length > this.lastCleanedText.length) {
        const remainingTextToSend = currentElementCleanedFullText.substring(this.lastCleanedText.length).trim();
        if (remainingTextToSend.length > 0) {
          const baseId = this.generateResponseId(this.currentResponseElement);
          const responseId = `${baseId}-final-onstop-${this.chunkCounterForElement++}`;
          console.log(`📤 Sending final chunk due to stopping monitor: "${remainingTextToSend.substring(0, 50)}..."`);
          this.sendStreamChunk(remainingTextToSend, true, responseId);
          // Update lastCleanedText to reflect this final send for consistency, though state will reset if restarted
          const separator = (this.lastCleanedText.length > 0 && !this.lastCleanedText.endsWith(' ') && !remainingTextToSend.startsWith(' ')) ? " " : "";
          this.lastCleanedText += separator + remainingTextToSend;
        }
      }
    }
    // Optionally, fully reset state here if desired after stopping,
    // or let startMonitoring handle resets when it's called next.
    // For now, startMonitoring handles the necessary resets.
  }


  debounceAndProcess() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processStreamUpdate();
    }, 250);
  }

  findCompleteParagraph(text) { /* ... (as before) ... */
    const paragraphBreak = text.match(/^(.*?\.)\s+(?=[A-Z]|$)/s);

    if (paragraphBreak && paragraphBreak[0].trim().length > 20) {
      return {
        found: true,
        text: paragraphBreak[0].trim(),
        endPosition: paragraphBreak[0].length
      };
    }

    if (text.length > 100) {
      const sentenceMatch = this.findCompleteSentence(text);
      if (sentenceMatch.found) {
        return sentenceMatch;
      }

      const punctuationBreak = text.match(/^.{60,}?[.!?:;]\s+/s);
      if (punctuationBreak) {
        return {
          found: true,
          text: punctuationBreak[0].trim(),
          endPosition: punctuationBreak[0].length
        };
      }
    }

    if (text.length > 300) {
      const forcedBreak = text.substring(0, 250).match(/^.{200,250}[\s,.!?:;]/);
      if (forcedBreak) {
        return {
          found: true,
          text: forcedBreak[0].trim(),
          endPosition: forcedBreak[0].length
        };
      }

      return {
        found: true,
        text: text.substring(0, 250).trim(),
        endPosition: 250
      };
    }
    return { found: false };
  }
  findNextBoundary(text, startPosition) { /* ... (as before) ... */
    const textToCheck = text.substring(startPosition);
    const boundaries = [
      {
        name: 'code_block',
        pattern: /```/,
        handler: (match, fullText, absMatchStart) => {
          const restOfText = fullText.substring(absMatchStart + 3);
          const closingIndex = restOfText.indexOf('```');
          if (closingIndex !== -1) {
            const closingPos = absMatchStart + 3 + closingIndex + 3;
            const codeContent = fullText.substring(absMatchStart, closingPos);
            console.log(`🚧 CODE BLOCK found from ${absMatchStart} to ${closingPos}, length: ${codeContent.length}`);
            console.log(`🚧 Code content: "${codeContent.substring(0, Math.min(40, codeContent.length))}..."`);
            return { position: absMatchStart, endPosition: closingPos, type: 'code_block', content: codeContent };
          }
          console.log(`⚠️ Unclosed code block found at ${absMatchStart}, skipping to end`);
          return { position: absMatchStart, endPosition: fullText.length, type: 'code_block_unclosed' };
        }
      },
      {
        name: 'thinking_section',
        pattern: /<thinking>/i,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /<\/thinking>/i.exec(fullText.substring(absMatchStart));
          if (closingMatch) {
            return { position: absMatchStart, endPosition: absMatchStart + closingMatch.index + closingMatch[0].length, type: 'thinking_section' };
          }
          return { position: absMatchStart, endPosition: fullText.length, type: 'thinking_section_unclosed' };
        }
      },
      {
        name: 'function_calls',
        pattern: /<function_calls>/i,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /<\/antml:function_calls>/i.exec(fullText.substring(absMatchStart));
          if (closingMatch) {
            return { position: absMatchStart, endPosition: absMatchStart + closingMatch.index + closingMatch[0].length, type: 'function_calls_artifact' };
          }
          return { position: absMatchStart, endPosition: fullText.length, type: 'function_calls_artifact_unclosed' };
        }
      },
      {
        name: 'function_results',
        pattern: /<function_results>/i,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /<\/function_results>/i.exec(fullText.substring(absMatchStart));
          if (closingMatch) {
            return { position: absMatchStart, endPosition: absMatchStart + closingMatch.index + closingMatch[0].length, type: 'function_results' };
          }
          return { position: absMatchStart, endPosition: fullText.length, type: 'function_results_unclosed' };
        }
      },
      {
        name: 'citation',
        pattern: /]*>/i,
        handler: (match, fullText, absMatchStart) => {
          const closingMatch = /<\/antml:cite>/i.exec(fullText.substring(absMatchStart));
          if (closingMatch) {
            return { position: absMatchStart, endPosition: absMatchStart + closingMatch.index + closingMatch[0].length, type: 'citation' };
          }
          return { position: absMatchStart, endPosition: fullText.length, type: 'citation_unclosed' };
        }
      },
      {
        name: 'multiline_inline_code',
        pattern: /`[^`\n]+\n[^`]*`/,
        handler: (match, fullText, absMatchStart) => {
          return { position: absMatchStart, endPosition: absMatchStart + match[0].length, type: 'multiline_inline_code' };
        }
      },
      {
        name: 'artifact_block',
        pattern: /\[artifact[^\]]*\]/i,
        handler: (match, fullText, absMatchStart) => {
          return { position: absMatchStart, endPosition: absMatchStart + match[0].length, type: 'artifact_block' };
        }
      },
      {
        name: 'html_tag',
        pattern: /<[a-z][a-z0-9]*(?:\s+[^>]*)?>/i,
        handler: (match, fullText, absMatchStart) => {
          const tagMatch = match[0].match(/<([a-z][a-z0-9]*)/i);
          if (!tagMatch) {
            return { position: absMatchStart, endPosition: absMatchStart + match[0].length, type: 'html_tag_unknown' };
          }
          const tagName = tagMatch[1];
          const closingTagPattern = new RegExp(`<\\/${tagName}>`, 'i');
          const closingMatch = closingTagPattern.exec(fullText.substring(absMatchStart + match[0].length));
          if (closingMatch) {
            const closingPos = absMatchStart + match[0].length + closingMatch.index + closingMatch[0].length;
            return { position: absMatchStart, endPosition: closingPos, type: 'html_tag_' + tagName.toLowerCase() };
          }
          return { position: absMatchStart, endPosition: absMatchStart + match[0].length, type: 'html_tag_unclosed_' + tagName.toLowerCase() };
        }
      }
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
  shouldSendPureText(text) { /* ... (as before) ... */
    if (!text || text.trim().length === 0) return false;

    const sentences = this.findAllSentences(text);

    if (sentences.length === 1 && sentences[0].length > 100) {
      // console.log("🎤 Pure text rule: Single long sentence detected.");
      return true;
    }

    if (sentences.length >= 2) {
      // console.log("🎤 Pure text rule: Two or more sentences detected.");
      return true;
    }
    return false;
  }
  findAllSentences(text) { /* ... (as before) ... */
    const sentences = [];
    if (!text || text.trim().length === 0) return sentences;

    const parts = text.split(/([.!?])\s+/);
    let currentSentence = "";
    const abbreviations = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Sr.', 'Jr.', 'St.', 'Co.', 'Inc.', 'Ltd.', 'vs.', 'i.e.', 'e.g.', 'etc.'];

    for (let i = 0; i < parts.length; i++) {
        currentSentence += parts[i];
        if (i + 1 < parts.length && /[.!?]/.test(parts[i+1])) { 
            const potentialAbbreviation = currentSentence.split(/\s+/).pop() + parts[i+1];
            if (!abbreviations.some(abbr => potentialAbbreviation.startsWith(abbr))) {
                currentSentence += parts[i+1]; 
                if (currentSentence.trim().length > 0) {
                    sentences.push(currentSentence.trim());
                }
                currentSentence = "";
                i++; 
            } else {
                 currentSentence += parts[i+1]; 
                 i++; 
            }
        }
    }
    if (currentSentence.trim().length > 0) {
        sentences.push(currentSentence.trim());
    }
    return sentences;
  }
  findCompleteSentence(text) { /* ... (as before) ... */
    const sentences = this.findAllSentences(text);
    if (sentences.length > 0 && sentences[0].length > 10) {
        const firstSentence = sentences[0];
        const endPosition = text.indexOf(firstSentence) + firstSentence.length;
        return { found: true, text: firstSentence, endPosition: endPosition };
    }
    return { found: false };
  }
  findTwoSentences(text) { /* ... (as before) ... */
    const sentences = this.findAllSentences(text);
    return sentences.length >= 2;
  }

  getResponseBaseId(element) {
    if (!element) return null;
    
    // Find the streaming container (more stable during streaming)
    const streamingContainer = element.closest('[data-is-streaming]') || element;
    
    getResponseBaseId(element) {
      if (!element) return null;
      
      // Find the streaming container
      const streamingContainer = element.closest('[data-is-streaming]') || element;
      
      // Use a stable identifier - check for existing ID first
      if (streamingContainer.dataset.ttsId) {
        return streamingContainer.dataset.ttsId;
      }
      
      // Create and store a stable ID on first encounter
      const stableId = `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      streamingContainer.dataset.ttsId = stableId;
      return stableId;
    }
    
    if (position !== -1) {
      return `resp-${position}`;
    }
    
    // Fallback: use a hash of the container's initial structure, not text content
    const containerSignature = streamingContainer.className || 'unknown';
    const hash = this.simpleHash(containerSignature);
    return `resp-fallback-${hash}`;
  }


  async processStreamUpdate() {
    if (!this.conversationMode) {
      if (this.processingLock) this.processingLock = false;
      return;
    }

    if (this.processingLock) return;
    this.processingLock = true;

    try {
      const newResponseDomElement = this.findClaudeResponse();
      if (!newResponseDomElement) {
        // console.log("No response element found in processStreamUpdate.");
        this.processingLock = false;
        return;
      }

      const newElementBaseId = this.getResponseBaseId(newResponseDomElement);
      const previousElementBaseId = this.currentResponseElement ? this.getResponseBaseId(this.currentResponseElement) : null;

      if (newElementBaseId !== previousElementBaseId) {
        console.log(`🔄 NEW LOGICAL RESPONSE DETECTED (Prev base: ${previousElementBaseId || 'N/A'}, New base: ${newElementBaseId})`);
        if (this.currentResponseElement) {
          console.log("✅ Sending final chunk for previous logical response before switching.");
          this.sendFinalChunk();
        }
        this.currentResponseElement = newResponseDomElement;
        this.currentResponseText = "";
        this.lastSentLength = 0;
        this.chunkCounterForElement = 0;
        this.processedChunks.clear();
        this.lastProcessedText = "";
        this.lastCleanedText = "";
        console.log("🔄 Switched to new logical response element. State fully reset.");
      } else if (newResponseDomElement !== this.currentResponseElement) {
        console.log(`🔄 DOM element reference updated for current logical response (Base ID: ${newElementBaseId}). Preserving context.`);
        this.currentResponseElement = newResponseDomElement;
      }

      const currentFullTextFromDOM = this.currentResponseElement.textContent || "";

      if (currentFullTextFromDOM === this.currentResponseText && this.lastProcessedText === this.currentResponseText && this.lastCleanedText === this.lastProcessedText) {
        // console.log("🚫 DOM content unchanged and fully processed/cleaned.");
        this.processingLock = false;
        return;
      }
      
      this.currentResponseText = currentFullTextFromDOM;
      
      // console.log(`📝 Processing currentFullTextFromDOM: "${this.currentResponseText.substring(0,50)}..."`);
      // console.log(`📝 lastCleanedText: "${this.lastCleanedText.substring(0,50)}...", lastProcessedText: "${this.lastProcessedText.substring(0,50)}..."`);

      const codeBlocksAndArtifacts = []; // ... (artifact removal as before)
      const hasCodeBlockInText = /```/.test(this.currentResponseText);
      const preElements = this.currentResponseElement.querySelectorAll('pre');
      for (const preEl of preElements) {
        codeBlocksAndArtifacts.push({ element: preEl, text: preEl.textContent, type: 'code_block' });
      }
      const artifactSelectors = [
        '.artifact-block-cell', '[data-artifact-title]', 'button.flex.text-left.font-styrene',
        '[aria-label="Preview contents"]', 'div[class*="transition-all duration"]', 'div.font-tiempos'
      ];
      for (const selector of artifactSelectors) {
        const artifactElements = this.currentResponseElement.querySelectorAll(selector);
        for (const artifactEl of artifactElements) {
          codeBlocksAndArtifacts.push({ element: artifactEl, text: artifactEl.textContent, type: 'artifact' });
        }
      }

      let textToProcess = this.currentResponseText; // Start with raw DOM text for this cycle
      for (const item of codeBlocksAndArtifacts) {
        const itemText = item.text;
        if (itemText && textToProcess.includes(itemText)) {
          textToProcess = textToProcess.replace(itemText, "\n\n"); // Replace with paragraph breaks
        }
      }
      textToProcess = textToProcess.replace(/\n\s*\n/g, '§PARAGRAPH§')
        .replace(/\s+/g, ' ')
        .replace(/§PARAGRAPH§/g, '\n\n')
        .trim();
      textToProcess = textToProcess.replace(/(Analyzing|Thinking|Parsing|Considering|Evaluating|Pondering)[^.]*\./gi, '').trim();
      textToProcess = textToProcess.replace(/You're absolutely right/g, "You're right");
      textToProcess = textToProcess.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
      
      // console.log(`DEBUG - textToProcess (cleaned current full DOM): "${textToProcess.substring(0, 50)}..."`);

      if (textToProcess.length === 0) {
        // console.log("🚫 No text content after removing code blocks and cleaning.");
        this.lastProcessedText = textToProcess; 
        this.processingLock = false;
        return;
      }

      if (textToProcess === this.lastProcessedText) {
        // console.log("🚫 Current cleaned DOM (textToProcess) is identical to last fully processed cleaned text - skipping.");
        this.processingLock = false;
        return;
      }

      let newText = "";
      if (this.lastCleanedText && textToProcess.startsWith(this.lastCleanedText)) {
          newText = textToProcess.substring(this.lastCleanedText.length).trim();
          // if (newText.length > 0) console.log(`🔍 Text extended. New part: "${newText.substring(0, 40)}..."`);
      } else {
          newText = textToProcess; // Process the whole thing as new relative to what's been cleaned and sent
          if (this.lastCleanedText) { // Only log divergence if there was prior cleaned text for this logical response
              console.log(`🆕 Text diverged or is new relative to lastCleanedText. Full new content: "${newText.substring(0,40)}..." (Old lastCleanedText: "${this.lastCleanedText.substring(0,40)}...")`);
              // If text diverges, we treat `textToProcess` as the new baseline.
              // `lastCleanedText` should effectively be considered "reset" for accumulation *from this point*.
              // We will send `newText` (which is `textToProcess`) and then `lastCleanedText` will become this `newText`.
              this.lastCleanedText = ""; // Clear to signify accumulation restarts with newText
          } else {
              // console.log(`🆕 Text is new (no prior lastCleanedText for this logical response). Processing as new: "${newText.substring(0,40)}..."`);
          }
      }
      
       if (newText.length === 0) {
            // console.log("🚫 No new text to send after comparison with lastCleanedText.");
            this.lastProcessedText = textToProcess; // Update lastProcessedText to current state
            this.processingLock = false;
            return;
        }

      const isStreaming = this.isClaudeTyping(this.currentResponseElement);
      const isAtCodeBlockBoundary = codeBlocksAndArtifacts.length > 0 || hasCodeBlockInText;
      // console.log("🤔 Sending decision - Block boundary:", isAtCodeBlockBoundary, "New Text length:", newText.length, "Is Streaming:", isStreaming);

      if (newText.length > 0) {
        let textToSend = "";
        let sendComplete = !isStreaming; 
        let paragraphBreakMatch = null; 

        if (isStreaming) { /* ... (chunking logic as before, operating on newText) ... */
          paragraphBreakMatch = newText.match(/^(.+?\n\n)/); 
          const shouldSendPure = this.shouldSendPureText(newText);

          if (isAtCodeBlockBoundary && newText.trim().length > 0 && this.lastCleanedText.length === 0) {
            textToSend = newText.trim(); 
            sendComplete = false; 
            console.log("🎤 Sending initial part due to code block boundary.");
          } else if (paragraphBreakMatch) {
            const paragraphText = paragraphBreakMatch[1].trim();
            if (paragraphText.length > 20) { 
              textToSend = paragraphText;
              sendComplete = false;
              console.log("🎤 Sending paragraph chunk.");
            }
          } else if (shouldSendPure) {
            const sentences = this.findAllSentences(newText);
            if (sentences.length === 1 && sentences[0].length > 100) textToSend = sentences[0];
            else if (sentences.length >=2) textToSend = sentences[0] + " " + sentences[1]; 
            if (textToSend.length > 0) {
                sendComplete = false; 
                console.log("🎤 Sending based on pure text rules (sentence detection).");
            }
          } else if (newText.length > 300) { 
            const sentenceMatch = this.findCompleteSentence(newText);
            if (sentenceMatch.found && sentenceMatch.text.length > 50) {
              textToSend = sentenceMatch.text;
              sendComplete = false;
              console.log("🎤 Sending long text sentence chunk.");
            }
          }
          else if (newText.trim().length > 150 && !sendComplete) {
              textToSend = newText.trim();
              sendComplete = false;
              console.log("🎤 Sending substantial new text chunk (no specific boundary).");
          }
        } else { 
          textToSend = newText.trim(); 
          sendComplete = true;
          console.log("🎤 Sending final chunk as Claude is not typing (or full message if never streamed).");
        }

        if (textToSend.length > 0) {
          const fullChunkId = this.generateResponseId(this.currentResponseElement); // resp-pos-hash
          const chunkTypeSuffix = sendComplete ? "final" : (isAtCodeBlockBoundary && (this.lastCleanedText === "" || this.lastCleanedText.length === 0) ? "block" : (paragraphBreakMatch ? "para" : "sent"));
          const responseId = `${fullChunkId}-${chunkTypeSuffix}-${this.chunkCounterForElement++}`;
          
          await this.sendStreamChunk(textToSend, sendComplete, responseId);
          
          const separator = (this.lastCleanedText.length > 0 && !this.lastCleanedText.endsWith(' ') && !textToSend.startsWith(' ')) ? " " : "";
          this.lastCleanedText += separator + textToSend;
          this.processedChunks.set(this.simpleHash(textToSend), true);
        }
      }
      
      this.lastProcessedText = textToProcess; 

      if (!isStreaming && textToProcess !== this.lastCleanedText) {
        const remainingUnsentCleanedText = textToProcess.substring(this.lastCleanedText.length).trim();
        if (remainingUnsentCleanedText.length > 0) {
            console.log(`🤔 Streaming stopped. Sending final remaining unsent cleaned text: "${remainingUnsentCleanedText.substring(0,50)}..."`);
            const fullChunkId = this.generateResponseId(this.currentResponseElement);
            const responseId = `${fullChunkId}-final-rem-${this.chunkCounterForElement++}`;
            await this.sendStreamChunk(remainingUnsentCleanedText, true, responseId);
            const separator = (this.lastCleanedText.length > 0 && !this.lastCleanedText.endsWith(' ') && !remainingUnsentCleanedText.startsWith(' ')) ? " " : "";
            this.lastCleanedText += separator + remainingUnsentCleanedText;
            this.lastProcessedText = textToProcess; 
        }
      }
       if (!isStreaming) {
          this.lastProcessedText = textToProcess;
          if (this.lastCleanedText !== textToProcess) {
            //   console.warn("⚠️ Post-streaming: lastCleanedText and final textToProcess differ.");
          }
      }

    } catch (error) {
      console.error("❌ Process error in processStreamUpdate:", error, error.stack);
    } finally {
      this.processingLock = false;
    }
  }

  calculateSimilarity(str1, str2) { /* ... (as before) ... */
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;

    let matchCount = 0;
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);

    for (const word of words1) {
      if (words2.includes(word)) matchCount++;
    }

    if (words1.length === 0) return 0;
    return matchCount / words1.length;
  }
  extractText(element) { /* ... (as before) ... */
    return (element && typeof element.textContent === 'string') ? element.textContent.trim() : null;
  }
  getResponseTimestamp(element) {  /* ... (as before) ... */
    if (!element) return Date.now();
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    const index = Array.from(allResponses).indexOf(element);
    return (this.conversationModeStartTime || Date.now()) + (index !== -1 ? index : allResponses.length);
  }
  isClaudeTyping(responseElement) { /* ... (as before) ... */
    if (!responseElement) return false;
    if (responseElement.getAttribute('data-is-streaming') === 'true') return true;
    if (responseElement.closest('[data-is-streaming="true"]')) return true;

    const typingSelectors = [
      '.typing-indicator', '.claude-typing-indicator', '.animate-pulse',
      '[class*="cursor"]', '.blinking-cursor', '[class*="streaming"]', '[class*="generating"]'
    ];

    for (const selector of typingSelectors) {
      if (responseElement.querySelector(selector) || responseElement.closest(selector)) return true;
    }

    const sendButton = document.querySelector('button[type="submit"]:disabled, button[aria-label*="Send"]:disabled, button[aria-label*="send"]:disabled');
    if (sendButton) return true;

    return false;
  }

  generateResponseId(element) { // This generates the full ID for a chunk, like resp-pos-hash
    if (!element) return `unknown-${Date.now()}`;
    const assistantMessageElement = element.closest('[data-message-author-role="assistant"]') || element;
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    const position = Array.from(allResponses).indexOf(assistantMessageElement);
    const contentHash = this.simpleHash((element.textContent || "").substring(0, 100)); 
    return `resp-${position}-${contentHash}`;
  }

  simpleHash(str) {  /* ... (as before) ... */
    if (!str) return '0'; 
    let hash = 0; 
    for (let i = 0; i < str.length; i++) { 
      const char = str.charCodeAt(i); 
      hash = ((hash << 5) - hash) + char; 
      hash = hash & hash; // Ensure 32bit integer
    } 
    return Math.abs(hash).toString(); 
  }
  async sendStreamChunk(text, isComplete, responseId, retryAttempt = 0, isRetryOfFailed = false) { /* ... (as before) ... */
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
        console.log(`🔌 Connection error, retrying in ${(retryAttempt + 1) * 1000}ms... (attempt ${retryAttempt + 1})`);
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
  async sendToServer(endpoint, data) { /* ... (as before) ... */
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
        console.error(`❌ Server response not JSON for ${endpoint}: ${response.status}`, textResponse.substring(0, 500));
        this.serverHealthy = false;
        return { success: false, error: `Server returned non-JSON response (status ${response.status})` };
      }

      if (!response.ok) {
        console.error(`❌ Server error: ${endpoint} (Status: ${response.status})`, result.error || result);
        if (response.status >= 500) this.serverHealthy = false;
        return { success: false, error: result.error || `Server error status ${response.status}`, ...result };
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
  async sendManualTTS(text) { /* ... (as before) ... */
    console.log(`📤 Manual TTS: ${text.substring(0, 50)}...`);
    const responseId = `manual-${this.simpleHash(text.substring(0, 50))}-${Date.now()}`;
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
    window.ttsPanel = this; // Make it accessible for loadSettings
  }

  createPanel() { /* ... (as before) ... */
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
    previewArea.appendChild(previewLabel);
    previewArea.appendChild(previewText);
    panel.appendChild(previewArea);
    document.body.appendChild(panel);
    this.updateStatusDisplay();
  }

  addConversationModeToggle(panel) {
    const toggleContainer = document.createElement('div');
    toggleContainer.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        background-color: #2A2A2A; padding: 10px; border-radius: 8px;
    `;

    const label = document.createElement('label');
    label.textContent = 'Conversation Mode:';
    label.style.cssText = `font-size: 14px; color: #D4A574; font-weight: 500;`;

    const toggleSwitch = document.createElement('div');
    this.toggleSwitchElement = toggleSwitch; // Store for updateToggleVisuals
    toggleSwitch.style.cssText = `
        width: 44px; height: 24px; background-color: #555; border-radius: 12px;
        position: relative; cursor: pointer; transition: background-color 0.3s;
    `;
    const toggleKnob = document.createElement('div');
    this.toggleKnobElement = toggleKnob; // Store for updateToggleVisuals
    toggleKnob.style.cssText = `
        width: 20px; height: 20px; background-color: white; border-radius: 50%;
        position: absolute; top: 2px; left: 2px; transition: transform 0.3s;
    `;
    toggleSwitch.appendChild(toggleKnob);
    
    this.updateToggleVisuals(this.monitor.conversationMode); // Initial visual state

    toggleSwitch.onclick = () => {
        const newMode = !this.monitor.conversationMode;
        chrome.storage.local.set({ conversationMode: newMode }, () => {
            // Ensure monitor's state is updated AFTER storage commits, then act.
            this.monitor.conversationMode = newMode; 
            this.updateToggleVisuals(newMode);
            this.updateStatusDisplay();

            if (newMode) { // Enabling
                if (!this.monitor.isMonitoring) {
                    this.monitor.startMonitoring();
                }
            } else { // Disabling
                if (this.monitor.isMonitoring) {
                    this.monitor.stopMonitoringAndFinalize();
                }
            }
        });
    };

    toggleContainer.appendChild(label);
    toggleContainer.appendChild(toggleSwitch);
    panel.appendChild(toggleContainer);
  }

  updateToggleVisuals(isActive) {
    if (this.toggleSwitchElement && this.toggleKnobElement) {
        if (isActive) {
            this.toggleSwitchElement.style.backgroundColor = '#D4A574'; 
            this.toggleKnobElement.style.transform = 'translateX(20px)';
        } else {
            this.toggleSwitchElement.style.backgroundColor = '#555'; 
            this.toggleKnobElement.style.transform = 'translateX(0px)';
        }
    }
  }


  detectAndDisplay() {
    this.monitor.resetForNewResponse(); 
    const responseElement = this.monitor.findClaudeResponse();
    const textPreview = document.getElementById('text-preview');

    if (responseElement) {
        this.currentText = responseElement.textContent || ""; 
        textPreview.textContent = this.currentText.substring(0, 500) + (this.currentText.length > 500 ? "..." : "");
        document.getElementById('status').textContent = 'Response detected.';
        this.monitor.currentResponseElement = responseElement; 
        this.monitor.processStreamUpdate(); 
    } else {
        textPreview.textContent = 'No Claude response found.';
        document.getElementById('status').textContent = 'No response found.';
        this.currentText = "";
    }
  }

  updateStatusDisplay() { /* ... (as before) ... */
    const statusDiv = document.getElementById('status');
    const lockDiv = document.getElementById('processing-lock');
    const serverStatusDiv = document.getElementById('server-status');

    if (!statusDiv || !lockDiv || !serverStatusDiv) return;

    statusDiv.textContent = this.monitor.conversationMode ? '🎤 Streaming Active' : '🎧 Streaming Paused';
    statusDiv.style.color = this.monitor.conversationMode ? '#86E0A2' : '#D4A574';

    lockDiv.style.display = this.monitor.processingLock ? 'block' : 'none';
    lockDiv.textContent = this.monitor.processingLock ? '⚙️ Processing...' : '';

    serverStatusDiv.textContent = this.monitor.serverHealthy ? '✅ Server OK' : '❌ Server Issue';
    serverStatusDiv.style.color = this.monitor.serverHealthy ? '#86E0A2' : '#E07A7A';
  }

  initPeriodicUpdates() {
    setInterval(() => {
        this.updateStatusDisplay();
    }, 1000);
  }
}

// Global instantiation
if (typeof claudeStreamMonitor === 'undefined' || !claudeStreamMonitor) {
  var claudeStreamMonitor = new ClaudeStreamMonitor(); // Constructor now calls loadSettings
  var ttsPanel = new TTSControlPanel(claudeStreamMonitor); // Panel created, constructor calls its updateToggleVisuals
  ttsPanel.initPeriodicUpdates();
}
