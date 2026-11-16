# @signet/cli

The `signet` command: set a project up, seal a build, and move a release through its gate.
Run it from the repo with `pnpm signet <command>` (or `node packages/cli/src/cli.ts`). Node ≥ 22.18.

| Command | What it does | Who |
|---|---|---|
| `signet init --domain … --approvers a,b,c --recovery … [--guardian …] [--proposer …]` | Commits to the domain, then (2 blocks later) creates the gate through SignetFactory and binds the domain. Writes `signet.config.json`. Safe to rerun. | Anyone (the creator gets no rights) |
| `signet verify <buildDir \| url> [--build dir] [--strict]` | Checks that Guard can verify the site: static build, SRI on cross-origin scripts, `no-store`, CDN rewrites, SSR. Exit 1 on problems. | Anyone, no key |
| `signet seal <buildDir>` | Hashes every file, builds `filesRoot`, extracts the allowlist and the external origins, writes `signet-manifest.json` and `signet/{allowlist,origins,files}.json`. | Anyone, no key |
| `signet propose <buildDir> [--emergency]` | Proposes the sealed build. The gate computes the risk tier. | CI proposer key or an approver |
| `signet approve <id>` / `signet cancel <id>` | Approve or cancel a proposal. | Approvers |
| `signet publish <id> [buildDir] [--full]` | Publishes if the policy circuit allows it, then writes the manifest files on-chain. | Anyone |
| `signet upload <buildDir> [--full]` | Only the file-writing step; skips files already on-chain. | Anyone |
| `signet status [buildDir]` | The gate, its current release and its open proposals. | Anyone, no key |
| `signet freeze` / `signet unfreeze` | Stop all publishing at once; 2 approvers unfreeze. | Approvers; the guardian can freeze |

**Network.** `SIGNET_NETWORK=local` uses the staging chain (`pnpm staging:up`); the default is `mainnet`, where Signet's contracts are not deployed yet, so chain commands stop with a clear message.

**Keys.** `SIGNET_PRIVATE_KEY` for approvers and publishers; `SIGNET_PROPOSER_KEY` for CI (or the `.signet/proposer.key` file that `init` creates). Keys are never printed or written anywhere else. On staging only, `--as approver1` (or `proposer`, `guardian`, `user1`, an address…) signs with one of the chain's test accounts.

**Config.** `signet.config.json` (`network`, `chainId`, `domain`, `gate`) plus optional overrides for `seal`:

```json
{
  "allowlist": { "196": { "spenders": ["0x…"], "eip712": ["0x…"], "targets": ["0x…"], "exclude": ["0x…"] } },
  "origins": { "include": ["https://api.example.org"], "exclude": ["https://unused.example.org"] }
}
```

**Tests.** `pnpm --filter @signet/cli test` (20 unit tests: hashing, Merkle proofs, extraction, verify against a local web server). `pnpm --filter @signet/cli test:staging` (7 end-to-end tests that run every command against the staging chain; needs `pnpm staging:up`). `pnpm staging:demo` prints the whole flow.

`src/abi.ts` is generated from the Foundry build: `forge build` in `packages/contracts`, then `pnpm --filter @signet/cli gen:abi`.
