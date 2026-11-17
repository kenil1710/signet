# Local staging chain

An anvil fork of X Layer mainnet with Signet's contracts deployed on it. TapeOut is **not** on X Layer testnet
(checked 2026-11-17: chain 1952 has no code at any TapeOut address), so a mainnet fork is the only place to run
every user journey against the real policy circuit and the real SiteRegistry. The fork only reads mainnet.

```bash
pnpm staging:up            # start anvil, deploy registry + factory, create the Signet site gate and a demo gate
pnpm staging:smoke         # one full release on the demo gate (propose, 3 approvals, publish, write files)
pnpm staging:time 24h      # jump the clock (90s, 10m, 1h, 7d ...)
pnpm staging:time blocks 2 # mine blocks (commit-reveal needs 2)
pnpm staging:fund 0xAddr 5 # give any address OKB
pnpm staging:renew         # renew the registry's 30-day operator grant (needed after the clock moved >30 days)
pnpm staging:demo          # the whole CLI flow as a transcript (init, verify, seal, 2 releases, freeze)
pnpm staging:down          # stop; state is discarded, the next `up` starts fresh
```

- RPC `http://127.0.0.1:8545`, chain id 196 (same as mainnet, so container addresses match).
- Needs `XLAYER_RPC_URL` in `.env`. `STAGING_PORT` and `STAGING_FORK_BLOCK` are optional.
- Addresses and test accounts: `packages/contracts/deployments/local.json` (rewritten on every `up`).
  Accounts: 0 deployer, 1-3 approvers, 4 proposer (CI), 5 recovery, 6 guardian, 7-9 users. Their private keys are
  in `staging/.run/anvil.log` (test keys from a fixed seed; never use them anywhere else).
- Circuit #5's holder (the dev wallet) is impersonated once to make the registry the shared container's operator.
- **Every package uses the staging chain when `SIGNET_NETWORK=local`** (`@signet/contracts/network`):
  `pnpm --filter @signet/cli network`, `SIGNET_NETWORK=local pnpm --filter @signet/extension build`, and the Vite apps
  (`demo-dapp`, `dashboard`) read it in `vite.config.ts`. The default is `mainnet`.
- In a browser wallet, add a network with the RPC above and chain id 196, and import a test key from the log.
