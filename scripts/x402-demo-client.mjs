#!/usr/bin/env node
/**
 * Demo client for the FactVerifier x402 pay-per-verdict API.
 *
 * One claim verified by GenLayer consensus, paid $0.10 USDC on Base Sepolia
 * via the x402 protocol (v2, exact scheme, facilitator https://x402.org).
 * The payer only signs an off-chain EIP-3009 authorization; the facilitator
 * settles it on-chain. No API key, no account, no signup.
 *
 *   1. Plain request (no payment)  -> expect HTTP 402 with payment terms.
 *   2. Paid request (x402-fetch)   -> expect 200 with claim_id + tx_hash.
 *   3. Poll GET /api/claim/<id>    -> verdict (verified / refuted / ...).
 *
 * Setup:
 *   cd scripts && npm install
 *   export DEMO_PRIVATE_KEY=0x...   # payer wallet; needs Base Sepolia USDC
 *                                    # (>= $0.10 per check) + a little ETH.
 *                                    # NEVER commit this key.
 *
 * Usage:
 *   node x402-demo-client.mjs [--api URL] [--claim "..."] [--source URL ...]
 *   node x402-demo-client.mjs --no-pay            # only step 1 (402 check)
 *   node x402-demo-client.mjs --claim-id claim_3  # only step 3 (poll existing)
 *
 * Defaults verify "The Eiffel Tower is in Paris." against Wikipedia +
 * Simple Wikipedia (sources the GenLayer validators can fetch; avoid
 * sites that 403 bots, e.g. Britannica — a 403 source fails consensus
 * after payment, see SKILL.md).
 */

import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_API = "https://genlayer-factverifier.vercel.app";
const DEFAULT_CLAIM = "The Eiffel Tower is in Paris.";
const DEFAULT_SOURCES = [
  "https://en.wikipedia.org/wiki/Eiffel_Tower",
  "https://simple.wikipedia.org/wiki/Eiffel_Tower",
];
const NETWORK = "eip155:84532"; // Base Sepolia
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 300_000;
const TERMINAL = new Set(["verified", "refuted", "disputed", "insufficient_sources"]);

function parseArgs(argv) {
  const out = {
    api: DEFAULT_API,
    claim: DEFAULT_CLAIM,
    sources: [],
    category: "general",
    context: "",
    noPay: false,
    claimId: "",
    pollTimeoutMs: POLL_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api") out.api = argv[++i];
    else if (a === "--claim") out.claim = argv[++i];
    else if (a === "--source") out.sources.push(argv[++i]);
    else if (a === "--category") out.category = argv[++i];
    else if (a === "--context") out.context = argv[++i];
    else if (a === "--no-pay") out.noPay = true;
    else if (a === "--claim-id") out.claimId = argv[++i];
    else if (a === "--poll-timeout") out.pollTimeoutMs = Number(argv[++i]) * 1000;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node x402-demo-client.mjs [--api URL] [--claim ...] [--source URL ...] [--category ...] [--context ...] [--no-pay] [--claim-id claim_N] [--poll-timeout SECONDS]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (out.sources.length === 0) out.sources = DEFAULT_SOURCES;
  out.api = out.api.replace(/\/$/, "");
  return out;
}

function verifyUrl(api, { claim, sources, category, context }) {
  const u = new URL(`${api}/api/verify`);
  u.searchParams.set("claim", claim);
  for (const s of sources) u.searchParams.append("sources", s);
  if (category) u.searchParams.set("category", category);
  if (context) u.searchParams.set("context", context);
  return u.toString();
}

function decodePaymentRequired(header) {
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return { raw: header };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollVerdict(api, claimId, timeoutMs) {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    const res = await fetch(`${api}/api/claim/${claimId}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const status = body.status ?? body.claim?.status ?? "unknown";
      const score = body.consensus_score ?? body.claim?.consensus_score ?? "?";
      console.log(`[poll ${attempt} +${elapsed}s] status=${status} consensus_score=${score}`);
      if (TERMINAL.has(status)) {
        console.log("--- verdict ---");
        console.log(JSON.stringify(body, null, 2));
        return body;
      }
    } else {
      // 404 not_found is expected until the submit tx finalizes on-chain
      // (consensus takes ~1-2 min); keep polling.
      console.log(`[poll ${attempt} +${elapsed}s] HTTP ${res.status} (${body.status ?? body.error ?? "?"}) — waiting for chain`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Poll timed out after ${Math.round(timeoutMs / 1000)}s; claim ${claimId} has no terminal verdict yet`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.claimId) {
    console.log(`Polling existing claim ${opts.claimId} ...`);
    await pollVerdict(opts.api, opts.claimId, opts.pollTimeoutMs);
    return;
  }

  const url = verifyUrl(opts.api, opts);
  console.log(`API: ${opts.api}`);
  console.log(`Claim: ${opts.claim}`);
  console.log(`Sources: ${opts.sources.join(", ")}`);

  // Step 1: unpaid request, expect 402.
  console.log("\n--- step 1: unpaid request (expect 402) ---");
  const t1 = Date.now();
  const unpaid = await fetch(url);
  console.log(`HTTP ${unpaid.status} in ${Date.now() - t1}ms`);
  const terms = decodePaymentRequired(
    unpaid.headers.get("payment-required") ?? unpaid.headers.get("Payment-Required")
  );
  if (unpaid.status !== 402) {
    console.error(`Expected 402, got ${unpaid.status}: ${await unpaid.text()}`);
    process.exit(1);
  }
  console.log("Payment terms:", JSON.stringify(terms?.accepts ?? terms, null, 2));
  if (opts.noPay) {
    console.log("OK: server asks for payment before verifying. (--no-pay, stopping here.)");
    return;
  }

  // Step 2: paid request via x402-fetch.
  const key = process.env.DEMO_PRIVATE_KEY;
  if (!key || !key.startsWith("0x")) {
    console.error("DEMO_PRIVATE_KEY env var is required for the paid request (payer wallet).");
    process.exit(2);
  }
  const account = privateKeyToAccount(key);
  console.log(`\n--- step 2: paid request (payer ${account.address}) ---`);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  });
  const t2 = Date.now();
  const paid = await fetchWithPayment(url);
  const paidMs = Date.now() - t2;
  console.log(`HTTP ${paid.status} in ${paidMs}ms`);
  const payResp = paid.headers.get("payment-response") ?? paid.headers.get("Payment-Response");
  if (payResp) {
    try {
      console.log("Payment response:", JSON.stringify(decodePaymentResponseHeader(payResp), null, 2));
    } catch {
      console.log("Payment response (raw):", payResp.slice(0, 200));
    }
  }
  const data = await paid.json().catch(() => ({}));
  if (!paid.ok) {
    console.error("Paid request failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log("Paid response:", JSON.stringify(data, null, 2));
  if (!data.claim_id) {
    console.error("No claim_id in paid response; cannot poll.");
    process.exit(1);
  }

  // Step 3: poll for the verdict.
  console.log(`\n--- step 3: poll ${opts.api}/api/claim/${data.claim_id} until verdict ---`);
  const verdict = await pollVerdict(opts.api, data.claim_id, opts.pollTimeoutMs);
  const totalS = ((Date.now() - t2) / 1000).toFixed(0);
  console.log(`\nDone in ~${totalS}s from paid request to verdict.`);
  console.log(`Claim: ${data.claim_id} | tx: ${data.tx_hash}`);
  console.log(`Explorer: https://explorer-studio-dev.genlayer.com/tx/${data.tx_hash}`);
  const status = verdict.status ?? verdict.claim?.status;
  if (status !== "verified") {
    console.log(`Note: final status is "${status}", not "verified" — see the verdict body above.`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
