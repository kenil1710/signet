# Signet vs. scam detectors (checked 2026-11-19)

Scam detectors protect people on **any** site, by recognizing known-bad sites and addresses and by simulating
transactions. Signet protects people on **sealed** sites, by allowing only the exact code and contracts the team
sealed. They are **complementary**; Signet isn't a replacement for them.

| Tool | How it works (from public sources) | Blocks or warns |
|---|---|---|
| **Blockaid** (MetaMask security alerts) | MetaMask checks each transaction and signature request before you sign: a simulation plus Blockaid's threat data, on chains including Ethereum, Linea, BNB Chain, Polygon, Arbitrum, Optimism and Avalanche. On by default since Feb 2024. MetaMask's own pages differ on whether the check runs locally or on a MetaMask / Blockaid server ([MetaMask](https://support.metamask.io/configure/wallet/security-alerts/), [The Block](https://www.theblock.co/news/regulation/2024-02-20-metamask-blockaid-security-alerts-278156)) | Warns ("Warning" / "Malicious"); you can still confirm |
| **Wallet Guard** | URL scanning (new domains, look-alikes, impersonation) and transaction simulation. Acquired by Consensys, July 2024 ([GitHub](https://www.github.com/wallet-guard/wallet-guard-extension), [CB Insights](https://www.cbinsights.com/compare/pocket-universe-vs-wallet-guard)) | Warns, and blocks known phishing sites |
| **Pocket Universe** | Simulates the transaction and shows what it will do before the wallet's confirmation. Acquired by Kerberus, Aug 2025 ([CB Insights](https://www.cbinsights.com/company/pocket-universe/alternatives-competitors)) | Warns |
| **Scam Sniffer** | Large lists of malicious domains and addresses (≈ 420k domains, 61k addresses per a 2026 review); no simulation per that review ([Stablecoin Insider](https://stablecoininsider.org/best-transaction-security-apis-wallets/)) | Warns / blocks on list matches |

## The difference in one line

They ask **"is this known to be bad, or does it look bad?"** Signet asks **"is this exactly what this site's team
approved?"**

| Situation | Scam detectors | Signet (with Guard) |
|---|---|---|
| A real, trusted dApp's front end is hijacked on day 0 (Bybit / Safe{Wallet}, Curve DNS, the Ledger Connect Kit npm attack), sending to a **fresh** attacker address | The address and domain aren't on any list yet. Simulation shows *what* happens (e.g. "approve token to 0x…") but can't know it isn't what the team intended | The page doesn't match its seal, **and** the spender isn't on the sealed allowlist, so the signature is refused (12/12 on staging, `docs/attack-report.md`) |
| A scam site the team never sealed | Strong: blocklists, look-alike detection, simulation | Nothing: Guard does nothing on unsealed domains (by design, and for privacy) |
| The user has none of these tools | Built into MetaMask by default (Blockaid) | Not protected at signing (the watchtower alerts the team) |
| Coverage | Every site, every chain they support | Only sites whose teams sealed them on X Layer |

**So:** keep your scam detector. Signet closes the gap scam detectors can't see: a legitimate site turned against
its own users, with addresses nobody has flagged yet.

## Test plan (not run yet: we claim only what it shows)

**Goal:** record, side by side, what each tool shows for the same hijack of a real-looking dApp, with a fresh
attacker address.

1. **Setup.**
   - Run the local demo from `docs/TRY-IT-LOCALLY.md`: `pnpm try:setup && pnpm try:serve`.
   - Generate a **fresh attacker address** (`cast wallet new`, never funded, never used).
   - Change the hacked bundle so its drainer asks `approve(token, <fresh address>, max)`.
2. **Browsers.** One Chrome profile per tool, each with MetaMask (security alerts **on**, the default) and the demo
   chain added:
   - (a) MetaMask only;
   - (b) MetaMask + Wallet Guard;
   - (c) MetaMask + Pocket Universe;
   - (d) MetaMask + Scam Sniffer;
   - (e) MetaMask + Signet Guard (built for the demo chain, enforce mode).
3. **Run.** Open `http://swap.localhost:4180/`, then `pnpm try:hack` (hacked build), and click Swap → Approve. Then
   run the **clean** build and click the same buttons (to measure false alarms).
4. **Record for each profile:**
   - a screenshot of every warning;
   - whether the signature request reached MetaMask's confirmation;
   - what MetaMask's alert says (simulation result, "Malicious" / "Warning" / nothing);
   - whether a transaction could be sent;
   - for the clean run, any warning at all.
5. **Rules:**
   - Report each tool's result exactly as observed, with the tool's version and the date.
   - Note that the demo chain is a local fork, so threat-intel tools may not even run there. That is a limitation
     of the test, not evidence against them.
   - No claim like "X misses hijacks" beyond what the recording shows.
   - Repeat on X Layer mainnet only with the user's go-ahead (gas would be spent).
