import fieldsAerial from "@/assets/fields-aerial.jpg"

const STEPS = [
  { title: "NASA gives the regional picture.", text: "Temperature and rainfall from NASA POWER, a satellite and model product with a coarse grid." },
  { title: "Volunteers give the field truth.", text: "People on the ground send signed daily readings for their area." },
  { title: "A decentralised oracle network checks both.", text: "Chainlink nodes each fetch the readings and NASA's data, run the same rules, and must agree before anything is recorded." },
  { title: "Local corrections are stored on-chain.", text: "For each area: how far real conditions differ from NASA, and how much we trust that." },
  { title: "Farmers get advice built on the corrected data.", text: "Crop rotations scored for suitability, water, soil health, income, risk and simplicity, weighted by what matters to them." },
  { title: "Subscriptions pay the volunteers.", text: "Most of every subscription backs the FIELD reward token. The rest keeps the app running." },
]

const LIMITS = [
  "Temperature, rainfall, and soil pH thresholds are sourced from the FAO ECOCROP database, while crop water demand and relative income remain general estimates to be calibrated with local extension and market data.",
  "The model uses seasonal temperature, rainfall and soil pH. It does not model pests, markets, irrigation or crop varieties.",
  "NASA POWER cells are large (tens of kilometres), so one volunteer's field may differ from the cell average. That is exactly why local readings help, and why we show how many back each correction.",
  "Consensus makes the result tamper-proof. It does not prove that a volunteer measured honestly: plausibility against NASA, agreement between neighbours and per-area reward caps do that.",
  "This is a testnet demonstration. The tokens have no real value and the contracts are not audited.",
]

export default function AboutView() {
  return (
    <>
      <section className="gt-container pb-16 pt-12 md:pt-20">
        <div className="gt-rise max-w-3xl">
          <p className="gt-eyebrow">How it works</p>
          <h1 className="gt-display mt-5 text-5xl sm:text-6xl lg:text-7xl">
            From orbit, <em>down to the soil.</em>
          </h1>
          <p className="gt-lede mt-6">
            NASA data covers the whole planet, but in cells tens of kilometres wide. Volunteers fix it for the farms in
            between, and an oracle network keeps everyone honest.
          </p>
        </div>
      </section>

      <section className="gt-container">
        <ol className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="gt-rise border-b border-border py-8 sm:pr-8" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="gt-display text-5xl text-primary">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="mt-4 text-lg font-medium">{s.title}</h2>
              <p className="mt-2 text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="gt-container mt-20 grid items-center gap-12 lg:grid-cols-2">
        <img
          src={fieldsAerial}
          alt="Farm plots seen from above"
          width={1600}
          height={1008}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-[2rem] object-cover"
        />
        <div>
          <p className="gt-eyebrow">Honest limits</p>
          <h2 className="gt-display mt-3 text-4xl sm:text-5xl">What this can't do yet.</h2>
          <ul className="mt-8 grid gap-4">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-3 text-muted-foreground">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-highlight" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
