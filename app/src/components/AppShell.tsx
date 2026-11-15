import { Link } from "@/lib/router"
import type { ReactNode } from "react"
import { useWallet } from "@/lib/wallet"

const LINKS = [
  { to: "/", label: "Advice" },
  { to: "/volunteer", label: "Volunteer" },
  { to: "/about", label: "How it works" },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const { account, connect, error } = useWallet()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="gt-nav">
        <div className="gt-container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <Link to="/" className="gt-wordmark" aria-label="GroundTruth home">
            <span className="gt-mark" aria-hidden />
            GroundTruth
          </Link>
          <nav aria-label="Sections" className="order-3 -mx-2 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="gt-navlink" activeOptions={{ exact: true }}>
                {l.label}
              </Link>
            ))}
          </nav>
          <button className="gt-btn" onClick={() => void connect()} aria-label="Connect wallet">
            {account ? (
              <>
                <span className="gt-live-dot" aria-hidden />
                <span className="gt-num text-sm">{`${account.slice(0, 6)}…${account.slice(-4)}`}</span>
              </>
            ) : (
              "Connect wallet"
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="gt-container pt-4">
          <p className="gt-error" role="alert">{error}</p>
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="gt-rule mt-24">
        <div className="gt-container flex flex-col gap-3 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="gt-wordmark text-lg text-foreground">
            <span className="gt-mark" aria-hidden />
            GroundTruth
          </span>
          <span>Testnet demonstration. Not financial or agronomic advice.</span>
          <span className="gt-eyebrow">NASA POWER · Chainlink CRE</span>
        </div>
      </footer>
    </div>
  )
}
