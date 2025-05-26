// Smart Streaming Content Script for Claude - Version 3.5 - Enhanced with Config Integration
console.log("🚀 Smart Streaming Claude TTS loaded - Version 3.5 (Config Integrated)");

// Load configuration from extension config
const CONFIG = window.CLAUDE_TTS_CONFIG || {
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
    healthCheckIntervalMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 750,
    chunkMinLength: 5
  },
  ui: {
    quiet_mode: true,
    panelPosition: "bottom-right",
    enablePreview: true,
    previewMaxLength: 500
  }
};

const QUIET_MODE = CONFIG.ui.quiet_mode;

// Helper function to build server URLs
const getServerUrl = (endpoint = '') => {
  return `http://${CONFIG.server.host}:${CONFIG.server.port}${endpoint}`;
};

console.log("📋 Loaded config:", CONFIG);

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
    this.currentResponseText = ""; // Mirrors currentResponseElement.textContent, but cleaned
    this.lastSentLength = 0; // How much of currentResponseText has been processed (sent or skipped)
    this.chunkCounterForElement = 0; // Sequence number for chunks of currentResponseElement
    this.lastProcessedText = ""; // The exact textToProcess from the last successful processing run
    this.isRetrying = false;
    this.serverHealthy = true;
    this.failedRequests = []; // Stores requests that failed due to server/network issues
    this.lastCleanedText = ""; // The last text sent to TTS OR the full text if it was a final chunk
    this.loadSettings();
    this.resetServerOnPageLoad();
    this.startHealthCheck();
  }

  async startHealthCheck() {
    try {
      const result = await fetch(getServerUrl(CONFIG.server.endpoints.health), {
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
    setTimeout(() => this.startHealthCheck(), CONFIG.streaming.healthCheckIntervalMs);
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
    this.lastProcessedText = "";
    this.lastCleanedText = "";
  }

  sendFinalChunk() {
    if (this.currentResponseElement && this.currentResponseText.length > 0 &&
      this.lastSentLength < this.currentResponseText.length) {

      const remainingFullText = this.currentResponseText.substring(this.lastSentLength);
      let textToActuallySend = "";
      let currentInternalPos = 0;

      while (currentInternalPos < remainingFullText.length) {
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
        this.lastCleanedText = this.currentResponseText; // Update lastCleanedText with the full text
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
        const result = await this.sendToServer(CONFIG.server.endpoints.reset, {
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

      const existingResponse = this.findClaudeResponse();
      if (existingResponse) {
        console.log("🔍 Found existing response, processing...");
        this.processStreamUpdate();
      } else {
        console.log("📝 No existing response found - observer ready for new content");
      }
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
    }, CONFIG.streaming.debounceMs);
  }

  findCompleteParagraph(text) {
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

  findNextBoundary(text, startPosition) {
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

  shouldSendPureText(text) {
    if (!text || text.trim().length === 0) return false;

    const sentences = this.findAllSentences(text);

    if (sentences.length === 1 && sentences[0].length > 100) {
      console.log("🎤 Pure text rule: Single long sentence detected.");
      return true;
    }

    if (sentences.length >= 2) {
      console.log("🎤 Pure text rule: Two or more sentences detected.");
      return true;
    }
    return false;
  }

  findAllSentences(text) {
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

  findCompleteSentence(text) {
    const sentences = this.findAllSentences(text);
    if (sentences.length > 0 && sentences[0].length > 10) {
        const firstSentence = sentences[0];
        const endPosition = text.indexOf(firstSentence) + firstSentence.length;
        return { found: true, text: firstSentence, endPosition: endPosition };
    }
    return { found: false };
  }

  findTwoSentences(text) {
    const sentences = this.findAllSentences(text);
    return sentences.length >= 2;
  }

  // Fix the core issue: response element detection during streaming
    async processStreamUpdate() {
      if (!this.conversationMode) {
        if (this.processingLock) this.processingLock = false;
        return;
      }

      if (this.processingLock) return;
      this.processingLock = true;

      try {
        const responseElement = this.findClaudeResponse();
        if (!responseElement) {
          this.processingLock = false;
          return;
        }

        const currentId = this.generateResponseId(responseElement);

        // CRITICAL FIX: Don't reset state for same logical response
        if (responseElement !== this.currentResponseElement) {
          const prevId = this.currentResponseElement ?
            this.generateResponseId(this.currentResponseElement) : null;

          // Only reset if this is truly a NEW response (different base ID)
          const currentBaseId = currentId.substring(0, currentId.lastIndexOf('-'));
          const prevBaseId = prevId ? prevId.substring(0, prevId.lastIndexOf('-')) : null;

          if (prevBaseId && currentBaseId === prevBaseId) {
            console.log(`🔄 DOM element updated but same logical response (${currentId})`);
            this.currentResponseElement = responseElement; // Update element reference
            // DON'T reset state - continue with current context
          } else {
            console.log("🔄 NEW LOGICAL RESPONSE DETECTED");
            if (this.currentResponseElement) {
              console.log("✅ Sending final chunk for previous response element");
              this.sendFinalChunk();
            }
            // Reset for truly new response
            this.currentResponseElement = responseElement;
            this.currentResponseText = "";
            this.lastSentLength = 0;
            this.chunkCounterForElement = 0;
            this.processedChunks.clear();
            this.lastProcessedText = "";
            this.lastCleanedText = "";
            console.log("🔄 Switched to new response element. State reset for new element.");
          }
        }

        const currentFullText = responseElement.textContent || "";
        console.log(`📝 Processing response element: ${currentId}`);

        // FIXED: Better artifact detection using Claude's actual selectors
        const codeBlocksAndArtifacts = [];
        const hasCodeBlockInText = /```/.test(currentFullText);

        // Check for Claude's actual artifact containers
        const preElements = responseElement.querySelectorAll('pre');
        const codeBlockElements = responseElement.querySelectorAll('.code-block__code');
        const languageCodeElements = responseElement.querySelectorAll('code[class*="language-"]');

        // Collect all artifact elements
        for (const preEl of preElements) {
          codeBlocksAndArtifacts.push({
            element: preEl,
            text: preEl.textContent,
            type: 'pre_block'
          });
        }

        for (const codeEl of codeBlockElements) {
          codeBlocksAndArtifacts.push({
            element: codeEl,
            text: codeEl.textContent,
            type: 'code_block'
          });
        }

        for (const langEl of languageCodeElements) {
          codeBlocksAndArtifacts.push({
            element: langEl,
            text: langEl.textContent,
            type: 'language_code'
          });
        }

        const isAtCodeBlockBoundary = codeBlocksAndArtifacts.length > 0 || hasCodeBlockInText;
        console.log("🔍 isAtCodeBlockBoundary:", isAtCodeBlockBoundary);
        if (codeBlocksAndArtifacts.length > 0) {
          console.log(`🎯 Found ${codeBlocksAndArtifacts.length} artifact elements`);
        }

        // FIXED: Properly clean content by removing all artifact text
        let textToProcess = currentFullText;
        for (const item of codeBlocksAndArtifacts) {
          const itemText = item.text;
          if (itemText && textToProcess.includes(itemText)) {
            textToProcess = textToProcess.replace(itemText, " ");
            console.log(`🗑️ Removed ${item.type}: ${itemText.substring(0, 50)}...`);
          }
        }

        // Additional cleanup for any remaining code blocks in text
        textToProcess = textToProcess.replace(/```[\s\S]*?```/g, " ");

        // Clean up whitespace (keep your existing normalization)
        textToProcess = textToProcess.replace(/\n\s*\n/g, '§PARAGRAPH§')
          .replace(/\s+/g, ' ')
          .replace(/§PARAGRAPH§/g, '\n\n')
          .trim();

        console.log(`🧹 Content cleaned: ${currentFullText.length} → ${textToProcess.length} chars`);
        console.log(`📤 Clean text: "${textToProcess.substring(0, 100)}..."`);

        // Continue with your existing logic...
        if (textToProcess === this.lastProcessedText) {
          console.log("🚫 Already processed this exact cleaned text - skipping");
          this.currentResponseText = currentFullText;
          this.processingLock = false;
          return;
        }

        let newText = "";
        if (this.lastCleanedText && textToProcess.startsWith(this.lastCleanedText)) {
          newText = textToProcess.substring(this.lastCleanedText.length).trim();
          console.log(`🔍 Text extended. New part: "${newText.substring(0, 40)}..."`);
        } else {
          newText = textToProcess;
          this.lastCleanedText = "";
          console.log(`🆕 Text is new or significantly changed. Processing as new: "${newText.substring(0, 40)}..."`);
        }

        if (newText.length === 0) {
          console.log("🚫 No new text to send after comparison.");
          this.lastProcessedText = textToProcess;
          this.currentResponseText = currentFullText;
          this.processingLock = false;
          return;
        }

        const isStreaming = this.isClaudeTyping(responseElement);
        console.log("🤔 Sending decision - Block boundary:", isAtCodeBlockBoundary, "Text length:", newText.length, "Is Streaming:", isStreaming);

        if (newText.length > 0) {
          let textToSend = "";
          let sendComplete = !isStreaming;

          if (isStreaming) {
            if (isAtCodeBlockBoundary && newText.trim().length > 0) {
              textToSend = newText.trim();
              sendComplete = false;
              console.log("🎤 Sending due to code block boundary.");
            } else if (this.shouldSendPureText(newText)) {
              const sentences = this.findAllSentences(newText);
              if (sentences.length >= 2) textToSend = sentences[0] + " " + sentences[1];
              else textToSend = newText;
              sendComplete = false;
              console.log("🎤 Sending based on pure text rules (sentence detection).");
            }
          } else {
            textToSend = newText.trim();
            sendComplete = true;
            console.log("🎤 Sending final chunk as Claude is not typing.");
          }

          if (textToSend.length > 0) {
            const baseId = this.generateResponseId(this.currentResponseElement);
            const chunkType = sendComplete ? "final" : (isAtCodeBlockBoundary ? "block" : "sent");
            const responseId = `${baseId}-${chunkType}-${this.chunkCounterForElement++}`;

            await this.sendStreamChunk(textToSend, sendComplete, responseId);
            console.log("✅ Successfully sent chunk, updating state");

            this.lastCleanedText = textToProcess;
            this.processedChunks.set(this.simpleHash(textToSend), true);
          }
        }

        this.currentResponseText = currentFullText;
        this.lastProcessedText = textToProcess;

      } catch (error) {
        console.error("❌ Process error in processStreamUpdate:", error);
      } finally {
        this.processingLock = false;
      }
    }

    generateResponseId(element) {
      if (!element) return `unknown-${Date.now()}`;
      
      const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
      const position = Array.from(allResponses).indexOf(element.closest('[data-message-author-role="assistant"]') || element);
      const contentHash = this.simpleHash((element.textContent || "").substring(0, 100));
      
      const baseId = `resp-${position}-${contentHash}`;
      return baseId;
    }
    
  calculateSimilarity(str1, str2) {
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

  extractText(element) {
    return (element && typeof element.textContent === 'string') ? element.textContent.trim() : null;
  }

  getResponseTimestamp(element) { // This function might be less relevant with the new ID but kept for now
    if (!element) return Date.now();
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    const index = Array.from(allResponses).indexOf(element);
    return (this.conversationModeStartTime || Date.now()) + (index !== -1 ? index : allResponses.length);
  }

  isClaudeTyping(responseElement) {
      if (!responseElement) return false;
      
      // Check explicit streaming attributes first
      if (responseElement.getAttribute('data-is-streaming') === 'true') return true;
      if (responseElement.closest('[data-is-streaming="true"]')) return true;
      
      // CRITICAL FIX: Force streaming mode when code blocks are detected
      // This ensures code blocks behave like artifacts with real-time streaming
      const hasCodeBlocks = responseElement.querySelector('pre') || /```/.test(responseElement.textContent);
      if (hasCodeBlocks) {
        console.log("🔧 Code block detected - forcing streaming mode for boundary detection");
        return true;  // Force streaming mode for code blocks
      }

      // Check for typing indicators
      const typingSelectors = [
        '.typing-indicator', '.claude-typing-indicator', '.animate-pulse',
        '[class*="cursor"]', '.blinking-cursor', '[class*="streaming"]', '[class*="generating"]'
      ];

      for (const selector of typingSelectors) {
        if (responseElement.querySelector(selector) || responseElement.closest(selector)) return true;
      }

      // Check if send button is disabled (Claude is typing)
      const sendButton = document.querySelector('button[type="submit"]:disabled, button[aria-label*="Send"]:disabled, button[aria-label*="send"]:disabled');
      if (sendButton) return true;

      return false;
    }

  simpleHash(str) { 
    if (!str) return '0'; 
    let hash = 0; 
    for (let i = 0; i < str.length; i++) { 
      const char = str.charCodeAt(i); 
      hash = ((hash << 5) - hash) + char; 
      hash = hash & hash; // Ensure 32bit integer
    } 
    return Math.abs(hash).toString(); 
  }

  async sendStreamChunk(text, isComplete, responseId, retryAttempt = 0, isRetryOfFailed = false) {
    if (!text || text.trim().length === 0) {
      return { success: true, error: "Empty text, skipped" };
    }

    const MAX_RETRIES = CONFIG.streaming.retryAttempts;
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
      const result = await this.sendToServer(CONFIG.server.endpoints.stream, payload);
      if (result.success) {
        return result;
      } else {
        console.warn(`⚠️ Server returned error for ${responseId} (Attempt ${retryAttempt}): ${result.error}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, (retryAttempt + 1) * CONFIG.streaming.retryDelayMs));
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

  async sendToServer(endpoint, data) {
    if (!this.serverHealthy && endpoint !== CONFIG.server.endpoints.health && endpoint !== CONFIG.server.endpoints.reset) {
      console.warn(`⚠️ Server appears to be down, not sending to ${endpoint}. Queuing if applicable.`);
      if (endpoint === CONFIG.server.endpoints.stream && data && data.response_id && !this.failedRequests.find(fr => fr.responseId === data.response_id)) {
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

      const response = await fetch(getServerUrl(endpoint), {
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

  async sendManualTTS(text) {
    console.log(`📤 Manual TTS: ${text.substring(0, 50)}...`);
    const responseId = `manual-${this.simpleHash(text.substring(0, 50))}-${Date.now()}`;
    const payload = { text: text, conversation_mode: false, timestamp: Date.now(), response_id: responseId, is_complete: true };

    if (!this.serverHealthy) {
      console.warn("Server down, queuing manual TTS request.");
      this.failedRequests.push({ ...payload });
      return { success: false, error: "Server down, request queued" };
    }
    return this.sendToServer(CONFIG.server.endpoints.tts, payload);
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
    
    // Use config for panel positioning
    const position = CONFIG.ui.panelPosition || "bottom-right";
    const baseStyles = `
      position: fixed; z-index: 9999;
      background-color: #1C1C1C; color: white; padding: 16px;
      border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; gap: 12px;
      width: 320px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      border: 1px solid #333;
    `;
    
    // Set position based on config
    if (position === "bottom-right") {
      panel.style.cssText = baseStyles + "bottom: 20px; right: 20px;";
    } else if (position === "bottom-left") {
      panel.style.cssText = baseStyles + "bottom: 20px; left: 20px;";
    } else if (position === "top-right") {
      panel.style.cssText = baseStyles + "top: 20px; right: 20px;";
    } else if (position === "top-left") {
      panel.style.cssText = baseStyles + "top: 20px; left: 20px;";
    } else {
      panel.style.cssText = baseStyles + "bottom: 20px; right: 20px;"; // Default fallback
    }

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

    // Add config info display if not in quiet mode
    if (!CONFIG.ui.quiet_mode) {
      const configInfo = document.createElement('div');
      configInfo.style.cssText = `
        font-size: 9px; color: #555; text-align: center; margin-top: 2px;
        font-family: monospace;
      `;
      configInfo.textContent = `Server: ${CONFIG.server.host}:${CONFIG.server.port}`;
      panel.appendChild(configInfo);
    }

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

    // Only add preview area if enabled in config
    if (CONFIG.ui.enablePreview) {
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
    }
    
    document.body.appendChild(panel);
    this.updateStatusDisplay();
  }

  addConversationModeToggle(panel) {
    const toggleContainer = document.createElement('div');
    toggleContainer.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      background-color: #2A2A2A; padding: 10px; border-radius: 8px;
      margin-bottom: 8px;
    `;

    const label = document.createElement('label');
    label.textContent = 'Conversation Mode:';
    label.style.cssText = `font-size: 14px; color: #D4A574; font-weight: 500;`;

    const toggleSwitch = document.createElement('div');
    toggleSwitch.style.cssText = `
      width: 44px; height: 24px; background-color: #555; border-radius: 12px;
      position: relative; cursor: pointer; transition: background-color 0.3s;
    `;
    
    const toggleKnob = document.createElement('div');
    toggleKnob.style.cssText = `
      width: 20px; height: 20px; background-color: white; border-radius: 50%;
      position: absolute; top: 2px; left: 2px; transition: transform 0.3s;
    `;
    toggleSwitch.appendChild(toggleKnob);

    // Status text to show current state
    const statusText = document.createElement('div');
    statusText.style.cssText = `
      font-size: 12px; color: #999; margin-top: 4px; text-align: center;
    `;
    
    const updateToggleVisuals = (isActive) => {
      console.log(`🔄 Updating toggle visuals: ${isActive}`);
      if (isActive) {
        toggleSwitch.style.backgroundColor = '#D4A574'; 
        toggleKnob.style.transform = 'translateX(20px)';
        statusText.textContent = '🎤 Streaming Active';
        statusText.style.color = '#86E0A2';
      } else {
        toggleSwitch.style.backgroundColor = '#555'; 
        toggleKnob.style.transform = 'translateX(0px)';
        statusText.textContent = '🎧 Streaming Paused';
        statusText.style.color = '#D4A574';
      }
    };
    
    // Initialize with current state
    updateToggleVisuals(this.monitor.conversationMode);

    toggleSwitch.onclick = async () => {
      try {
        console.log(`🔄 Toggle clicked. Current state: ${this.monitor.conversationMode}`);
        
        // Toggle the state
        this.monitor.conversationMode = !this.monitor.conversationMode;
        
        // Save to storage
        await chrome.storage.local.set({ conversationMode: this.monitor.conversationMode });
        console.log(`💾 Saved conversation mode: ${this.monitor.conversationMode}`);
        
        // Update visuals immediately
        updateToggleVisuals(this.monitor.conversationMode);
        
        // Update the main status display
        this.updateStatusDisplay();
        
        // Handle monitoring state
        if (this.monitor.conversationMode) {
          console.log("🎤 Starting monitoring...");
          this.monitor.startMonitoring();
          // Reset state for clean start
          this.monitor.resetForNewResponse(); 
          // Process any existing response
          setTimeout(() => {
            this.monitor.processStreamUpdate();
          }, 100);
        } else {
          console.log("🎧 Stopping monitoring...");
          this.monitor.stopMonitoring();
          // Send any final chunk before stopping
          this.monitor.sendFinalChunk(); 
        }
        
        console.log(`✅ Toggle complete. New state: ${this.monitor.conversationMode}`);
        
      } catch (error) {
        console.error("❌ Error in toggle handler:", error);
        // Revert visual state on error
        updateToggleVisuals(!this.monitor.conversationMode);
      }
    };

    // Add elements to container
    toggleContainer.appendChild(label);
    toggleContainer.appendChild(toggleSwitch);
    
    // Add status text below the toggle
    const toggleWrapper = document.createElement('div');
    toggleWrapper.appendChild(toggleContainer);
    toggleWrapper.appendChild(statusText);
    
    panel.appendChild(toggleWrapper);
    
    // Store reference for external updates
    this.conversationToggle = {
      updateVisuals: updateToggleVisuals,
      statusText: statusText
    };
  }

  detectAndDisplay() {
    this.monitor.resetForNewResponse(); 
    const responseElement = this.monitor.findClaudeResponse();
    
    if (CONFIG.ui.enablePreview) {
      const textPreview = document.getElementById('text-preview');
      
      if (responseElement) {
          this.currentText = responseElement.textContent || "";
          const maxLength = CONFIG.ui.previewMaxLength || 500;
          textPreview.textContent = this.currentText.substring(0, maxLength) + (this.currentText.length > maxLength ? "..." : "");
          document.getElementById('status').textContent = 'Response detected.';
          
          this.monitor.currentResponseElement = responseElement;
          this.monitor.currentResponseText = ""; 
          this.monitor.lastSentLength = 0;
          this.monitor.chunkCounterForElement = 0;
          this.monitor.processedChunks.clear();
          this.monitor.lastProcessedText = "";
          this.monitor.lastCleanedText = "";
          this.monitor.processStreamUpdate();

      } else {
          textPreview.textContent = 'No Claude response found.';
          document.getElementById('status').textContent = 'No response found.';
          this.currentText = "";
      }
    } else {
      // If preview is disabled, still do the detection logic
      if (responseElement) {
          this.currentText = responseElement.textContent || "";
          document.getElementById('status').textContent = 'Response detected.';
          
          this.monitor.currentResponseElement = responseElement;
          this.monitor.currentResponseText = ""; 
          this.monitor.lastSentLength = 0;
          this.monitor.chunkCounterForElement = 0;
          this.monitor.processedChunks.clear();
          this.monitor.lastProcessedText = "";
          this.monitor.lastCleanedText = "";
          this.monitor.processStreamUpdate();
      } else {
          document.getElementById('status').textContent = 'No response found.';
          this.currentText = "";
      }
    }
  }

  updateStatusDisplay() {
    const statusDiv = document.getElementById('status');
    const lockDiv = document.getElementById('processing-lock');
    const serverStatusDiv = document.getElementById('server-status');

    if (!statusDiv || !lockDiv || !serverStatusDiv) return;

    // Update main status
    statusDiv.textContent = this.monitor.conversationMode ? '🎤 Streaming Active' : '🎧 Streaming Paused';
    statusDiv.style.color = this.monitor.conversationMode ? '#86E0A2' : '#D4A574';

    // Update processing lock
    lockDiv.style.display = this.monitor.processingLock ? 'block' : 'none';
    lockDiv.textContent = this.monitor.processingLock ? '⚙️ Processing...' : '';

    // Update server status
    serverStatusDiv.textContent = this.monitor.serverHealthy ? '✅ Server OK' : '❌ Server Issue';
    serverStatusDiv.style.color = this.monitor.serverHealthy ? '#86E0A2' : '#E07A7A';

    // Show failed requests count if any
    if (this.monitor.failedRequests.length > 0) {
      serverStatusDiv.textContent += ` (${this.monitor.failedRequests.length} queued)`;
    }
    
    // Update toggle visuals if available
    if (this.conversationToggle) {
      this.conversationToggle.updateVisuals(this.monitor.conversationMode);
    }
    
    console.log(`📊 Status updated - Mode: ${this.monitor.conversationMode}, Processing: ${this.monitor.processingLock}, Server: ${this.monitor.serverHealthy}`);
  }

  initPeriodicUpdates() {
    setInterval(() => {
      this.updateStatusDisplay();
    }, 1000);
  }
} 

if (typeof claudeStreamMonitor === 'undefined' || !claudeStreamMonitor) {
  var claudeStreamMonitor = new ClaudeStreamMonitor();
  var ttsPanel = new TTSControlPanel(claudeStreamMonitor);
  ttsPanel.initPeriodicUpdates();

  chrome.storage.local.get(['conversationMode'], (result) => {
    if (result.conversationMode) {
      claudeStreamMonitor.conversationMode = true; 
      if (!claudeStreamMonitor.isMonitoring) {
        claudeStreamMonitor.startMonitoring();
      }
      ttsPanel.updateStatusDisplay(); 
    } else {
      claudeStreamMonitor.conversationMode = false;
      ttsPanel.updateStatusDisplay();
    }
  });
}
