export function mark(el: HTMLElement | null): void {
  if (el) el.dataset.lazy = 'loaded';
}
