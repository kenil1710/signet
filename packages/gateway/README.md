# @signet/gateway

The verified copy of a sealed site as a **normal web page**: its own origin, storage that works, and wallet
extensions that inject, while every byte comes from the project's container on X Layer and is checked against
the release its approvers published. This is what Guard's "Open verified copy" opens during a hijack.

The design is TapeKit's service-worker gateway (`TapeOutProtocol/TapeKit`, `sw-gateway/`, live at tapekit.org);
see `docs/tapeout-interfaces.md` §11 for why sealed projects can't use that one as it is.

```
https://app-example-org.<gateway>/        the verified copy of app.example.org   ("." -> "-", "-" -> "--")
https://app-example-org.<gateway>/.signet/status   what was read and checked
```

1. The gateway's server returns the same boot page for every host and path (plus `/sw.js` and `/.signet/boot.js`).
2. The boot page installs the service worker and reloads. From then on the worker answers every request of that origin, in the visitor's browser.
3. The worker asks SignetRegistry for the domain's gate and container (two RPCs, same block, identical answers), reads `allowlist.json`, `origins.json` and `files.json`, and rejects them unless they hash to the gate's current release.
4. Each file is read from the container and served only if its SHA-256 is the sealed one. Anything else is an explanation page with no site content.
5. The copy gets a CSP built from the sealed origins: its code comes only from the verified files, and it can talk only to the origins its team sealed.

```bash
SIGNET_NETWORK=local SIGNET_RPC_URL2=<second rpc> pnpm --filter @signet/gateway build   # -> dist/ (3 files + hashes.json)
pnpm --filter @signet/gateway serve          # http://localhost:8097/  and  http://<label>.localhost:8097/
pnpm --filter @signet/gateway test           # label encoding
pnpm --filter @signet/gateway test:staging   # 6 scenarios in headless Chromium; needs pnpm staging:up
```

**Deploying it** (not done): any static host that returns `index.html` for unknown paths, on a domain with
wildcard DNS and a wildcard certificate (one level: that is why a project is one label). Then build Guard with
`SIGNET_GATEWAY_URL=https://<gateway>`; Guard pins the SHA-256 of `index.html`, `boot.js` and `sw.js` from
`dist/.signet/hashes.json`. The domain should go on the Public Suffix List so projects are separate sites.

**Trust.** The server never handles site content, but the visitor has to trust the three files it hands out.
Guard checks them against its pins (with the limit described in `docs/decisions.md`); the signing-time
allowlist is enforced on the copy too and does not depend on the gateway.

**Limits.** Only files stored on-chain can be shown (≤ 48,000 bytes each, published with `signet publish --full`).
The team's backend must accept the gateway origin (CORS). Wallet connections are per origin. No fallback for
browsers without service workers. Tested with a mock wallet on `http://*.localhost`, not with MetaMask or OKX
Wallet, and not on a public https domain.
