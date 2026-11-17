# Signet

Signet decides what a dApp's website may ask a wallet to sign. A team seals each release on X Layer; a TapeOut
circuit decides when a release may go live; users who run the **Guard** extension have every page and every
signature checked against the sealed release, by a second TapeOut circuit.

**Users without Guard are not protected at signing.** For them, the watchtower alerts the team when the site stops
matching its sealed release.

- **Judges:** [`JUDGES.md`](JUDGES.md) (5 minutes), [`CLAIMS.md`](CLAIMS.md), [`THREAT_MODEL.md`](THREAT_MODEL.md)
- **Check the claims against mainnet:** `pnpm install && pnpm verify:claims`
- **Status:** the release-policy circuit is on X Layer mainnet (circuit #6, processor #101). Signet's contracts, the Guard decision circuit, the gateway and the watchtower run on a staging fork of X Layer; the mainnet plan is [`docs/mainnet-plan.md`](docs/mainnet-plan.md). Guard is not in the Chrome Web Store yet.
- **Spec and decisions:** [`docs/signet-spec.md`](docs/signet-spec.md), [`docs/decisions.md`](docs/decisions.md)

Built for the X Layer TapeOut Accelerate hackathon. MIT licensed.
