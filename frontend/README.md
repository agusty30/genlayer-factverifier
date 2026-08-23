# FactVerifier — frontend

Next.js dApp for **FactVerifier**, a cross-source fact-verification oracle built as a
GenLayer Intelligent Contract. Every user action is a live transaction against the
deployed contract on **Bradbury testnet**:

- **Submit** a factual claim with 2–5 source URLs and a GEN stake. The contract fetches
  each source and runs per-source LLM analysis under the equivalence principle, recording
  a verdict + consensus score on-chain.
- **Read** the verdict, per-source support/refute breakdown, confidence, and evidence.
- **Dispute** a verdict with counter-sources and a matching stake — consensus is re-run and
  the winner takes the loser's stake, minus a protocol fee.
- **Finalize** an unchallenged claim (submitter only) and **withdraw** your balance
  (pull-payment).

Live contract: [`0x0341797e201C1e697E89a199E6bC0e2e0bF5193a`](https://explorer-bradbury.genlayer.com/address/0x0341797e201C1e697E89a199E6bC0e2e0bF5193a)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables. The defaults already point at the live Bradbury
   deployment, so this step is optional:

```bash
cp .env.example .env.local
```

   - `NEXT_PUBLIC_CONTRACT_ADDRESS` — FactVerifier contract address (defaults to the live one)
   - `NEXT_PUBLIC_GENLAYER_RPC_URL` — GenLayer RPC (default: `https://rpc-bradbury.genlayer.com`)
   - `NEXT_PUBLIC_GENLAYER_CHAIN_ID` — chain id (default: `4221`)
   - `NEXT_PUBLIC_GENLAYER_EXPLORER_URL` — block explorer base URL

   To develop against a local Studio instead, set the RPC URL and chain id to your Studio node.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Reads work with no wallet; submitting,
disputing, finalizing, and withdrawing require MetaMask connected to Bradbury and a little
GEN for stake and fees.

## Build

```bash
npm run build
npm start
```

## Deploy (Railway)

This app deploys to [Railway](https://railway.com) directly from the repo. It's an
npm-workspaces monorepo — the lockfile lives at the repo **root** — so point the Railway
service at the **repository root**, not this `frontend/` folder. The root `package.json`
scripts delegate the build here, and the root `railway.json` + `.nvmrc` pin the commands and
Node version, so there's effectively nothing to configure.

1. **New Project → Deploy from GitHub repo** and pick this repo.
2. **Root Directory:** leave it as the repo root. Do *not* set it to `frontend/` — `npm ci`
   needs the lockfile that only exists at the root.
3. Build and start commands are read from `railway.json` (`npm run build` / `npm run start`),
   and Node 22 from `.nvmrc`.
4. **Variables (optional):** every `NEXT_PUBLIC_*` value defaults to the live Bradbury
   deployment, so it runs with none set. To override, copy keys from `.env.example`. They are
   inlined at **build** time, so set them before the first deploy, not after.
5. Deploy. Railway serves the app over HTTPS (which wallets require to inject) and routes its
   injected `$PORT` to `next start` automatically.

> No backend and no secrets are involved — it's a client-side dApp (the build prerenders to
> static content) — so any static host (Vercel / Cloudflare Pages / Netlify) works equally
> well if you prefer one.

## Tech Stack

- **Next.js (App Router)** + **React 19** + **TypeScript**
- **Tailwind CSS v4** — glass-morphism dark theme
- **genlayer-js** — GenLayer blockchain SDK (reads/writes, MetaMask signing)
- **viem** — `parseEther`/`formatEther` for GEN amounts
- **TanStack Query** — data fetching, caching, invalidation
- **Radix UI** / shadcn-style primitives, **sonner** toasts

## How the frontend talks to GenLayer

- `lib/genlayer/client.ts` — network config + MetaMask helpers; resolves the genlayer-js
  chain for Bradbury (env-driven).
- `lib/contracts/FactVerifier.ts` — typed contract wrapper. Reads decode genlayer-js `Map`
  results into plain objects; writes send the stake as the payable `value` and poll the
  receipt with `waitForTransactionReceipt`.
- `lib/hooks/useFactVerifier.ts` — TanStack Query hooks (`useStats`, `useClaims`,
  `useStakeInfo`, `useClaimable`, `useOwner`) and mutations (`useSubmitClaim`,
  `useDisputeClaim`, `useFinalizeClaim`, `useWithdraw`, `useWithdrawTreasury`).
- `components/` — `StatsBar`, `ClaimsTable` + `ClaimDetail`, `SubmitClaimModal`,
  `DisputeModal`, `ClaimablePanel`.

## Features

- **Submit claims** with client-side validation mirroring the contract (2–5 sources,
  http(s), length bounds, distinct domains, prompt-injection guard).
- **Claims table** with status badges, consensus score, and per-source support counts;
  rows expand to full per-source analysis and settlement state.
- **Dispute / finalize / withdraw** flows with fee-preset selection (low / standard / high).
- **Live stats** — total claims, verified, refuted, disputes, staked GEN, treasury.
- **Explorer links** for the contract, submitters, and winners on Bradbury.
