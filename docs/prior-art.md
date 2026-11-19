# Prior art: Meta Code Verify and WEBCAT (checked 2026-11-19)

Both answer the question Signet answers: "is the code in my browser the code the site's owners meant to ship?"
They are mature, well-designed systems. This is an honest comparison, from their public documentation (sources
at the end).

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

| | Code Verify | WEBCAT | Signet |
|---|---|---|---|
| Who can make a release "official"? | Meta publishes the hash | The enrolled signer identities | **No single key.** CI only *proposes*; human approvers approve in their own wallets; TapeOut circuit #6 decides when it publishes |
| Is there a rule for *risky* changes? | No | No public one (the cooldown applies to enrollment changes, not to each release) | **Yes, computed on-chain.** A new contract or spender: 2 approvals + 24 h. A new outside origin: 2 + 1 h. Code only: 1 + 1 h. Admin changes: 3 of 3 + 24 h. CI can't lie about the tier: the chain compares the hashes |
| Can the rule be changed later? | n/a | n/a | No. It's a taped-out circuit whose beacon has owner `0x0`, checked on all 512 inputs (`pnpm verify:claims` C1–C5) |
| What a wallet may be asked to sign | Not covered | Not covered (CSP restricts where code can connect, not what a wallet signs) | **Signing-time allowlist**: Guard refuses a signature to a contract or spender the team didn't seal, even on a page whose code passed. The decision comes from TapeOut circuit #7 |
| When the site is hijacked | Red warning | Load aborted | Red page, signature refused, and a **verified copy** read from the chain (built and tested on staging; not yet on a public domain) |
| Proof anyone can check | Cloudflare endpoint | Rekor / Sigsum logs | X Layer: the release, its approvals and the circuit's answer, readable with no account (`/prove`) |

## What they do better (honestly)

- **Code Verify ships at scale** in three browser stores, for WhatsApp Web. Signet's Guard isn't in any store yet.
- **WEBCAT is fail-closed before any script runs.** Signet's page check runs *after* the code has run. It can't
  undo what the code did outside signing; the signing-time check is what stops theft.
- **WEBCAT ties a domain to its signers through enrollment with a cooldown.** **Signet doesn't prove domain
  ownership today:** anyone can bind an unbound domain (`docs/domain-ownership.md`, fix designed).
- **WEBCAT enforces CSP** from the signed manifest, and **needs no blockchain, gas or wallet** for anyone. It uses
  established public infrastructure (Sigstore, Sigsum).
- **Both are audited by more eyes** and have real deployments. Signet's attack results are from a fork (staging),
  and Guard has been tested with a mock wallet only.
- **WEBCAT's preload list** avoids even sealed-domain lookups at browse time. Guard reads the chain for sealed
  domains (none for unsealed ones).

**Where Signet fits:** dApps, where the damage is a signed transaction, and where a public, unchangeable approval
rule and a "what may be signed" allowlist matter as much as the code hash. The ideas combine well: a WEBCAT-style
enrollment cooldown is the natural fix for Signet's domain-ownership gap.
