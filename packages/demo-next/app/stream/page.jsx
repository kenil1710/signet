// A page that streams: the slow part arrives later, revealed by React's inline streaming runtime ($RS / $RC calls).
import { Suspense } from 'react';
import Wallet from '../wallet.jsx';

export const dynamic = 'force-dynamic';

async function Slow() {
  await new Promise((r) => setTimeout(r, 300));
  return <p id="slow">streamed at {new Date().toISOString()}</p>;
}

export default function Stream() {
  return (
    <main>
      <h1>Streaming</h1>
      <Suspense fallback={<p id="wait">loading…</p>}>
        <Slow />
      </Suspense>
      <Wallet />
    </main>
  );
}
