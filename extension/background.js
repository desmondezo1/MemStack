// Toolbar icon opens the side panel; the "talk" shortcut (⌥Space by default, change it at
// chrome://extensions/shortcuts) opens the panel and starts listening. Clicking Mo on a
// page asks for the same thing.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// Exposed on self so tests can trigger it without a real key press.
self.handleTalk = async function handleTalk(tab) {
  // sidePanel.open must run first, while Chrome still counts this as a user action.
  const opening = tab?.windowId ? chrome.sidePanel.open({ windowId: tab.windowId }).then(() => true, () => false) : Promise.resolve(false);
  await chrome.storage.session.set({ listenAt: Date.now(), listenTabId: tab?.id ?? null });
  // An already-open panel hears this at once; a panel that is just opening reads listenAt.
  chrome.runtime.sendMessage({ type: 'showme:listen', tabId: tab?.id ?? null }).catch(() => {});
  return opening;
};

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'talk') self.handleTalk(tab);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'showme:talk') {
    self.handleTalk(sender.tab).then(opened => reply({ ok: true, opened }));
    return true;
  }
  if (msg.type === 'showme:open-panel') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(() => reply({ ok: true }), err => reply({ ok: false, error: err.message }));
    return true;
  }
  return false;
});
