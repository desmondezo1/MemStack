# MemStack
A memory stack project

**Show Me** — the browser agent you teach by hand. You say a task, the agent tries it in the browser, and
when it fails you show it once. Every step you demonstrate goes through [Mubit](https://docs.mubit.ai) as a
training example, so the agent's decision step becomes a small model we own.

- Idea, demo script and build plan: [docs/IDEA.md](docs/IDEA.md)
- Run and test it locally: [TESTING.md](TESTING.md)

## Quick start

```bash
npm install
npm start          # backend on http://localhost:8787 (mock model until you add a Mubit key)
```

Then load `extension/` as an unpacked extension in Chrome, open <http://localhost:8787/demo/> and click the
Show Me icon. Details in [TESTING.md](TESTING.md).

## How it fits together

| Part | What it does |
| --- | --- |
| `extension/content.js` | Reads the page as a short list of interactive elements (text, no screenshots), performs actions, records your demonstrations. |
| `extension/sidepanel.*` | Goal box with voice, agent loop, "Show me how" teaching flow, ledger. |
| `server/index.js` | Backend the extension calls. Holds the Mubit key; Mubit refuses browser calls. |
| `server/llm.js` | Sends every model call to Claude (or OpenAI) through Mubit's gateway; mock model when no key is set. |
| `server/prompts.js` | The three fixed system prompts, one per Mubit task: `next-action`, `done-check`, `safety-gate`. |
| `server/memory.js` | MemStack memory: demonstrations, recalled into later runs on the same page. |
| `server/ledger.js` | Local log of every call for the ledger: counts, latency, cost. |
| `server/demo-site/` | Trattoria Nove, the stage demo page. |
| `scripts/seed-traffic.js` | Sends varied calls through Mubit so tasks reach 25 kept examples and train. |
