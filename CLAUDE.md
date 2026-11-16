# Signet — project rules for Claude Code

Signet is our entry for the X Layer TapeOut Accelerate hackathon (deadline Dec 7, 2026, 23:59 UTC; we submit Dec 6).
It decides what a dApp's website is allowed to do, and keeps the app usable when the website is hacked.
The full spec is `docs/signet-spec.md`. Read it before starting any task.

## Repo layout (pnpm monorepo)

```
packages/
  contracts/    Foundry: ReleaseGate, Registry (Solidity 0.8.24)
  circuit/      Policy circuit netlist + exhaustive truth-table test (TypeScript)
  cli/          `signet` CLI: init, seal, verify, propose (TypeScript, viem, commander)
  action/       GitHub composite action
  extension/    Guard: Chrome MV3 extension (TypeScript, Vite)
  watchtower/   Site checker + alerts (Node, Puppeteer, Telegram Bot API)
  dashboard/    Approvals, Diff Guard, history, freeze (React + Vite, static, published to DeWEB)
  demo-dapp/    Simple X Layer swap/stake page used in the demo video
docs/
  signet-spec.md            The strategy and spec (source of truth)
  tapeout-interfaces.md     Exact TapeOut ABIs/addresses found in spikes (source of truth for TapeOut)
  decisions.md              Short log of decisions we make while building
```

## Hard rules

1. **Never invent TapeOut ABIs, addresses or behaviors.** Use only what is written in `docs/tapeout-interfaces.md`. If something isn't there, stop and tell me what to find out.
2. **Ask me before any mainnet transaction** (X Layer mainnet, chain id 196) and before spending any funds. Show the exact call and the estimated cost first.
3. **No secrets in the repo.** Private keys only in `.env` (gitignored). Never print keys in logs.
4. **The CI proposer key can only propose.** Never give it approve or publish rights in code or docs.
5. **Every release needs at least 1 human approval.** There is no automatic tier.
6. **Risk tier is computed on-chain** by comparing allowlistHash / originsHash with the current release. Never trust a tier sent by CI.
7. **Policy circuit:** keep the TypeScript reference function and the netlist in sync. CI runs all 1,024 input combinations; any mismatch fails the build.
8. **Extension privacy:** never send browsing history. No network calls for unsealed domains (there is a test for this).
9. **Default to observe mode and fail-open.** Enforcement only when a team turns it on.
10. **Every ReleaseGate rule has a Foundry test**, including every row of the tier table and the edge cases in the spec.

## How we work

- Work in the order of the build plan in the spec. Spikes A, B and C come first.
- One package at a time. Small commits with clear messages.
- After each task: run the tests, then summarize what changed and what's next in 3–5 lines.
- Log any design decision in `docs/decisions.md` (date, decision, why).
- If a spec detail turns out to be wrong or impossible, say so and propose the fallback from the spec's "Open questions" table.

## Approval tiers (summary; the spec has full details)

| Tier | When | Rule to publish |
| --- | --- | --- |
| 00 | Code only | ≥1 approval + 1 h timelock, or 3 of 3 with emergency flag |
| 01 | New external origin | ≥2 approvals + 1 h |
| 10 | New contract / spender | ≥2 approvals + 24 h, or 3 of 3 with emergency flag |
| 11 | Admin change (approvers, domain binding, timelocks, circuit swap) | 3 of 3 + 24 h, no fast lane |

Frozen → nothing publishes. Any one approver can freeze; unfreezing needs 2 of 3.
