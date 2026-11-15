import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Hex } from "viem"
import { ArrowDown, ArrowRight, Check, Lock, Satellite, Sprout, Users } from "lucide-react"
import { Link } from "@/lib/router"
import { recommend, climatologyUrl, parseClimatology } from "@/engine/engine"
import type { Correction, Priorities, Recommendation, Season } from "@/engine/types"
import { getCells } from "@/lib/api"
import { faucetUsdc, readCorrection, readPrice, readSubscribed, subscribe } from "@/lib/chain"
import { FALLBACK_CELLS, isConfigured, type Cell } from "@/lib/config"
import { errorMessage, formatUsdc } from "@/lib/format"
import {
  DEMO_PRICE,
  EMPTY_DEMO,
  clearDemo,
  demoActive,
  demoFaucet,
  demoSubscribe,
  loadDemo,
  saveDemo,
  type DemoState,
} from "@/lib/demo-subscription"
import fieldsAerial from "@/assets/fields-aerial.jpg"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Inclusive month range that may wrap around the year end (Oct to Feb gives Oct, Nov, Dec, Jan, Feb). */
function monthsBetween(start: number, end: number): number[] {
  const out: number[] = []
  for (let m = start; ; m = (m + 1) % 12) {
    out.push(m)
    if (m === end) break
  }
  return out
}

const GOALS: { key: keyof Priorities; label: string; hint: string }[] = [
  { key: "income", label: "Income", hint: "Higher earning crops" },
  { key: "water", label: "Water saving", hint: "Crops that fit the rain you get" },
  { key: "soil", label: "Soil health", hint: "Legumes and plant variety" },
  { key: "risk", label: "Low risk", hint: "No bad year in the plan" },
  { key: "simplicity", label: "Simplicity", hint: "Fewer different crops" },
]

function Step({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 py-8 first:pt-0 last:pb-0 md:grid-cols-[13rem_1fr] md:gap-10">
      <div>
        <div className="gt-step-num">{n}</div>
        <h3 className="mt-1 text-lg font-medium">{title}</h3>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export default function FarmerView({ account }: { account: Hex | null }) {
  const [cells, setCells] = useState<Cell[]>(FALLBACK_CELLS)
  const [cellId, setCellId] = useState(FALLBACK_CELLS[0].id)
  const [startMonth, setStartMonth] = useState(4)
  const [endMonth, setEndMonth] = useState(8)
  const [picking, setPicking] = useState<"start" | "end">("start")
  const [ph, setPh] = useState("6.3")
  const [carbon, setCarbon] = useState("1.4")
  const [priorities, setPriorities] = useState<Priorities>({ income: 3, water: 3, soil: 4, risk: 3, simplicity: 1 })

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [priceLabel, setPriceLabel] = useState("")
  const resultsRef = useRef<HTMLDivElement>(null)

  // Demo mode: without deployed contracts the subscribe flow runs in the browser only.
  const demo = !isConfigured
  const [demoState, setDemoState] = useState<DemoState>(EMPTY_DEMO)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!demo) return
    setDemoState(loadDemo())
    setNow(Date.now())
  }, [demo])
  const updateDemo = (s: DemoState) => {
    setDemoState(s)
    saveDemo(s)
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  useEffect(() => {
    void getCells().then((c) => {
      setCells(c)
      setCellId((cur) => (c.some((x) => x.id === cur) ? cur : c[0].id))
    })
  }, [])

  useEffect(() => {
    if (!isConfigured || !account) return setSubscribed(null)
    void readSubscribed(account).then(setSubscribed).catch(() => setSubscribed(null))
    void readPrice().then((p) => setPriceLabel(`${formatUsdc(p)} mUSDC`)).catch(() => undefined)
  }, [account])

  const season = monthsBetween(startMonth, endMonth)

  function pickMonth(m: number) {
    if (picking === "start") {
      setStartMonth(m)
      setEndMonth(m)
      setPicking("end")
    } else {
      setEndMonth(m)
      setPicking("start")
    }
  }

  async function getAdvice() {
    setBusy(true)
    setError(null)
    setStatus("Fetching NASA POWER climate data…")
    try {
      const cell = cells.find((c) => c.id === cellId)!
      const res = await fetch(climatologyUrl(cell.lat, cell.lon))
      if (!res.ok) throw new Error(`NASA POWER request failed (${res.status})`)
      const climate = parseClimatology(await res.json())

      let corr: Correction | null = null
      if (isConfigured) {
        setStatus("Reading volunteer-verified corrections from the chain…")
        corr = await readCorrection(cellId).catch(() => null)
      }
      setCorrection(corr)

      const s: Season = { id: "main", label: `${MONTHS[startMonth]} to ${MONTHS[endMonth]}`, months: season }
      setRec(recommend({ climate, correction: corr, season: s, soil: { ph: Number(ph), organicCarbonPct: Number(carbon) }, priorities }))
      setStatus(null)
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
    } catch (e) {
      setError(errorMessage(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  async function doSubscribe() {
    if (demo) return demoDoSubscribe()
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      setStatus("Approve and confirm the subscription in your wallet…")
      await subscribe(account, 1n)
      setSubscribed(await readSubscribed(account))
      setStatus("Subscribed. Thank you for supporting the volunteers.")
    } catch (e) {
      setError(errorMessage(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  async function demoDoSubscribe() {
    setBusy(true)
    setError(null)
    try {
      const t = Date.now()
      const next = demoSubscribe(demoState, 1, t)
      setStatus(`Approving ${formatUsdc(DEMO_PRICE)} mUSDC…`)
      await wait(700)
      setStatus("Confirming subscription…")
      await wait(900)
      setNow(t)
      updateDemo(next)
      setStatus("Subscribed. Thank you for supporting the volunteers.")
    } catch (e) {
      setError(errorMessage(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  async function demoGetTestFunds() {
    setBusy(true)
    setError(null)
    setStatus("Minting test mUSDC…")
    await wait(600)
    updateDemo(demoFaucet(demoState))
    setStatus("You received 50 test mUSDC.")
    setBusy(false)
  }

  function resetDemo() {
    clearDemo()
    setDemoState(EMPTY_DEMO)
    setStatus(null)
    setError(null)
  }

  async function getTestFunds() {
    if (demo) return demoGetTestFunds()
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      setStatus("Minting test mUSDC…")
      await faucetUsdc(account, 50_000_000n)
      setStatus("You received 50 test mUSDC.")
    } catch (e) {
      setError(errorMessage(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const isSubscriber = demo ? demoActive(demoState, now) : subscribed === true
  const gated = !isSubscriber
  const price = demo ? `${formatUsdc(DEMO_PRICE)} mUSDC` : priceLabel
  const canAct = demo || Boolean(account)
  const shown = rec ? (gated ? rec.rotations.slice(0, 1) : rec.rotations) : []

  return (
    <>
      {/* Hero */}
      <section className="gt-container grid items-center gap-12 pb-20 pt-12 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
        <div className="gt-rise">
          <p className="gt-eyebrow">NASA data · Volunteers · Decentralised oracle</p>
          <h1 className="gt-display mt-5 text-5xl sm:text-6xl lg:text-7xl">
            Plant what your land is <em>ready</em> for.
          </h1>
          <p className="gt-lede mt-6">
            Crop rotation advice from 20 years of NASA climate data, corrected by neighbours who measure the rain on
            their own fields.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href="#planner" className="gt-btn gt-btn-primary gt-btn-lg">
              Plan my rotation <ArrowDown className="size-4" aria-hidden />
            </a>
            <Link to="/about" className="gt-btn gt-btn-quiet gt-btn-lg">
              How it works
            </Link>
          </div>
        </div>

        <div className="relative gt-rise [animation-delay:120ms]">
          <img
            src={fieldsAerial}
            alt="Aerial view of patchwork farm plots in the savanna"
            width={1600}
            height={1008}
            className="aspect-[4/5] w-full rounded-[2rem] object-cover sm:aspect-[5/4] lg:aspect-[4/5]"
          />
          <div className="gt-chip gt-float absolute left-4 top-6 sm:-left-6">
            <Satellite className="size-4 text-primary" aria-hidden /> NASA POWER climatology
          </div>
          <div className="gt-chip gt-float absolute bottom-24 right-4 [animation-delay:1.5s] sm:-right-5">
            <Users className="size-4 text-primary" aria-hidden /> Checked by volunteers
          </div>
          <div className="gt-chip gt-float absolute bottom-6 left-6 [animation-delay:3s]">
            <Sprout className="size-4 text-primary" aria-hidden /> Ranked rotations
          </div>
        </div>
      </section>

      {/* Planner */}
      <section id="planner" className="gt-narrow scroll-mt-24">
        <div className="mb-8">
          <p className="gt-eyebrow">Rotation planner</p>
          <h2 className="gt-display mt-3 text-4xl sm:text-5xl">Tell us about your field.</h2>
        </div>

        <div className="gt-card divide-y divide-border p-6 sm:p-10">
          <Step n="01" title="Area" hint="The NASA grid cell your field sits in.">
            <div role="radiogroup" aria-label="Area" className="grid gap-3 sm:grid-cols-3">
              {cells.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={cellId === c.id}
                  className="gt-choice"
                  onClick={() => setCellId(c.id)}
                >
                  <div className="font-medium">{c.label.replace("CELL", "Cell")}</div>
                  <div className="gt-num mt-1 text-xs text-muted-foreground">
                    {c.lat.toFixed(1)}°N, {c.lon.toFixed(1)}°E
                  </div>
                </button>
              ))}
            </div>
          </Step>

          <Step n="02" title="Growing season" hint={picking === "end" ? "Now tap the last month." : "Tap the first month, then the last."}>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {MONTHS.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className="gt-month"
                  data-in={season.includes(i)}
                  data-edge={i === startMonth || i === endMonth}
                  aria-pressed={season.includes(i)}
                  onClick={() => pickMonth(i)}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {MONTHS[startMonth]} → {MONTHS[endMonth]} · <span className="gt-num">{season.length}</span> month
              {season.length === 1 ? "" : "s"}
            </p>
          </Step>

          <Step n="03" title="Soil" hint="From a soil test, or your best estimate.">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="gt-label">Soil pH</span>
                <input className="gt-input gt-num" type="number" step="0.1" min="3" max="10" value={ph} onChange={(e) => setPh(e.target.value)} />
              </label>
              <label className="grid gap-2">
                <span className="gt-label">Organic carbon (%)</span>
                <input className="gt-input gt-num" type="number" step="0.1" min="0" max="10" value={carbon} onChange={(e) => setCarbon(e.target.value)} />
              </label>
            </div>
          </Step>

          <Step n="04" title="What matters most" hint="Only the balance between them counts.">
            <div className="grid gap-5">
              {GOALS.map((g) => (
                <label key={g.key} className="grid gap-1.5">
                  <span className="flex items-baseline justify-between gap-4">
                    <span>
                      <span className="font-medium">{g.label}</span>
                      <span className="ml-2 text-sm text-muted-foreground">{g.hint}</span>
                    </span>
                    <span className="flex gap-1" aria-hidden>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className="gt-pip" data-on={priorities[g.key] >= n} />
                      ))}
                    </span>
                  </span>
                  <input
                    className="gt-range"
                    type="range"
                    min="0"
                    max="5"
                    value={priorities[g.key]}
                    aria-label={g.label}
                    onChange={(e) => setPriorities({ ...priorities, [g.key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </Step>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-8">
            <p className="text-sm text-muted-foreground">Takes a few seconds. Nothing is stored.</p>
            <button className="gt-btn gt-btn-primary gt-btn-lg" onClick={() => void getAdvice()} disabled={busy}>
              {busy ? "Working…" : "Get rotation advice"}
              {!busy && <ArrowRight className="size-4" aria-hidden />}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="mt-4 grid gap-3">
          {status && (
            <p className="gt-notice">
              <span className="gt-live-dot" aria-hidden />
              {status}
            </p>
          )}
          {error && <p className="gt-error" role="alert">{error}</p>}
        </div>
      </section>

      {/* Results */}
      {rec && (
        <section ref={resultsRef} className="gt-narrow mt-20 scroll-mt-24">
          <div className="gt-rise">
            <p className="gt-eyebrow">Your season · {rec.season.label}</p>
            <div className="mt-6 grid grid-cols-3 gap-4 border-y border-border py-8">
              <div>
                <div className="gt-display text-4xl sm:text-6xl">{rec.seasonClimate.meanTempC.toFixed(1)}°</div>
                <div className="mt-2 text-sm text-muted-foreground">Average temperature (°C)</div>
              </div>
              <div>
                <div className="gt-display text-4xl sm:text-6xl">{Math.round(rec.seasonClimate.totalRainMm)}</div>
                <div className="mt-2 text-sm text-muted-foreground">Rain over the season (mm)</div>
              </div>
              <div>
                <div className="gt-display text-4xl sm:text-6xl">{rec.season.months.length}</div>
                <div className="mt-2 text-sm text-muted-foreground">Months</div>
              </div>
            </div>
            <div className="mt-5">
              {rec.dataQuality === "nasa-plus-volunteers" && correction ? (
                <span className="gt-tag gt-tag-good">
                  Verified locally: {correction.accepted} volunteer readings (settlement {correction.epoch}), trust{" "}
                  {Math.round(correction.quality * 100)}%. Adjusted {correction.tempBiasC >= 0 ? "+" : ""}
                  {correction.tempBiasC.toFixed(1)} °C and ×{correction.rainRatio.toFixed(2)} rain.
                </span>
              ) : (
                <span className="gt-tag">
                  Regional NASA data only. No volunteer has verified this area yet{isConfigured ? "." : " (contracts not configured)."}
                </span>
              )}
            </div>
          </div>

          {isSubscriber && (
            <div className="gt-card mt-8 flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-4" aria-hidden />
                </span>
                <div>
                  <div className="font-medium">
                    Subscriber{demo && <span className="gt-tag ml-2">Demo</span>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {demo ? (
                      <>
                        Active until {new Date(demoState.paidUntil).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                        {" · "}
                        {formatUsdc(demoState.toRewards)} mUSDC sent to volunteer rewards
                      </>
                    ) : (
                      "All rotation options unlocked."
                    )}
                  </div>
                </div>
              </div>
              {demo && (
                <button className="gt-btn gt-btn-quiet" onClick={resetDemo} disabled={busy}>
                  Reset demo
                </button>
              )}
            </div>
          )}

          {shown.length === 0 && <p className="gt-notice mt-8">{rec.notes[0]}</p>}

          <div className="mt-10 grid gap-5">
            {shown.map((r, i) => (
              <article
                key={r.years.map((y) => y.crop.id).join("-")}
                className="gt-card gt-rotation gt-rise p-6 sm:p-8"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="flex items-start gap-5">
                    <span className="gt-display text-5xl text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      {i === 0 && <span className="gt-tag gt-tag-best mb-3">Best match</span>}
                      <div className="flex flex-wrap items-center gap-2">
                        {r.years.map((y, j) => (
                          <span key={j} className="flex items-center gap-2">
                            {j > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
                            <span className="gt-crop">{y.crop.name}</span>
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{r.years.length}-year rotation</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="gt-display text-5xl text-primary">{Math.round(r.total * 100)}%</div>
                    <div className="text-sm text-muted-foreground">Overall fit</div>
                  </div>
                </div>

                <div className="mt-7 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {(Object.keys(r.scores) as (keyof typeof r.scores)[]).map((k) => (
                    <div key={k} className="grid gap-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{GOALS.find((g) => g.key === k)?.label}</span>
                        <span className="gt-num">{Math.round(r.scores[k] * 100)}</span>
                      </div>
                      <div className="gt-track">
                        <div className="gt-fill" style={{ width: `${Math.round(r.scores[k] * 100)}%`, animationDelay: `${i * 90 + 200}ms` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <ul className="mt-7 grid gap-1.5 border-t border-border pt-5 text-sm text-muted-foreground">
                  {r.explanation.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
              </article>
            ))}

            {gated && rec.rotations.length > 1 && (
              <div className="gt-card gt-dashed p-6 sm:p-8">
                <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-4">
                    <Lock className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                    <div>
                      <h3 className="text-lg font-medium">
                        {rec.rotations.length - 1} more rotation{rec.rotations.length - 1 === 1 ? "" : "s"} for your field
                        {demo && <span className="gt-tag ml-2 align-middle">Demo</span>}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Subscribe to see all {rec.rotations.length} options. 70% of every payment pays the volunteers who
                        check this data on the ground{price && <> · {price} per month</>}.
                      </p>
                    </div>
                  </div>
                  {canAct ? (
                    <div className="flex flex-wrap gap-2">
                      <button className="gt-btn" onClick={() => void getTestFunds()} disabled={busy}>Get test mUSDC</button>
                      <button
                        className="gt-btn gt-btn-primary"
                        onClick={() => void doSubscribe()}
                        disabled={busy || (demo && demoState.balance < DEMO_PRICE)}
                      >
                        Subscribe for 1 month
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Connect a wallet (top right) to subscribe.</p>
                  )}
                </div>
                {demo && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
                    <span>
                      Test wallet: <span className="gt-num text-foreground">{formatUsdc(demoState.balance)}</span> mUSDC
                      {demoState.balance < DEMO_PRICE && " · get test mUSDC first"}
                    </span>
                    <span>Demo only: no wallet or real payment. The live version runs on-chain.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {rec.notes.length > 0 && (
            <ul className="mt-8 grid gap-1.5 text-sm text-muted-foreground">
              {rec.notes.map((n) => (
                <li key={n}>— {n}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
