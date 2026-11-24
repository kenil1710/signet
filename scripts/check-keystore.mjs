// Checks a keystore password without revealing it: reads it from the terminal (no echo) with the SAME raw-mode reader
// scripts/new-keystore.mjs used (so control characters are captured the same way), then tries a few interpretations
// of what was typed and prints only which one opens the keystore and the address it gives. Never prints the password,
// its length or the key.
// Usage: node scripts/check-keystore.mjs [path]   (default ~/.foundry/keystores/signet-ops). Run it in your own terminal.
import { createRequire } from 'node:module';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const req = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const { keccak256 } = req('viem');
const { privateKeyToAccount } = req('viem/accounts');

const path = process.argv[2] || join(homedir(), '.foundry', 'keystores', 'signet-ops');
const ks = JSON.parse(readFileSync(path, 'utf8'));
const { kdf, kdfparams: kp, ciphertext, cipherparams, mac } = ks.crypto;
if (kdf !== 'scrypt') throw new Error(`kdf ${kdf}: only scrypt is checked here`);

// identical to new-keystore.mjs's reader (raw mode; only DEL erases; everything else is kept as typed)
async function askHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('needs a terminal: run it in your own shell');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let s = '';
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); return resolve(s); }
        if (c === '\u0003') { process.stdin.setRawMode(false); return reject(new Error('cancelled')); }
        if (c === '\u007f') s = s.slice(0, -1); else s += c;
      }
    };
    process.stdin.on('data', on);
  });
}

const opens = (pw) => {
  const dk = scryptSync(Buffer.from(pw, 'utf8'), Buffer.from(kp.salt, 'hex'), kp.dklen, { N: kp.n, r: kp.r, p: kp.p, maxmem: 2 ** 29 });
  const ct = Buffer.from(ciphertext, 'hex');
  if (keccak256(Buffer.concat([dk.subarray(16, 32), ct])).slice(2) !== mac.toLowerCase()) return null;
  const d = createDecipheriv('aes-128-ctr', dk.subarray(0, 16), Buffer.from(cipherparams.iv, 'hex'));
  const key = Buffer.concat([d.update(ct), d.final()]);
  const address = privateKeyToAccount(`0x${key.toString('hex')}`).address;
  key.fill(0);
  return address;
};

const typed = await askHidden(`Password for ${path} (not shown): `);
const backspaced = (s) => { let o = ''; for (const c of s) o = c === '\b' ? o.slice(0, -1) : o + c; return o; };
const noEscapes = (s) => s.replace(/\x1b\[20[01]~/g, '').replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '').replace(/\x1bO[A-Za-z]/g, '');
const candidates = [
  ['exactly as typed, NFKC (what new-keystore.mjs stored, and what cast reads for ASCII)', typed.normalize('NFKC')],
  ['exactly as typed, not normalized', typed],
  ['^H (0x08) treated as backspace', backspaced(typed).normalize('NFKC')],
  ['arrow-key and bracketed-paste sequences removed', noEscapes(typed).normalize('NFKC')],
  ['both of the above', noEscapes(backspaced(typed)).normalize('NFKC')],
  ['leading/trailing spaces removed', typed.trim().normalize('NFKC')],
];
// what was typed, as categories only (no length, no characters)
const has = (re) => re.test(typed);
console.log(`What you typed contains: control characters ${has(/[\x00-\x08\x0b-\x1f\x7f]/) ? 'YES' : 'no'}, escape sequences ${has(/\x1b/) ? 'YES' : 'no'}, non-ASCII ${has(/[^\x00-\x7f]/) ? 'yes' : 'no'}, leading/trailing spaces ${typed !== typed.trim() ? 'YES' : 'no'}`);
const tried = new Set();
let found = false;
for (const [label, pw] of candidates) {
  if (tried.has(pw)) continue;
  tried.add(pw);
  const address = opens(pw);
  console.log(`${address ? 'OPENS ' : 'no    '} ${label}${address ? ` -> ${address}${address.toLowerCase().slice(2) === String(ks.address).toLowerCase() ? ' (matches the file)' : ' (DIFFERS from the file!)'}` : ''}`);
  if (address) found = true;
}
console.log(found ? 'Result: the password opens this keystore.' : 'Result: no interpretation of what you typed opens this keystore.');
