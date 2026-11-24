# Chrome Web Store submission: Signet Guard 0.3.2

Everything the Developer Dashboard asks for, in its order. Nothing here has been submitted; the team submits it
(Chrome Web Store developer account, one-time USD 5 registration fee, paid by card to Google: **no OKB**).

## Package

- File: `signet-guard-0.3.2.zip`, built exactly like the `guard-release` workflow (mainnet build, files sorted, fixed
  timestamps). Upload the zip the workflow attaches to the `guard-v0.3.2` GitHub release (it carries the Sigstore
  attestation), not a local build.
- Manifest V3, version 0.3.2. No remote code: every script is in the package.

## Store listing

**Name:** Signet Guard

**Summary (≤ 132 characters):**
Checks dApp websites against the release their team sealed on X Layer, and refuses signatures to contracts they didn't seal.

**Category:** Developer Tools (alternatives: Privacy & Security, if offered for the account's region)

**Language:** English

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
> • checks every script the page runs against the sealed hashes (from your browser's cache: nothing is downloaded twice),
> • checks every signature request before your wallet shows it, against the sealed contracts and spenders,
> • shows a green seal, or a clear warning when the page doesn't match its release.
>
> Sites start in observe mode: Guard reports, it doesn't block. When a site's team turns on enforce mode, Guard refuses
> signatures to contracts and spenders the team didn't seal, and offers a verified copy of the site.
>
> Private by design: on sites that aren't sealed Guard makes no network request at all. It has no account, no
> analytics and no server: it reads public data from X Layer (and, for Arc dApps, Arc) through public RPC nodes, and
> decides in your browser. Its signing decision comes from a public, non-upgradeable TapeOut circuit on X Layer.
>
> Open source: https://github.com/kenil1710/signet · How it works and its limits: https://signetguard.xyz

**Screenshots (1280×800):** `docs/demo/store/` (the staging suite's real Guard screenshots, padded to the store size;
they show the staging test domain: retake them on signetguard.xyz during the real-wallet test below if possible):
1. `1-sealed.png`: a sealed site, green: the popup shows the sealed release.
2. `2-signature-refused.png`: enforce mode refuses a signature to an unsealed contract.
3. `3-page-mismatch.png`: a tampered script: the page doesn't match its sealed release.
4. `4-verified-copy.png`: the verified copy offered on a hijacked site.

**Small promo tile (440×280):** optional; not made.

**Homepage URL:** https://signetguard.xyz · **Support URL:** https://github.com/kenil1710/signet/issues

## Privacy practices tab

**Single purpose:**
Check websites of dApps that are sealed with Signet against their sealed release, and check the signature requests
those sites send to the user's wallet against the contracts the site's team sealed.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the public list of sealed domains, the sealed releases of sealed sites the user visits (so a check is instant), the user's settings, the per-tab result, and a local log of the last 200 warnings and refusals shown in the popup. Nothing leaves the device. |
| `alarms` | Refreshes the public list of sealed domains every 5 minutes, so Guard knows which sites are sealed without asking anyone about the site the user is on. |
| Host permission `https://xlayerrpc.okx.com/*`, `https://xlayer.drpc.org/*` | The two public X Layer RPC nodes Guard reads the sealed-domain list and sealed releases from. Every fact is read from both and must match; a difference is "could not check". |
| Host permission `https://rpc.mainnet.arc.io/*`, `https://arc-mainnet.drpc.org/*`, `https://rpc.testnet.arc.io/*`, `https://arc-testnet.drpc.org/*` | Two public RPC nodes per Arc network, read only on a sealed site whose contracts are on Arc, to check that a contract the user is asked to sign for was created by the site's sealed factory for that user. |
| Content scripts on `http://*/*`, `https://*/*` (an isolated script and a page-world script, at `document_start`) | Guard can't know in advance which site is sealed, and a hijacked page acts from its first script. The scripts ask the extension (locally) whether the current domain is sealed; on a domain that isn't sealed they do nothing and make no network request. On a sealed domain they compare the page's scripts with the sealed hashes and hold each wallet signature request until Guard has checked it. The page-world script is needed to see the page's wallet provider (`window.ethereum`, EIP-6963). |

**Remote code:** No, I am not using remote code. (All JavaScript is in the package; Guard only reads data: hashes,
addresses and circuit answers.)

**Data usage (what the form asks you to tick):** Guard collects **none** of the listed categories (personally
identifiable information, health, financial and payment information, authentication information, personal
communications, location, web history, user activity, website content). Pages and signature requests are checked in
the browser and never transmitted. Certify all three statements: not sold to third parties; not used or transferred
for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/kenil1710/signet/blob/main/docs/PRIVACY.md (also served at
https://signetguard.xyz/privacy from the next site release).

## Before submitting

- Tag `guard-v0.3.2` so the workflow builds, attests and attaches the zip; download that zip and check its SHA-256
  matches the release notes.
- Test it once with a real wallet (MetaMask or OKX Wallet) on signetguard.xyz and on misthos.world (observe mode), and
  say so in the listing only after that.
- Review usually takes a few days; extensions with content scripts on all sites can take longer.
