/**
 * Generates a cross-language test vector: a report + Merkle proofs produced by the TypeScript
 * oracle code, consumed by contracts/test/FieldOracle.t.sol to prove both sides agree.
 * Run: npx tsx test/gen-vector.ts
 */
import { writeFileSync } from "node:fs"
import { evaluateEpoch } from "../core/evaluate"
import { cellIdToBytes32 } from "../core/encode"
import { input, sign, wallet } from "./helpers"

async function main() {
  const temps = [262, 265, 268, 264, 266]
  const readings = await Promise.all(
    temps.map((t, i) => sign(wallet(i), { tempX10: t, rainX10: 30 + i * 4, moistureX10: i === 0 ? 300 : null })),
  )
  const out = evaluateEpoch(input(readings))

  const json = {
    epoch: 1,
    batchHash: out.batchHash,
    reportHex: out.reportHex,
    rewardRoot: out.rewardRoot,
    totalRewards: out.totalRewardsWei.toString(),
    cellId: cellIdToBytes32("cell-a"),
    expected: out.cells[0],
    volunteers: out.rewards.map((r) => r.address),
    amounts: out.rewards.map((r) => r.amountWei.toString()),
    proofs: out.rewards.map((r) => out.proofs[r.address.toLowerCase()].proof),
  }
  writeFileSync("../../contracts/test/vectors/epoch1.json", JSON.stringify(json, null, 2))
  console.log("rewards:", out.rewards.map((r) => `${r.address} ${r.amountWei}`))
  console.log("root:", out.rewardRoot, "total:", out.totalRewardsWei, "cell:", out.cells[0])
}
main()
