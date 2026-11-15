import { stringToHex, type Hex } from "viem"

/** A reading exactly as it is signed. Integers in TENTHS, mirroring workflow/field-workflow/core/types.ts. */
export type Reading = {
  volunteer: Hex
  cellId: string
  observedAt: number
  rainX10: number
  tempX10: number
  moistureX10: number | null
}

export type ReadingForm = {
  volunteer: Hex
  cellId: string
  observedAt: number
  rainMm: number
  tempC: number
  moisturePct: number | null
}

export const toTenths = (x: number): number => Math.round(x * 10)

export function buildReading(f: ReadingForm): Reading {
  return {
    volunteer: f.volunteer,
    cellId: f.cellId,
    observedAt: Math.floor(f.observedAt),
    rainX10: toTenths(f.rainMm),
    tempX10: toTenths(f.tempC),
    moistureX10: f.moisturePct === null ? null : toTenths(f.moisturePct),
  }
}

/**
 * The exact text that gets signed. This MUST stay identical to readingMessage() in
 * workflow/field-workflow/core/canonical.ts. A test in this app compares the two.
 */
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

/** Same encoding as the oracle uses for cell ids on-chain: utf8 text padded to 32 bytes. */
export const cellIdToBytes32 = (id: string): Hex => stringToHex(id, { size: 32 })
