# Chrome Web Store submission: Signet Guard 0.3.8

Everything the Developer Dashboard asks for. Nothing here has been submitted; the team submits it (Chrome Web Store
developer account, one-time USD 5 registration fee, paid by card to Google: **no OKB**). Updated 2026-11-28 for 0.3.8.

## Package

Upload the zip attached to the GitHub pre-release `guard-v0.3.8` (made by the `guard-release` workflow when the tag is
pushed; not released yet), not a local build: `signet-guard-0.3.8.zip` (mainnet build, files sorted, fixed timestamps),
with a Sigstore attestation (`gh attestation verify signet-guard-0.3.8.zip -R kenil1710/signet`) and its SHA-256 in
`signet-guard-0.3.8.zip.sha256`. 0.3.8 adds the icons the store needs (16/32/48/128, from the seal image) and says
"Verified copy: coming soon". Store icon: the manifest's 128 px icon (96 px art centered).

Manifest facts the review will see: Manifest V3, version 0.3.8, permissions `storage`, `alarms`; 6 host permissions
(two X Layer RPC nodes, four Arc RPC nodes); two content scripts on `http://*/*` and `https://*/*` at
`document_start` in all frames (one isolated, one in the page world); icons 16/32/48/128; no remote code.

## Store listing

**Name:** Signet Guard

**Summary (≤ 132 characters, 124 used):**
Checks dApp websites against the release their team sealed on X Layer, and refuses signatures to contracts they didn't seal.

**Category:** Privacy & Security if offered for your account's region, otherwise Developer Tools. **Language:** English.

**Description:**

> Your wallet trusts whatever the website asks it to sign. When a dApp's website is hijacked (DNS, CDN, a poisoned
> npm package, a stolen deploy key), the attacker's page asks your wallet to approve their contract, and it looks
> exactly like the real site.
>
> Signet Guard checks the site against what its team sealed. Teams that use Signet seal each release of their website
> on X Layer: the hash of every script, the contracts and spenders the site may ask a wallet to sign for, and the
> outside origins it may use. A release goes live only after the team's approvers approve it and a timelock passes.
>
> On a sealed site, Guard:
> • checks every script the page runs against the sealed hashes (read from your browser's cache: nothing is downloaded twice),
> • checks every signature request before your wallet shows it, against the sealed contracts and spenders,
> • shows a green seal, or a clear warning when the page doesn't match its release.
>
> Sites start in observe mode: Guard reports, it doesn't block. When a site's team turns on enforce mode, Guard refuses
> signatures to contracts and spenders the team didn't seal (the page gets the standard "rejected" error, 4001).
>
> Wallets: tested by hand with Rabby, OKX Wallet and MetaMask; tested automatically with Coinbase Wallet, Bitget Wallet
> and Phantom. Trust Wallet is not protected yet when a site uses window.ethereum.
>
> Private by design: on sites that aren't sealed Guard makes no network request at all. It has no account, no
> analytics and no server: it reads public data from X Layer (and, for Arc dApps, Arc) through public RPC nodes, and
> decides in your browser. Its signing decision comes from a public, non-upgradeable TapeOut circuit on X Layer.
>
> Open source: https://github.com/kenil1710/signet · How it works and its limits: https://signetguard.xyz

(The wallet paragraph matches CLAIMS.md as of release #18; drop it if you prefer a shorter listing.)

**Homepage URL:** https://signetguard.xyz · **Support URL:** https://github.com/kenil1710/signet/issues

**Screenshots (1280×800; up to 5; upload in this order; in `docs/demo/store/`):**
1. `1-sealed.png`: a sealed site, green; the popup shows the sealed release.
2. `2-signature-refused.png`: enforce mode refuses a signature to an unsealed contract.
3. `3-page-mismatch.png`: a tampered script: the page doesn't match its sealed release.
4. `4-verified-copy.png`: the verified copy offered on a hijacked site. Leave it out until a gateway is deployed (Guard 0.3.8 says "coming soon").

They come from the staging test suite (real Guard pages on a staging test domain, Guard 0.3.x). Optional: retake 1–3
at 1280×800 during the video demo on swap.localhost (same pages, newer build). No promo tile is required.

## Privacy practices tab

**Single purpose:**
Check websites of dApps that are sealed with Signet against their sealed release, and check the signature requests
those sites send to the user's wallet against the contracts the site's team sealed.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps, on the device only: the public list of sealed domains, the sealed releases and domain proofs of sealed sites the user visits (so a check is instant), settings, the per-tab result, and a local log of the last 200 warnings and refusals shown in the popup. Nothing is synced or uploaded. |
| `alarms` | Refreshes the public list of sealed domains every 5 minutes, so Guard knows which sites are sealed without asking anyone about the site the user is on. |
| Host permissions `https://xlayerrpc.okx.com/*`, `https://xlayer.drpc.org/*` | The two public X Layer RPC nodes Guard reads the sealed-domain list and sealed releases from. Every fact is read from both and must match; a difference means "could not check". |
| Host permissions `https://rpc.mainnet.arc.io/*`, `https://arc-mainnet.drpc.org/*`, `https://rpc.testnet.arc.io/*`, `https://arc-testnet.drpc.org/*` | Two public RPC nodes per Arc network, read only on a sealed site whose contracts are on Arc, to check that a contract the user is asked to sign for was created by the site's sealed factory for that user. |
| Content scripts on `http://*/*`, `https://*/*`, all frames, at `document_start` (one isolated script, one page-world script) | Guard can't know in advance which site is sealed, and a hijacked page acts from its first script. The scripts ask the extension (locally) whether the current domain is sealed; on a domain that isn't sealed they do nothing and make no network request. On a sealed domain they compare the page's scripts with the sealed hashes and hold each wallet signature request until Guard has checked it. The page-world script is needed to see the page's wallet providers (`window.ethereum`, EIP-6963). All frames: wallets also inject into iframes of the same site, which a hijacked page could use to reach the wallet; Guard checks signing requests in iframes whose every ancestor is the same site, and returns at once in any other frame. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package; Guard only reads data (hashes,
addresses, circuit answers).

**Data usage:** tick **none** of the categories. Guard transmits none of them: pages and signature requests are checked
in the browser; the local event log never leaves the device (the store's categories are about data collected or
transmitted). Certify all three statements (not sold; not used for unrelated purposes; not used for creditworthiness).

**Privacy policy URL:** https://signetguard.xyz/privacy (live, HTTP 200; the same text as `docs/PRIVACY.md`).

## Before you click Submit

- Upload `signet-guard-0.3.8.zip` from the GitHub release (not a local build) and check the dashboard shows version 0.3.8 and the seal icon.
- Review can take several days; extensions with content scripts on all sites often get a longer review.
- After approval: put the store link in the site (`chromeWebStore` in `packages/dashboard/src/landing/config.ts`, now a
  "coming soon" link) in a later site release, and say "in the Chrome Web Store" only after that.
