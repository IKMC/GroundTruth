import { createPublicClient, createWalletClient, custom, defineChain, http, type EIP1193Provider, type Hex } from "viem"
import { ORACLE_ABI, SUBSCRIPTION_ABI, TOKEN_ABI, USDC_ABI } from "./abi"
import { CONFIG } from "./config"
import { cellIdToBytes32 } from "./reading"
import type { Correction } from "../engine/types"

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export const chain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.chainId === 11155111 ? "Sepolia" : `Chain ${CONFIG.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
})

export const publicClient = createPublicClient({ chain, transport: http(CONFIG.rpcUrl) })

const need = (v: Hex | undefined, name: string): Hex => {
  if (!v) throw new Error(`${name} address is not configured (see .env.example)`)
  return v
}

// ------------------------------------------------------------------ reads

/** The oracle's latest attested correction for a cell, or null if no volunteer data has been settled yet. */
export async function readCorrection(cellId: string): Promise<Correction | null> {
  const c = await publicClient.readContract({
    address: need(CONFIG.oracle, "Oracle"), abi: ORACLE_ABI, functionName: "getCell", args: [cellIdToBytes32(cellId)],
  })
  if (c.epoch === 0) return null
  return {
    tempBiasC: c.tempBiasX10 / 10,
    rainRatio: c.rainRatioBps / 10_000,
    quality: c.qualityBps / 10_000,
    accepted: c.accepted,
    epoch: c.epoch,
  }
}

export const readLastSettled = async (): Promise<number> =>
  Number(await publicClient.readContract({ address: need(CONFIG.oracle, "Oracle"), abi: ORACLE_ABI, functionName: "lastSettledEpoch" }))

export const readSubscribed = (who: Hex): Promise<boolean> =>
  publicClient.readContract({ address: need(CONFIG.subscription, "Subscription"), abi: SUBSCRIPTION_ABI, functionName: "isActive", args: [who] })

export const readClaimed = (epoch: number, who: Hex): Promise<boolean> =>
  publicClient.readContract({ address: need(CONFIG.oracle, "Oracle"), abi: ORACLE_ABI, functionName: "claimed", args: [BigInt(epoch), who] })

export async function readBalances(who: Hex) {
  const [field, usdc] = await Promise.all([
    publicClient.readContract({ address: need(CONFIG.token, "Token"), abi: TOKEN_ABI, functionName: "balanceOf", args: [who] }),
    publicClient.readContract({ address: need(CONFIG.usdc, "USDC"), abi: USDC_ABI, functionName: "balanceOf", args: [who] }),
  ])
  return { field, usdc }
}

export const readPrice = (): Promise<bigint> =>
  publicClient.readContract({ address: need(CONFIG.subscription, "Subscription"), abi: SUBSCRIPTION_ABI, functionName: "PRICE_PER_PERIOD" })

// ------------------------------------------------------------------ wallet

export function walletClient() {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or another EIP-1193 wallet.")
  return createWalletClient({ chain, transport: custom(window.ethereum) })
}

export async function connectWallet(): Promise<Hex> {
  const wc = walletClient()
  const [account] = await wc.requestAddresses()
  try {
    await wc.switchChain({ id: CONFIG.chainId })
  } catch {
    /* the wallet may not know the chain; the next transaction will say so */
  }
  return account
}

async function send(account: Hex, tx: () => Promise<Hex>): Promise<Hex> {
  void account
  const hash = await tx()
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`transaction failed: ${hash}`)
  return hash
}

export const signReadingMessage = (account: Hex, message: string) => walletClient().signMessage({ account, message })

export const faucetUsdc = (account: Hex, amount: bigint) =>
  send(account, () =>
    walletClient().writeContract({ chain, account, address: need(CONFIG.usdc, "USDC"), abi: USDC_ABI, functionName: "faucet", args: [account, amount] }))

export async function subscribe(account: Hex, periods: bigint) {
  const price = await readPrice()
  await send(account, () =>
    walletClient().writeContract({ chain, account, address: need(CONFIG.usdc, "USDC"), abi: USDC_ABI, functionName: "approve", args: [need(CONFIG.subscription, "Subscription"), price * periods] }))
  return send(account, () =>
    walletClient().writeContract({ chain, account, address: need(CONFIG.subscription, "Subscription"), abi: SUBSCRIPTION_ABI, functionName: "subscribe", args: [periods] }))
}

export const claimReward = (account: Hex, epoch: number, amount: bigint, proof: Hex[]) =>
  send(account, () =>
    walletClient().writeContract({ chain, account, address: need(CONFIG.oracle, "Oracle"), abi: ORACLE_ABI, functionName: "claim", args: [BigInt(epoch), amount, proof] }))

export const redeemField = (account: Hex, amount: bigint) =>
  send(account, () =>
    walletClient().writeContract({ chain, account, address: need(CONFIG.token, "Token"), abi: TOKEN_ABI, functionName: "redeem", args: [amount] }))
