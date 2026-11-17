# Try Signet in your own Chrome (local staging, no mainnet)

Everything here runs on your machine: an anvil fork of X Layer (the staging chain), the demo dApp sealed as
`swap.localhost`, the Signet gateway, and the Guard extension. No mainnet transaction, no real funds. The test
accounts come from a fixed seed and are worthless; never send real OKB to them.

Needs: Foundry (`anvil`, `cast`), Node ≥ 22.18, pnpm, `XLAYER_RPC_URL` in `.env` (read-only), Chrome, MetaMask.

## 1. Start staging and the demo site

```bash
cd /path/to/signet
pnpm install
pnpm staging:up          # the fork with Signet deployed and the Guard circuit taped out (skip if already running)
pnpm try:setup           # seals the demo dApp as swap.localhost, publishes it, enforce mode, builds Guard + gateway
pnpm try:serve           # keep this terminal open
```

Open **http://swap.localhost:4180/**. Chrome sends `*.localhost` to your own machine and treats it as a secure
page, so nothing needs to go in `/etc/hosts`.

`try:setup` is safe to run again. After `pnpm staging:down` / `staging:up` (a fresh chain) run it again, and click
the reload icon on Guard in `chrome://extensions`.

## 2. Load the Guard extension

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the folder **`packages/extension/dist`**.
3. Pin **Signet Guard** to the toolbar (puzzle-piece icon → pin) to see its badge.

This build talks only to the local chain (`http://127.0.0.1:8545`; it is also given `http://localhost:8545` as its
"second RPC", which on staging is the same node). It reads the release from the chain, asks the Guard decision
circuit before every signature, and opens the verified copy on `localhost:8097`.

## 3. MetaMask: the local chain and a test account

**Add the network** (MetaMask → network menu → *Add a custom network*):

| Field | Value |
|---|---|
| Network name | Signet staging (local) |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `196` |
| Currency symbol | `OKB` |

The chain ID is the same as X Layer mainnet (the fork keeps it, so contract addresses match). MetaMask may say
196 is already used by X Layer; add it anyway as a separate network, and **check that "Signet staging (local)" is
selected** before you click anything.

**Import a funded test account** (about 1000 test OKB): `user1`, address `0x63e907c6ddba61146bbaab0b79b37ce0fd4f6c09`.
Its private key is entry **(7)** in the key list anvil printed when staging started:

```bash
sed -n '/Private Keys/,/Wallet/p' staging/.run/anvil.log
```

MetaMask → account menu → *Add account or hardware wallet* → *Import account* → paste the key for (7).

If you restart staging, MetaMask remembers old nonces: Settings → Advanced → **Clear activity tab data**.

## 4. Clean → hacked → clean

With the demo site open and Guard loaded:

| Command (second terminal) | What the site serves | What you should see after **reload** |
|---|---|---|
| `pnpm try:clean` | the sealed build | Guard badge **green `OK`**. *Connect wallet*, *Approve*, *Swap*, *Permit2*, *Stake* all reach MetaMask normally |
| `pnpm try:hack` | the main bundle with a drainer appended: on load it asks your wallet to approve `0xBAD0…0C0F` for all your USDT | the tab is replaced by Guard's **red page** "This site doesn't match its sealed release. Don't sign."; badge **red `!`**; the drainer's request never reaches MetaMask (you may see a *connect* request, which is not a signature) |
| `pnpm try:hack once` | tampered for one request only, then clean again (the Bybit pattern) | red, even though a re-download now gets clean bytes: Guard checks the bytes your browser actually ran |
| `pnpm try:clean` | the sealed build again | green again after a reload |

More things to try on the **clean** site:

- **http://swap.localhost:4180/?spender=0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F**, then *Approve* or the Permit2 button: the page is genuine but the data is hostile. Guard refuses with "Spender not in the sealed allowlist" before MetaMask opens.
- **…/?recipient=0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F**, then *Swap*: refused, "Recipient is not you".
- Click the Guard icon: the popup shows the release, the mode, the files checked, and refusals, each "decided by the Guard circuit, row 0x…".

## 5. The verified copy

On the red page, click **Open verified copy**. A new tab opens **http://swap-localhost.localhost:8097/**: the
same app, served by a service worker that reads every file from the project's container on the (staging) chain
and shows it only if its SHA-256 is the sealed one. The first visit installs the worker and reloads once.

- MetaMask works there (it's a normal page on its own origin), so you'll be asked to connect again.
- Guard treats it as `swap.localhost`: the badge is green and the sealed allowlist still applies (try `?spender=…` there too).
- **…:8097/.signet/status** shows what was read and checked.

On the red page, *Go back to the site* reloads the hijacked site with every signature still refused, and *Report
wrong block* copies a report to the clipboard (Guard sends nothing anywhere).

## What has and hasn't been tested

The flow above was run headless with a **mock** wallet (green → red with nothing reaching the wallet → verified
copy). It has **not** been run with real MetaMask yet: you are the first. If MetaMask behaves differently (for
example, a request reaching the MetaMask popup on the red page, or the badge staying grey), note what you clicked
and what you saw.

To stop: Ctrl+C in the `try:serve` terminal; `pnpm staging:down` stops the chain.
