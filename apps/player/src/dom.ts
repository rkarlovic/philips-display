/** Tiny DOM helpers (no framework; keep the DOM small). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Empties an image/video element so the browser can drop its decoded data, but keeps
 * the element itself for reuse. Creating new <video> elements per item leaks: detached
 * videos (with their internal shadow DOM) are not reliably garbage-collected.
 */
export function unload(media: HTMLImageElement | HTMLVideoElement): void {
  media.onload = null;
  media.onerror = null;
  if (media instanceof HTMLVideoElement) {
    media.oncanplay = null;
    media.onended = null;
    if (!media.hasAttribute('src')) return;
    try {
      media.pause();
    } catch {
      // ignore
    }
    media.removeAttribute('src');
    try {
      media.load();
    } catch {
      // ignore
    }
  } else {
    media.removeAttribute('src');
  }
}
