# FactVerifier x402 — pay-per-verdict fact-checking API

One factual claim verified by GenLayer consensus, paid **$0.10 USDC on Base
Sepolia** through the [x402](https://www.x402.org/) protocol (v2, `exact`
scheme). No API key, no account, no signup. This is the Internet Court
Partner Demo Lab entry: x402 (payment, layer 04) + GenLayer (verification,
layer 06) working together. GenLayer is the product, not decoration: without
the consensus verdict there is nothing to sell.

## Endpoints (live)

Base URL: `https://genlayer-factverifier.vercel.app`

| Endpoint | Auth | What it does |
|---|---|---|
| `GET /api/verify?claim=...&sources=...&sources=...` | x402, $0.10 USDC | Submits the claim to FactVerifier on GenLayer Studio Dev, returns `claim_id` + `tx_hash` immediately |
| `GET /api/claim/<id>` | free | Polls the verdict: `status`, `consensus_score`, per-source results, reasoning |

Payment details (from the live `402` response): scheme `exact`, network
`eip155:84532` (Base Sepolia), amount `100000` (= $0.10, USDC has 6
decimals), asset `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle USDC on
Base Sepolia), payTo `0x65cbf00EcD3D5c1091378A841f986997eFc42462`, facilitator
`https://x402.org/facilitator`.

## Quick start (demo client)

```bash
cd scripts && npm install
export DEMO_PRIVATE_KEY=0x...   # payer wallet; needs >= $0.10 Base Sepolia
                                # USDC per check. NEVER commit this key.
node x402-demo-client.mjs
```

The client does the full flow and prints timings: unpaid request (expect
402) -> paid request (expect `claim_id` + `tx_hash`) -> poll until the
verdict lands (~1-2 min). Options: `--api URL`, `--claim "..."`,
`--source URL` (repeatable), `--category`, `--context`, `--no-pay` (only the
402 check), `--claim-id claim_N` (poll an existing claim),
`--poll-timeout SECONDS` (default 300).

## Calling the API by hand

```bash
# 1. Unpaid request -> 402 with payment terms in the Payment-Required header
curl -s "https://genlayer-factverifier.vercel.app/api/verify?claim=The%20Eiffel%20Tower%20is%20in%20Paris.&sources=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FEiffel_Tower&sources=https%3A%2F%2Fsimple.wikipedia.org%2Fwiki%2FEiffel_Tower"

# 2. Pay with any x402 v2 client (e.g. @x402/fetch + viem, see
#    scripts/x402-demo-client.mjs): sign the EIP-3009 authorization for
#    $0.10 USDC, retry with the X-PAYMENT header. The facilitator settles
#    on-chain; the payer only signs off-chain (no ETH needed for gas).
#    The paid response is { claim_id, tx_hash, status: "submitted",
#    stake_wei, fee_wei, poll_url }.

# 3. Poll for the verdict (free, every ~15s)
curl -s "https://genlayer-factverifier.vercel.app/api/claim/claim_1"
```

## Rules and limits

- `claim`: required, max 1000 chars.
- `sources`: required, 2-5 URLs, distinct domains, `http(s)`.
- `category`: optional, max 100 chars (default `general`). `context`:
  optional, max 500 chars.
- Sources **must be fetchable by the GenLayer validators**. A source that
  403s the fetcher (e.g. Britannica) fails the whole claim *after* payment:
  consensus fails, no claim is created, and the server fee is still spent.
  Wikipedia / Simple Wikipedia are proven to work. The API pre-checks
  source reachability and returns 400 (no charge) if a source is dead.
- Verdicts: `verified` (consensus score >= 70), `refuted` (<= 30),
  `disputed`, `insufficient_sources`, `pending` while consensus runs.
- The payment is settled **only** if the handler succeeds (HTTP < 400). A
  400 (bad input / unreachable source) or 502 (GenLayer submit failed)
  means the client is NOT charged.
- One check costs the payer $0.10 USDC. The server also pays ~0.075 GEN in
  consensus fees plus a 0.01 GEN stake from its demo wallet per claim.

## Funding a payer wallet (testnet)

- USDC on Base Sepolia: Circle faucet at https://faucet.circle.com
  (20 USDC per address per chain, every 2 hours, no account). Pick
  **Base Sepolia**. The correct USDC contract is
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- ETH on Base Sepolia (gas): any Base Sepolia ETH faucet. Only a tiny
  amount is needed; the x402 payer signs off-chain and the facilitator
  pays settlement gas.

## How it works under the hood

1. `GET /api/verify` is wrapped in `withX402` (`@x402/next`). No payment
   header -> 402 with the terms above.
2. A paid request is verified with the facilitator, then the handler
   validates the input, pre-checks source reachability, and submits the
   claim to the FactVerifier contract
   (`0xD0C23F62660e68fF2A6D70369aF33CDE5822fe11`) on GenLayer Studio Dev
   (chain 61997) from a demo wallet. Submit -> FINALIZED takes ~77s.
3. Validators fetch every source, run per-source LLM analysis, and reach
   consensus by semantic equivalence. `GET /api/claim/<id>` reads the
   on-chain claim back.

Code: `frontend/app/api/verify/route.ts`,
`frontend/app/api/claim/[id]/route.ts`,
`frontend/lib/genlayer/server.ts` (genlayer-js v2, bundled `studioDevnet`
chain). Contract: `contracts/fact_verifier.py`.
