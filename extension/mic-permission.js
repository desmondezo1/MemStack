navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    stream.getTracks().forEach(t => t.stop());
    document.getElementById('status').textContent = 'Microphone allowed. Closing this tab…';
    // Close ourselves so the agent goes back to working on your real tab.
    setTimeout(() => chrome.tabs.getCurrent(tab => tab && chrome.tabs.remove(tab.id)), 900);
  })
  .catch(err => {
    document.getElementById('status').textContent = `Not allowed (${err.name}). Allow the microphone in Chrome's site settings for this extension.`;
  });
