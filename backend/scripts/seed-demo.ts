/**
 * Seeds a running backend with demo volunteers for one epoch, plus one liar, so you can show the
 * whole flow on stage without needing five people with weather stations.
 *
 *   BACKEND_URL=http://localhost:8787 EPOCH=1 npm run seed
 *
 * The backend must run with DEMO_REPLAY=true if the epoch is in the past.
 * The volunteer keys below are PUBLIC demo keys. Use them on testnets only.
 */
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import { readingMessage } from "../../workflow/field-workflow/core/canonical"
import { epochWindow, nasaDailyUrl, parseNasaDaily } from "../../workflow/field-workflow/core/nasa"
import type { NasaDay } from "../../workflow/field-workflow/core/types"
import { honestValues, liarValues } from "../src/demo"
import { DEFAULT_CELLS } from "../src/support"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8787"
const EPOCH = Number(process.env.EPOCH ?? 1)
const GENESIS = process.env.GENESIS_DATE ?? "2026-10-01"
const CELL = process.env.CELL ?? "cell-a"
const COUNT = Number(process.env.COUNT ?? 5)

const keyOf = (i: number): Hex => `0x${(i + 1000).toString(16).padStart(64, "0")}`

/** NASA's real value for this cell and day, so the demo volunteers can be centred on it. */
async function fetchNasa(ymd: string): Promise<NasaDay | undefined> {
  const cell = DEFAULT_CELLS.find((c) => c.id === CELL)
  if (!cell) return undefined
  try {
    const res = await fetch(nasaDailyUrl(cell, ymd), { signal: AbortSignal.timeout(15_000) })
    return res.ok ? parseNasaDaily(await res.json(), ymd) : undefined
  } catch {
    return undefined
  }
}

async function send(label: string, body: object) {
  const res = await fetch(`${BACKEND}/readings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const json = (await res.json()) as { error?: string }
  console.log(`${res.ok ? "accepted" : "REJECTED"}  ${label}${res.ok ? "" : `  (${json.error})`}`)
}

async function main() {
  const day = epochWindow(GENESIS, EPOCH)
  console.log(`Seeding epoch ${EPOCH} (${day.ymd}) in ${CELL} at ${BACKEND}`)
  const nasa = await fetchNasa(day.ymd)
  if (nasa) console.log(`NASA POWER says ${nasa.tempX10 / 10} C and ${nasa.rainX10 / 10} mm for that day: volunteers are centred on it.\n`)
  else console.log("WARNING: could not fetch NASA data, using generic numbers. The oracle will compare them with the REAL NASA values and\nmay compute a large correction. Check your internet connection and run again for realistic demo data.\n")

  for (let i = 0; i < COUNT; i++) {
    const a = privateKeyToAccount(keyOf(i))
    const v = honestValues(nasa, i)
    const r = {
      volunteer: a.address, cellId: CELL, observedAt: day.startUnix + 3600 * (i + 1),
      rainX10: v.rainX10, tempX10: v.tempX10, moistureX10: i === 0 ? 300 : null,
    }
    await send(`volunteer ${i + 1} ${a.address}`, { ...r, signature: await a.signMessage({ message: readingMessage(r) }) })
  }

  // A liar whose number looks plausible against NASA but disagrees with the honest majority.
  const liar = privateKeyToAccount(keyOf(900))
  const lv = liarValues(nasa)
  const lie = { volunteer: liar.address, cellId: CELL, observedAt: day.startUnix + 7200, rainX10: lv.rainX10, tempX10: lv.tempX10, moistureX10: null }
  await send(`LIAR      ${liar.address}`, { ...lie, signature: await liar.signMessage({ message: readingMessage(lie) }) })

  // A forger signing in someone else's name is refused immediately.
  const forger = privateKeyToAccount(keyOf(901))
  const fake = { ...lie, volunteer: privateKeyToAccount(keyOf(0)).address, observedAt: day.startUnix + 9000 }
  await send(`FORGER    claims to be volunteer 1`, { ...fake, signature: await forger.signMessage({ message: readingMessage(fake) }) })

  console.log("\nDemo volunteer keys (public, testnet only). Run `npm run keys` any time to print them again:")
  for (let i = 0; i < COUNT; i++) console.log(`  volunteer ${i + 1}: ${privateKeyToAccount(keyOf(i)).address}  key ${keyOf(i)}`)
  console.log("Next: POST /admin/commit, wait for the CRE run, POST /admin/finalize. See docs/07-DEMO-AND-PITCH.md")
}

main().catch((e) => { console.error(e); process.exit(1) })