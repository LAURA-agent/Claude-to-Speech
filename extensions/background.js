// background.js
console.log("Claude TTS Background Script loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ttsRequest") {
    handleTTSRequest(message.endpoint, message.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  }
});

async function handleTTSRequest(endpoint, data) {
  try {
    const response = await fetch(`http://127.0.0.1:5000${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Server error ${response.status}: ${await response.text()}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('TTS request failed:', error);
    throw error;
  }
}

console.log("Background script initialization complete");
