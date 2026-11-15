import { keccak256, stringToBytes, type Hex } from "viem"
import type { Reading, SignedReading } from "./types"

/** The exact text a volunteer signs. Integers only, fixed order: no float or JSON ambiguity. */
export function readingMessage(r: Reading): string {
  return [
    "GroundTruth/reading/v1",
    r.volunteer.toLowerCase(),
    r.cellId,
    r.observedAt,
    r.rainX10,
    r.tempX10,
    r.moistureX10 === null ? "na" : r.moistureX10,
  ].join("|")
}

/** Deterministic order so every node (and the backend) builds the identical batch text. */
export function sortReadings(readings: SignedReading[]): SignedReading[] {
  return [...readings].sort((a, b) => {
    const v = a.volunteer.toLowerCase().localeCompare(b.volunteer.toLowerCase())
    if (v !== 0) return v
    if (a.cellId !== b.cellId) return a.cellId < b.cellId ? -1 : 1
    return a.observedAt - b.observedAt
  })
}

/**
 * Hash of a whole epoch batch. The backend commits this on-chain BEFORE settlement;
 * the contract only accepts a DON report whose batchHash matches the commitment.
 */
export function batchHash(epoch: number, readings: SignedReading[]): Hex {
  const lines = sortReadings(readings).map((r) => `${readingMessage(r)}|${r.signature}`)
  return keccak256(stringToBytes([`epoch|${epoch}`, ...lines].join("\n")))
}
