import Wallet from './wallet.jsx';

export default function Home() {
  return (
    <main>
      <h1>Signet v2 demo</h1>
      <p>A server-rendered page: its scripts are sealed, its HTML is not.</p>
      <Wallet />
    </main>
  );
}
