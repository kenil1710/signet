#!/usr/bin/env bash
# Subsets Archivo (weight + width axes kept) to printable ASCII plus every other character the landing page uses.
# Rerun after changing the page's copy: bash test/subset-font.sh   (needs uv: https://docs.astral.sh/uv/)
set -euo pipefail
cd "$(dirname "$0")/.."
chars=$(mktemp)
python3 - > "$chars" <<'PY'
import re, html
text = ''
for f in ['index.html', 'src/landing/main.ts', 'src/landing/sim.ts', 'src/landing/verify-output.ts', 'src/landing/config.ts', 'src/landing/seal3d.ts']:
    t = open(f, encoding='utf8').read()
    if f.endswith('.html'): t = html.unescape(re.sub(r'<[^>]+>', ' ', t))
    text += t
chars = set(chr(c) for c in range(0x20, 0x7f)) | set(c for c in text if ord(c) > 0x7e) | set('‘’“”–—…·→←×•€$')
print(''.join(sorted(chars)))
PY
uvx --from fonttools==4.55.3 --with brotli==1.1.0 pyftsubset node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2 \
  --text-file="$chars" --layout-features='kern,liga,calt' --flavor=woff2 --output-file=src/landing/fonts/archivo-subset.woff2
ls -l src/landing/fonts/archivo-subset.woff2
