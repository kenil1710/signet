// Guard 0.3.7: the popup's "Files matched" line. The same statuses count as checked as in the page check
// (content.ts: a page is "ok" when every result is one of these). Until 0.3.6 the popup left out ok-inline and ok-ssr,
// so a sealed server-rendered page (misthos.world: 26 files + 8 inline scripts + 1 page) showed "26 / 35" in red.
import type { FileResult, FileStatus } from './types.ts';

export const CHECKED: ReadonlySet<FileStatus> = new Set<FileStatus>(['ok', 'ok-sri', 'ok-gateway', 'ok-inline', 'ok-ssr']);

/// "35 / 35 loaded checked · 26 files + 8 inline + 1 server-rendered page"; good when every loaded item is checked.
export function filesMatched(files: readonly FileResult[]): { text: string; good: boolean; unchecked: FileResult[] } {
  const unchecked = files.filter((f) => !CHECKED.has(f.status));
  const n = (s: FileStatus[]) => files.filter((f) => s.includes(f.status)).length;
  const fileN = n(['ok', 'ok-sri', 'ok-gateway']);
  const inlineN = n(['ok-inline']);
  const pageN = n(['ok-ssr']);
  const parts = [
    fileN ? `${fileN} file${fileN === 1 ? '' : 's'}` : '',
    inlineN ? `${inlineN} inline` : '',
    pageN ? `${pageN} server-rendered page${pageN === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const ok = files.length - unchecked.length;
  return { text: `${ok} / ${files.length} loaded checked${parts.length ? ` · ${parts.join(' + ')}` : ''}`, good: unchecked.length === 0, unchecked };
}
