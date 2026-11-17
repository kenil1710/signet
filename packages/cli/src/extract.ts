// Address and origin extraction from build text. No Node APIs, so the dashboard can bundle it (Diff Guard in the browser).
import { getAddress } from 'viem';

// ---------------------------------------------------------------- allowlist

export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const ADDRESS_RE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/// Not contracts an app calls: the zero address, precompiles, the 0xEeee... native-token placeholder, burn addresses.
function isNoiseAddress(a: string): boolean {
  const x = a.toLowerCase();
  return BigInt(x) <= 0xffffn || /^0x(e{40}|f{40}|0{36}dead|dead0{36})$/.test(x);
}

export function extractAddresses(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(ADDRESS_RE) ?? []) if (!isNoiseAddress(m)) out.add(getAddress(m.toLowerCase()));
  return [...out];
}

// ---------------------------------------------------------------- origins

const URL_RE = /\b(?:https?|wss?):\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?/g;
/// Documentation links that bundlers leave in error strings and license headers. Never fetched by the app.
export const DOC_HOSTS = new Set([
  'www.w3.org', 'reactjs.org', 'react.dev', 'fb.me', 'vitejs.dev', 'vite.dev', 'nextjs.org', 'developer.mozilla.org',
  'tc39.es', 'eips.ethereum.org', 'github.com', 'viem.sh', 'wagmi.sh', 'docs.ethers.org', 'links.ethers.org',
  'example.com', 'www.example.com', 'feross.org', 'mths.be', 'npms.io', 'opensource.org', 'creativecommons.org',
]);

export function extractOrigins(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(URL_RE) ?? []) {
    try {
      const u = new URL(m);
      const local = u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      if (!local && !/\.[a-z]{2,}$/i.test(u.hostname)) continue; // "http://a" fragments in minified code
      out.add(`${u.protocol}//${u.host}`.toLowerCase());
    } catch { /* not a URL */ }
  }
  return [...out];
}

