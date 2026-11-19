# Domain ownership: can someone seal a domain they don't own? (Phase 0a, 2026-11-19)

> **Update 2026-11-19: layer 1 is built** (no contract change). Guard, the dashboard, `/prove`, the badge and the
> watchtower ignore any gate whose domain doesn't serve `/.well-known/signet.json` naming it. Tested: Guard staging
> (squatting with no proof, with another gate's proof, a pinned domain hijacked, a first-time visitor during a
> proof-dropping hijack), the dashboard staging suite (the badge says "Not verified"), and the watchtower (no checks
> or alerts for an unconfirmed gate). Details under "Built" at the end.

## Answer: TRUE, they can. Signet doesn't check domain control today.

**The code path.**
- `SignetFactory.createGate` (`packages/contracts/src/SignetFactory.sol:103–127`) calls `_useCommit` (`:94–101`), then
  `registry.claimFor(gate, domain, …)`.
- `_useCommit` only checks a commit-reveal. That stops someone copying a claim from the mempool, **not** someone
  claiming a domain they don't control.
- `SignetRegistry.claimFor` (`packages/contracts/src/SignetRegistry.sol:127–144`) checks only that the gate is
  factory-made, that the domain is well-formed and unbound, and the reclaim window after an unbind. **Any address
  can claim any unbound domain** (for example `cronpay.co`), first come, first served.
- Only the bound gate can `unbind` or `transfer` it (`:162–205`). The registry has **no owner** (`:28`), so the
  real owner has **no on-chain recourse**.

**What an attacker gets** (they bind `cronpay.co` to their own gate and publish their own release):

| Where | What happens | Severity |
|---|---|---|
| Guard on the **real** `cronpay.co` | The real site's files don't match the attacker's seal, so it shows **red: "Doesn't match the sealed release"**. If the attacker switches the gate to enforce mode, Guard **blocks the real site** and refuses signatures to its real contracts. | Denial of service, and damage to the real team's reputation |
| Guard's **"Open the verified copy"** | It opens the **attacker's** files (the gateway or preview copy), and Guard's popup shows **"Sealed"** there (`docs/demo/ui/guard-popup-verified-copy.png`). | **Phishing with Signet's green seal.** This is the serious one. |
| Dashboard, `/prove`, badge | "Sealed by Signet · cronpay.co", with the attacker's gate | Misleading |
| Watchtower | Alerts go to the attacker | No help to the real team |

Making Guard show the attacker's version **on the real domain** would still need a DNS or hosting hijack. Without
one, the attack works through the red warning and the "verified copy" button. **Nobody is exposed today**: no
domain except `signetguard.xyz` is bound on mainnet, and Guard isn't published. It must be fixed before either
changes.

## Fix (design; nothing built or deployed)

### Layer 1: the domain names its gate (no contract change)

The site serves **`https://<domain>/.well-known/signet.json`**:

```json
{ "signet": 1, "chainId": 196, "gate": "0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503" }
```

Only someone who controls the domain's web serving can publish it. Every Signet reader requires it to name **the
gate the registry binds the domain to** before treating the domain as sealed:

| Reader | Rule |
|---|---|
| **Guard** | The content script fetches it **same-origin**, only on domains that are already in the sealed list, so the privacy rule still holds. Missing, or naming another gate: **"not confirmed by the domain"**. That means grey, never red, **no verified-copy button**, and no blocking (fail-open, as when Guard can't check). Matching: proceed as today. |
| **Guard, against later hijacks** | **Pin it (trust on first use).** Once Guard has seen the file name gate X, it keeps X for that domain. A later hijack that serves a different `signet.json` doesn't downgrade the domain: Guard checks the pages against X's release and shows red. A fresh install during a hijack sees "not confirmed" and fails open, which is no worse than today. |
| **Dashboard, `/prove`, badge** | Show "Sealed by Signet" only when the file matches. Otherwise: "bound on-chain, **not confirmed by the domain**". |
| **Watchtower** | Re-checks it every round; a missing or mismatched file is an alert. |
| **Optional, dashboard and watchtower only:** DNS TXT `_signet.<domain>` = `gate=0x…` | A second channel for teams that can't serve `/.well-known`. **Guard doesn't use DNS**: a lookup over DNS-over-HTTPS would tell a third party what the user browses. |

The file must also be part of the **sealed release** (it's a normal file in the build), so its content is itself
hash-checked.

### Layer 2: recourse for a squatted domain (contract change, later)

Layer 1 stops a squatter from *showing* anything, but the squatter still holds the on-chain binding. The real team
can't bind its own gate, because the registry is immutable. Real recourse needs a **v2 registry**: a claim can be
challenged by a gate the domain's `signet.json` names, and moves after a dispute window unless the current gate's
domain also names it. Judging that on-chain needs an attestation from independent checkers (an oracle set), since
contracts can't read DNS or HTTPS.

## Cost

| Part | Contracts? | OKB | Work |
|---|---|---|---|
| Layer 1 in Guard, dashboard / `/prove` / badge, watchtower, gateway; `signet init` writes the file and `signet seal` checks it's in the build; tests (missing, mismatched, pinned during a hijack) | **No** | 0 | ≈ 1–1.5 days |
| `signetguard.xyz` serves its own `/.well-known/signet.json` | No | Part of release #3. The site files change; the tier depends on whether the seal also picks up the gate address in that file (to check in Phase 0b) | 0.5 h |
| Layer 2: SignetRegistry v2 + a new factory (the factory pins the registry), checkers, migration | **Yes** | deploy ≈ 0.0002 OKB (registry 2.9M + factory 5.5M gas at 0.02 gwei), plus moving `signetguard.xyz` | ≈ 3–4 days + a review |

**Recommendation:** build Layer 1 before Guard is published or a second team binds a domain. Write Layer 2 down as
a known limit (THREAT_MODEL) until then.

## Built (2026-11-19)

| Reader | Behavior | Where |
|---|---|---|
| **Guard** | On a sealed domain, the content script reads `/.well-known/signet.json` **same-origin**. The background accepts it only from a page of that very domain (never from the gateway's copy, whose files come from the chain) and only if it names the bound gate on chain 196; then it **pins** that gate. Until then the site is **`unconfirmed`**: grey badge, popup "Not verified: this site hasn't confirmed this gate", no page verdict, no red page, no verified copy, signatures fail-open. Signatures on a sealed domain **wait** for this step (no fail-open window while the file loads). A pinned domain stays protected if a later hijack drops or changes the file; a different gate bound on-chain needs a new confirmation | `extension/src/background.ts` (`siteFor`, `proof` message), `extension/src/content.ts`, `extension/src/lib/proof.ts` |
| **Dashboard, `/prove`, badge** | Read the file cross-origin (the domain must send `Access-Control-Allow-Origin: *`). Not confirmed: a "NOT VERIFIED" chip and explanation on the project page; the badge says "Not verified", never "Sealed by Signet"; `/prove` marks the project "Not verified" (not a failure) | `dashboard/src/chain.ts` (`domainProof`), `pages/project.ts`, `pages/badge.ts`, `pages/prove.ts` |
| **Watchtower** | Loads the file with its browser; a gate the domain never confirmed gets **no checks and no alerts**. Pinned like Guard (a site that goes down, or a hijack that drops the file, is still checked and alerted) | `watchtower/src/watchtower.ts` |
| **CLI** | `signet domain <dir>` writes the file and prints the CORS header to add; `signet domain --check` verifies it and warns if the header is missing | `cli/src/commands.ts` |

**Honest limit (tested):** a user whose Guard has **never** seen the domain confirm its gate, visiting **during** a
hijack that also removes or changes the file, isn't protected: Guard can't tell a squatted domain from a hijacked
one on a first visit, and fails open. Returning visitors are protected (pinned). Closing this needs the
confirmation to come from somewhere the hijacker doesn't control: confirmations recorded on-chain (registry v2,
below) or a preload list (as WEBCAT does).

**Future work (contract change):** a SignetRegistry v2 where a claim records the domain's confirmation (attested by
independent checkers), and a squatted domain can be taken over by the gate its `signet.json` names after a dispute
window. Deploy ≈ 0.0002 OKB plus migration. Not started.
