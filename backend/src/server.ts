import { parseUnits, type Hex } from "viem"
import { createApp } from "./app"
import { createViemChain } from "./chain"
import { liveNasa } from "./nasa"
import { Store, configFromEnv } from "./support"
import { DEFAULT_PARAMS } from "../../workflow/field-workflow/core/params"
import { startScheduler } from "./scheduler"

const env = process.env
const config = configFromEnv(env)
if (config.adminKey === "change-me") console.warn("WARNING: ADMIN_KEY is the default. Set a real one.")

const chain =
  env.RPC_URL && env.ORACLE_ADDRESS && env.COMMITTER_PRIVATE_KEY
    ? createViemChain({
        rpcUrl: env.RPC_URL,
        oracle: env.ORACLE_ADDRESS as Hex,
        privateKey: env.COMMITTER_PRIVATE_KEY as Hex,
        deployBlock: BigInt(env.DEPLOY_BLOCK ?? "0"),
      })
    : undefined
if (!chain) console.warn("Chain not configured: /admin/commit and /admin/finalize are disabled.")

// Must equal baseRewardField in the workflow config, or the Merkle roots will not match.
const params = {
  ...DEFAULT_PARAMS,
  baseRewardWei: env.BASE_REWARD_FIELD ? parseUnits(env.BASE_REWARD_FIELD, 18) : DEFAULT_PARAMS.baseRewardWei,
}

const app = createApp({ config, store: new Store(env.DATA_FILE ?? "./data/store.json"), chain, nasa: liveNasa, params })
const port = Number(env.PORT ?? 8787)

app.listen(port, () => {
  console.log(`GroundTruth backend listening on :${port} (demoReplay=${config.demoReplay})`)
  if (chain && env.AUTO_RUN === "true") {
    startScheduler({
      baseUrl: `http://localhost:${port}`,
      adminKey: config.adminKey,
      genesisDate: config.genesisDate,
      everyMs: Number(env.AUTO_EVERY_MIN ?? 5) * 60_000,
      graceSec: Number(env.AUTO_COMMIT_GRACE_MIN ?? 60) * 60,
    })
    console.log("Auto commit/finalize is on")
  }
})