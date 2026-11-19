# signetguard

The `signet` CLI: seal each release of your dApp's website on X Layer (chain 196), propose it from CI, and publish it
once your approvers and the on-chain policy (a TapeOut circuit) allow. Users who run Signet Guard are refused anything
your team didn't seal.

```
npm install -g signetguard
signet keygen          # the CI proposer key (it can propose and publish, never approve)
signet link <domain> <gate>
signet domain public   # the domain proof: public/.well-known/signet.json
signet seal dist && signet propose dist
```

Setup guide: https://signetguard.xyz/start (also https://signet-6l4.pages.dev/start). MIT.
