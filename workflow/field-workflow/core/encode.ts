import { decodeAbiParameters, encodeAbiParameters, stringToHex, type Hex } from "viem"
import type { CellOutcome } from "./types"

/** Must match `abi.decode(report, (uint256, bytes32, bytes32, uint256, CellResult[]))` in FieldOracle. */
export const REPORT_ABI = [
  { type: "uint256", name: "epoch" },
  { type: "bytes32", name: "batchHash" },
  { type: "bytes32", name: "rewardRoot" },
  { type: "uint256", name: "totalRewards" },
  {
    type: "tuple[]",
    name: "cells",
    components: [
      { type: "bytes32", name: "cellId" },
      { type: "int16", name: "tempBiasX10" },
      { type: "uint16", name: "rainRatioBps" },
      { type: "uint16", name: "moistureX100" },
      { type: "uint16", name: "qualityBps" },
      { type: "uint8", name: "accepted" },
    ],
  },
] as const

/** Human-readable bytes32 id: the utf8 text, right-padded with zeros. Max 32 characters. */
export const cellIdToBytes32 = (id: string): Hex => stringToHex(id, { size: 32 })

export function encodeReport(args: {
  epoch: number
  batchHash: Hex
  rewardRoot: Hex
  totalRewardsWei: bigint
  cells: CellOutcome[]
}): Hex {
  return encodeAbiParameters(REPORT_ABI, [
    BigInt(args.epoch),
    args.batchHash,
    args.rewardRoot,
    args.totalRewardsWei,
    args.cells.map((c) => ({
      cellId: cellIdToBytes32(c.cellId),
      tempBiasX10: c.tempBiasX10,
      rainRatioBps: c.rainRatioBps,
      moistureX100: c.moistureX100,
      qualityBps: c.qualityBps,
      accepted: c.accepted,
    })),
  ])
}

export function decodeReport(data: Hex) {
  return decodeAbiParameters(REPORT_ABI, data)
}
