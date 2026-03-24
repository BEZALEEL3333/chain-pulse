import type { FourByteResult } from "../types";

// ─── Hardcoded known event signatures ────────────────────────────────────────
const KNOWN_SIGNATURES: Record<string, string> = {
  // ERC-20
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
    "Transfer(address,address,uint256)",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925":
    "Approval(address,address,uint256)",
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31":
    "ApprovalForAll(address,address,bool)",

  // Uniswap / DEX
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1":
    "Sync(uint112,uint112)",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822":
    "Swap(address,uint256,uint256,uint256,uint256,address)",
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f":
    "Mint(address,uint256,uint256)",
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496":
    "Burn(address,uint256,uint256,address)",

  // ERC-721 / ERC-1155
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62":
    "TransferSingle(address,address,address,uint256,uint256)",
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb":
    "TransferBatch(address,address,address,uint256[],uint256[])",

  // General
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0":
    "OwnershipTransferred(address,address)",
  "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258":
    "Paused(address)",
  "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa":
    "Unpaused(address)",
};

// ─── In-memory cache for 4byte lookups ───────────────────────────────────────
const cache = new Map<string, string | null>();

// ─── Extract just the event name from a full signature ───────────────────────
function extractEventName(signature: string): string {
  return signature.split("(")[0];
}

// ─── Fetch from 4byte.directory ───────────────────────────────────────────────
async function fetchFrom4Byte(topicHash: string): Promise<string | null> {
  try {
    // console.log("[4byte] Fetching:", topicHash);
    const res = await fetch(
      `https://www.4byte.directory/api/v1/event-signatures/?hex_signature=${topicHash}`
    );
    // console.log("[4byte] Status:", res.status);
    // console.log("[4byte] Response:", await res.text());

    if (!res.ok) return null;
    const data: FourByteResult = await res.json();
    if (data.results.length > 0) {
      // Return highest-id result (most recently added = most likely correct)
      const sorted = [...data.results].sort((a, b) => b.id - a.id);
      return sorted[0].text_signature;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main decode function ─────────────────────────────────────────────────────
export async function decodeTopic(topicHash: string): Promise<{
  eventName: string;
  signature: string | null;
}> {
  if (!topicHash) return { eventName: "Unknown", signature: null };

  // 1. Check hardcoded map
  const known = KNOWN_SIGNATURES[topicHash.toLowerCase()];
  if (known) {
    return { eventName: extractEventName(known), signature: known };
  }

  // 2. Check cache (including null = "already looked up, not found")
  if (cache.has(topicHash)) {
    const cached = cache.get(topicHash) ?? null;
    return cached
      ? { eventName: extractEventName(cached), signature: cached }
      : { eventName: shortHash(topicHash), signature: null };
  }

  // 3. Fetch from 4byte.directory
  const result = await fetchFrom4Byte(topicHash);
  cache.set(topicHash, result);

  if (result) {
    return { eventName: extractEventName(result), signature: result };
  }

  return { eventName: shortHash(topicHash), signature: null };
}

// ─── Fallback: short hash display e.g. "0xddf252..." ─────────────────────────
function shortHash(hash: string): string {
  return hash.slice(0, 10) + "…";
}