# @signet/watchtower

Every minute: loads each sealed site in headless Chromium, compares what it served with the release sealed on
X Layer, and tells the team when they differ. It also posts every new domain binding and every pending
tier-10 / tier-11 proposal. Read-only: it holds no key and sends no transaction.

```bash
SIGNET_NETWORK=local pnpm --filter @signet/watchtower start            # every 60 s
SIGNET_NETWORK=local pnpm --filter @signet/watchtower start -- --once  # one round
pnpm --filter @signet/watchtower test            # 2 unit tests (alert channels)
pnpm --filter @signet/watchtower test:staging    # 8 scenarios incl. a simulated hijack; needs pnpm staging:up
```

| Setting | |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional. With both set, every message also goes to that chat through the Bot API. Without them: console only. The token is never printed. |
| `TELEGRAM_PUBLIC_CHAT_ID` | Optional. Where the public posts go (new bindings, pending tier-10/11). Default: the same chat. |
| `SIGNET_RPC_URL2` | Second RPC; chain facts must be identical on both. Mainnet has one configured; staging runs with one. |
| `WATCHTOWER_ONLY` | Comma-separated domains (default: every bound domain). |
| `WATCHTOWER_URL_TEMPLATE` | Default `https://{domain}/`. |
| `WATCHTOWER_HOST_RULES` | Chromium `--host-resolver-rules`, for staging hosts that aren't in DNS. |
| `WATCHTOWER_FROM_INDEX`, `WATCHTOWER_STATE` | First run only: skip the first N domains of the registry's list; the state file (default `.state/<network>.json`). |

**What counts as a mismatch.** The HTML document, a script or a stylesheet whose SHA-256 isn't the sealed one; a
same-origin script that isn't in the release; a cross-origin script that isn't sealed or whose `integrity`
attribute isn't the sealed SRI hash; any request to an origin that isn't in the sealed origins. During the grace
window after a publish, the previous release is accepted too.

**Confirm twice.** A mismatch (or a failed load) is followed by a second load in a fresh browser context a few
seconds later. Only if that one is wrong too is the team alerted, once per distinct mismatch, and once more
when the site is clean again ("Recovered").

**Not built yet:** 3 regions (it runs in one place; "two regions confirm" is two loads from the same place),
TapeSend, X posts, the public status page, Guard telemetry.

**Live (built 2026-11-19; switched on when the repository is public):** `.github/workflows/watchtower.yml` runs one
round every 5 minutes for `signetguard.xyz` on GitHub Actions (free for public repositories). The clock is a Cloudflare
Worker cron (`cron/`, free plan) that starts the workflow with `workflow_dispatch` and skips a beat while a round is
queued or running: GitHub's own schedule is best-effort (from 2026-11-20 to 11-24 it ran every 4–12 hours) and stays
only as a fallback. State and the public `status.json` live on the `watchtower-status`
branch (one commit, replaced each round); `/prove` and the dashboard read the status from there. Alerts go to
Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` secrets).

**Operator auto-renew (`src/renew.ts`):** each round reads `SiteRegistry.operatorUntil(container #5)`; with fewer than
7 days left it calls `siteGate.renewOperator(processor, 5)` from a **dedicated renewer wallet**
(`WATCHTOWER_RENEW_KEY`, never signet-dev or any gate role), after simulating it. ≈ 115k gas ≈ 0.0000025 OKB per
renewal. It alerts once on a renewal, on a failure, and when the wallet falls below 0.00005 OKB. Tested on staging
(`test/staging/watchtower.test.ts`, "operator grant").
See `docs/decisions.md`.
