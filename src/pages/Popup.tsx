import { useEffect, useRef, useState, useCallback } from "react";
import type {
  SessionState,
  ExtensionMessage,
  ChainEvent,
  WatchedContract,
  GasStats,
} from "../types/index";

// ─── Constants ────────────────────────────────────────────────────────────────
const FILTER_TYPES = [
  "All",
  "Transfer",
  "Approval",
  "Swap",
  "Sync",
  "Mint",
  "Burn",
  "Unknown",
] as const;
type FilterType = (typeof FILTER_TYPES)[number];
type Tab = "feed" | "watchlist" | "gas";

const DEFAULT_STATE: SessionState = {
  events: [],
  metrics: { eventsPerSec: 0, totalEvents: 0, windowEvents: 0 },
  connectionStatus: "disconnected",
  lastError: null,
  gasStats: null,
  blockNumber: "—",
  blockTime: "—",
};

async function sendMsg(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function eventAccent(name: string): { color: string; bg: string } {
  const n = name.toLowerCase();
  if (n.includes("transfer")) return { color: "#0ea5e9", bg: "#e0f2fe" };
  if (n.includes("approval") || n.includes("approve"))
    return { color: "#f59e0b", bg: "#fef3c7" };
  if (n.includes("swap")) return { color: "#10b981", bg: "#d1fae5" };
  if (n.includes("sync")) return { color: "#6366f1", bg: "#ede9fe" };
  if (n.includes("mint")) return { color: "#06b6d4", bg: "#cffafe" };
  if (n.includes("burn")) return { color: "#ef4444", bg: "#fee2e2" };
  return { color: "#64748b", bg: "#f1f5f9" };
}

function matchesFilter(event: ChainEvent, filter: FilterType): boolean {
  if (filter === "All") return true;
  const n = event.eventName.toLowerCase();
  if (filter === "Unknown")
    return !FILTER_TYPES.slice(1, -1).some((f) => n.includes(f.toLowerCase()));
  return n.includes(filter.toLowerCase());
}

function shortAddr(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatGas(gas: number): string {
  if (gas >= 1_000_000) return `${(gas / 1_000_000).toFixed(2)}M`;
  if (gas >= 1_000) return `${(gas / 1_000).toFixed(1)}K`;
  return String(gas);
}

function decodeTransfer(
  event: ChainEvent,
): { from: string; to: string; amount: string } | null {
  try {
    if (event.topics.length < 3) return null;
    const from = "0x" + event.topics[1].slice(-40);
    const to = "0x" + event.topics[2].slice(-40);
    const raw = BigInt(event.data === "0x" || !event.data ? "0x0" : event.data);
    const amount = raw === 0n ? "0" : (Number(raw) / 1e18).toFixed(4);
    return { from, to, amount };
  } catch {
    return null;
  }
}

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: SessionState["connectionStatus"] }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    connected: { label: "Live", color: "#10b981", bg: "#d1fae5" },
    connecting: { label: "Connecting…", color: "#f59e0b", bg: "#fef3c7" },
    disconnected: { label: "Disconnected", color: "#64748b", bg: "#f1f5f9" },
    error: { label: "Error", color: "#ef4444", bg: "#fee2e2" },
  };
  const s = map[status] ?? map.disconnected;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      {status === "connected" && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse-live"
          style={{ background: s.color }}
        />
      )}
      {s.label}
    </span>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center gap-0.5">
      <span
        className="font-['JetBrains_Mono'] text-[13px] font-medium tracking-tight leading-none"
        style={{ color: accent ?? "#0f172a" }}
      >
        {value}
      </span>
      <span className="text-[9px] text-slate-400 uppercase tracking-wider font-['DM_Sans']">
        {label}
      </span>
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────
function EventRow({ event, isNew }: { event: ChainEvent; isNew: boolean }) {
  const { color, bg } = eventAccent(event.eventName);
  const isTransfer = event.eventName.toLowerCase().includes("transfer");
  const transfer = isTransfer ? decodeTransfer(event) : null;

  return (
    <div
      className={`flex items-center gap-2 px-3.5 py-1.5 border-b border-slate-100 transition-colors hover:bg-sky-50/50 ${event.isWatched ? "bg-sky-50 border-l-[3px] border-l-sky-400 pl-[11px]" : event.signature ? "bg-[#fafcff]" : ""} ${isNew ? "animate-slide-in" : ""}`}
    >
      {/* event tag — dynamic color unavoidable */}
      <span
        className="font-['JetBrains_Mono'] text-[10px] font-medium px-1.5 py-0.5 rounded-[4px] whitespace-nowrap shrink-0"
        style={{ color, background: bg }}
      >
        {event.eventName}
      </span>

      <div className="flex-1 min-w-0 flex flex-col gap-px">
        {transfer ? (
          <>
            <span className="font-['JetBrains_Mono'] text-[10px] text-slate-500">
              {shortAddr(transfer.from)}
              <span className="text-slate-300 mx-0.5">→</span>
              {shortAddr(transfer.to)}
            </span>
            <span className="font-['JetBrains_Mono'] text-[10px] text-sky-500 font-medium">
              {transfer.amount} STT
            </span>
          </>
        ) : (
          <>
            <span className="font-['JetBrains_Mono'] text-[10px] text-slate-500">
              {shortAddr(event.address)}
            </span>
            {event.signature && (
              <span className="font-['JetBrains_Mono'] text-[9px] text-slate-300 truncate">
                {event.signature}
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {event.isWatched && <span className="text-[10px]">👁</span>}
        <span className="font-['JetBrains_Mono'] text-[9px] text-slate-300">
          {formatTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ─── Contract detail panel ────────────────────────────────────────────────────
function ContractDetail({
  contract,
  events,
  onBack,
  onRemove,
}: {
  contract: WatchedContract;
  events: ChainEvent[];
  onBack: () => void;
  onRemove: () => void;
}) {
  const contractEvents = events
    .filter((e) => e.address.toLowerCase() === contract.address.toLowerCase())
    .slice(0, 30);

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-slide-right">
      {/* back bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-white border-b border-slate-100">
        <button
          onClick={onBack}
          className="text-sky-500 font-semibold text-[12px] font-['DM_Sans'] hover:opacity-75 transition-opacity"
        >
          ← Back
        </button>
        <button
          onClick={onRemove}
          className="text-[11px] text-red-400 border border-red-200 px-2.5 py-1 rounded-md font-['DM_Sans'] hover:bg-red-50 transition-colors"
        >
          Remove
        </button>
      </div>

      {/* contract info */}
      <div className="px-3.5 py-3 border-b border-slate-100 bg-gradient-to-b from-sky-50 to-white">
        <div className="font-['Syne'] text-[14px] font-bold text-slate-800 mb-1">
          {contract.label || "Unlabelled Contract"}
        </div>
        <div className="font-['JetBrains_Mono'] text-[10px] text-slate-400 break-all mb-3">
          {contract.address}
        </div>
        <div className="flex">
          {[
            { value: String(contract.eventCount), label: "total events" },
            { value: String(contractEvents.length), label: "in feed" },
            {
              value: contract.addedAt
                ? new Date(contract.addedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                : "—",
              label: "added at",
            },
          ].map((stat, i, arr) => (
            <div
              key={stat.label}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 ${i < arr.length - 1 ? "border-r border-slate-100" : ""}`}
            >
              <span className="font-['JetBrains_Mono'] text-[15px] font-medium text-sky-500">
                {stat.value}
              </span>
              <span className="text-[9px] text-slate-400 uppercase tracking-wider font-['DM_Sans']">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* event list header */}
      <div className="px-3.5 py-1.5 bg-white border-b border-slate-100 font-['Syne'] text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        Recent Events
      </div>

      {/* event list */}
      <div className="flex-1 overflow-y-auto">
        {contractEvents.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-[12px] text-slate-400 font-['DM_Sans']">
            No events from this contract yet
          </div>
        ) : (
          contractEvents.map((ev) => {
            const { color, bg } = eventAccent(ev.eventName);
            return (
              <div
                key={ev.id}
                className="flex items-center gap-2 px-3.5 py-1.5 border-b border-slate-100 hover:bg-sky-50/50 transition-colors"
              >
                <span
                  className="font-['JetBrains_Mono'] text-[10px] font-medium px-1.5 py-0.5 rounded-[4px] whitespace-nowrap shrink-0"
                  style={{ color, background: bg }}
                >
                  {ev.eventName}
                </span>
                <div className="flex-1 min-w-0">
                  {ev.signature && (
                    <span className="font-['JetBrains_Mono'] text-[9px] text-slate-300 truncate block">
                      {ev.signature}
                    </span>
                  )}
                </div>
                <span className="font-['JetBrains_Mono'] text-[9px] text-slate-300 shrink-0">
                  {formatTime(ev.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Watchlist tab ────────────────────────────────────────────────────────────
function WatchlistTab({ events }: { events: ChainEvent[] }) {
  const [watchlist, setWatchlist] = useState<WatchedContract[]>([]);
  const [addrInput, setAddrInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<WatchedContract | null>(null);

  useEffect(() => {
    sendMsg({ type: "GET_WATCHLIST" }).then((res) => {
      const r = res as { ok: boolean; watchlist?: WatchedContract[] };
      if (r?.ok && r.watchlist) setWatchlist(r.watchlist);
    });
  }, []);

  const handleAdd = async () => {
    const addr = addrInput.trim();
    const label = labelInput.trim();
    if (!addr) {
      setError("Enter a contract address");
      return;
    }
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setError("Invalid address format");
      return;
    }
    setLoading(true);
    setError("");
    const res = (await sendMsg({
      type: "ADD_TO_WATCHLIST",
      address: addr,
      label,
    })) as { ok: boolean; watchlist?: WatchedContract[]; error?: string };
    setLoading(false);
    if (res?.ok && res.watchlist) {
      setWatchlist(res.watchlist);
      setAddrInput("");
      setLabelInput("");
    } else setError(res?.error ?? "Failed to add");
  };

  const handleRemove = async (address: string) => {
    const res = (await sendMsg({ type: "REMOVE_FROM_WATCHLIST", address })) as {
      ok: boolean;
      watchlist?: WatchedContract[];
    };
    if (res?.ok && res.watchlist) {
      setWatchlist(res.watchlist);
      setSelected(null);
    }
  };

  if (selected) {
    return (
      <ContractDetail
        contract={selected}
        events={events}
        onBack={() => setSelected(null)}
        onRemove={() => handleRemove(selected.address)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-2.5 p-3.5 overflow-y-auto animate-fade-in">
      <p className="text-[11px] text-slate-500 leading-relaxed font-['DM_Sans']">
        Watch up to 5 contracts. Get a notification whenever they emit an event.
      </p>

      <div className="flex flex-col gap-1.5">
        <input
          className="w-full bg-slate-50 border border-slate-200 text-slate-800 font-['JetBrains_Mono'] text-[11px] px-2.5 py-1.5 rounded-md outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 placeholder:text-slate-300 transition-all"
          type="text"
          placeholder="Contract address (0x…)"
          value={addrInput}
          onChange={(e) => setAddrInput(e.target.value)}
          spellCheck={false}
        />
        <input
          className="w-full bg-slate-50 border border-slate-200 text-slate-800 font-['JetBrains_Mono'] text-[11px] px-2.5 py-1.5 rounded-md outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 placeholder:text-slate-300 transition-all"
          type="text"
          placeholder="Label (optional)"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={loading || watchlist.length >= 5}
          className="w-full py-2 rounded-md text-[12px] font-semibold text-white font-['DM_Sans'] bg-gradient-to-r from-sky-500 to-indigo-500 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {loading
            ? "…"
            : watchlist.length >= 5
              ? "Full (5/5)"
              : "Add Contract"}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-red-500 bg-red-50 px-2.5 py-1.5 rounded-md font-['DM_Sans']">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5 flex-1">
        {watchlist.length === 0 ? (
          <div className="text-center text-slate-400 text-[12px] font-['DM_Sans'] py-8">
            No contracts watched yet
          </div>
        ) : (
          watchlist.map((w) => (
            <div
              key={w.address}
              onClick={() => setSelected(w)}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2.5 cursor-pointer hover:border-sky-300 hover:shadow-sm transition-all"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-['DM_Sans'] text-[12px] font-semibold text-slate-800">
                  {w.label || shortAddr(w.address)}
                </span>
                <span className="font-['JetBrains_Mono'] text-[10px] text-slate-400">
                  {shortAddr(w.address)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-['JetBrains_Mono'] text-[10px] text-sky-500 bg-sky-50 px-1.5 py-0.5 rounded-full">
                  {w.eventCount} events
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(w.address);
                  }}
                  className="w-5 h-5 flex items-center justify-center text-[10px] text-slate-400 border border-slate-200 rounded hover:border-red-300 hover:text-red-400 transition-all"
                >
                  ✕
                </button>
                <span className="text-slate-300 text-[16px] leading-none">
                  ›
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-[10px] text-slate-300 font-['JetBrains_Mono'] text-right mt-auto">
        {watchlist.length} / 5 slots used
      </div>
    </div>
  );
}

// ─── Gas tab ──────────────────────────────────────────────────────────────────
function GasTab({ gasStats }: { gasStats: GasStats | null }) {
  if (!gasStats) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[12px] text-slate-400 font-['DM_Sans']">
        <div className="w-5 h-5 border-2 border-slate-200 border-t-sky-400 rounded-full animate-spin-slow" />
        <p>Fetching gas data…</p>
      </div>
    );
  }

  const updated = new Date(gasStats.lastUpdated).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const range = gasStats.highestGasUsed - gasStats.lowestGasUsed || 1;
  const avgPct = ((gasStats.avgGasUsed - gasStats.lowestGasUsed) / range) * 100;

  return (
    <div className="flex-1 flex flex-col gap-3 p-3.5 overflow-y-auto animate-fade-in">
      <p className="text-[11px] text-slate-500 leading-relaxed font-['DM_Sans']">
        Gas usage from the last {gasStats.sampleSize} transactions on Somnia
        Testnet.
      </p>

      {/* Gas cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "Average",
            value: formatGas(gasStats.avgGasUsed),
            color: "#0ea5e9",
            border: "border-sky-200",
            bg: "bg-sky-50",
          },
          {
            label: "Highest",
            value: formatGas(gasStats.highestGasUsed),
            color: "#ef4444",
            border: "border-red-200",
            bg: "bg-red-50",
          },
          {
            label: "Lowest",
            value: formatGas(gasStats.lowestGasUsed),
            color: "#10b981",
            border: "border-emerald-200",
            bg: "bg-emerald-50",
          },
        ].map((card) => (
          <div
            key={card.label}
            className={`flex flex-col items-center gap-0.5 p-2.5 rounded-xl border ${card.border} ${card.bg}`}
          >
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider font-['DM_Sans']">
              {card.label}
            </span>
            <span
              className="font-['JetBrains_Mono'] text-[17px] font-medium leading-none"
              style={{ color: card.color }}
            >
              {card.value}
            </span>
            <span className="text-[9px] text-slate-400 font-['DM_Sans']">
              gas used
            </span>
          </div>
        ))}
      </div>

      {/* Bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-['JetBrains_Mono'] text-[9px] text-slate-400">
          <span>{formatGas(gasStats.lowestGasUsed)}</span>
          <span>avg</span>
          <span>{formatGas(gasStats.highestGasUsed)}</span>
        </div>
        <div className="h-1.5 bg-slate-200 rounded-full relative overflow-visible">
          <div
            className="h-full rounded-full opacity-40 bg-gradient-to-r from-sky-400 to-indigo-400"
            style={{ width: `${avgPct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-sky-500 rounded-full border-2 border-white shadow-sm"
            style={{ left: `${avgPct}%`, transform: "translate(-50%, -50%)" }}
          />
        </div>
      </div>

      <div className="text-[9px] text-slate-300 font-['JetBrains_Mono'] text-center mt-auto">
        Updated at {updated} · refreshes every 30s
      </div>
    </div>
  );
}

// ─── Main Popup ───────────────────────────────────────────────────────────────
export default function Popup() {
  const [state, setState] = useState<SessionState>(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState<Tab>("feed");
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const prevEventIds = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: "GET_STATE" })) as {
        ok: boolean;
        state?: SessionState;
      };
      if (res?.ok && res.state) setState(res.state);
    } catch {
      /* not ready */
    }
  }, []);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "popup" });
    fetchState();
    pollRef.current = setInterval(fetchState, 800);
    return () => {
      port.disconnect();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchState]);

  const handleClear = async () => {
    await sendMsg({ type: "CLEAR_EVENTS" });
    setState((s) => ({ ...s, events: [] }));
    prevEventIds.current.clear();
  };

  const handleReconnect = async () => {
    await sendMsg({ type: "RECONNECT" });
  };

  const newIds = new Set<string>();
  for (const ev of state.events) {
    if (!prevEventIds.current.has(ev.id)) newIds.add(ev.id);
  }
  useEffect(() => {
    prevEventIds.current = new Set(state.events.map((e) => e.id));
  }, [state.events]);

  const filteredEvents = state.events.filter((ev) =>
    matchesFilter(ev, activeFilter),
  );
  const { metrics, connectionStatus, lastError } = state;

  return (
    <div className="w-[380px] min-h-[560px] max-h-[600px] flex flex-col bg-slate-50 overflow-hidden">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-3.5 py-2.5 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-100 to-indigo-100 flex items-center justify-center shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M2 12h4l3-9 4 18 3-9h6"
                stroke="url(#g)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient
                  id="g"
                  x1="2"
                  y1="12"
                  x2="22"
                  y2="12"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#0ea5e9" />
                  <stop offset="1" stopColor="#6366f1" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="font-['Syne'] text-[15px] font-extrabold tracking-tight bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
            Chain Pulse
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill status={connectionStatus} />
          {connectionStatus !== "connected" && (
            <button
              onClick={handleReconnect}
              className="w-6 h-6 flex items-center justify-center text-[13px] text-slate-400 border border-slate-200 rounded-md hover:border-sky-400 hover:text-sky-500 transition-all"
            >
              ↺
            </button>
          )}
        </div>
      </header>

      {/* ── Gradient bar ── */}
      <div className="h-[3px] bg-gradient-to-r from-sky-400 to-indigo-400 opacity-70" />

      {/* ── Error banner ── */}
      {lastError && (
        <div className="bg-red-50 border-b border-red-100 text-red-500 text-[11px] px-3.5 py-1.5 font-['JetBrains_Mono']">
          ⚠ {lastError}
        </div>
      )}

      {/* ── Metrics strip ── */}
      <div className="flex items-center px-3.5 py-2.5 bg-white border-b border-slate-100 shadow-sm">
        <MetricCard
          value={metrics.eventsPerSec.toFixed(2)}
          label="evt / sec"
          accent="#0ea5e9"
        />
        <div className="w-px h-7 bg-slate-100 mx-1 shrink-0" />
        <MetricCard value={String(metrics.windowEvents)} label="last 30s" />
        <div className="w-px h-7 bg-slate-100 mx-1 shrink-0" />
        <MetricCard
          value={metrics.totalEvents.toLocaleString()}
          label="total"
          accent="#6366f1"
        />
        <div className="w-px h-7 bg-slate-100 mx-1 shrink-0" />
        <MetricCard value={state.blockNumber} label="block" accent="#10b981" />
        <div className="w-px h-7 bg-slate-100 mx-1 shrink-0" />
        <MetricCard value={state.blockTime} label="blk time" accent="#f59e0b" />
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-100 bg-white">
        {(["feed", "watchlist", "gas"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[12px] font-medium font-['DM_Sans'] flex items-center justify-center gap-1.5 border-b-2 transition-all ${activeTab === tab ? "border-sky-500 text-sky-500" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            {tab === "feed" && (
              <>
                Feed{" "}
                {state.events.length > 0 && (
                  <span className="text-[9px] text-white bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 rounded-full font-['JetBrains_Mono']">
                    {filteredEvents.length}
                  </span>
                )}
              </>
            )}
            {tab === "watchlist" && "Watchlist"}
            {tab === "gas" && (
              <>
                Gas{" "}
                {state.gasStats && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_4px_#38bdf8]" />
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* ── Feed tab ── */}
      {activeTab === "feed" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* feed toolbar */}
          <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-50">
            <div className="flex items-center gap-1.5">
              <span className="font-['Syne'] text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Event Stream
              </span>
              <span className="text-[9px] text-white bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 rounded-full font-['JetBrains_Mono']">
                {filteredEvents.length}
              </span>
            </div>
            <button
              onClick={handleClear}
              className="text-[10px] text-slate-400 border border-slate-200 px-2.5 py-0.5 rounded-md hover:border-red-300 hover:text-red-400 font-['DM_Sans'] transition-all"
            >
              Clear
            </button>
          </div>

          {/* filter pills */}
          <div
            className="flex items-center gap-1 px-3.5 py-1.5 overflow-x-auto border-b border-slate-100 bg-white scrollbar-none"
            style={{ scrollbarWidth: "none" }}
          >
            {FILTER_TYPES.map((f) => {
              const count =
                f === "All"
                  ? state.events.length
                  : state.events.filter((ev) => matchesFilter(ev, f)).length;
              const isActive = activeFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium font-['DM_Sans'] whitespace-nowrap shrink-0 border transition-all ${isActive ? "bg-gradient-to-r from-sky-500 to-indigo-500 border-transparent text-white" : "bg-white border-slate-200 text-slate-500 hover:border-sky-300 hover:text-sky-500"}`}
                >
                  {f}
                  {count > 0 && (
                    <span
                      className={`text-[9px] px-1 rounded-full font-['JetBrains_Mono'] ${isActive ? "bg-white/25 text-white" : "bg-slate-100 text-slate-400"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* events */}
          <div className="flex-1 overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 h-48 text-[12px] text-slate-400 font-['DM_Sans']">
                {connectionStatus === "connecting" ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-sky-400 rounded-full animate-spin-slow" />
                    <p>Connecting to Somnia…</p>
                  </>
                ) : connectionStatus === "connected" &&
                  activeFilter !== "All" ? (
                  <p>
                    No <strong>{activeFilter}</strong> events yet
                  </p>
                ) : connectionStatus === "connected" ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.4)] animate-pulse-live" />
                    <p>Waiting for events…</p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-medium">Not connected</p>
                    <button
                      onClick={handleReconnect}
                      className="text-[11px] font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-1.5 rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                    >
                      Reconnect
                    </button>
                  </>
                )}
              </div>
            ) : (
              filteredEvents.map((ev) => (
                <EventRow key={ev.id} event={ev} isNew={newIds.has(ev.id)} />
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "watchlist" && <WatchlistTab events={state.events} />}
      {activeTab === "gas" && <GasTab gasStats={state.gasStats} />}

      {/* ── Footer ── */}
      <footer className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 border-t border-slate-100 bg-white font-['JetBrains_Mono'] text-[9px] text-slate-300 tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-sky-400 to-indigo-400 shrink-0" />
        Somnia Testnet · Chain ID 50312
      </footer>
    </div>
  );
}