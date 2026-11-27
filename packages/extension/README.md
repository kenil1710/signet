# @signet/extension — Guard

Chrome MV3 extension. On a sealed domain it checks the page against the release the team published on X Layer,
and checks every signing request against the sealed allowlist. On every other domain it does nothing.

```bash
SIGNET_NETWORK=local pnpm --filter @signet/extension build   # -> packages/extension/dist (load unpacked)
pnpm --filter @signet/extension test                         # 10 unit tests (signing policy, manifest hashing)
pnpm --filter @signet/extension test:staging                 # 11 headless scenarios; needs pnpm staging:up
```

Staging needs two RPC URLs (`SIGNET_RPC_URL`, `SIGNET_RPC_URL2`); the tests put two logging proxies in front of anvil.

| File | What it does |
|---|---|
| `src/background.ts` | Service worker. Downloads the list of sealed domains (the registry's `domainCount` / `domainsRange`) on a timer; for a sealed domain reads the binding and the gate from **two RPCs at the same block, which must agree**; fetches `signet/{allowlist,origins,files}.json` from the container and **rejects them unless they hash to the on-chain `allowlistHash`, `originsHash` and `filesRoot`**; caches the result (fresh 60 s, usable for 24 h if the RPCs are down); decides signing requests; sets the badge. |
| `src/content.ts` | Isolated world. Reads the HTML, scripts and stylesheets the page loaded from the browser's HTTP cache (`only-if-cached`, no network), hashes them and compares with the sealed files. Cross-origin scripts: the `integrity` attribute must equal the sealed SRI hash. Shows the full-page notice when a signature is refused. |
| `src/inpage.ts` | Page world, `document_start`. Wraps every provider a page can reach in place: `window.ethereum` (and `.providers`), the wallet globals (`okxwallet`, `bitkeep.ethereum`, `coinbaseWalletExtension`, `phantom.ethereum`, `trustwallet`, `rabby`, …), any other EIP-1193 object on a global, and every EIP-6963 provider. Signing requests wait for Guard's answer, and the wallet gets the copy Guard checked. A wallet that can't be wrapped (OKX Wallet 4.26.0: non-configurable globals, a provider that ignores assignments) is checked on its own channel instead: `content.ts` + `lib/wire.ts` (docs/decisions.md, 2026-11-28). |
| `src/lib/policy.ts` | The signing rules (pure): decodes approve / increaseAllowance / setApprovalForAll / permit / transfer / transferFrom, Permit2, Uniswap-V2-style router swaps, EIP-712 typed data. |
| `src/pages/` | Popup, the red warning page, the verified-copy page and its sandboxed preview frame. |

**Badge.** Green `OK`: sealed and every loaded file matches. Red `!`: a file differs or isn't sealed, or the release was revoked. Grey `?`: Guard could not check (RPCs down or disagreeing, manifest missing or rejected, a file not in the cache). No badge: not a sealed domain.

**Modes (read from the gate).** Observe: nothing is ever blocked; what would have been is recorded and shown in the popup. Enforce: a tampered page is replaced by the red warning page, and a signature for an unsealed spender, target, recipient or verifying contract is refused with EIP-1193 error 4001 before the wallet sees it. When Guard can't check, it never blocks (fail-open).

**Privacy.** A visited host is compared with the local list of sealed domains. If it isn't on it, Guard makes no request and stores nothing (tested: zero RPC requests, the site sees only its own requests). "Report wrong block" builds a report locally and copies it to the clipboard; Guard has no server.

**Verified copy.** Built with `SIGNET_GATEWAY_URL` (and the gateway's `dist`), "Open verified copy" opens the project on the Signet gateway (`packages/gateway`): a normal page on its own origin where the wallet works. Guard treats that host as the sealed domain and pins the gateway's own three files. Without a gateway it shows a preview inside the extension (no wallet).

**Token transfers** follow the project's sealed `transfers` setting: `user` (default), `allowlist` or `any`.

**Limits (v1).** See `docs/decisions.md`, "Guard extension" and "Four changes after the overnight run". The main ones: no public gateway is deployed yet; only the top frame is checked; a wallet that freezes its provider and makes `window.ethereum` non-configurable can only be wrapped through EIP-6963; not tested with a real wallet.
