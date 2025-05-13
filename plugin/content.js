// Claude-to-Speech content script
console.log("Claude TTS Content Script loaded");

// Global variables
let currentDetectedText = "";
let conversationMode = false; // Toggle for conversation mode
let isWaitingForResponse = false; // Flag to track if Claude is currently responding
let lastProcessedResponseId = null; // Track the last processed response ID
let claudeResponseTimer = null;
let playedResponses = new Set();
let pageLoadTime = Date.now();
let pageURL = window.location.href;


// Initialize from localStorage when the page loads
chrome.storage.local.get(['playedResponses'], function(result) {
  if (result.playedResponses) {
    playedResponses = new Set(result.playedResponses);
  }
});

// Main control panel setup
function addControlPanel() {
  // Check if control panel already exists
  if (document.getElementById('claude-tts-controls')) {
    return;
  }
  
  // Create control panel
  const panel = document.createElement('div');
  panel.id = 'claude-tts-controls';
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    background-color: #1C1C1C;
    color: white;
    padding: 16px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 320px;
    min-width: 260px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 1px solid #333;
  `;
  
  // Title with Copernicus font and stars
  const title = document.createElement('div');
  title.textContent = ' Claude-to-Speech ';
  title.style.cssText = `
    font-size: 30px;
    font-weight: 500;
    text-align: center;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid #D4A574;
    font-family: 'Copernicus', serif;
    color: white;
    letter-spacing: 0.5px;
    position: relative;
  `;
  
  // Add LAURA mark with heart
  const lauraSignature = document.createElement('div');
  lauraSignature.innerHTML = 'from LAURA with ♥';
  lauraSignature.style.cssText = `
    font-size: 9px;
    color: #666;
    position: absolute;
    bottom: -14px;
    right: 4px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;
  title.appendChild(lauraSignature);
  panel.appendChild(title);
  
  // Add conversation mode toggle
  addConversationModeToggle(panel);
  
  // Detect button (dark grey)
  const detectBtn = document.createElement('button');
  detectBtn.textContent = 'Detect Claude Response';
  detectBtn.style.cssText = `
    background-color: #333333;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 12px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: all 0.2s ease;
    margin-top: 4px;
  `;
  detectBtn.onmouseover = () => { 
    detectBtn.style.backgroundColor = '#2a2a2a'; 
    detectBtn.style.transform = 'translateY(-1px)';
  };
  detectBtn.onmouseout = () => { 
    detectBtn.style.backgroundColor = '#333333'; 
    detectBtn.style.transform = 'translateY(0)';
  };
  detectBtn.onclick = detectCurrentResponse;
  
  // Preview area
  const previewArea = document.createElement('div');
  previewArea.style.cssText = `
    margin-top: 4px;
    border: 1px solid #D4A574;
    border-radius: 8px;
    background-color: #1F2020;
    padding: 12px;
  `;
  
  const previewLabel = document.createElement('div');
  previewLabel.textContent = 'Detected Text Preview:';
  previewLabel.style.cssText = `
    font-size: 12px; 
    margin-bottom: 8px; 
    color: #D4A574; 
    font-weight: 500;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;
  
  const previewText = document.createElement('div');
  previewText.id = 'claude-tts-preview';
  previewText.style.cssText = `
    max-height: 120px;
    overflow-y: auto;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    padding: 10px;
    background-color: #2A2A2A;
    border-radius: 6px;
    color: #F5E6D3;
    line-height: 1.4;
  `;
  
  // TTS button (orange)
  const ttsBtn = document.createElement('button');
  ttsBtn.id = 'claude-tts-send-button';
  ttsBtn.textContent = 'Voice with ElevenLabs';
  ttsBtn.style.cssText = `
    background-color: #CC6514;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 12px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin-top: 4px;
    transition: all 0.2s ease;
    opacity: 0.5;
    min-width: 100%;
    text-align: center;
  `;
  ttsBtn.disabled = true;
  ttsBtn.onmouseover = () => { 
    if (!ttsBtn.disabled) {
      ttsBtn.style.backgroundColor = '#B8560F'; 
      ttsBtn.style.transform = 'translateY(-1px)';
    }
  };
  ttsBtn.onmouseout = () => { 
    ttsBtn.style.backgroundColor = '#CC6514'; 
    ttsBtn.style.transform = 'translateY(0)';
  };
  ttsBtn.onclick = function() {
    if (currentDetectedText) {
      speakText(currentDetectedText);
    }
  };
  
  // Debug button
  const debugBtn = document.createElement('button');
  debugBtn.textContent = 'Debug Response Detection';
  debugBtn.style.cssText = `
    background-color: #5A5A5A;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin-top: 0px;
    transition: all 0.2s ease;
  `;
  debugBtn.onmouseover = () => { 
    debugBtn.style.backgroundColor = '#4A4A4A'; 
    debugBtn.style.transform = 'translateY(-1px)';
  };
  debugBtn.onmouseout = () => { 
    debugBtn.style.backgroundColor = '#5A5A5A'; 
    debugBtn.style.transform = 'translateY(0)';
  };
  debugBtn.onclick = debugFindClaudeResponse;
  
  // Assemble all components
  previewArea.appendChild(previewLabel);
  previewArea.appendChild(previewText);
  
  panel.appendChild(detectBtn);
  panel.appendChild(previewArea);
  panel.appendChild(ttsBtn);
  panel.appendChild(debugBtn);
  
  // Add to page
  document.body.appendChild(panel);
  console.log("Claude TTS controls added");
}

// Add a toggle switch for conversation mode
function addConversationModeToggle(container) {
  const conversationModeContainer = document.createElement('label');
  conversationModeContainer.className = 'claude-tts-toggle';
  conversationModeContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 4px 0;
  `;
  
  const conversationModeInput = document.createElement('input');
  conversationModeInput.type = 'checkbox';
  conversationModeInput.checked = conversationMode;
  conversationModeInput.style.cssText = `
    height: 0;
    width: 0;
    visibility: hidden;
    margin: 0;
  `;
  
  const conversationModeSlider = document.createElement('span');
  conversationModeSlider.className = 'claude-tts-slider';
  conversationModeSlider.style.cssText = `
    position: relative;
    display: inline-block;
    width: 40px;
    height: 20px;
    background-color: ${conversationMode ? '#EF7D21' : '#666666'};
    border-radius: 20px;
    transition: 0.4s;
  `;
  
  // Add slider circle
  const sliderCircle = document.createElement('span');
  sliderCircle.style.cssText = `
    position: absolute;
    content: '';
    height: 16px;
    width: 16px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    border-radius: 50%;
    transition: 0.4s;
    transform: ${conversationMode ? 'translateX(20px)' : 'translateX(0)'};
  `;
  conversationModeSlider.appendChild(sliderCircle);
  
  // Label text
  const conversationModeText = document.createElement('span');
  conversationModeText.textContent = 'Conversation Mode';
  conversationModeText.style.cssText = 'color: #F5E6D3; font-weight: bold;';
  
  // Add event listener for toggle
  conversationModeInput.addEventListener('change', function() {
    conversationMode = this.checked;
    sliderCircle.style.transform = conversationMode ? 'translateX(20px)' : 'translateX(0)';
    conversationModeSlider.style.backgroundColor = conversationMode ? '#EF7D21' : '#666666';
    console.log(`Conversation Mode ${conversationMode ? 'enabled' : 'disabled'}`);
    
    // Save preference
    chrome.storage.local.set({ conversationMode: conversationMode });
  });
  
  // Load saved preference
  chrome.storage.local.get(['conversationMode'], function(result) {
    if (typeof result.conversationMode !== 'undefined') {
      conversationMode = result.conversationMode;
      conversationModeInput.checked = conversationMode;
      sliderCircle.style.transform = conversationMode ? 'translateX(20px)' : 'translateX(0)';
      conversationModeSlider.style.backgroundColor = conversationMode ? '#EF7D21' : '#666666';
    }
  });
  
  // Assemble the toggle switch
  conversationModeContainer.appendChild(conversationModeInput);
  conversationModeContainer.appendChild(conversationModeSlider);
  conversationModeContainer.appendChild(conversationModeText);
  
  // Add to container
  container.appendChild(conversationModeContainer);
}

// Function to generate a unique ID for a response based on content and position
function generateResponseId(element) {
  if (!element) return null;
  
  // Get more of the content for a better fingerprint
  const contentFingerprint = element.textContent.trim().substring(0, 200);
  
  // Add the current URL path to make it conversation-specific
  const urlPath = window.location.pathname;
  
  // Create a simple hash of the content + URL - FIX FOR UNICODE
  try {
    return btoa(contentFingerprint + urlPath).slice(0, 20);
  } catch (error) {
    // Fallback for Unicode characters
    console.log("Unicode encoding fallback triggered");
    const normalized = (contentFingerprint + urlPath).replace(/[^\x00-\x7F]/g, "");
    return btoa(normalized).slice(0, 20);
  }
}

// Check for Claude response and process it - WITH TIMESTAMPS
function checkForClaudeResponse() {
  clearTimeout(claudeResponseTimer);
  claudeResponseTimer = setTimeout(() => {
    const startTime = performance.now();
    console.log(`🔍 Looking for Claude's finished response... [${startTime.toFixed(2)}ms]`);
    
    const response = findClaudeResponse();
    
    // Check if Claude is still typing
    if (response && response.querySelector('.typing-indicator, .loading, .animate-pulse')) {
      console.log("Claude still typing, skipping...");
      return;
    }
    
    if (response) {
      const foundTime = performance.now();
      console.log(`✨ Found Claude's response! [${(foundTime - startTime).toFixed(2)}ms]`);
            
      // Generate a response ID based on content and position
      const responseId = generateResponseId(response);
      const idTime = performance.now();
      console.log(`Response ID: ${responseId} [${(idTime - foundTime).toFixed(2)}ms]`);
      console.log(`Last processed ID: ${lastProcessedResponseId}`);
      
      // Check if we've already played this response
      if (playedResponses.has(responseId)) {
        console.log("Response already played, skipping TTS");
        return;
      }
      
      // Check if this response was already on the page when we loaded
      if (Date.now() - pageLoadTime < 5000) { // Within 5 seconds of page load
        console.log("Page recently loaded, checking if response is stale...");
        console.log(`Response already played, skipping TTS`);
        return;
      }
      
      // Only process if this is a new response we haven't spoken already
      if (responseId !== lastProcessedResponseId) {
        console.log("New response detected, processing for TTS");
        
        // Process the response to skip code blocks
        const processedText = processResponseText(response);
        const processTime = performance.now();
        console.log(`Processed text (first 100 chars): ${processedText.substring(0, 100)} [${(processTime - idTime).toFixed(2)}ms]`);
        
        // Clean and update preview
        updatePreview(processedText.trim());
        
        // If conversation mode is enabled, automatically speak the text
        if (conversationMode && currentDetectedText) {
          const ttsStartTime = performance.now();
          console.log(`🔊 Conversation Mode enabled, sending to speech... [${(ttsStartTime - processTime).toFixed(2)}ms]`);
          speakText(currentDetectedText);
          
          // Store this response ID as processed
          lastProcessedResponseId = responseId;
          
          // Add to played responses and save
          playedResponses.add(responseId);
          chrome.storage.local.set({ playedResponses: Array.from(playedResponses) });
        }
      } else {
        console.log("Response already processed, skipping TTS");
      }
    } else {
      console.log("😕 No response found after Claude finished responding");
    }
  }, 3000);
}


// Function to set up response monitoring using MutationObserver
function setupResponseMonitoring() {
  console.log("🔍 Setting up Claude response monitoring...");
  
  // Add a timer to prevent spam
  let mutationDebounceTimer;
  
  // Create a MutationObserver to watch for DOM changes
  const observer = new MutationObserver((mutations) => {
    // Look for additions of substantial content which might be Claude's response
    const hasNewContent = mutations.some(mutation => {
      // Skip mutations from our own UI
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          mutation.target.closest('#claude-tts-controls')) {
        return false;
      }
      
      // Skip artifacts panel mutations
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          (mutation.target.closest('[data-testid="artifacts-panel"]') || 
           mutation.target.closest('[class*="artifact"]') ||
           mutation.target.closest('[data-testid="artifact"]'))) {
        return false;
      }
      
      // Skip other UI mutations (expand/collapse buttons, etc.)
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          mutation.target.closest('button') && 
          mutation.type === 'attributes') {
        return false;
      }
      
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is substantial content
            if (node.textContent && node.textContent.trim().length > 10) {
              return true;
            }
          }
        }
      }
      return false;
    });
    
    if (hasNewContent) {
      // Wait half a second before checking to avoid spam
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        console.log("Detected possible new content, checking for Claude response...");
        checkForClaudeResponse();
      }, 500);
    }
  });
  
  // Monitor the main content area
  const contentArea = document.querySelector('main') || document.body;
  observer.observe(contentArea, { 
    childList: true, 
    subtree: true,
    characterData: true
  });
  
  // Also watch for the send button's state
  const sendButtons = document.querySelectorAll('button[type="submit"], button[aria-label="Send message"]');
  if (sendButtons.length > 0) {
    sendButtons.forEach(button => {
      // Watch button state changes
      const buttonObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes' && 
              (mutation.attributeName === 'disabled' || 
               mutation.attributeName === 'aria-disabled')) {
            
            const wasDisabled = mutation.oldValue === 'true' || mutation.oldValue === '';
            const isNowDisabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
            
            // Button was disabled but is now enabled - Claude finished responding
            if (wasDisabled && !isNowDisabled) {
              console.log("Send button re-enabled, Claude probably finished responding");
              setTimeout(checkForClaudeResponse, 500);
            }
          }
        });
      });
      
      buttonObserver.observe(button, { 
        attributes: true, 
        attributeOldValue: true,
        attributeFilter: ['disabled', 'aria-disabled'] 
      });
    });
  }
}

function processResponseText(element) {
  if (!element) return "";
  
  const clone = element.cloneNode(true);
  
  // Strip code blocks first
  clone.querySelectorAll('pre, code').forEach(block => block.remove());
  
  // Then grab all text
  let text = clone.textContent || "";
  
  text = text.replace(/Share|Edit|Retry|Claude can make mistakes/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Streaming TTS Manager for processing responses in chunks
class StreamingTTSManager {
  constructor() {
    this.fullResponseBuffer = '';     // Complete response text
    this.processedUpTo = 0;          // Character index we've already spoken
    this.isProcessing = false;       // Currently generating TTS
    this.streamingTimer = null;      // Debounce timer
    this.spokenSegments = new Set(); // Track what we've already spoken
    this.lastResponseId = null;      // Track current response
  }

  onStreamUpdate(responseElement) {
    if (!responseElement || !conversationMode) return;
    
    // Get the current full text
    const fullText = processResponseText(responseElement);
    
    // Check if this is a new response
    const currentId = generateResponseId(responseElement);
    if (currentId !== this.lastResponseId) {
      console.log("🆕 New response detected, resetting...");
      this.reset();
      this.lastResponseId = currentId;
    }
    
    // Update buffer with new content
    this.fullResponseBuffer = fullText;
    
    // Don't process if we're already generating audio
    if (this.isProcessing) return;
    
    // Debounce - wait for pause in typing
    clearTimeout(this.streamingTimer);
    this.streamingTimer = setTimeout(() => {
      this.processNewText();
    }, 500);
  }

  processNewText() {
    // Extract only the unprocessed portion
    const unprocessedText = this.fullResponseBuffer.slice(this.processedUpTo);
    
    if (unprocessedText.length === 0) return;
    
    console.log(`📝 Processing unprocessed text (${unprocessedText.length} chars): "${unprocessedText.substring(0, 50)}..."`);
    
    // Strategy 1: Process text before first code block
    const codeBlockMatch = unprocessedText.match(/```[\s\S]*?```/);
    
    if (codeBlockMatch) {
      // Found code block - speak everything before it
      const textBeforeCode = unprocessedText.substring(0, codeBlockMatch.index);
      this.speakAndAdvance(textBeforeCode);
    } else {
      // No code blocks found - check for complete sentences
      const sentences = this.splitIntoSentences(unprocessedText);
      
      if (sentences.length > 1) {
        // Keep the last sentence (might be incomplete)
        const completeText = sentences.slice(0, -1).join(' ');
        
        if (completeText.length > 0) {
          this.speakAndAdvance(completeText);
        }
      }
    }
  }

  speakAndAdvance(text) {
    if (!text || text.trim().length < 5) return;
    
    const trimmedText = text.trim();
    
    // Create unique identifier for this text segment
    const segmentKey = `${this.processedUpTo}:${this.lastResponseId}:${trimmedText.substring(0, 30)}`;
    
    // Check if we've already spoken this segment
    if (this.spokenSegments.has(segmentKey)) {
      console.log(`⚠️ Skipping duplicate segment: "${trimmedText.substring(0, 50)}..."`);
      return;
    }
    
    // Mark as spoken
    this.spokenSegments.add(segmentKey);
    
    console.log(`🔊 Speaking segment (${trimmedText.length} chars): "${trimmedText.substring(0, 50)}..."`);
    console.log(`📍 Advancing processedUpTo from ${this.processedUpTo} to ${this.processedUpTo + text.length}`);
    
    // Generate TTS
    this.generateTTS(trimmedText);
    
    // Update processed index (use original text length, not trimmed)
    this.processedUpTo += text.length;
  }

  async generateTTS(text) {
    this.isProcessing = true;
    
    try {
      console.log(`📤 Sending to TTS: "${text.substring(0, 50)}..."`);
      
      const response = await chrome.runtime.sendMessage({
        action: "processText",
        text: text
      });
      
      console.log(`✅ TTS generated successfully`);
      
      // Wait before processing next chunk
      setTimeout(() => {
        this.isProcessing = false;
        
        // Check if there's more to process
        if (this.processedUpTo < this.fullResponseBuffer.length) {
          console.log("📝 Checking for more text to process...");
          this.processNewText();
        }
      }, 1000); // Short delay to avoid overwhelming the TTS server
      
    } catch (error) {
      console.error('❌ TTS Error:', error);
      this.isProcessing = false;
    }
  }

  splitIntoSentences(text) {
    // Split on sentence boundaries, keeping delimiters
    return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  }

  finishResponse() {
    console.log("🏁 Response complete, processing final segment...");
    
    // Process any remaining text
    const remainingText = this.fullResponseBuffer.slice(this.processedUpTo);
    
    if (remainingText.trim().length > 0) {
      // Clean final text (remove any code blocks)
      const cleanText = remainingText.replace(/```[\s\S]*?```/g, ' ').trim();
      
      if (cleanText.length > 0) {
        console.log(`🔊 Final segment: "${cleanText.substring(0, 50)}..."`);
        this.generateTTS(cleanText);
      }
    }
    
    // Don't reset yet - wait a bit for final TTS to complete
    setTimeout(() => {
      this.resetAfterResponse();
    }, 2000);
  }

  reset() {
    console.log("🔄 Resetting for next response...");
    this.fullResponseBuffer = '';
    this.processedUpTo = 0;
    this.isProcessing = false;
    this.spokenSegments.clear();
    clearTimeout(this.streamingTimer);
  }

  resetAfterResponse() {
    // Only reset if we're not in the middle of processing
    if (!this.isProcessing) {
      this.reset();
    } else {
      // Try again later
      setTimeout(() => this.resetAfterResponse(), 1000);
    }
  }
}

// Global streaming TTS manager instance
const streamingTTS = new StreamingTTSManager();

// Function to generate a unique ID for a response based on content and position
function generateResponseId(element) {
  if (!element) return null;
  
  // Get more of the content for a better fingerprint
  const contentFingerprint = element.textContent.trim().substring(0, 200);
  
  // Add the current URL path to make it conversation-specific
  const urlPath = window.location.pathname;
  
  // Create a simple hash of the content + URL
  return btoa(contentFingerprint + urlPath).slice(0, 20);
}

// Check for Claude response and process it - WITH STREAMING SUPPORT
function checkForClaudeResponse() {
  clearTimeout(claudeResponseTimer);
  claudeResponseTimer = setTimeout(() => {
    const startTime = performance.now();
    console.log(`🔍 Looking for Claude's finished response... [${startTime.toFixed(2)}ms]`);
    
    const response = findClaudeResponse();
    
    // Check if Claude is still typing
    if (response && response.querySelector('.typing-indicator, .loading, .animate-pulse')) {
      console.log("Claude still typing, skipping...");
      return;
    }
    
    if (response) {
      const foundTime = performance.now();
      console.log(`✨ Found Claude's response! [${(foundTime - startTime).toFixed(2)}ms]`);
      
      // Generate a response ID based on content and position
      const responseId = generateResponseId(response);
      const idTime = performance.now();
      console.log(`Response ID: ${responseId} [${(idTime - foundTime).toFixed(2)}ms]`);
      console.log(`Last processed ID: ${lastProcessedResponseId}`);
      
      // Check if we've already played this response (for non-conversation mode)
      if (!conversationMode && playedResponses.has(responseId)) {
        console.log("Response already played, skipping TTS");
        return;
      }
      
      // Check if this response was already on the page when we loaded
      if (Date.now() - pageLoadTime < 5000) { // Within 5 seconds of page load
        console.log("Page recently loaded, checking if response is stale...");
        if (!conversationMode) {
          console.log(`Response already played, skipping TTS`);
          return;
        }
      }
      
      // Handle conversation mode - finish the streaming response
      if (conversationMode) {
        streamingTTS.finishResponse();
      } else {
        // Handle normal mode - only process if this is a new response
        if (responseId !== lastProcessedResponseId) {
          console.log("New response detected, processing for TTS");
          
          // Process the response to skip code blocks
          const processedText = processResponseText(response);
          const processTime = performance.now();
          console.log(`Processed text (first 100 chars): ${processedText.substring(0, 100)} [${(processTime - idTime).toFixed(2)}ms]`);
          
          // Clean and update preview
          updatePreview(processedText.trim());
          
          // Store this response ID as processed
          lastProcessedResponseId = responseId;
          
          // Add to played responses and save
          playedResponses.add(responseId);
          chrome.storage.local.set({ playedResponses: Array.from(playedResponses) });
        } else {
          console.log("Response already processed, skipping TTS");
        }
      }
    } else {
      console.log("😕 No response found after Claude finished responding");
    }
  }, 3000);
}

// Function to set up response monitoring using MutationObserver
function setupResponseMonitoring() {
  console.log("🔍 Setting up Claude response monitoring...");
  
  // Add a timer to prevent spam
  let mutationDebounceTimer;
  
  // Create a MutationObserver to watch for DOM changes
  const observer = new MutationObserver((mutations) => {
    // Look for additions of substantial content which might be Claude's response
    const hasNewContent = mutations.some(mutation => {
      // Skip mutations from our own UI
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          mutation.target.closest('#claude-tts-controls')) {
        return false;
      }
      
      // Skip artifacts panel mutations
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          (mutation.target.closest('[data-testid="artifacts-panel"]') || 
           mutation.target.closest('[class*="artifact"]') ||
           mutation.target.closest('[data-testid="artifact"]'))) {
        return false;
      }
      
      // Skip other UI mutations (expand/collapse buttons, etc.)
      if (mutation.target.nodeType === Node.ELEMENT_NODE && 
          mutation.target.closest && 
          mutation.target.closest('button') && 
          mutation.type === 'attributes') {
        return false;
      }
      
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is substantial content
            if (node.textContent && node.textContent.trim().length > 10) {
              return true;
            }
          }
        }
      }
      return false;
    });
    
    if (hasNewContent) {
      // In conversation mode, check for streaming updates
      if (conversationMode) {
        const response = findClaudeResponse();
        if (response) {
          streamingTTS.onStreamUpdate(response);
        }
      }
      
      // Wait half a second before checking for complete response
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        console.log("Detected possible new content, checking for Claude response...");
        checkForClaudeResponse();
      }, 500);
    }
  });
  
  // Monitor the main content area
  const contentArea = document.querySelector('main') || document.body;
  observer.observe(contentArea, { 
    childList: true, 
    subtree: true,
    characterData: true
  });
  
  // Also watch for the send button's state
  const sendButtons = document.querySelectorAll('button[type="submit"], button[aria-label="Send message"]');
  if (sendButtons.length > 0) {
    sendButtons.forEach(button => {
      // Watch button state changes
      const buttonObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes' && 
              (mutation.attributeName === 'disabled' || 
               mutation.attributeName === 'aria-disabled')) {
            
            const wasDisabled = mutation.oldValue === 'true' || mutation.oldValue === '';
            const isNowDisabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
            
            // Button was disabled but is now enabled - Claude finished responding
            if (wasDisabled && !isNowDisabled) {
              console.log("Send button re-enabled, Claude probably finished responding");
              setTimeout(() => {
                checkForClaudeResponse();
              }, 500);
            }
          }
        });
      });
      
      buttonObserver.observe(button, { 
        attributes: true, 
        attributeOldValue: true,
        attributeFilter: ['disabled', 'aria-disabled'] 
      });
    });
  }
}

function processResponseText(element) {
  if (!element) return "";
  
  const clone = element.cloneNode(true);
  
  // Strip code blocks first
  clone.querySelectorAll('pre, code').forEach(block => block.remove());
  
  // Then grab all text
  let text = clone.textContent || "";
  
  text = text.replace(/Share|Edit|Retry|Claude can make mistakes/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Add this function after the processResponseText function
function findClaudeResponse() {
  const selectors = [
    'div[data-test-render-count] div.font-claude-message',
    'div[data-test-render-count]',
    '[data-message-author-role="assistant"]',
    '[data-message-author="claude"]'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      return elements[elements.length - 1];
    }
  }
  
  // Fallback: find the last message that isn't from user
  const allMessages = document.querySelectorAll('div[role="group"] > div > div');
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    if (!msg.closest('[data-testid="user-message"]') && 
        msg.textContent.trim().length > 20) {
      return msg;
    }
  }
  
  return null;
}

// Detect current response and update preview
function detectCurrentResponse() {
  console.log("Detecting Claude response...");
  
  const response = findClaudeResponse();
  
  if (response) {
    console.log("Found response:", response);
    
    // Process the response to skip code blocks
    const processedText = processResponseText(response);
    
    // Clean up the text
    updatePreview(processedText.trim());
  } else {
    console.log("No response found");
    updatePreview("");
    alert("No Claude response found. Try sending a message first.");
  }
}

// Update the preview with clean text
function updatePreview(text) {
  const preview = document.getElementById('claude-tts-preview');
  const ttsBtn = document.getElementById('claude-tts-send-button');
  
  if (!preview || !ttsBtn) return;
  
  // Store cleaned text
  currentDetectedText = text;
  
  // Format for display
  let displayText = text;
  if (text.length > 500) {
    displayText = text.substring(0, 500) + '... (' + text.length + ' characters total)';
  }
  
  preview.textContent = displayText || '(No text detected)';
  
  // Enable/disable TTS button
  if (text) {
    ttsBtn.disabled = false;
    ttsBtn.style.opacity = '1';
  } else {
    ttsBtn.disabled = true;
    ttsBtn.style.opacity = '0.5';
  }
}

// Send text to TTS
function speakText(text) {
  if (!text) return;
  
  // Limit text length
  const maxChars = 10000;
  let processedText = text;
  
  if (text.length > maxChars) {
    console.log(`Text too long (${text.length} chars), truncating`);
    processedText = text.substring(0, maxChars) + "... [truncated]";
  }
  
  console.log(`Speaking: ${processedText.substring(0, 50)}... (Response ID: ${lastProcessedResponseId})`);
  
  chrome.runtime.sendMessage({
    action: "processText",
    text: processedText
  }, function(response) {
    console.log("TTS response:", response);
  });
}

// Debug function to help diagnose detection issues
function debugFindClaudeResponse() {
  console.log("=============== DEBUGGING CLAUDE DETECTION ===============");
  
  // Try specific Claude message attributes
  const attributes = [
    'div[data-test-render-count] div.font-claude-message',
    'div[data-test-render-count]',
    '[data-message-author-role="assistant"]',
    '[data-message-author="claude"]',
    '.assistant-message',
    '.claude-response'
  ];
  
  console.log("Testing Claude-specific attributes...");
  attributes.forEach(attr => {
    const elements = document.querySelectorAll(attr);
    console.log(`Attribute "${attr}": found ${elements.length} elements`);
    if (elements.length > 0) {
      console.log(`Example text: "${elements[elements.length-1].textContent.substring(0, 50)}..."`);
    }
  });
  
  // Try to find the conversation container
  console.log("\nLooking for conversation container...");
  const conversationContainers = [
    document.querySelector('.conversation-container'),
    document.querySelector('[role="log"]'),
    document.querySelector('.message-list')
  ].filter(Boolean);
  
  if (conversationContainers.length > 0) {
    console.log(`Found ${conversationContainers.length} conversation containers`);
    
    // Check the most recent messages in the container
    const container = conversationContainers[0];
    const messages = Array.from(container.children)
      .filter(el => el.textContent.trim().length > 20)
      .slice(-4); // Get last 4 messages
    
    console.log("\nLast few messages in container:");
    messages.forEach((msg, i) => {
      const isUser = msg.closest('[data-testid="user-message"]') !== null;
      const hasRenderCount = msg.querySelector('[data-test-render-count]') !== null;
      
      console.log(`Message #${i+1}: ${isUser ? 'USER' : 'CLAUDE?'} - RenderCount: ${hasRenderCount ? 'YES' : 'NO'}`);
      console.log(`Text: "${msg.textContent.substring(0, 50)}..."`);
    });
  } else {
    console.log("No conversation container found");
  }
  
  // Test our detection function
  console.log("\nTesting findClaudeResponse function...");
  const detectedResponse = findClaudeResponse();
  if (detectedResponse) {
    console.log("Detected response:", detectedResponse);
    console.log("Text content (first 100 chars):", detectedResponse.textContent.substring(0, 100));
    
    // Process the text
    const processedText = processResponseText(detectedResponse);
    console.log("Processed text (first 100 chars):", processedText.substring(0, 100));
  } else {
    console.log("No response detected");
  }
  
  console.log("=============== END DEBUG ===============");
}

// Initialize
function init() {
  console.log("Initializing Claude-to-Speech");
  
  // Add control panel
  addControlPanel();
  
  // Set up response monitoring
  setupResponseMonitoring();
  
  // Load conversation mode setting
  chrome.storage.local.get(['conversationMode'], function(result) {
    if (typeof result.conversationMode !== 'undefined') {
      conversationMode = result.conversationMode;
    }
  });
}

// Start on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 1000);
}
