// Signing calls found in a build's code: the patterns a drainer needs (approve, permit, transfer, blind signing).
// `seal` stores the count per kind in signet/files.json ("calls"), so Diff Guard can compare a proposal with a
// release whose code isn't at hand. This is a text scan of bundled code, not an analysis of what the code does:
// a call built at runtime (string concatenation, fetched ABI) isn't found. The signing-time allowlist is the
// check that doesn't depend on this.

export interface CallKind { kind: string; label: string; re: RegExp }

const q = '["\'`]';
const sel = (...s: string[]) => `0x(?:${s.join('|')})(?![0-9a-fA-F])`;
const mk = (kind: string, label: string, ...parts: string[]): CallKind => ({ kind, label, re: new RegExp(parts.join('|'), 'g') });

/// Order is fixed: it is the key order of "calls" in files.json.
export const CALL_KINDS: CallKind[] = [
  mk('approve', 'ERC-20 approve', sel('095ea7b3'), `${q}approve${q}`, '\\.approve\\(', '\\bapprove\\(address'),
  mk('increaseAllowance', 'ERC-20 increaseAllowance', sel('39509351'), '\\bincreaseAllowance\\b'),
  mk('setApprovalForAll', 'NFT setApprovalForAll', sel('a22cb465'), '\\bsetApprovalForAll\\b'),
  mk('permit', 'Permit (EIP-2612 / DAI)', sel('d505accf', '8fcbaf0c'), `${q}permit${q}`, '\\.permit\\(', '\\bPermit\\(address', `primaryType:\\s*${q}Permit${q}`),
  mk('permit2', 'Permit2', sel('87517c45', '2b67b570', '2a2d80d1', '30f28b7a', 'edd9444b', '36c78516'), '\\bPermit(?:Single|Batch|TransferFrom|BatchTransferFrom|WitnessTransferFrom)\\b', '\\bpermit(?:Witness)?TransferFrom\\b'),
  mk('transfer', 'ERC-20 transfer', sel('a9059cbb'), `${q}transfer${q}`, '\\.transfer\\(', '\\btransfer\\(address'),
  mk('transferFrom', 'transferFrom / safeTransferFrom', sel('23b872dd', '42842e0e', 'b88d4fde', 'f242432a', '2eb2c2d6'), '\\b(?:safeBatchT|safeT|t)ransferFrom\\b'),
  mk('signTypedData', 'EIP-712 typed-data signature', '\\beth_signTypedData(?:_v[134])?\\b', '\\bsignTypedData\\b'),
  mk('ethSign', 'eth_sign (blind signature)', `${q}eth_sign${q}`),
];

export type CallCounts = Record<string, number>;
export interface CallSite { kind: string; file: string; offset: number; snippet: string }

const CODE = /\.(m?js|html?)$/i;
export const isCode = (path: string) => CODE.test(path);

/// Every match in one file, with a short piece of the surrounding code.
export function findCalls(file: string, text: string): CallSite[] {
  const out: CallSite[] = [];
  for (const k of CALL_KINDS) {
    for (const m of text.matchAll(k.re)) out.push({ kind: k.kind, file, offset: m.index, snippet: snippetAt(text, m.index, m[0].length) });
  }
  return out;
}

export function snippetAt(text: string, offset: number, length: number, around = 60): string {
  const from = Math.max(0, offset - around);
  const to = Math.min(text.length, offset + length + around);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`;
}

/// Count per kind over a whole build; kinds with no match are left out.
export function countCalls(sites: CallSite[]): CallCounts {
  const out: CallCounts = {};
  for (const k of CALL_KINDS) {
    const n = sites.filter((s) => s.kind === k.kind).length;
    if (n > 0) out[k.kind] = n;
  }
  return out;
}
