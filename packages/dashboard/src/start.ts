// /start: fill in this site's own address in the commands, and add copy buttons.
import './style.css';
const origin = location.origin + location.pathname.replace(/\/start(\.html)?$/, '').replace(/\/$/, '');
for (const pre of document.querySelectorAll<HTMLPreElement>('pre[data-copy]')) {
  pre.textContent = pre.textContent!.replaceAll('{{ORIGIN}}', origin);
  const b = document.createElement('button');
  b.className = 'copy';
  b.textContent = 'Copy';
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(pre.textContent!); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
    setTimeout(() => (b.textContent = 'Copy'), 1600);
  };
  pre.before(b);
}
for (const el of document.querySelectorAll('.start p, .start li')) el.innerHTML = el.innerHTML.replaceAll('{{ORIGIN}}', origin);
