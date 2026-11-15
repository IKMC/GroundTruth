import { useEffect } from "react"
import AboutView from "@/components/AboutView"
import { AppShell } from "@/components/AppShell"
import FarmerView from "@/components/FarmerView"
import VolunteerView from "@/components/VolunteerView"
import { usePath } from "@/lib/router"
import { WalletProvider, useWallet } from "@/lib/wallet"

const TITLES = {
  "/": "GroundTruth: crop rotation advice from NASA data and volunteers",
  "/volunteer": "Volunteer | GroundTruth",
  "/about": "How it works | GroundTruth",
} as const

function Page() {
  const path = usePath()
  const { account } = useWallet()
  useEffect(() => {
    document.title = TITLES[path]
  }, [path])
  if (path === "/volunteer") return <VolunteerView account={account} />
  if (path === "/about") return <AboutView />
  return <FarmerView account={account} />
}

export default function App() {
  return (
    <WalletProvider>
      <AppShell>
        <Page />
      </AppShell>
    </WalletProvider>
  )
}
