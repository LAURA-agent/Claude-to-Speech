// Smart Streaming Content Script for Claude
console.log("🚀 Smart Streaming Claude TTS loaded");

class ClaudeStreamMonitor {
  constructor() {
    this.conversationMode = false;
    this.lastResponseText = "";
    this.lastResponseId = null;
    this.isMonitoring = false;
    this.debounceTimer = null;
    this.streamingActive = false;
    
    // Load settings
    this.loadSettings();
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
      if (!this.conversationMode) return;
      
      // Check for substantial changes
      let hasSignificantChange = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Only trigger on actual content additions, not UI changes
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 5) {
              hasSignificantChange = true;
              break;
            }
            if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim().length > 10) {
              hasSignificantChange = true;
              break;
            }
          }
        }
      }
      
      if (hasSignificantChange) {
        this.debounceAndProcess();
      }
    });
    
    // Monitor the main conversation area
    const target = document.querySelector('main') || document.body;
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
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
    // Shorter debounce for responsive streaming
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processStreamUpdate();
    }, 300); // 300ms debounce
  }
  
  async processStreamUpdate() {
    if (!this.conversationMode) return;
    
    const response = this.findClaudeResponse();
    if (!response) return;
    
    const currentText = response.textContent.trim();
    const currentId = this.generateResponseId(response);
    
    // Detect if this is a new response
    if (currentId !== this.lastResponseId) {
      console.log("🆕 New response detected, starting stream");
      this.lastResponseId = currentId;
      this.streamingActive = true;
      
      // Reset conversation state on server
      await this.sendToServer("/reset_conversation", {
        client_ip: 'browser'
      });
    }
    
    // Check if response is complete
    const isComplete = !this.isClaudeTyping(response);
    
    // Only send if we have new content
    if (currentText !== this.lastResponseText) {
      console.log(`📤 Streaming ${isComplete ? 'final' : 'partial'} content: ${currentText.length} chars`);
      
      await this.sendStreamChunk(currentText, isComplete);
      this.lastResponseText = currentText;
      
      if (isComplete) {
        console.log("✅ Response complete, stream finished");
        this.streamingActive = false;
      }
    }
  }
  
  findClaudeResponse() {
    // Multiple strategies for finding Claude's response
    const selectors = [
      // Most specific first
      'div[data-test-render-count]:not([data-testid="user-message"] *) div.font-claude-message',
      'div[data-test-render-count]:not([data-testid="user-message"] *)',
      '[data-message-author-role="assistant"]',
      '.font-claude-message:not([data-testid="user-message"] *)'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements[elements.length - 1];
      }
    }
    
    return null;
  }
  
  isClaudeTyping(responseElement) {
    // Check for typing indicators
    const typingIndicators = [
      '.typing-indicator',
      '.loading',
      '[class*="typing"]',
      '[class*="loading"]',
      '.animate-pulse'
    ];
    
    for (const indicator of typingIndicators) {
      if (responseElement.querySelector(indicator)) {
        return true;
      }
    }
    
    // Check if the send button is disabled (Claude is responding)
    const sendButton = document.querySelector('button[type="submit"], button[aria-label*="Send"]');
    if (sendButton && sendButton.disabled) {
      return true;
    }
    
    return false;
  }
  
  generateResponseId(element) {
    if (!element) return null;
    
    // Create unique ID based on position and initial content
    const content = element.textContent.trim().substring(0, 50);
    const siblings = Array.from(element.parentNode?.children || []);
    const position = siblings.indexOf(element);
    
    try {
      return btoa(content + position + window.location.pathname).slice(0, 16);
    } catch {
      return `r${Date.now()}`;
    }
  }
  
  async sendStreamChunk(text, isComplete) {
    const payload = {
      text: text,
      is_complete: isComplete,
      conversation_mode: true,
      timestamp: Date.now()
    };
    
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
    
    return this.sendToServer("/tts", {
      text: text,
      conversation_mode: false,
      timestamp: Date.now()
    });
  }
}

// Control Panel for testing and settings
class TTSControlPanel {
  constructor(monitor) {
    this.monitor = monitor;
    this.currentText = "";
    this.createPanel();
  }
  
  createPanel() {
    if (document.getElementById('smart-tts-controls')) return;
    
    const panel = document.createElement('div');
    panel.id = 'smart-tts-controls';
    panel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: white; padding: 16px; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      min-width: 320px; font-family: system-ui;
      border: 1px solid #333;
    `;
    
    panel.innerHTML = `
      <div style="text-align: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: #4dabf7;">🎤 Smart Claude TTS</h3>
        <div id="status" style="font-size: 12px; color: #868e96; margin-top: 4px;">
          Ready
        </div>
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
          <div style="position: relative;">
            <input type="checkbox" id="conversation-toggle" ${this.monitor.conversationMode ? 'checked' : ''} 
                   style="position: absolute; opacity: 0; width: 0; height: 0;">
            <div id="toggle-slider" style="
              width: 50px; height: 26px; border-radius: 13px;
              background: ${this.monitor.conversationMode ? '#4dabf7' : '#495057'};
              position: relative; transition: background 0.3s;
            ">
              <div id="toggle-circle" style="
                position: absolute; top: 3px; left: ${this.monitor.conversationMode ? '26px' : '3px'};
                width: 20px; height: 20px; border-radius: 50%;
                background: white; transition: left 0.3s;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              "></div>
            </div>
          </div>
          <span style="font-weight: 600; color: #f8f9fa;">Auto Stream Mode</span>
        </label>
      </div>
      
      <div style="margin-bottom: 16px;">
        <button id="detect-btn" style="
          width: 100%; padding: 10px; border: none; border-radius: 8px;
          background: #4dabf7; color: white; font-weight: 600;
          cursor: pointer; transition: background 0.2s;
        ">🔍 Detect Response</button>
      </div>
      
      <div style="margin-bottom: 16px;">
        <button id="manual-tts-btn" style="
          width: 100%; padding: 10px; border: none; border-radius: 8px;
          background: #ffd43b; color: #212529; font-weight: 600;
          cursor: pointer; opacity: 0.5; transition: all 0.2s;
        " disabled>🔊 Manual TTS</button>
      </div>
      
      <div style="
        background: #212529; border-radius: 8px; padding: 12px;
        max-height: 120px; overflow-y: auto;
        border: 1px solid #343a40;
      ">
        <div style="font-size: 12px; color: #adb5bd; margin-bottom: 8px;">Detected Text:</div>
        <div id="text-preview" style="
          font-family: monospace; font-size: 11px; 
          color: #e9ecef; line-height: 1.4;
        ">No text detected</div>
      </div>
    `;
    
    document.body.appendChild(panel);
    this.attachEventListeners();
  }
  
  attachEventListeners() {
    // Toggle conversation mode
    const toggle = document.getElementById('conversation-toggle');
    const slider = document.getElementById('toggle-slider');
    const circle = document.getElementById('toggle-circle');
    
    toggle.addEventListener('change', () => {
      this.monitor.conversationMode = toggle.checked;
      
      slider.style.background = toggle.checked ? '#4dabf7' : '#495057';
      circle.style.left = toggle.checked ? '26px' : '3px';
      
      chrome.storage.local.set({ conversationMode: toggle.checked });
      
      if (toggle.checked) {
        this.monitor.startMonitoring();
        this.updateStatus('Monitoring active');
      } else {
        this.monitor.stopMonitoring();
        this.updateStatus('Manual mode');
      }
    });
    
    // Detect button
    document.getElementById('detect-btn').addEventListener('click', () => {
      this.detectAndDisplay();
    });
    
    // Manual TTS button
    document.getElementById('manual-tts-btn').addEventListener('click', () => {
      if (this.currentText) {
        this.monitor.sendManualTTS(this.currentText);
      }
    });
    
    // Start monitoring if conversation mode is on
    if (this.monitor.conversationMode) {
      this.monitor.startMonitoring();
      this.updateStatus('Monitoring active');
    }
  }
  
  detectAndDisplay() {
    const response = this.monitor.findClaudeResponse();
    
    if (!response) {
      this.updatePreview('❌ No Claude response found');
      this.updateStatus('No response detected');
      return;
    }
    
    const text = response.textContent.trim();
    this.currentText = text;
    
    this.updatePreview(text);
    this.updateStatus(`Detected ${text.length} characters`);
    
    // Enable manual TTS button
    const btn = document.getElementById('manual-tts-btn');
    btn.disabled = false;
    btn.style.opacity = '1';
  }
  
  updatePreview(text) {
    const preview = document.getElementById('text-preview');
    if (!preview) return;
    
    let displayText = text;
    if (text.length > 300) {
      displayText = text.substring(0, 300) + `...\n\n(${text.length} total characters)`;
    }
    
    preview.textContent = displayText || 'No text';
  }
  
  updateStatus(message) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.style.color = message.includes('❌') ? '#ff6b6b' : 
                          message.includes('✅') || message.includes('Monitoring') ? '#4dabf7' : 
                          '#868e96';
    }
  }
}

// Initialize
const monitor = new ClaudeStreamMonitor();
const controlPanel = new TTSControlPanel(monitor);

// Export for debugging
window.claudeTTSMonitor = monitor;
