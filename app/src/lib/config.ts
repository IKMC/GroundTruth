import type { Hex } from "viem"

const env = import.meta.env

export const CONFIG = {
  backendUrl: (env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8787",
  chainId: Number(env.VITE_CHAIN_ID ?? 11155111),
  rpcUrl: (env.VITE_RPC_URL as string | undefined) ?? "https://ethereum-sepolia-rpc.publicnode.com",
  genesisDate: (env.VITE_GENESIS_DATE as string | undefined) ?? "2026-10-01",
  oracle: env.VITE_ORACLE as Hex | undefined,
  token: env.VITE_TOKEN as Hex | undefined,
  subscription: env.VITE_SUBSCRIPTION as Hex | undefined,
  usdc: env.VITE_USDC as Hex | undefined,
}

/** True once the contract addresses have been set in .env. The app still works without them (NASA-only advice). */
export const isConfigured = Boolean(CONFIG.oracle && CONFIG.token && CONFIG.subscription && CONFIG.usdc)

export type Cell = { id: string; label: string; lat: number; lon: number }

/** Fallback list used when the backend is offline. Keep in sync with backend/src/support.ts. */
export const FALLBACK_CELLS: Cell[] = [
  { id: "cell-a", label: "Cell A", lat: 12.0, lon: 8.5 },
  { id: "cell-b", label: "Cell B", lat: 11.5, lon: 9.0 },
  { id: "cell-c", label: "Cell C", lat: 10.5, lon: 7.5 },
]
