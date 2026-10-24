// Mo's New Tab page: an address ("example.com", "localhost:8787/demo", a full URL)
// opens; anything else is a web search with the user's default search engine.
const ADDRESS = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^\s/]+\.[a-z]{2,})(:\d+)?(\/\S*)?$/i;

document.getElementById('go').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  if (/^[a-z]+:\/\//i.test(q)) location.href = q;
  else if (ADDRESS.test(q)) location.href = `${/^(localhost|\d)/i.test(q) ? 'http' : 'https'}://${q}`;
  else chrome.search.query({ text: q, disposition: 'CURRENT_TAB' });
});
