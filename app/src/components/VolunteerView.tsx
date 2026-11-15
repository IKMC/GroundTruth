import { useCallback, useEffect, useState } from "react"
import type { Hex } from "viem"
import { ArrowRight, PenLine, Ruler, Wallet } from "lucide-react"
import { getCells, getProof, postReading } from "@/lib/api"
import { claimReward, readBalances, readClaimed, readLastSettled, redeemField, signReadingMessage } from "@/lib/chain"
import { FALLBACK_CELLS, isConfigured, type Cell } from "@/lib/config"
import { errorMessage, formatField, formatUsdc } from "@/lib/format"
import { buildReading, readingMessage } from "@/lib/reading"

const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

type Reward = { amountWei: bigint; proof: Hex[]; claimed: boolean }

export default function VolunteerView({ account }: { account: Hex | null }) {
  const [cells, setCells] = useState<Cell[]>(FALLBACK_CELLS)
  const [cellId, setCellId] = useState(FALLBACK_CELLS[0].id)
  const [rain, setRain] = useState("0")
  const [temp, setTemp] = useState("")
  const [moisture, setMoisture] = useState("")
  const [observed, setObserved] = useState("")

  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [epoch, setEpoch] = useState("1")
  const [reward, setReward] = useState<Reward | null>(null)
  const [balances, setBalances] = useState<{ field: bigint; usdc: bigint } | null>(null)

  // Set the default measurement time after hydration so server and browser render the same markup.
  useEffect(() => setObserved((cur) => cur || localNow()), [])

  useEffect(() => {
    void getCells().then((c) => {
      setCells(c)
      setCellId((cur) => (c.some((x) => x.id === cur) ? cur : c[0].id))
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!isConfigured || !account) return setBalances(null)
    setBalances(await readBalances(account).catch(() => null))
    const last = await readLastSettled().catch(() => 0)
    if (last > 0) setEpoch(String(last))
  }, [account])

  useEffect(() => { void refresh() }, [refresh])

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setStatus(label)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    run("Sign the reading in your wallet…", async () => {
      if (!account) throw new Error("Connect your wallet first")
      if (temp.trim() === "") throw new Error("Enter the average temperature")
      if (!observed) throw new Error("Enter when you measured")
      const reading = buildReading({
        volunteer: account,
        cellId,
        observedAt: new Date(observed).getTime() / 1000,
        rainMm: Number(rain),
        tempC: Number(temp),
        moisturePct: moisture.trim() === "" ? null : Number(moisture),
      })
      const signature = await signReadingMessage(account, readingMessage(reading))
      setStatus("Sending to the network…")
      const res = await postReading(reading, signature)
      setStatus(`Reading accepted for settlement ${res.epoch}. You earn a reward if it agrees with neighbouring volunteers and NASA.`)
    })

  const check = () =>
    run("Looking for your reward…", async () => {
      if (!account) throw new Error("Connect your wallet first")
      const n = Number(epoch)
      const p = await getProof(n, account)
      const claimed = isConfigured ? await readClaimed(n, account) : false
      setReward({ amountWei: BigInt(p.amountWei), proof: p.proof, claimed })
      setStatus(claimed ? "Already claimed." : `Reward found: ${formatField(BigInt(p.amountWei))} FIELD`)
    })

  const claim = () =>
    run("Confirm the claim in your wallet…", async () => {
      if (!account || !reward) return
      await claimReward(account, Number(epoch), reward.amountWei, reward.proof)
      setReward({ ...reward, claimed: true })
      setStatus("Claimed. Your FIELD tokens are in your wallet.")
      await refresh()
    })

  const redeem = () =>
    run("Confirm the redemption in your wallet…", async () => {
      if (!account || !balances) return
      await redeemField(account, balances.field)
      setStatus("Redeemed FIELD for mUSDC.")
      await refresh()
    })

  const STEPS = [
    { icon: Ruler, title: "Measure", text: "Today's rainfall and average temperature on your land." },
    { icon: PenLine, title: "Sign", text: "Your wallet signs it, so nobody can forge it in your name." },
    { icon: Wallet, title: "Earn", text: "Readings that agree with neighbours and NASA earn FIELD." },
  ]

  return (
    <>
      <section className="gt-container pb-14 pt-12 md:pt-20">
        <div className="gt-rise max-w-3xl">
          <p className="gt-eyebrow">For volunteers</p>
          <h1 className="gt-display mt-5 text-5xl sm:text-6xl lg:text-7xl">
            Your field, <em>on the record.</em>
          </h1>
          <p className="gt-lede mt-6">
            Report the same day. NASA publishes its numbers days later, so an honest reading always arrives before
            NASA's value exists.
          </p>
        </div>
        <ol className="mt-12 grid gap-4 sm:grid-cols-3">
          {STEPS.map((st, i) => (
            <li key={st.title} className="gt-panel gt-rise p-5" style={{ animationDelay: `${120 + i * 80}ms` }}>
              <div className="flex items-center justify-between">
                <st.icon className="size-5 text-primary" aria-hidden />
                <span className="gt-step-num">0{i + 1}</span>
              </div>
              <h3 className="mt-6 font-medium">{st.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="gt-container grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="gt-card p-6 sm:p-8">
          <h2 className="gt-display text-3xl">Send a field reading</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <span className="gt-label">Area</span>
              <div role="radiogroup" aria-label="Area" className="grid grid-cols-3 gap-2">
                {cells.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={cellId === c.id} className="gt-choice py-3 text-center" onClick={() => setCellId(c.id)}>
                    {c.label.replace("CELL", "Cell")}
                  </button>
                ))}
              </div>
            </div>
            <label className="grid gap-2 sm:col-span-2">
              <span className="gt-label">When did you measure?</span>
              <input className="gt-input gt-num" type="datetime-local" value={observed} onChange={(e) => setObserved(e.target.value)} />
            </label>
            <label className="grid gap-2">
              <span className="gt-label">Rainfall, whole day (mm)</span>
              <input className="gt-input gt-num" type="number" step="0.1" min="0" max="500" value={rain} onChange={(e) => setRain(e.target.value)} />
            </label>
            <label className="grid gap-2">
              <span className="gt-label">Average temperature (°C)</span>
              <input className="gt-input gt-num" type="number" step="0.1" min="-30" max="55" placeholder="e.g. 27.5" value={temp} onChange={(e) => setTemp(e.target.value)} />
            </label>
            <label className="grid gap-2 sm:col-span-2">
              <span className="gt-label">Soil moisture (%) · optional, earns a bonus</span>
              <input className="gt-input gt-num" type="number" step="0.1" min="0" max="100" placeholder="Leave empty if you didn't measure" value={moisture} onChange={(e) => setMoisture(e.target.value)} />
            </label>
          </div>
          <button className="gt-btn gt-btn-primary gt-btn-lg mt-7 w-full sm:w-auto" onClick={() => void submit()} disabled={busy || !account}>
            {account ? "Sign and send reading" : "Connect a wallet to send readings"}
            {account && <ArrowRight className="size-4" aria-hidden />}
          </button>

          <div aria-live="polite" className="mt-4 grid gap-3">
            {status && (
              <p className="gt-notice">
                <span className="gt-live-dot shrink-0" aria-hidden />
                {status}
              </p>
            )}
            {error && <p className="gt-error" role="alert">{error}</p>}
          </div>
        </div>

        <aside className="gt-card p-6 sm:p-8 lg:sticky lg:top-24">
          <h2 className="gt-display text-3xl">Your rewards</h2>
          {balances ? (
            <div className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5">
              <div>
                <div className="gt-display text-4xl">{formatField(balances.field)}</div>
                <div className="text-sm text-muted-foreground">FIELD</div>
              </div>
              <div>
                <div className="gt-display text-4xl">{formatUsdc(balances.usdc)}</div>
                <div className="text-sm text-muted-foreground">mUSDC</div>
              </div>
            </div>
          ) : (
            !isConfigured && <p className="gt-notice mt-5">Contract addresses are not configured, so rewards are disabled.</p>
          )}
          <div className="mt-6 grid gap-3">
            <label className="grid gap-2">
              <span className="gt-label">Settlement number</span>
              <input className="gt-input gt-num" type="number" min="1" value={epoch} onChange={(e) => setEpoch(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="gt-btn" onClick={() => void check()} disabled={busy || !account}>Check reward</button>
              {reward && !reward.claimed && (
                <button className="gt-btn gt-btn-primary" onClick={() => void claim()} disabled={busy}>
                  Claim {formatField(reward.amountWei)} FIELD
                </button>
              )}
              {balances && balances.field >= 10n ** 13n && (
                <button className="gt-btn" onClick={() => void redeem()} disabled={busy}>Redeem FIELD for mUSDC</button>
              )}
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">10 FIELD = 1 mUSDC. FIELD only exists when subscriptions already back it.</p>
        </aside>
      </section>
    </>
  )
}
