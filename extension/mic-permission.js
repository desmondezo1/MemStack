navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    stream.getTracks().forEach(t => t.stop());
    document.getElementById('status').textContent = 'Microphone allowed. You can close this tab.';
  })
  .catch(err => {
    document.getElementById('status').textContent = `Not allowed (${err.name}). Allow the microphone in Chrome's site settings for this extension.`;
  });
