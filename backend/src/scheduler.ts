import { epochOfTimestamp, epochWindow } from "../../workflow/field-workflow/core/nasa"

type Opts = { baseUrl: string; adminKey: string; genesisDate: string; everyMs: number; graceSec: number }

export function startScheduler(o: Opts) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(o.baseUrl + path, {
      method,
      headers: { "content-type": "application/json", "x-admin-key": o.adminKey },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any }
  }

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const now = Math.floor(Date.now() / 1000)
      const current = epochOfTimestamp(o.genesisDate, now)
      for (let e = 1; e < current; e++) {
        const { data: info } = await call("GET", `/epochs/${e}`)
        if (info.finalized) continue

        if (!info.committedHash) {
          if (now < epochWindow(o.genesisDate, e).endUnix + o.graceSec) continue
          const r = await call("POST", "/admin/commit", { epoch: e })
          console.log(`[auto] commit epoch ${e}:`, r.status, r.data.error ?? r.data.tx)
          continue // finalize on a later tick, after the workflow settles it
        }

        const r = await call("POST", "/admin/finalize", { epoch: e })
        if (r.status === 200) console.log(`[auto] finalized epoch ${e}, root ${r.data.rewardRoot}`)
        else if (r.data.error !== "not settled on-chain yet") console.warn(`[auto] finalize epoch ${e}:`, r.status, r.data.error)
      }
    } catch (err) {
      console.error("[auto] tick failed:", err)
    } finally {
      running = false
    }
  }

  setTimeout(tick, 5_000)
  return setInterval(tick, o.everyMs)
}