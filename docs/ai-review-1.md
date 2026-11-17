# AI review 1: Signet, as a strict X Layer TapeOut Accelerate reviewer would read it

Written 2026-11-18 by Claude acting as a strict reviewer. Reading order: README top lines, then the root files
(`JUDGES.md`, `CLAIMS.md`, `claims.json`, `THREAT_MODEL.md`, `llms.txt`), then only what those link to. I treated
anything I could not check from mainnet or from a 5-minute read as unverified, even where the repo has a test for it.

## Summary

Signet is a serious, unusually honest piece of security engineering. It turns TapeOut circuits into policy engines,
one for release approval and one for signing decisions, each with a published, exhaustively tested 512-row truth
table, and backs its numbers with a reproducible attack suite and a claims checker that runs against mainnet in two
minutes. The weakness is that almost all of it lives on a local fork. Only the release-policy circuit (#6) and a
storage spike are on X Layer mainnet. The contracts, the second circuit, the dashboard, the gateway and the
extension are not deployed. There are no users or sealed projects, no Web Store listing, no test with a real wallet,
and no demo video. Most of all, there is no public repository link: as submitted, a judge could not open the code at
all. On innovation and engineering depth this is a top-tier entry. On readiness it is still a strong prototype.

## Scores (1–5)

| Criterion | Score | Why |
|---|---|---|
| **User Value & Commercial Potential** | **3** | The problem is real and well documented (an incident table with $1.5B+ in losses), and the pricing is plausible (free for users, teams pay). The value proposition, though, depends on users installing Guard, and the repo itself says that "most users" are not protected at signing. There are no pilots, no letters of intent, and no sealed real project; the spec's goal of "2+ real projects" is not met. The wallet-integration path that would reach users without an extension is only a plan. |
| **Innovation** | **5** | Using TapeOut circuits as fixed, publicly checkable policy, with the risk tier computed on-chain so CI can't lie about it and a second circuit deciding every signature, is genuinely new. The exhaustive truth tables, the "proven equal on 512 rows" Solidity mirror, and Diff Guard (behavioral review of a release before approval) go well beyond "hash on-chain + extension". The benchmark makes the novelty concrete: 12/12 against a hash-only checker's 7/12 on the same attacks. |
| **Ecosystem Integration** | **3** | It is strong where it is real: Processor #101, circuit #6 taped out and verified on mainnet, a Circuit Container plus SiteRegistry used for storage (Spike B on mainnet), and TapeKit's gateway design studied and reused. But Signet's own contracts and the Guard circuit are not on mainnet, the dashboard is not on DeWEB, TapeSend is not used for alerts, and the gateway re-implements TapeKit's approach instead of building on it (for documented reasons). |
| **Product Readiness & UX** | **2** | The engineering readiness is high: 189 Foundry tests, 512-row circuit tests, staging end-to-end suites, a 5-minute judge guide, and a working local try-it flow. Product readiness is low: nothing a user can install or open without cloning the repo, running anvil and building locally. There is no live URL (the README says "placeholder"), Guard is not in the Chrome Web Store and has not been run with MetaMask or OKX Wallet, the watchtower runs in one region, and the "10-minute setup" has not been timed with an outside team. |
| **Demo Video** | **1** | None exists yet. The script in the spec is good, and the hacked/clean switch and the new swap UI make it easy to film. |

**Overall:** strong on innovation and rigor, held back by deployment and reach. Fixing the first three items below would
likely move Ecosystem Integration and Product Readiness up by a point each.

## Claims I could not verify as a reviewer

| Claim | Why not |
|---|---|
| "12/12 attacks blocked, 0 false blocks" and the benchmark (2 / 7 / 12) | Staging only. Reproducing them needs Foundry, an X Layer RPC and about 25 minutes; `verify:claims` only checks that the report says so (R6, R9). Strong evidence, but not independently verifiable in 5 minutes. A green CI run would help. |
| The hash-only column stands for TEE Shield / Meta Code Verify | It is an ablation of Guard (the repo says so). It may be stronger or weaker than those products. |
| Signet's contracts, the Guard circuit, the enumerable domain list | Not on mainnet (C8, C9 PENDING). |
| The gateway keeps the app usable during a hijack | Built and tested on `*.localhost`, not deployed; files over 48 KB need the new chunked upload, measured only on staging. |
| Guard works with real wallets | Tested with a mock wallet only (stated in `CLAIMS.md`). |
| "A team seals its app in about 10 minutes" | A target; not timed. |
| Watchtower alerts "within about a minute", "from 3 regions" in the spec | One region; Telegram tested against a local stand-in. |
| Any real project is sealed | None is. |
| The code is public | No repository link; the repo has no git remote. |

## Top 5 improvements, in order

1. **Publish the repository** (public GitHub, the link in the README's first line). Without it nothing else can be judged.
2. **Run the mainnet plan** (≈ 0.0022 OKB, `docs/mainnet-plan.md`): contracts plus the Guard circuit. Then C8 and C9 turn from PENDING to PASS, and the README placeholders become addresses.
3. **Put a live surface online:** the dashboard (with `/prove`) on DeWEB and an https gateway. A judge who can click one link and watch `/prove` turn green on mainnet in their own browser gets the whole story in a minute.
4. **Close the reach gap:** test Guard with MetaMask and OKX Wallet, submit it to the Chrome Web Store, and seal one real project (Signet's own dashboard as the first sealed site counts). Run the attack suite in GitHub Actions so its result is visible without a local setup.
5. **Record the ≤ 3-minute video** from the existing script: hacked → red → signature refused → verified copy, then `/prove` and the benchmark table. Use TapeSend for at least one alert, to round out the ecosystem story.
