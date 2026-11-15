/**
 * Browser-only stand-in for the Subscription contract, used while contract addresses are not
 * configured so the subscribe flow can be shown without a wallet. Numbers mirror Deploy.s.sol.
 * Nothing here touches a chain; replace it by configuring the real contracts.
 */
export const DEMO_PRICE = 5_000_000n // 5 mUSDC (6 decimals), PRICE_PER_PERIOD
export const DEMO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000 // PERIOD_LENGTH = 30 days
export const DEMO_REWARD_BPS = 7_000n // 70% of each payment backs volunteer rewards
export const DEMO_FAUCET = 50_000_000n // 50 mUSDC per faucet click

export type DemoState = { balance: bigint; paidUntil: number; toRewards: bigint }

export const EMPTY_DEMO: DemoState = { balance: 0n, paidUntil: 0, toRewards: 0n }

export const demoFaucet = (s: DemoState): DemoState => ({ ...s, balance: s.balance + DEMO_FAUCET })

export const demoActive = (s: DemoState, now: number): boolean => s.paidUntil > now

/** Same rules as Subscription.subscribe: pay up front, extend from the later of now or the current end. */
export function demoSubscribe(s: DemoState, periods: number, now: number): DemoState {
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new Error("Choose between 1 and 12 months.")
  const amount = DEMO_PRICE * BigInt(periods)
  if (s.balance < amount) throw new Error("Not enough test mUSDC. Get some from the faucet first.")
  const start = Math.max(s.paidUntil, now)
  return {
    balance: s.balance - amount,
    paidUntil: start + periods * DEMO_PERIOD_MS,
    toRewards: s.toRewards + (amount * DEMO_REWARD_BPS) / 10_000n,
  }
}

const KEY = "gt-demo-subscription"

export function loadDemo(): DemoState {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY_DEMO
    const o = JSON.parse(raw) as { balance: string; paidUntil: number; toRewards: string }
    return { balance: BigInt(o.balance), paidUntil: Number(o.paidUntil) || 0, toRewards: BigInt(o.toRewards) }
  } catch {
    return EMPTY_DEMO
  }
}

export function saveDemo(s: DemoState) {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ balance: s.balance.toString(), paidUntil: s.paidUntil, toRewards: s.toRewards.toString() }),
  )
}

export const clearDemo = () => window.localStorage.removeItem(KEY)
