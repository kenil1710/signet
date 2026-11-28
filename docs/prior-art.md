# Prior art: TapeKit, Meta Code Verify, WEBCAT and WAICT (checked 2026-11-19)

Both answer the question Signet answers: "is the code in my browser the code the site's owners meant to ship?"
They are mature, well-designed systems. This is an honest comparison, from their public documentation (sources
at the end).

## TapeKit (TapeOut's DeWEB toolkit): what Signet builds on

- **What it does:** DeWEB sites keep their files in a TapeOut Circuit Container on X Layer (SiteRegistry). TapeKit's
  kernel and gateway (`<circuit>-2-<processor>.tapekit.org`) read each file and accept it only if its size and
  SHA-256 equal the on-chain record (TAP-10 §7.1), reading the chain from independent RPCs.
- **What Signet reuses:** the same storage (SiteRegistry, circuit #5's container), the same reading rule and the
  two-RPC agreement in Guard, the gateway, the watchtower and `/prove`, and TapeKit's service-worker gateway design.
- **What Signet adds on top:**
  1. **A signing-time contract allowlist**: Guard refuses a signature to a contract or spender the release didn't
     seal, before the wallet opens (circuit #7). TapeKit checks files; it doesn't look at what a page asks a wallet
     to sign.
  2. **Risk-tiered approvals with timelocks, decided by circuit #6**: in DeWEB, whoever holds the container
     publishes. In Signet, CI only proposes, humans approve in their own wallets, and the tier is computed on-chain.
  3. **CI can only propose**: a stolen CI key can't publish anything nobody approved.
  4. **A domain proof** (`/.well-known/signet.json`): sites stay on their own domain, so the domain must confirm its gate.
  5. **A verified copy** read from X Layer when the live site doesn't match (built and tested on staging; live with Pro).

## WAICT (Mozilla and partners, 2026)

- **What it is:** Web Application Integrity, Consistency and Transparency. A site ties its client-side JavaScript to
  a manifest committed to a public transparency log, so users can tell the code they run is what everyone else gets.
  Mozilla described it in May 2026 ([Mozilla Hacks](https://hacks.mozilla.org/2026/05/trustworthy-javascript-for-the-open-web/)),
  with Cloudflare, Meta and the Freedom of the Press Foundation; a prototype is behind a pref in Firefox Nightly and
  the draft specs are in the `waict-wg` GitHub organization.
- **Relation to Signet:** the strongest long-term answer for page integrity, built into the browser, with no
  extension. It is a draft, not a stable browser feature. Like Code Verify and WEBCAT it answers "is this the
  published code?", not "may this page ask the wallet to sign this?" or "who approved this release, and did the
  risky ones wait?". If WAICT ships, Guard's page check can rely on it, and Signet's on-chain approvals and
  signing-time allowlist still apply.

## Meta Code Verify

- **What it does:** a browser extension (Chrome, Firefox, Edge) for **WhatsApp Web** and Meta's other web apps.
  Meta publishes the hash of each release of its web JavaScript to **Cloudflare**, an independent third party. The
  extension hashes the code the browser actually loaded and compares it with Cloudflare's copy. Green = verified,
  yellow = another extension interferes, red = mismatch. ([Meta engineering](https://engineering.fb.com/2022/03/10/security/code-verify/),
  [Cloudflare](https://blog.cloudflare.com/cloudflare-verifies-code-whatsapp-web-serves-users/))
- **Trust model:** one publisher (Meta) and one independent holder of the hash (Cloudflare). There is no
  multi-person approval and no public rule for *when* a release may go live: whatever Meta publishes is the
  reference.

## WEBCAT (Freedom of the Press Foundation)

- **What it does:** blocking code signing plus integrity and transparency checks for web apps
  ([repo](https://github.com/freedomofpress/webcat), [announcement](https://securedrop.org/news/introducing-webcat-web-based-code-assurance-and-transparency/)).
  - Developers sign a **manifest** (paths and hashes of executable assets, plus Content Security Policies) with
    **Sigstore**, using "one or more" OIDC identities. Signing is logged in Sigstore's Rekor transparency log.
  - Sites **enroll** through an enrollment service with a **cooldown** before changes apply; enrollment itself is
    backed by a consensus system (`webcat-infra-chain`).
  - An updater builds a **preload list** (domains and their authorized signers) from the **Sigsum** log, so the
    browser does no per-site lookups (privacy).
  - The Firefox extension checks content **before the page loads**, and **aborts the load** on any mismatch
    (fail-closed).
- **Status:** "a developer preview; not yet intended for production use". **Firefox only.** Proof-of-concept
  deployments include Element, Jitsi, Standard Notes, Bitwarden, CryptPad and GlobaLeaks.

## What Signet adds

| | Code Verify | WEBCAT | WAICT (draft) | Signet |
|---|---|---|---|---|
| Who can make a release "official"? | Meta publishes the hash | The enrolled signer identities | The site's manifest, logged publicly | **No single key.** CI only *proposes*; human approvers approve in their own wallets; TapeOut circuit #6 decides when it publishes |
| Is there a rule for *risky* changes? | No | No public one (the cooldown applies to enrollment changes, not to each release) | No | **Yes, computed on-chain.** A new contract or spender: 2 approvals + 24 h. A new outside origin: 2 + 1 h. Code only: 1 + 1 h. Admin changes: 3 of 3 + 24 h. CI can't lie about the tier: the chain compares the hashes |
| Can the rule be changed later? | n/a | n/a | n/a | Its logic can't be upgraded: circuit #6's beacon has owner `0x0`, and a gate can only switch to a copy of the same netlist (checked on all 512 inputs, `pnpm verify:claims` C1–C5). A team can change its approvers and waits, only through a tier-11 change |
| What a wallet may be asked to sign | Not covered | Not covered (CSP restricts where code can connect, not what a wallet signs) | Not covered | **Signing-time allowlist**: Guard refuses a signature to a contract or spender the team didn't seal, even on a page whose code passed. The decision comes from TapeOut circuit #7 |
| When the site is hijacked | Red warning | Load aborted | Browser refuses the mismatching code (draft) | Red page, signature refused, and a **verified copy** read from the chain (built and tested on staging; live with Pro) |
| Proof anyone can check | Cloudflare endpoint | Rekor / Sigsum logs | Transparency log | X Layer: the release, its approvals and the circuit's answer, readable with no account (`/prove`) |

## What they do better (honestly)

- **Code Verify ships at scale** in three browser stores, for WhatsApp Web. Signet's Guard isn't in any store yet.
- **WEBCAT is fail-closed before any script runs.** Signet's page check runs *after* the code has run. It can't
  undo what the code did outside signing; the signing-time check is what stops theft.
- **WEBCAT ties a domain to its signers through enrollment with a cooldown.** Signet's domain proof is a
  `/.well-known/signet.json` naming the gate, pinned on first sight: weaker on a first visit during a hijack, and
  anyone can still *bind* an unbound domain on-chain (readers ignore it; `docs/domain-ownership.md`).
- **WEBCAT enforces CSP** from the signed manifest, and **needs no blockchain, gas or wallet** for anyone. It uses
  established public infrastructure (Sigstore, Sigsum).
- **Both are audited by more eyes** and have real deployments. Signet's attack results are from a fork (staging),
  and Guard is tested by hand with two real wallets (Rabby and OKX Wallet, on X Layer mainnet, refusals work) and
  headless with copies of MetaMask, Coinbase Wallet, Bitget Wallet and Phantom; Trust Wallet is not protected yet.
- **WEBCAT's preload list** avoids even sealed-domain lookups at browse time. Guard reads the chain for sealed
  domains (none for unsealed ones).

**Where Signet fits:** dApps, where the damage is a signed transaction, and where a public, non-upgradeable approval
rule and a "what may be signed" allowlist matter as much as the code hash. The ideas combine well: a WEBCAT-style
enrollment cooldown is the natural fix for Signet's domain-ownership gap.
