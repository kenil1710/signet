// Creates an Ethereum V3 keystore with strong scrypt (N = 2^18, r = 8, p = 1; geth's "standard" setting).
// Usage: node scripts/new-keystore.mjs <name> [outDir]   (outDir defaults to ~/.foundry/keystores)
// The password is read from the terminal without echo, twice. Only the address is printed; the key never is.
// TEST ONLY: KS_TEST_PASSWORD=... skips the prompt (never use it for a real key).
import { createRequire } from 'node:module';
import { randomBytes, createCipheriv, randomUUID, scryptSync } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const req = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const { keccak256 } = req('viem');
const { privateKeyToAccount } = req('viem/accounts');

const name = process.argv[2];
if (!name || !/^[\w.-]+$/.test(name)) { console.error('usage: node new-keystore.mjs <name> [outDir]'); process.exit(2); }
const outDir = process.argv[3] || join(homedir(), '.foundry', 'keystores');
const out = join(outDir, name);
if (existsSync(out)) { console.error(`${out} already exists; refusing to overwrite`); process.exit(2); }

async function askHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('needs a terminal (run it with ! in Claude Code, or in your own shell)');
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

let pw = process.env.KS_TEST_PASSWORD;
if (!pw) {
  pw = await askHidden('New keystore password (min 16 chars): ');
  if (pw.length < 16) { console.error('too short'); process.exit(2); }
  if ((await askHidden('Repeat: ')) !== pw) { console.error('passwords differ'); process.exit(2); }
}

let key;
do { key = randomBytes(32); } while (key.equals(Buffer.alloc(32)));
const address = privateKeyToAccount(`0x${key.toString('hex')}`).address;

const kdfparams = { dklen: 32, n: 262144, p: 1, r: 8, salt: randomBytes(32).toString('hex') };
const dk = scryptSync(Buffer.from(pw.normalize('NFKC'), 'utf8'), Buffer.from(kdfparams.salt, 'hex'), 32, { N: kdfparams.n, r: 8, p: 1, maxmem: 2 ** 29 });
const iv = randomBytes(16);
const c = createCipheriv('aes-128-ctr', dk.subarray(0, 16), iv);
const ciphertext = Buffer.concat([c.update(key), c.final()]);
const mac = keccak256(Buffer.concat([dk.subarray(16, 32), ciphertext])).slice(2);
key.fill(0);

const json = { address: address.slice(2).toLowerCase(), crypto: { cipher: 'aes-128-ctr', cipherparams: { iv: iv.toString('hex') }, ciphertext: ciphertext.toString('hex'), kdf: 'scrypt', kdfparams, mac }, id: randomUUID(), version: 3 };
mkdirSync(outDir, { recursive: true });
writeFileSync(out, JSON.stringify(json), { mode: 0o600 });
chmodSync(out, 0o600);
console.log(`Keystore written: ${out}\nAddress: ${address}\nscrypt n=262144 r=8 p=1. Back up this file and the password separately.`);
