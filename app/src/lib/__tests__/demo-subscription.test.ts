import { describe, expect, it } from "vitest"
import { DEMO_PERIOD_MS, EMPTY_DEMO, demoActive, demoFaucet, demoSubscribe } from "../demo-subscription"

const NOW = 1_800_000_000_000

describe("demo subscription", () => {
  it("one month costs 5 mUSDC", () => {
    const s = demoSubscribe(demoFaucet(EMPTY_DEMO), 1, NOW)
    expect(s.balance).toBe(45_000_000n)
  })

  it("one month lasts 30 days", () => {
    const s = demoSubscribe(demoFaucet(EMPTY_DEMO), 1, NOW)
    expect(s.paidUntil).toBe(NOW + 30 * 24 * 60 * 60 * 1000)
    expect(demoActive(s, NOW + DEMO_PERIOD_MS - 1)).toBe(true)
    expect(demoActive(s, NOW + DEMO_PERIOD_MS)).toBe(false)
  })

  it("renewing extends from the current end, not from today", () => {
    const once = demoSubscribe(demoFaucet(EMPTY_DEMO), 1, NOW)
    const twice = demoSubscribe(once, 1, NOW + 1000)
    expect(twice.paidUntil).toBe(NOW + 2 * DEMO_PERIOD_MS)
  })

  it("70% of each payment goes to volunteer rewards", () => {
    const s = demoSubscribe(demoFaucet(EMPTY_DEMO), 1, NOW)
    expect(s.toRewards).toBe(3_500_000n)
  })

  it("refuses to subscribe without enough mUSDC", () => {
    expect(() => demoSubscribe(EMPTY_DEMO, 1, NOW)).toThrow(/Not enough/)
  })
})
