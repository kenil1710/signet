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

**Planned: auto-renew the operator grant.** Each round, read `SiteRegistry.operatorUntil(container #5)`; when fewer
than **7 days** are left, send `siteGate.renewOperator(processor, 5)` (anyone may call it; ≈ 115k gas ≈ 0.0000024 OKB).
Send from a **small dedicated renewer wallet** funded with a little OKB (`WATCHTOWER_RENEW_KEY`), **never signet-dev**
or any approver/proposer key. Alert the team if the renewal fails or the wallet runs low. Current expiry:
2026-12-19 08:05 UTC.
See `docs/decisions.md`.
