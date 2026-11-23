// Inline scripts on a server-rendered page (page mode "ssr"): what may run without being a sealed file.
// Shared by the sealer (which collects the exact bodies of a release's inline scripts) and Guard (which checks
// every inline script the page runs). Browser-safe: no Node APIs.
//
// An inline script is allowed only if it is one of:
//   1. sealed   the SHA-256 of its exact text is in the release (pages.inline). The sealer collects these from the
//               build's HTML and from the pages it crawled: theme and config snippets, React's streaming runtime.
//   2. data     a Next.js flight push: exactly `self.__next_f.push(` + JSON + `)`, where the JSON is an array of
//               numbers, strings and nulls. JSON.parse checks the whole argument, so no code can be in it.
//   3. reveal   a React streaming call: exactly `$RS(`, `$RC(`, `$RX(` or `$RV(` + a JSON list of strings + `)`.
//               Only the sealed runtime defines these functions; the arguments are node ids and messages.
//   4. inert    a <script> type the browser never runs (application/json, ld+json, text/plain…).
// Anything else is "injected": a script that is not in the release.
import { sha256, toHex } from 'viem';

export type InlineKind = 'sealed' | 'data' | 'reveal' | 'inert' | 'injected';
export interface InlineSeen { text: string; type: string }

/// <script> types the browser executes as JavaScript (HTML spec: a JavaScript MIME type essence, or "module", or
/// no type). importmap and speculationrules change what loads, so they must be sealed like code.
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'application/ecmascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
  'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript']);
const CODE_LIKE = new Set(['importmap', 'speculationrules']);

export function normType(type: string | null | undefined): string {
  return String(type ?? '').split(';')[0]!.trim().toLowerCase();
}
/// Does the browser run (or act on) a <script> of this type?
export function runs(type: string | null | undefined): boolean {
  const t = normType(type);
  return JS_TYPES.has(t) || CODE_LIKE.has(t);
}

/// SHA-256 of the exact text (UTF-8), 0x-prefixed lowercase hex: the value sealed in pages.inline.
export function inlineHash(text: string): `0x${string}` {
  return sha256(toHex(new TextEncoder().encode(text)));
}

const FLIGHT = /^self\.__next_f\.push\(([\s\S]*)\)$/;
const REVEAL = /^\$R[SCXV]\(([\s\S]*)\)$/;
const MAX_ARG = 1_000_000;

function jsonArray(src: string): unknown[] | null {
  if (src.length > MAX_ARG) return null;
  try {
    const v: unknown = JSON.parse(src);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/// The template an inline script matches without being sealed, if any ("data" or "reveal").
export function templateOf(text: string): 'data' | 'reveal' | null {
  const f = FLIGHT.exec(text);
  if (f) {
    const a = jsonArray(f[1]!);
    if (a && a.length >= 1 && a.every((x) => x === null || typeof x === 'number' || typeof x === 'string')) return 'data';
    return null;
  }
  const r = REVEAL.exec(text);
  if (r) {
    const a = jsonArray(`[${r[1]!}]`);
    if (a && a.length >= 1 && a.length <= 8 && a.every((x) => typeof x === 'string' && x.length <= 4096)) return 'reveal';
  }
  return null;
}

export function classifyInline(s: InlineSeen, sealed: ReadonlySet<string>): InlineKind {
  if (!runs(s.type)) return 'inert';
  if (sealed.has(inlineHash(s.text))) return 'sealed';
  return templateOf(s.text) ?? 'injected';
}

/// Every inline <script> in an HTML document: its exact text and type (no HTML entity decoding: script text is raw).
export function inlineScriptsOf(html: string): InlineSeen[] {
  const out: InlineSeen[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1]!;
    if (/\ssrc\s*=/i.test(` ${attrs}`)) continue;
    const t = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    out.push({ text: m[2]!, type: t ? (t[1] ?? t[2] ?? t[3] ?? '') : '' });
  }
  return out;
}

/// What the sealer seals for a set of pages: the hashes of every inline script that runs and isn't a template.
export function inlineHashesOf(pages: string[]): `0x${string}`[] {
  const set = new Set<`0x${string}`>();
  for (const html of pages) for (const s of inlineScriptsOf(html)) if (runs(s.type) && !templateOf(s.text)) set.add(inlineHash(s.text));
  return [...set].sort();
}
