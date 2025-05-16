// Smart Streaming Content Script for Claude - Fixed Version
console.log("🚀 Smart Streaming Claude TTS loaded - Version 2.0");


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

    // Load settings
    this.loadSettings();
  
    // Clear server state on page refresh
    this.resetServerOnPageLoad();
  }

async resetServerOnPageLoad() {
  // Give page a moment to fully load
  setTimeout(async () => {
    await this.sendToServer("/reset_conversation", {
      client_ip: 'browser',
      response_id: 'page-refresh-' + Date.now()
    });
    console.log("🔄 Cleared server state after page load");
  }, 500);
}
  
  async loadSettings() {
    const result = await chrome.storage.local.get(['conversationMode']);
    this.conversationMode = result.conversationMode || false;
    console.log(`📊 Loaded conversation mode: ${this.conversationMode}`);
  }
  
startMonitoring() {
  if (this.isMonitoring) return;
  
  console.log("🔄 Starting smart stream monitoring");
  this.isMonitoring = true;
  
  // Set up mutation observer for real-time detection
  this.observer = new MutationObserver((mutations) => {
    if (!this.conversationMode || this.processingLock) return;
    this.debounceAndProcess();
  });
  
  // updated selector:
  const target = document.querySelector('main') || 
                 document.querySelector('[data-testid="conversation-container"]') ||
                 document.querySelector('.conversation');
                 
  if (target) {
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
    console.log("✅ Observer attached to:", target);
  } else {
    console.error("❌ No target found for observer");
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
    // Longer debounce for stability - increased from 300ms to 800ms
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processStreamUpdate();
    }, 800);
  }
  
processStreamUpdate() {
  if (!this.conversationMode || this.processingLock) return;
  
  this.processingLock = true;
  
  try {
    const response = this.findClaudeResponse();
    if (!response) return;
    
    const chunks = this.parseResponseIntoChunks(response);
    const currentId = this.generateResponseId(response);
    
    // Track chunks per response
    if (!this.processedChunks.has(currentId)) {
      this.processedChunks.set(currentId, 0);
    }
    
    const alreadySent = this.processedChunks.get(currentId);
    const newChunks = chunks.slice(alreadySent);
    
    // Send new chunks as they appear
    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i];
      this.sendStreamChunk(chunk, false, `${currentId}-chunk-${alreadySent + i}`);
      this.processedChunks.set(currentId, alreadySent + i + 1);
    }
    
  } finally {
    this.processingLock = false;
  }
}

  getResponseTimestamp(element) {
    // Use DOM position as a proxy for creation time
    const allResponses = document.querySelectorAll('[data-message-author-role="assistant"]');
    return this.conversationModeStartTime + Array.from(allResponses).indexOf(element);
  }
  
  findClaudeResponse() {
    // First try the official attribute selector
    const responses = document.querySelectorAll('[data-message-author-role="assistant"]');
    
    if (responses.length === 0) {
      // If that fails, manually grab the last Claude message
      const allClaudeMessages = document.querySelectorAll('.font-claude-message');
      
      if (allClaudeMessages.length > 0) {
        return allClaudeMessages[allClaudeMessages.length - 1];
      }
      
      // Final fallback - try these selectors in order
      const fallbackSelectors = [
        'div[data-test-render-count]:last-child div.font-claude-message',
        'div[data-test-render-count]:last-child',
        '.font-claude-message:not([data-testid="user-message"] *)'
      ];
      
      for (const selector of fallbackSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          return elements[elements.length - 1];
        }
      }
      return null;
    }
    
    const lastResponse = responses[responses.length - 1];
    
    // Check if this response existed when we started monitoring
    if (this.conversationModeStartTime && lastResponse) {
      const responseTime = this.getResponseTimestamp(lastResponse);
      if (responseTime < this.conversationModeStartTime) {
        console.log("⚠️ Skipping pre-existing response");
        return null;
      }
    }

    // Validate we have complete content
    const textContent = lastResponse.textContent.trim();
    if (textContent.length < 10) {
      console.log("⚠️ Response too short, waiting for more content");
      return null;
    }
    
    // Check for completion indicators - if typing and content is very short, wait
    const isTyping = lastResponse.querySelector('.typing-indicator, .animate-pulse, [class*="typing"], [class*="loading"]');
    if (isTyping && textContent.length < 50) {
      console.log("⚠️ Detected typing with short content, waiting...");
      return null;
    }
    
    return lastResponse;
  }

  extractText(element) {
    if (!element) return null;
    
    // Clone the element to avoid modifying the original
    const clone = element.cloneNode(true);
  
    // Remove artifact buttons and their content
    const artifactButtons = clone.querySelectorAll('button[aria-label="Preview contents"]');
    artifactButtons.forEach(button => button.remove());

    // Remove code blocks in pre tags
    const preElements = clone.querySelectorAll('pre');
    preElements.forEach(pre => pre.remove());
  
    // Remove any other artifact containers
    const artifactContainers = clone.querySelectorAll('.artifact-block-cell');
    artifactContainers.forEach(container => container.remove());
  
    let text = clone.textContent.trim();
    
    // Remove code blocks before sending to TTS
    text = text.replace(/```[\s\S]*?```/g, '[Code block]');
    text = text.replace(/`[^`]+`/g, '[Code]');
    
    // Basic corruption detection patterns
    const corruptionPatterns = [
      /cuts ofnts/,  // Specific corruption we've seen
      /\b\w+#<---/,  // Truncation markers
    ];

    // Skip corruption check entirely for code-related content
    if (text.includes('`/') || text.includes('```') || text.includes('regex')) {
      return text; // Code blocks and regex discussions get a free pass
    }
    
    for (const pattern of corruptionPatterns) {
      if (pattern.test(text)) {
        console.warn('🔴 Detected corrupted text pattern:', pattern.toString());
        console.warn('🔴 Corrupted text sample:', text.substring(0, 100));
        return null;
      }
    }
    
    // Additional validation
    if (text.length < 5) return null;
    
    return text;
  }
  
  isClaudeTyping(responseElement) {
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
  }
  
  generateResponseId(element) {
    if (!element) return null;
    
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
  
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  async sendStreamChunk(text, isComplete, responseId) {
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
    return this.sendToServer("/stream", payload);
  }
  
  async sendToServer(endpoint, data) {
    try {
      const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Server response: ${endpoint}`, result);
      } else {
        console.error(`❌ Server error: ${endpoint}`, result.error);
      }
      
      return result;
    } catch (error) {
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

  
// Control Panel with improved aesthetics from original content.js
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


    function createAnimatedTTSButton() {
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
      const style = document.createElement('style');
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
      return button;
}

    // Fix your animations to include the centering transform:
    @keyframes starWiggle {
      0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
      25% { transform: translate(-50%, -50%) rotate(2deg); }
      75% { transform: translate(-50%, -50%) rotate(-2deg); }
    }
     
      // Add animations and color filters
      const style = document.createElement('style');
      style.textContent = `
        /* Color filters */
        .star-element {
          /* Filter for #d3623d (orange-red color) */
          filter: brightness(0) saturate(100%) invert(48%) sepia(89%) saturate(2074%) hue-rotate(359deg) brightness(95%) contrast(90%);
          animation: starWiggle 3s ease-in-out infinite;
        }
        
        .arc1-element, .arc2-element, .arc3-element {
          /* Filter for white */
          filter: brightness(0) saturate(100%) invert(100%);
        }
        
        .arc1-element { animation: arc1Wiggle 2.5s ease-in-out infinite; }
        .arc2-element { animation: arc2Wiggle 3.2s ease-in-out infinite; }
        .arc3-element { animation: arc3Wiggle 4s ease-in-out infinite; }
        
        /* Animations */
        @keyframes starWiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(2deg); }
          75% { transform: rotate(-2deg); }
        }
        
        @keyframes arc1Wiggle {
          0%, 100% { transform: rotate(0deg); }
          33% { transform: rotate(3deg); }
          66% { transform: rotate(-3deg); }
        }
        
        @keyframes arc2Wiggle {
          0%, 100% { transform: rotate(0deg); }
          40% { transform: rotate(-2deg); }
          80% { transform: rotate(2deg); }
        }
        
        @keyframes arc3Wiggle {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(4deg); }
        }
      `;
      
      document.head.appendChild(style);
      return button;
    }
    // Now create and add the animated TTS button
    const ttsBtn = createAnimatedTTSButton();
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
      console.log("🐛 Attempting to start monitoring...");
      this.monitor.startMonitoring();
      console.log("🐛 Start monitoring called");
      this.updateStatus('Monitoring active');
    }
    
    // Update processing lock status periodically
    setInterval(() => this.updateProcessingStatus(), 1000);
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
    
    const text = this.monitor.extractText(response);
    
    if (!text) {
      this.updatePreview('❌ Failed to extract valid text (possible corruption)');
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

  stopAudio() {
    // Add your stop audio implementation here
    this.monitor.sendToServer("/stop", { timestamp: Date.now() });
  }
}

// Initialize
const monitor = new ClaudeStreamMonitor();
const controlPanel = new TTSControlPanel(monitor);

// Export for debugging
window.claudeTTSMonitor = monitor;
