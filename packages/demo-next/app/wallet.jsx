'use client';
// Wallet actions on the vault named in the URL (?vault=0x…&token=0x…&factory=0x…&id=0x…): what a Misthos owner does.
import { useEffect, useState } from 'react';

const pad = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
async function send(to, data) {
  const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to, data }] });
}

export default function Wallet() {
  const [q, setQ] = useState(null);
  const [out, setOut] = useState('');
  useEffect(() => setQ(Object.fromEntries(new URLSearchParams(location.search))), []);
  if (!q) return <p>loading…</p>;
  const run = (name, f) => async () => {
    try {
      setOut(`${name}: sent ${await f()}`);
    } catch (e) {
      setOut(`${name}: error ${e.message}`);
    }
  };
  return (
    <div>
      <button id="create" onClick={run('create', async () => {
        const [me] = await window.ethereum.request({ method: 'eth_requestAccounts' });
        return send(q.factory, `0x1b07d98e${q.id.slice(2)}${pad(me)}${pad(me)}${pad('0x0')}`);
      })}>Create vault</button>
      <button id="approve" onClick={run('approve', () => send(q.token, `0x095ea7b3${pad(q.vault)}${'f'.repeat(64)}`))}>Approve vault</button>
      <button id="deposit" onClick={run('deposit', () => send(q.vault, `0xb6b55f25${(1000n).toString(16).padStart(64, '0')}`))}>Deposit</button>
      <p id="out">{out}</p>
    </div>
  );
}
