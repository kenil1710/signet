# UI screenshots (2026-11-18)

Restyled to the landing page's look: Archivo wide headings, IBM Plex Mono labels and data, ink #0A0908, wax red
#D63D27, green #5AD9A0 only for sealed / verified, square buttons, thin lines.

| File | What |
|---|---|
| `prove-1280.png`, `prove-390.png` | /prove: the verification report. Each claim has its status (verified / pending deployment), its source (on-chain at the block shown, plus the repo file it is compared with) and OKLink links for mainnet addresses. Signet's own contracts, not on mainnet yet, show a TODO. |
| `dashboard-home-*.png` | Sealed projects |
| `dashboard-project-*.png` | A project with two open proposals: tier 10 (poisoned build, 0 of 3) and tier 00 (1 of 3, timelock counting down) |
| `dashboard-proposal-tier10-*.png` | Diff Guard for the tier-10 proposal |
| `dashboard-badge-*.png` | The badge page |
| `guard-blocked-1280.png`, `guard-blocked-390.png` | Guard's full red page (#7A2216), with "What changed" |
| `guard-popup-*.png` | The popup at its real size (360 px wide, as tall as its content, up to Chrome's 600 px cap) |
| `guard-verified-copy.png`, `guard-clean-site.png`, `guard-signature-refused.png`, `guard-blocked.png` | From the Guard staging suite |

Regenerate the dashboard ones with `node packages/dashboard/test/ui-shots.ts` (needs staging and a `vite preview` on
:4300). Regenerate the Guard ones with
`SIGNET_SAVE_DEMO=1 SIGNET_DEMO_DIR=$PWD/docs/demo/ui pnpm --filter @signet/extension test:staging`.
