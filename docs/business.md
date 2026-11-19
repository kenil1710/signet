# Who pays, and how Signet reaches users (2026-11-19)

Short and honest: **no customers and no revenue yet.** Prices below are our proposal, not tested with buyers.

| | |
|---|---|
| **Who pays** | dApp teams, **per domain**. Users never pay: Guard is free, and so is the Free plan. |
| **Free** | 1 domain: sealed releases with on-chain approvals, Diff Guard, the badge, Guard protection for every visitor who has it. The team pays its own gas (≈ 0.0001 OKB per release). |
| **Pro: $49 / month** (planned, early access) | Up to 3 domains; a watchtower that checks every minute from more than one region; private alerts; automatic renewal of the on-chain storage grant; a **verified copy** hosted on X Layer (we pay the storage gas, ≈ 0.004 OKB per full upload). |
| **Enterprise: from $500 / month** (planned) | Setup with the team, incident support, and an **API for wallets** to read a site's sealed allowlist. |
| **Our costs** | Gas for Pro storage (cents per release), the watchtower's servers, support. |

## How we reach users

1. **X Layer teams first.** Every TapeOut / DeWEB project and X Layer dApp is a candidate. We start with the
   ecosystem's own channels (hackathon, OKX X Layer ecosystem programs) and offer to seal their first release with them.
2. **Each sealed site advertises Guard.** The "Sealed by Signet" badge links to the site's on-chain record and to
   Guard, so a team's users find Guard on a site they already trust.
3. **Wallets.** The long-term channel is a wallet doing Guard's check itself (the Enterprise API). We have **no wallet
   partner** today; we'd approach wallets on X Layer (e.g. OKX Wallet) and Rabby once there are sealed sites with traffic.
4. **Developers.** The CLI on npm (`signetguard`), a GitHub Action, and a setup guide (`/start`) a team can follow alone.

## Why teams stay

- **It's in their release path.** Once CI proposes every release and approvers approve in the dashboard, removing
  Signet means removing a control their users and auditors can see.
- **A public record.** Every release, approval and timelock is on X Layer, and the badge shows it. That history is
  the team's, and it grows with every release.
- **Alerts.** The watchtower tells them when their live site stops matching its seal, the moment they most need us.

## What would prove this wrong

No X Layer team adopting the Free plan in its first months, or teams adopting it without their users installing
Guard. We'd measure: domains sealed, releases per domain, Guard installs on sealed domains.
