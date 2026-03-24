// ─── Raw event from Somnia Reactivity SDK ────────────────────────────────────
export interface RawChainEvent {
  address: string;
  topics: string[];
  data: string;
  simulationResults: unknown[];
}

// ─── Processed event ──────────────────────────────────────────────────────────
export interface ChainEvent {
  id: string;
  timestamp: number;
  address: string;
  topics: string[];
  data: string;
  eventName: string;
  signature: string | null;
  isWatched: boolean;
}

// ─── Rate metrics ─────────────────────────────────────────────────────────────
export interface RateMetrics {
  eventsPerSec: number;
  totalEvents: number;
  windowEvents: number;
}

// ─── Watchlist entry ──────────────────────────────────────────────────────────
export interface WatchedContract {
  address: string;
  label: string;
  addedAt: number;
  eventCount: number;
}

// ─── Gas stats ────────────────────────────────────────────────────────────────
export interface GasStats {
  avgGasUsed: number;
  highestGasUsed: number;
  lowestGasUsed: number;
  sampleSize: number;
  lastUpdated: number;
}

// ─── Session storage schema ───────────────────────────────────────────────────
export interface SessionState {
  events: ChainEvent[];
  metrics: RateMetrics;
  connectionStatus: "connecting" | "connected" | "disconnected" | "error";
  lastError: string | null;
  gasStats: GasStats | null;
  blockNumber: string;
  blockTime: string;
}

// ─── Messages between popup ↔ background ─────────────────────────────────────
export type ExtensionMessage =
  | { type: "GET_STATE" }
  | { type: "CLEAR_EVENTS" }
  | { type: "RECONNECT" }
  | { type: "ADD_TO_WATCHLIST"; address: string; label: string }
  | { type: "REMOVE_FROM_WATCHLIST"; address: string }
  | { type: "GET_WATCHLIST" };

export type ExtensionMessageResponse =
  | { ok: true; state: SessionState }
  | { ok: true; watchlist: WatchedContract[] }
  | { ok: true }
  | { ok: false; error: string };

// ─── 4byte.directory API ──────────────────────────────────────────────────────
export interface FourByteResult {
  results: Array<{
    id: number;
    text_signature: string;
    hex_signature: string;
  }>;
}

// ─── BlockScout API ───────────────────────────────────────────────────────────
export interface ExplorerTxResult {
  status: string;
  message: string;
  result: Array<{
    hash: string;
    gasUsed: string;
    from: string;
    to: string;
    timeStamp: string;
  }>;
}