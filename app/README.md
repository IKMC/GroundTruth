# GroundTruth app

Farmer advice, volunteer readings and rewards. Talks to the Express server in `../backend`.

## Run
```
cp .env.example .env      # VITE_BACKEND_URL defaults to http://localhost:8787
npm install
npm run dev               # http://localhost:5173
```
Start the backend first (`cd ../backend && npm start`).

- Pages: `#/` advice, `#/volunteer`, `#/about`.
- Without contract addresses in `.env`, the subscribe box runs as a browser-only demo (no wallet, no payment). Fill in `VITE_ORACLE`, `VITE_TOKEN`, `VITE_SUBSCRIPTION`, `VITE_USDC` to switch to real on-chain payments.
- `npm test` runs engine, signing-consistency and demo subscription tests.
