import {
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain,
  type Hex,
  type Transport,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import type { ChainPort } from "./support"

const ABI = parseAbi([
  "function commitBatch(uint256 epoch, bytes32 batchHash)",
  "function lastCommittedEpoch() view returns (uint256)",
  "function lastSettledEpoch() view returns (uint256)",
  "function rewardRoot(uint256 epoch) view returns (bytes32)",
  "function availableRewardBudget() view returns (uint256)",
])
/** Real chain access through viem. The committer key can only call commitBatch, nothing else. */
export function createViemChain(opts: {
  rpcUrl: string
  oracle: Hex
  privateKey: Hex
  deployBlock: bigint
  chain?: Chain // defaults to Sepolia; pass foundry for a local anvil node
  transport?: Transport // tests can inject one; defaults to plain HTTP on rpcUrl
}): ChainPort {
  const net = opts.chain ?? sepolia
  const transport = opts.transport ?? http(opts.rpcUrl)
  const pub = createPublicClient({ chain: net, transport })
  const wallet = createWalletClient({ chain: net, transport, account: privateKeyToAccount(opts.privateKey) })
  const read = <T,>(functionName: "lastCommittedEpoch" | "lastSettledEpoch") =>
    pub.readContract({ address: opts.oracle, abi: ABI, functionName }) as Promise<T>

  return {
    async commitBatch(epoch, hash) {
      // Gas is estimated by the node, which prices state creation correctly (Foundry's local estimate does not).
      const tx = await wallet.writeContract({
        address: opts.oracle,
        abi: ABI,
        functionName: "commitBatch",
        args: [BigInt(epoch), hash],
      })
      const receipt = await pub.waitForTransactionReceipt({ hash: tx })
      if (receipt.status !== "success") throw new Error(`commitBatch reverted: ${tx}`)
      return tx
    },
    async lastCommittedEpoch() {
      return Number(await read<bigint>("lastCommittedEpoch"))
    },
    async lastSettledEpoch() {
      return Number(await read<bigint>("lastSettledEpoch"))
    },
    async rewardRoot(epoch) {
      return (await pub.readContract({ address: opts.oracle, abi: ABI, functionName: "rewardRoot", args: [BigInt(epoch)] })) as Hex
    },
    async budgetAtSettlement(epoch) {
      // Find the block where this epoch settled WITHOUT scanning logs. Many free RPC plans cap
      // eth_getLogs at about 10 blocks, so instead we binary-search the contract's own state:
      // the first block where lastSettledEpoch >= epoch is the settlement block. About 20 cheap calls.
      const target = BigInt(epoch)
      const settledAt = async (blockNumber: bigint): Promise<bigint> => {
        try {
          return (await pub.readContract({ address: opts.oracle, abi: ABI, functionName: "lastSettledEpoch", blockNumber })) as bigint
        } catch (e) {
          // Before the contract existed the call returns no data. That simply means "not settled yet".
          const zero = (e as { walk?: (fn: (x: unknown) => boolean) => unknown }).walk?.((x) => x instanceof ContractFunctionZeroDataError)
          if (zero) return 0n
          throw e
        }
      }

      let hi = await pub.getBlockNumber()
      if ((await settledAt(hi)) < target) throw new Error(`epoch ${epoch} is not settled on-chain yet`)
      let lo = opts.deployBlock
      while (lo < hi) {
        const mid = (lo + hi) / 2n
        if ((await settledAt(mid)) >= target) hi = mid
        else lo = mid + 1n
      }
      // State just before the settlement block: the budget the DON saw when it capped rewards.
      return (await pub.readContract({
        address: opts.oracle,
        abi: ABI,
        functionName: "availableRewardBudget",
        blockNumber: lo - 1n,
      })) as bigint
    },
  }
}