import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { SDK } from "@somnia-chain/reactivity";
import { createPublicClient, defineChain, webSocket } from "viem";
import { decodeTopic } from "./lib/topicDecoder";
import type {
  ChainEvent,
  SessionState,
  WatchedContract,
  GasStats,
  ExtensionMessage,
  ExtensionMessageResponse,
  ExplorerTxResult,
} from "./types/index";

// ─── Somnia Testnet ───────────────────────────────────────────────────────────
const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { decimals: 18, name: "STT", symbol: "STT" },
  rpcUrls: {
    default: {
      http: ["https://dream-rpc.somnia.network"],
      webSocket: ["wss://api.infra.testnet.somnia.network/ws"],
    },
  },
});

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_EVENTS = 100;
const RATE_WINDOW_MS = 30_000;
const SESSION_KEY = "chainpulse_state";
const LOCAL_KEY = "chainpulse_watchlist";
const KEEPALIVE_ALARM = "keepalive";
const STATS_ALARM = "stats_poll";
const EXPLORER_BASE = "https://somnia.w3us.site/api";

// ─── Rolling window ───────────────────────────────────────────────────────────
const eventTimestamps: number[] = [];

// ─── Default state ────────────────────────────────────────────────────────────
const defaultState: SessionState = {
  events: [],
  metrics: { eventsPerSec: 0, totalEvents: 0, windowEvents: 0 },
  connectionStatus: "disconnected",
  lastError: null,
  gasStats: null,
  blockNumber: "—",
  blockTime: "—",
};

// ─── Session storage ──────────────────────────────────────────────────────────
async function getState(): Promise<SessionState> {
  try {
    const r = await chrome.storage.session.get(SESSION_KEY);
    return (r[SESSION_KEY] as SessionState) ?? defaultState;
  } catch {
    return defaultState;
  }
}

async function setState(partial: Partial<SessionState>): Promise<void> {
  const current = await getState();
  await chrome.storage.session.set({ [SESSION_KEY]: { ...current, ...partial } });
}

// ─── Local storage (watchlist persists) ──────────────────────────────────────
async function getWatchlist(): Promise<WatchedContract[]> {
  try {
    const r = await chrome.storage.local.get(LOCAL_KEY);
    return (r[LOCAL_KEY] as WatchedContract[]) ?? [];
  } catch {
    return [];
  }
}

async function saveWatchlist(list: WatchedContract[]): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEY]: list });
}

// ─── Rate metrics ─────────────────────────────────────────────────────────────
function updateMetrics(totalEvents: number): { eventsPerSec: number; windowEvents: number } {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  eventTimestamps.push(now);
  while (eventTimestamps.length > 0 && eventTimestamps[0] < cutoff) eventTimestamps.shift();
  const windowEvents = eventTimestamps.length;
  const eventsPerSec = parseFloat((windowEvents / (RATE_WINDOW_MS / 1000)).toFixed(2));
  return { eventsPerSec, windowEvents };
}

// ─── Network stats ────────────────────────────────────────────────────────────
async function fetchNetworkStats(): Promise<{ blockNumber: string; blockTime: string }> {
  let blockNumber = "—";
  let blockTime = "—";
  try {
    const res = await fetch(`${EXPLORER_BASE}?module=block&action=eth_block_number`);
    if (res.ok) {
      const data = await res.json();
      if (data.result) {
        const latest = parseInt(data.result, 16);
        blockNumber = latest.toLocaleString();
        const [b1Res, b2Res] = await Promise.all([
          fetch("https://dream-rpc.somnia.network", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${latest.toString(16)}`, false] }),
          }),
          fetch("https://dream-rpc.somnia.network", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [`0x${(latest - 1).toString(16)}`, false] }),
          }),
        ]);
        if (b1Res.ok && b2Res.ok) {
          const b1 = await b1Res.json();
          const b2 = await b2Res.json();
          const t1 = parseInt(b1.result?.timestamp, 16);
          const t2 = parseInt(b2.result?.timestamp, 16);
          if (t1 && t2 && t1 > t2) {
            const diff = (t1 - t2) * 1000;
            blockTime = diff < 1000 ? `${diff}ms` : `${(diff / 1000).toFixed(2)}s`;
          }
        }
      }
    }
  } catch { /* silent */ }
  return { blockNumber, blockTime };
}

// ─── Gas stats ────────────────────────────────────────────────────────────────
async function fetchGasStats(): Promise<GasStats | null> {
  try {
    const res = await fetch(
      `${EXPLORER_BASE}?module=account&action=txlist&address=0x0000000000000000000000000000000000000100&sort=desc&page=1&offset=20`
    );
    if (!res.ok) return null;
    const data: ExplorerTxResult = await res.json();
    if (data.status !== "1" || !Array.isArray(data.result) || data.result.length === 0) return null;

    const gasValues = data.result
      .map((tx) => parseInt(tx.gasUsed))
      .filter((v) => !isNaN(v) && v > 0);

    if (gasValues.length === 0) return null;

    const avgGasUsed = Math.round(gasValues.reduce((a, b) => a + b, 0) / gasValues.length);
    const highestGasUsed = Math.max(...gasValues);
    const lowestGasUsed = Math.min(...gasValues);

    return { avgGasUsed, highestGasUsed, lowestGasUsed, sampleSize: gasValues.length, lastUpdated: Date.now() };
  } catch {
    return null;
  }
}

// ─── Watchlist notification ───────────────────────────────────────────────────
async function notifyWatchlistHit(event: ChainEvent, contract: WatchedContract): Promise<void> {
  chrome.notifications.create(`watchlist-${event.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon48.png"),
    title: `Chain Pulse: Watched Contract Active`,
    message: `${event.eventName} from ${contract.label || contract.address.slice(0, 8) + "…"}`,
    priority: 2,
  });
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#0EA5E9" });
}

// ─── Active subscription ──────────────────────────────────────────────────────
let currentSubscription: { unsubscribe: () => void } | null = null;

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect(): Promise<void> {
  if (currentSubscription) {
    try { currentSubscription.unsubscribe(); } catch { /* ignore */ }
    currentSubscription = null;
  }

  await setState({ connectionStatus: "connecting", lastError: null });

  try {
    const publicClient = createPublicClient({
      chain: somniaTestnet,
      transport: webSocket("wss://api.infra.testnet.somnia.network/ws"),
    });

    const sdk = new SDK({ public: publicClient });

    const result = await sdk.subscribe({
      ethCalls: [],
      onData: async (data: {
        result: { address: string; topics: string[]; data: string; simulationResults: unknown[] };
      }) => {
        const raw = data.result;
        const topicHash = raw.topics?.[0] ?? "";
        const { eventName, signature } = await decodeTopic(topicHash);

        // Check against watchlist
        const watchlist = await getWatchlist();
        const watchedContract = watchlist.find(
          (w) => w.address.toLowerCase() === raw.address.toLowerCase()
        );
        const isWatched = !!watchedContract;

        const event: ChainEvent = {
          id: `${raw.address}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          address: raw.address,
          topics: raw.topics,
          data: raw.data,
          eventName,
          signature,
          isWatched,
        };

        // Notify if watched
        if (isWatched && watchedContract) {
          await notifyWatchlistHit(event, watchedContract);
          // Increment event count
          const updated = watchlist.map((w) =>
            w.address.toLowerCase() === raw.address.toLowerCase()
              ? { ...w, eventCount: w.eventCount + 1 }
              : w
          );
          await saveWatchlist(updated);
        }

        const state = await getState();
        const combined = [event, ...state.events];

        // Smart cap — preserve known events
        let capped = combined;
        if (combined.length > MAX_EVENTS) {
          const known = combined.filter((e) => e.signature !== null || e.isWatched);
          const unknown = combined.filter((e) => e.signature === null && !e.isWatched);
          if (known.length >= MAX_EVENTS) {
            capped = known.slice(0, MAX_EVENTS);
          } else {
            capped = [...known, ...unknown.slice(0, MAX_EVENTS - known.length)];
          }
          capped.sort((a, b) => b.timestamp - a.timestamp);
        }

        const totalEvents = state.metrics.totalEvents + 1;
        const { eventsPerSec, windowEvents } = updateMetrics(totalEvents);

        await setState({
          events: capped,
          metrics: { eventsPerSec, totalEvents, windowEvents },
        });
      },
    });

    if (result instanceof Error) throw result;
    currentSubscription = result;
    await setState({ connectionStatus: "connected" });
    console.log("[Chain Pulse] Connected to Somnia Testnet");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Chain Pulse] Connection failed:", message);
    await setState({ connectionStatus: "error", lastError: message });
    setTimeout(connect, 5000);
  }
}

// ─── Alarms ───────────────────────────────────────────────────────────────────
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
chrome.alarms.create(STATS_ALARM, { periodInMinutes: 0.5 }); // ~30 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    getState().then((state) => {
      if (state.connectionStatus === "disconnected" || state.connectionStatus === "error") {
        connect();
      }
    });
  }
  if (alarm.name === STATS_ALARM) {
    Promise.all([fetchNetworkStats(), fetchGasStats()]).then(([{ blockNumber, blockTime }, gasStats]) => {
      setState({ blockNumber, blockTime, gasStats });
    });
  }
});

// ─── Clear badge when popup opens ────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    chrome.action.setBadgeText({ text: "" });
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (r: ExtensionMessageResponse) => void) => {
    (async () => {
      try {
        switch (message.type) {
          case "GET_STATE": {
            const state = await getState();
            sendResponse({ ok: true, state });
            break;
          }
          case "CLEAR_EVENTS": {
            await setState({ events: [] });
            sendResponse({ ok: true });
            break;
          }
          case "RECONNECT": {
            await connect();
            sendResponse({ ok: true });
            break;
          }
          case "GET_WATCHLIST": {
            const watchlist = await getWatchlist();
            sendResponse({ ok: true, watchlist });
            break;
          }
          case "ADD_TO_WATCHLIST": {
            const watchlist = await getWatchlist();
            if (watchlist.length >= 5) {
              sendResponse({ ok: false, error: "Watchlist is full (max 5 contracts)" });
              break;
            }
            const exists = watchlist.some((w) => w.address.toLowerCase() === message.address.toLowerCase());
            if (exists) {
              sendResponse({ ok: false, error: "Contract already in watchlist" });
              break;
            }
            const updated = [...watchlist, {
              address: message.address,
              label: message.label,
              addedAt: Date.now(),
              eventCount: 0,
            }];
            await saveWatchlist(updated);
            sendResponse({ ok: true, watchlist: updated });
            break;
          }
          case "REMOVE_FROM_WATCHLIST": {
            const watchlist = await getWatchlist();
            const updated = watchlist.filter((w) => w.address.toLowerCase() !== message.address.toLowerCase());
            await saveWatchlist(updated);
            sendResponse({ ok: true, watchlist: updated });
            break;
          }
          default:
            sendResponse({ ok: false, error: "Unknown message type" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }
);

// ─── Boot ─────────────────────────────────────────────────────────────────────
connect();
Promise.all([fetchNetworkStats(), fetchGasStats()]).then(([{ blockNumber, blockTime }, gasStats]) => {
  setState({ blockNumber, blockTime, gasStats });
});