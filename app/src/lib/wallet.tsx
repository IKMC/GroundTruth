import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { Hex } from "viem"
import { connectWallet } from "./chain"
import { errorMessage } from "./format"

type WalletState = { account: Hex | null; connect: () => Promise<void>; error: string | null }

const WalletContext = createContext<WalletState | null>(null)

/** One injected-wallet connection shared by every tab (was useWallet in the original App). */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Hex | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    try {
      setError(null)
      setAccount(await connectWallet())
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    const eth = window.ethereum
    if (!eth) return
    const onChange = (accounts: Hex[]) => setAccount(accounts[0] ?? null)
    eth.on("accountsChanged", onChange)
    return () => eth.removeListener("accountsChanged", onChange)
  }, [])

  return <WalletContext.Provider value={{ account, connect, error }}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider")
  return ctx
}
