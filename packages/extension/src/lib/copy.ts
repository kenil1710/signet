// Is the verified copy there? The popup and the warning page offer "Open the verified copy" only when every file of
// the current release is stored in the project's container with its sealed size and SHA-256 (SiteRegistry.fileInfo,
// docs/tapeout-interfaces.md §8). Otherwise the button would open a copy that can't run. The copy page still reads
// and hashes every file itself; this only decides whether to offer it.
import type { Hex, SealedFile } from './types.ts';

export type StoredInfo = { size: number; sha256: Hex } | null; // null: no such file in the container
export interface CopyState { complete: boolean; stored: number; total: number }

export function fullCopy(files: SealedFile[], infos: StoredInfo[]): CopyState {
  let stored = 0;
  files.forEach((f, i) => {
    const s = infos[i];
    if (s && s.size === f.size && s.sha256.toLowerCase() === f.sha256.toLowerCase()) stored++;
  });
  return { complete: files.length > 0 && stored === files.length, stored, total: files.length };
}
