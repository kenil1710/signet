# Signet Guard privacy policy

_Effective 2026-11-24. Applies to the Signet Guard browser extension (version 0.3.1 and later)._

**Short version: Guard collects nothing about you and sends nothing to us.** It has no account, no analytics, no
telemetry and no server of ours to talk to. Everything it decides, it decides inside your browser.

## What Guard reads, and where

| What | Where it goes | Why |
|---|---|---|
| The public list of sealed domains (the same list for every user) | Read from X Layer through two public RPC nodes (`xlayerrpc.okx.com`, `xlayer.drpc.org`), every 5 minutes | To know which sites are sealed, **without** asking anyone about the site you're on |
| On a **sealed** site only: that site's sealed release (file hashes, allowed contracts and origins) and its gate's state | Read from the same two X Layer RPC nodes, which see that a Guard user is checking that sealed domain (they see your IP address, as any website you load does) | To check the page and the signature requests against what the site's team sealed |
| On a sealed site only: its own `https://<site>/.well-known/signet.json` | Read from that site itself | The site's proof that it uses this gate |
| On a sealed site whose contracts are on Arc: whether a contract you're asked to sign for was created by the site's sealed factory, for you | Read from Arc RPC nodes (`rpc.mainnet.arc.io`, `arc-mainnet.drpc.org`, and the testnet equivalents) | The factory rule: your own vault is allowed, someone else's isn't |
| The scripts the page loads, and the signature requests the page sends to your wallet | **Nowhere.** Read from your browser's cache and compared in the browser | The page check and the signing check |

**On a site that isn't sealed, Guard makes no network request at all** (there is an automated test for this:
`packages/extension/test/staging/guard.test.ts`, "privacy").

## What Guard stores

In the extension's own storage, on your device: the sealed-domain list, the sealed releases and domain proofs of the
sealed sites you visit (to answer quickly), its settings, the current state of each tab (cleared when the browser
closes), and a log of its last 200 warnings and refusals on sealed sites (time, domain, page URL, what was flagged),
which you can read in the popup. Nothing
is synced or uploaded. Removing the extension removes all of it.

## What Guard never does

- It never sends your browsing history, page contents, wallet addresses, balances or keys to us or to anyone.
- It never reads or changes your wallet's keys. It sees a signature request only to decide whether to let it through.
- It never sells, shares or transfers data: it has none to share.
- It uses no remote code: everything it runs is in the extension package.

## Your wallet's requests

On a sealed site, Guard wraps the page's wallet providers (`window.ethereum`, wallet globals such as `window.okxwallet`, and
EIP-6963 providers), and reads the requests a wallet's page script passes to its own content script on the page, so it
can check each signature request
against the sealed release before your wallet shows it. In observe mode (the default) it only reports; when the site's
team turned on enforce mode, it refuses requests to contracts and spenders the team didn't seal. It doesn't record the
requests anywhere.

## Changes and contact

Changes to this policy are made in the public repository (https://github.com/kenil1710/signet/blob/main/docs/PRIVACY.md);
its history shows every change. Questions: open an issue at https://github.com/kenil1710/signet/issues.
