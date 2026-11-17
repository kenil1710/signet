#!/usr/bin/env node
// signet-watchtower: node src/cli.ts [--once] [--interval 60]
//   SIGNET_NETWORK            mainnet (default) | local
//   SIGNET_RPC_URL2           second RPC (the two must agree)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID [, TELEGRAM_PUBLIC_CHAT_ID]   optional; without them alerts go to the console
//   WATCHTOWER_ONLY           comma-separated domains to watch (default: all bound domains)
//   WATCHTOWER_URL_TEMPLATE   default https://{domain}/   (staging: http://{domain}:PORT/)
//   WATCHTOWER_HOST_RULES     Chromium --host-resolver-rules, for staging hosts that don't exist in DNS
//   WATCHTOWER_FROM_BLOCK, WATCHTOWER_STATE
import { fileURLToPath } from 'node:url';
import { loadNetwork } from '@signet/contracts/network';
import { alerterFromEnv } from './alerts.ts';
import { run } from './watchtower.ts';
import type { Net } from './chain.ts';

export function netFromEnv(env: NodeJS.ProcessEnv = process.env): Net {
  const n = loadNetwork(env.SIGNET_NETWORK || 'mainnet') as ReturnType<typeof loadNetwork> & { deployBlock?: number };
  return {
    name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: env.SIGNET_RPC_URL2 || n.rpcUrl2 || null,
    registry: (n.contracts.registry as `0x${string}` | undefined) ?? null, siteRegistry: n.tapeout.siteRegistry as `0x${string}`,
    fromBlock: Number(env.WATCHTOWER_FROM_BLOCK ?? n.deployBlock ?? n.forkBlock ?? 0),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const env = process.env;
  const net = netFromEnv(env);
  if (!net.registry) {
    console.error(`signet-watchtower: Signet's contracts are not deployed on ${net.name} yet. For staging: pnpm staging:up, then SIGNET_NETWORK=local.`);
    process.exit(1);
  }
  const template = env.WATCHTOWER_URL_TEMPLATE || 'https://{domain}/';
  const interval = Number(args[args.indexOf('--interval') + 1]) || 60;
  await run(
    {
      net, alert: alerterFromEnv(env),
      statePath: env.WATCHTOWER_STATE || fileURLToPath(new URL(`../.state/${net.name}.json`, import.meta.url)),
      urlFor: (d) => template.replace('{domain}', d),
      only: env.WATCHTOWER_ONLY ? env.WATCHTOWER_ONLY.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    },
    { intervalSec: args.includes('--interval') ? interval : 60, once: args.includes('--once'), chromiumArgs: env.WATCHTOWER_HOST_RULES ? [`--host-resolver-rules=${env.WATCHTOWER_HOST_RULES}`] : [] },
  );
}
