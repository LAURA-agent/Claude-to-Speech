// background.js
console.log("Claude TTS Background Script loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 console.log("Received message:", message);
 
 if (message.action === "processText") {
   // Send request to local TTS server
   fetch('http://127.0.0.1:5000/tts', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ text: message.text })
   })
   .then(response => response.json())
   .then(data => {
     console.log("TTS server response:", data);
     sendResponse(data);
   })
   .catch(error => {
     console.error('Error:', error);
     sendResponse({success: false, error: error.toString()});
   });
   
   return true; // Indicates we'll respond asynchronously
 }
});

console.log("Background script initialization complete");