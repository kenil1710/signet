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

/// What Guard offers as the verified copy, the same everywhere (popup, warning page, refusal notice). A button only
/// when the copy is usable: a gateway is configured (the copy runs on its own origin, where the wallet works) and
/// every file of the current release is stored on-chain with its sealed size and hash. Otherwise a plain line:
/// "coming soon" (0.3.8; no gateway is deployed yet). (The read-only preview inside the extension is not offered as
/// the verified copy.)
export function copyOffer(st: (CopyState & { gateway?: boolean }) | null): { button: boolean; text: string; title: string } {
  if (st?.complete && st.gateway) return { button: true, text: 'Open the verified copy', title: 'A copy of the sealed release, read from X Layer, every file hash-checked.' };
  const title = !st ? 'Guard could not read the stored copy.'
    : !st.gateway ? "The verified copy runs on Signet's gateway, which isn't deployed yet."
    : `This release isn't stored on X Layer in full (${st.stored} of ${st.total} files).`;
  return { button: false, text: 'Verified copy: coming soon', title };
}

