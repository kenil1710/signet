// The theme snippet runs before paint, like next-themes and Misthos's network script: an inline script the sealer
// collects by hash.
const THEME = '(function(){try{var t=localStorage.getItem("theme")||"light";document.documentElement.dataset.theme=t}catch(e){}})()';

export const metadata = { title: 'Signet v2 demo' };

export default function Root({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
