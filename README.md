# Chain Pulse

*Live On-Chain Event Intelligence for Somnia Testnet — Right in Your Browser*

## 🚀 Overview

**Chain Pulse** is a Chrome extension that streams live blockchain events from the Somnia Testnet directly into your browser toolbar. Powered entirely by the **Somnia Reactivity SDK**, it gives you a real-time decoded view of everything happening on-chain — with smart event filtering, contract watchlist, gas tracking, network stats, and Transfer decoding built in.

No block explorer. No refreshing. No polling. Just the chain, live.

## Cover Image

![Cover Image](https://i.ibb.co/XZ36Nf99/unnamed-5.jpg)

## Download

Check the [releases](https://github.com/bezaleel3333/chain-pulse/releases) page

## 🎮 Core Features

### Live Event Stream
- Persistent WebSocket connection via Somnia Reactivity SDK — survives popup close/reopen
- Events stream in real time directly from the Somnia Testnet
- Smart feed cap — known events (Transfer, Swap, Approval etc.) are preserved when the feed fills up, unknowns are trimmed first
- Watched contract events are always preserved and highlighted in the feed

### Topic Filter
- Filter the live feed by event type — All, Transfer, Approval, Swap, Sync, Mint, Burn, Unknown
- Scrollable pill strip with live counts per category
- Feed updates instantly on filter change

### Transfer Decoder
- Transfer events show decoded `from → to` addresses and STT amount inline
- No external API needed — decoded directly from `topics[1]`, `topics[2]`, and `data`

### Contract Watchlist
- Watch up to 5 contract addresses and get alerted the moment they emit any event
- Desktop notification + blue badge on the extension icon fires instantly
- Badge persists until you open the popup
- Per-contract event counter tracked across the session
- Click any contract row to open a **detail panel** showing full address, stats, and a list of recent events from that contract
- Watchlist stored in `chrome.storage.local` — persists across browser restarts

![Demo](https://i.ibb.co/wF5Qr5Bt/Chain-Pulse-Demo-Gifonline-video-cutter-com-ezgif-com-video-to-gif-converter.gif)

### Gas Tracker
- Average, highest, and lowest gas used sampled from recent Somnia Testnet transactions
- Visual range bar with an average marker
- Refreshes automatically every 30 seconds

### Event Rate Metrics
- Live events/sec over a 30-second rolling window
- Total event count since extension started
- Window event count for quick burst detection

### Network Stats
- Latest block number fetched from Somnia BlockScout Explorer
- Average block time calculated from consecutive block timestamps
- Both refresh every 30 seconds automatically

### Topic Decoder
- Hardcoded lookup for common ERC-20 / ERC-721 event signatures — instant, no API call
- Falls back to 4byte.directory for unknown hashes
- Each hash fetched exactly once per session, cached in memory

## 🧠 How Somnia Reactivity Powers This

The entire event stream runs through a single persistent subscription in the background service worker:

```ts
const sdk = new SDK({ public: publicClient });

const result = await sdk.subscribe({
  ethCalls: [],
  onData: async (data) => {
    // every on-chain event arrives here in real time
  },
});
```

The service worker stays alive via Chrome alarms even when the popup is closed — meaning you never miss an event. State is shared between background and popup via `chrome.storage.session`. The watchlist persists across sessions via `chrome.storage.local`.

## 📦 Tech Stack

| Layer               | Technology                                   |
| ------------------- | -------------------------------------------- |
| Extension           | Chrome MV3, Vite + vite-plugin-web-extension |
| Frontend            | React + TypeScript, Tailwind CSS v4          |
| Blockchain          | Somnia Testnet (Reactivity SDK + viem)       |
| Session State       | chrome.storage.session                       |
| Persistent State    | chrome.storage.local (watchlist)             |
| Event Decoding      | Hardcoded map + 4byte.directory API          |
| Network & Gas Stats | Somnia BlockScout Explorer API               |

## 🔧 Setup & Installation

### Prerequisites
- Node.js 18+
- pnpm
- Google Chrome or Brave

### Installation

```bash
# Clone the repository
git clone https://github.com/bezaleel3333/chain-pulse.git
cd chain-pulse

# Install dependencies
pnpm install
```

### Build & Load

```bash
# Start dev build with watch mode
pnpm dev
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Click the extension icon in your toolbar

### Production Build

```bash
pnpm build
```

## 🛠 Project Structure

```
src/
├── background.ts          # Service worker — SDK, watchlist, gas polling, notifications
├── popup.tsx              # React entry point
├── popup.html             # Popup shell with font imports
├── popup.css              # Global styles, Tailwind v4, keyframe animations
├── manifest.json          # Chrome MV3 manifest
├── types/
│   └── index.ts           # Shared TypeScript types
├── lib/
│   └── topicDecoder.ts    # Topic hash → signature resolution + 4byte cache
└── pages/
    └── Popup.tsx          # Main UI — Feed, Watchlist, Gas tabs (pure Tailwind)
```

## 🎯 Problem & Solution

**Problem:** On-chain events are noisy and hard to read — block explorers show raw hashes with no context, there's no way to monitor specific contracts in real time, and there's no live gas visibility from your browser.

**Solution:** Chain Pulse sits in your toolbar and gives you a clean, filtered, decoded view of the Somnia Testnet event stream. Watch specific contracts, track gas trends, decode Transfer events, and monitor network stats — all in a lightweight popup that runs 24/7 in the background.

## ✅ What's Next

1. Multi-contract event correlation — see relationships between watched contracts
2. Export — download the event feed as CSV
3. Custom notification rules — alert only on specific event types per contract
4. Mainnet support when Somnia Reactivity goes live

---

Built for the Somnia Reactivity Hackathon. Every event you see is a live signal from the chain. No polling. No faking it.
