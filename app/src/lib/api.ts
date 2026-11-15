import type { Hex } from "viem"
import { CONFIG, FALLBACK_CELLS, type Cell } from "./config"
import type { Reading } from "./reading"

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CONFIG.backendUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
  return body
}

export async function getCells(): Promise<Cell[]> {
  try {
    const r = await call<{ cells: { id: string; lat: number; lon: number }[] }>("/cells")
    return r.cells.map((c) => ({ ...c, label: c.id.replace("cell-", "Cell ").toUpperCase() }))
  } catch {
    return FALLBACK_CELLS
  }
}

export const postReading = (r: Reading, signature: Hex) =>
  call<{ epoch: number }>("/readings", { method: "POST", body: JSON.stringify({ ...r, signature }) })

export const getProof = (epoch: number, address: Hex) =>
  call<{ amountWei: string; proof: Hex[] }>(`/proofs/${epoch}/${address}`)

export const getEpoch = (epoch: number) =>
  call<{ readings: number; committedHash: string | null; finalized: boolean }>(`/epochs/${epoch}`)
