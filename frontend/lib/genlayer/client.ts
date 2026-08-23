"use client";

import { createClient } from "genlayer-js";
import * as glChains from "genlayer-js/chains";
import { createWalletClient, custom, type WalletClient } from "viem";

/**
 * GenLayer network configuration.
 *
 * Defaults target the **Bradbury testnet** (where the FactVerifier contract is
 * deployed), but every value is overridable via NEXT_PUBLIC_* env vars, so the
 * same build can point at a local Studio by editing `.env.local`.
 */
export const GENLAYER_CHAIN_ID = parseInt(
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "4221"
);
export const GENLAYER_CHAIN_ID_HEX = `0x${GENLAYER_CHAIN_ID.toString(16).toUpperCase()}`;

export const GENLAYER_EXPLORER_URL =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ||
  "https://explorer-bradbury.genlayer.com";

export const GENLAYER_NETWORK = {
  chainId: GENLAYER_CHAIN_ID_HEX,
  chainName:
    process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME || "GenLayer Bradbury Testnet",
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    symbol: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    decimals: 18,
  },
  rpcUrls: [
    process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ||
      "https://rpc-bradbury.genlayer.com",
  ],
  blockExplorerUrls: GENLAYER_EXPLORER_URL ? [GENLAYER_EXPLORER_URL] : [],
};

/** Extract a lowercased host from a URL, or "" if it can't be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Resolve the genlayer-js chain object to drive the SDK client.
 *
 * genlayer-js bundles several named chains (studionet, localnet, testnetAsimov,
 * testnetBradbury…). IMPORTANT: multiple GenLayer testnets currently share the
 * same numeric `id` (both Asimov and Bradbury report id 4221) while carrying
 * DIFFERENT consensus-contract addresses and RPC URLs — and genlayer-js builds
 * *writes* against the chain's consensus contracts. Matching on `id` alone is
 * therefore ambiguous and can silently target the wrong network's contracts.
 *
 * We resolve in priority order:
 *   1. explicit `NEXT_PUBLIC_GENLAYER_CHAIN_KEY` (exact genlayer-js export name),
 *   2. the bundled chain whose default RPC host matches the configured RPC —
 *      the RPC URL is the real source of truth for which network we talk to,
 *      and it disambiguates chains that share an id,
 *   3. the bundled chain whose numeric `id` matches (last-resort, ambiguous),
 *   4. a chain synthesized from `studionet` (e.g. local Studio / custom RPC),
 *      overriding only the network identity.
 */
function resolveActiveChain(): any {
  const named = glChains as Record<string, any>;
  const candidates = Object.values(named).filter(
    (c) => c && typeof c === "object" && "id" in c
  );

  // 1. explicit override by genlayer-js export name
  const key = process.env.NEXT_PUBLIC_GENLAYER_CHAIN_KEY;
  if (key && named[key] && typeof named[key] === "object" && "id" in named[key]) {
    return named[key];
  }

  // 2. match by RPC host (disambiguates id collisions like Asimov vs Bradbury)
  const rpcHost = hostOf(getStudioUrl());
  if (rpcHost) {
    const byRpc = candidates.find((c) => {
      const http =
        c?.rpcUrls?.default?.http?.[0] ?? c?.rpcUrls?.public?.http?.[0];
      return http && hostOf(http) === rpcHost;
    });
    if (byRpc) {
      return byRpc;
    }
  }

  // 3. match by numeric id (ambiguous across testnets — last resort)
  const byId = candidates.find((c) => Number((c as any).id) === GENLAYER_CHAIN_ID);
  if (byId) {
    return byId;
  }

  // 4. synthesize from studionet (local Studio / unrecognized custom RPC)
  const base: any = named.studionet ?? candidates[0] ?? {};
  return {
    ...base,
    id: GENLAYER_CHAIN_ID,
    name: GENLAYER_NETWORK.chainName,
    nativeCurrency: GENLAYER_NETWORK.nativeCurrency,
    rpcUrls: {
      default: { http: [getStudioUrl()] },
      public: { http: [getStudioUrl()] },
    },
    ...(GENLAYER_EXPLORER_URL
      ? {
          blockExplorers: {
            default: { name: "Explorer", url: GENLAYER_EXPLORER_URL },
          },
        }
      : {}),
  };
}

/** The genlayer-js chain object used for all clients in the app. */
export const activeChain = resolveActiveChain();

// EIP-1193 injected provider (MetaMask, Rabby, or any compatible wallet).
interface EthereumProvider {
  isMetaMask?: boolean;
  isRabby?: boolean;
  /** Present when multiple wallets are installed; each entry is a provider. */
  providers?: EthereumProvider[];
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

/**
 * Get the GenLayer RPC URL from environment variables (defaults to Bradbury).
 */
export function getStudioUrl(): string {
  return (
    process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ||
    "https://rpc-bradbury.genlayer.com"
  );
}

/**
 * Get the FactVerifier contract address.
 *
 * Defaults to the live Bradbury deployment so the app works out of the box;
 * override with NEXT_PUBLIC_CONTRACT_ADDRESS to point at another deployment.
 */
export function getContractAddress(): string {
  return (
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    "0x0341797e201C1e697E89a199E6bC0e2e0bF5193a"
  );
}

/** Explorer base URL (no trailing slash). */
export function getExplorerUrl(): string {
  return GENLAYER_EXPLORER_URL.replace(/\/$/, "");
}

/** Explorer link for an address. */
export function getExplorerAddressUrl(address: string): string {
  return `${getExplorerUrl()}/address/${address}`;
}

/** Explorer link for a transaction hash. */
export function getExplorerTxUrl(hash: string): string {
  return `${getExplorerUrl()}/tx/${hash}`;
}

/**
 * Get the injected EIP-1193 provider (MetaMask, Rabby, or any compatible wallet).
 *
 * When several wallets are installed they expose themselves through
 * `window.ethereum.providers`. We prefer Rabby, then MetaMask, then whatever is
 * first — so a user with both installed connects through Rabby.
 */
export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const injected = window.ethereum;
  if (!injected) return null;

  const list = injected.providers;
  if (Array.isArray(list) && list.length > 0) {
    return (
      list.find((p) => p?.isRabby) ??
      list.find((p) => p?.isMetaMask) ??
      list[0]
    );
  }
  return injected;
}

/**
 * Whether any Web3 wallet (MetaMask, Rabby, …) is available to connect.
 */
export function isWalletInstalled(): boolean {
  return getEthereumProvider() !== null;
}

/**
 * Human-readable name of the active injected wallet, for UI copy.
 */
export function getWalletName(): string {
  const provider = getEthereumProvider();
  if (!provider) return "wallet";
  if (provider.isRabby) return "Rabby";
  if (provider.isMetaMask) return "MetaMask";
  return "your wallet";
}

/**
 * Request accounts from the connected wallet
 * @returns Array of addresses
 */
export async function requestAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();

  if (!provider) {
    throw new Error("No wallet detected");
  }

  try {
    const accounts = await provider.request({
      method: "eth_requestAccounts",
    });
    return accounts;
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected the connection request");
    }
    throw new Error(`Failed to connect wallet: ${error.message}`);
  }
}

/**
 * Get current MetaMask accounts without requesting permission
 * @returns Array of addresses
 */
export async function getAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();

  if (!provider) {
    return [];
  }

  try {
    const accounts = await provider.request({
      method: "eth_accounts",
    });
    return accounts;
  } catch (error) {
    console.error("Error getting accounts:", error);
    return [];
  }
}

/**
 * Get the current chain ID from MetaMask
 */
export async function getCurrentChainId(): Promise<string | null> {
  const provider = getEthereumProvider();

  if (!provider) {
    return null;
  }

  try {
    const chainId = await provider.request({
      method: "eth_chainId",
    });
    return chainId;
  } catch (error) {
    console.error("Error getting chain ID:", error);
    return null;
  }
}

/**
 * Add GenLayer network to MetaMask
 */
export async function addGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();

  if (!provider) {
    throw new Error("No wallet detected");
  }

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [GENLAYER_NETWORK],
    });
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected adding the network");
    }
    throw new Error(`Failed to add GenLayer network: ${error.message}`);
  }
}

/**
 * Switch to GenLayer network
 */
export async function switchToGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();

  if (!provider) {
    throw new Error("No wallet detected");
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: GENLAYER_CHAIN_ID_HEX }],
    });
  } catch (error: any) {
    // If the chain is not added, add it
    if (error.code === 4902) {
      await addGenLayerNetwork();
    } else if (error.code === 4001) {
      throw new Error("User rejected switching the network");
    } else {
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }
}

/**
 * Check if we're on the GenLayer network
 */
export async function isOnGenLayerNetwork(): Promise<boolean> {
  const chainId = await getCurrentChainId();

  if (!chainId) {
    return false;
  }

  // Convert both to decimal for comparison
  const currentChainIdDecimal = parseInt(chainId, 16);
  return currentChainIdDecimal === GENLAYER_CHAIN_ID;
}

/**
 * Connect the injected wallet and ensure we're on the GenLayer network
 * @returns The connected address
 */
export async function connectMetaMask(): Promise<string> {
  if (!isWalletInstalled()) {
    throw new Error("No wallet detected");
  }

  // Request accounts
  const accounts = await requestAccounts();

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found");
  }

  // Check and switch to GenLayer network
  const onCorrectNetwork = await isOnGenLayerNetwork();

  if (!onCorrectNetwork) {
    await switchToGenLayerNetwork();
  }

  return accounts[0];
}

/**
 * Request user to switch MetaMask account
 * Shows MetaMask account picker even if already connected
 * Uses wallet_requestPermissions to force account selection dialog
 * @returns The newly selected account address
 */
export async function switchAccount(): Promise<string> {
  const provider = getEthereumProvider();

  if (!provider) {
    throw new Error("No wallet detected");
  }

  try {
    // Request permissions - this shows account picker
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });

    // Get the newly selected account
    const accounts = await provider.request({
      method: "eth_accounts",
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No account selected");
    }

    return accounts[0];
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected account switch");
    } else if (error.code === -32002) {
      throw new Error("Account switch request already pending");
    }
    throw new Error(`Failed to switch account: ${error.message}`);
  }
}

/**
 * Create a viem wallet client from MetaMask provider
 */
export function createMetaMaskWalletClient(): WalletClient | null {
  const provider = getEthereumProvider();

  if (!provider) {
    return null;
  }

  try {
    return createWalletClient({
      chain: activeChain as any,
      transport: custom(provider),
    });
  } catch (error) {
    console.error("Error creating wallet client:", error);
    return null;
  }
}

/**
 * Create a GenLayer client with MetaMask account
 *
 * Note: The genlayer-js SDK doesn't directly support custom transports like viem.
 * When an address is provided, the SDK will use the window.ethereum provider
 * automatically for transaction signing via MetaMask.
 */
export function createGenLayerClient(address?: string) {
  const config: any = {
    chain: activeChain,
    endpoint: getStudioUrl(),
  };

  if (address) {
    config.account = address as `0x${string}`;
    // Sign through the SAME injected wallet the user connected with. genlayer-js
    // otherwise defaults to `window.ethereum`, which — when multiple wallets are
    // installed — may not be the one the user selected (e.g. Rabby vs MetaMask).
    // Passing the resolved provider keeps reads, the pre-send chain check, and
    // signing all on one wallet.
    const provider = getEthereumProvider();
    if (provider) {
      config.provider = provider;
    }
  }

  try {
    return createClient(config);
  } catch (error) {
    console.error("Error creating GenLayer client:", error);
    // Return client without account on error
    return createClient({
      chain: activeChain,
      endpoint: getStudioUrl(),
    });
  }
}

/**
 * Get a client instance with MetaMask account
 */
export async function getClient() {
  const accounts = await getAccounts();
  const address = accounts[0];
  return createGenLayerClient(address);
}
