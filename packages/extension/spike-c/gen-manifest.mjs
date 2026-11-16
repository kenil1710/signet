// Writes packages/extension/signet-manifest.json: the "sealed" SHA-256 of every file the clean demo build
// serves, plus the SHA-256 of each inline script. Spike C stand-in for the on-chain manifest (Spike B).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanFiles, sha256, SEALED, OTHER } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { files } = await cleanFiles();
const out = { v: 0, note: 'Spike C local manifest. Not the real Signet manifest format.', sites: { [SEALED]: { files: {}, inline: [], origins: [OTHER] } } };
const site = out.sites[SEALED];
for (const [url, bytes] of files) {
  site.files[url] = sha256(bytes);
  if (url.endsWith('/') || url.endsWith('.html')) {
    for (const m of bytes.toString('utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const h = sha256(Buffer.from(m[1]));
      if (!site.inline.includes(h)) site.inline.push(h);
    }
  }
}
await writeFile(path.resolve(here, '../signet-manifest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`sealed ${Object.keys(site.files).length} files and ${site.inline.length} inline script(s) for ${SEALED}`);
