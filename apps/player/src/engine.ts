/**
 * Playback engine: plays the manifest as an endless loop.
 *
 * - Two layers, crossfaded by opacity. Each layer owns ONE <img> and ONE <video> for the
 *   whole session; items are shown by changing `src`. The element count never changes,
 *   so the DOM stays flat over weeks (verified by `pnpm test:soak`).
 * - The next image is preloaded (one reused Image object) while the current one shows.
 * - Images stay `durationSec`; videos play to their end unless `durationSec` is set.
 * - Broken items are skipped; if everything fails, it retries slowly instead of spinning.
 */
import type { DisplayCommand, DisplayState, Manifest, ManifestItem } from '@slidecast/shared';
import { clear, el, unload } from './dom.js';

const FADE_MS = 600;
const LOAD_TIMEOUT_MS = 30_000;
const VIDEO_STALL_MS = 20_000;
const ALL_FAILED_RETRY_MS = 15_000;

interface Layer {
  root: HTMLDivElement;
  img: HTMLImageElement;
  video: HTMLVideoElement;
  /** Bumped whenever the layer is (re)used, so stale cleanup timers can tell. */
  use: number;
}

function makeLayer(): Layer {
  const root = el('div', 'layer');
  const img = el('img', 'media');
  img.alt = '';
  const video = el('video', 'media');
  video.muted = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.playsInline = true;
  video.preload = 'auto';
  img.style.display = 'none';
  video.style.display = 'none';
  root.appendChild(img);
  root.appendChild(video);
  return { root, img, video, use: 0 };
}

function emptyLayer(layer: Layer): void {
  unload(layer.img);
  unload(layer.video);
  layer.img.style.display = 'none';
  layer.video.style.display = 'none';
}

export class Engine {
  private readonly stage: HTMLDivElement;
  private readonly layers: [Layer, Layer];
  private readonly idle: HTMLDivElement;
  private readonly preloader = new Image();
  private front = 0;
  private manifest: Manifest | null = null;
  private index = -1;
  private seq = 0;
  private paused = false;
  private currentVideo: HTMLVideoElement | null = null;

  private timer: number | undefined;
  private timerEndsAt = 0;
  private remainingMs = 0;
  private loadTimer: number | undefined;
  private stallTimer: number | undefined;
  private clockTimer: number | undefined;

  private errors: string[] = [];
  private failuresInARow = 0;

  constructor(
    root: HTMLElement,
    private readonly onStatus: (state: DisplayState) => void,
  ) {
    clear(root);
    this.stage = el('div', 'stage');
    this.layers = [makeLayer(), makeLayer()];
    this.idle = el('div', 'idle');
    this.stage.appendChild(this.layers[0].root);
    this.stage.appendChild(this.layers[1].root);
    this.stage.appendChild(this.idle);
    root.appendChild(this.stage);
    window.addEventListener('resize', () => this.layout());
  }

  get version(): string | null {
    return this.manifest ? this.manifest.version : null;
  }

  /** Starts (or restarts) playback of a manifest from its first item. */
  load(manifest: Manifest): void {
    this.manifest = manifest;
    this.failuresInARow = 0;
    this.layout();
    const fade = manifest.transition === 'fade' ? `opacity ${FADE_MS}ms ease` : 'none';
    for (const layer of this.layers) {
      layer.root.style.transition = fade;
      layer.img.style.objectFit = manifest.fit;
      layer.video.style.objectFit = manifest.fit;
    }

    if (manifest.items.length === 0) {
      this.stopPlayback();
      this.showIdle();
    } else {
      this.hideIdle();
      this.index = -1;
      this.next();
    }
    this.report();
  }

  command(cmd: DisplayCommand): void {
    switch (cmd) {
      case 'next':
        this.next();
        break;
      case 'prev':
        this.prev();
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'reload':
        window.location.reload();
        break;
    }
  }

  next(): void {
    const n = this.count();
    if (n > 0) this.show((this.index + 1) % n);
  }

  prev(): void {
    const n = this.count();
    if (n > 0) this.show((this.index - 1 + n) % n);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.timer !== undefined) {
      this.remainingMs = Math.max(0, this.timerEndsAt - Date.now());
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.currentVideo) this.currentVideo.pause();
    this.report();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.currentVideo) void this.playVideo(this.currentVideo);
    if (this.remainingMs > 0) this.startTimer(this.remainingMs);
    this.report();
  }

  /** Current state, as reported to the server. */
  state(): DisplayState {
    const item = this.currentItem();
    return {
      manifestVersion: this.version,
      itemIndex: this.index >= 0 ? this.index : null,
      itemCount: this.count(),
      mediaId: item ? item.mediaId : null,
      pageNo: item ? item.pageNo : null,
      paused: this.paused,
      errors: this.errors.slice(-5),
      screen: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  // ---------- internals ----------

  private count(): number {
    return this.manifest ? this.manifest.items.length : 0;
  }

  private currentItem(): ManifestItem | null {
    return this.manifest && this.index >= 0 ? (this.manifest.items[this.index] ?? null) : null;
  }

  private report(): void {
    this.onStatus(this.state());
  }

  /** Rotation is applied here: for 90/270 the stage is sized portrait and turned. */
  private layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rot = this.manifest ? this.manifest.rotation : 0;
    const sideways = rot === 90 || rot === 270;
    this.stage.style.width = `${sideways ? h : w}px`;
    this.stage.style.height = `${sideways ? w : h}px`;
    this.stage.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
  }

  private clearTimers(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.loadTimer);
    window.clearInterval(this.stallTimer);
    this.timer = undefined;
    this.loadTimer = undefined;
    this.stallTimer = undefined;
  }

  private startTimer(ms: number): void {
    window.clearTimeout(this.timer);
    this.timerEndsAt = Date.now() + ms;
    this.remainingMs = ms;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.next();
    }, ms);
  }

  private stopPlayback(): void {
    this.seq++;
    this.clearTimers();
    for (const layer of this.layers) {
      layer.use++;
      emptyLayer(layer);
      layer.root.style.opacity = '0';
    }
    this.currentVideo = null;
    this.preloader.removeAttribute('src');
    this.index = -1;
  }

  private show(i: number): void {
    const manifest = this.manifest;
    if (!manifest) return;
    const item = manifest.items[i];
    if (!item) return;
    const seq = ++this.seq;
    this.clearTimers();
    this.index = i;

    // Load into the back layer; the front layer keeps showing until it is ready.
    const layer = this.layers[1 - this.front]!;
    layer.use++;
    emptyLayer(layer);

    let done = false;
    const ready = () => {
      if (done || seq !== this.seq) return;
      done = true;
      window.clearTimeout(this.loadTimer);
      this.failuresInARow = 0;
      this.reveal(layer, item.type);
      this.schedule(item, layer);
      this.preloadNext();
      this.report();
    };
    const fail = (why: string) => {
      if (done || seq !== this.seq) return;
      done = true;
      emptyLayer(layer);
      this.recordError(`${why}: ${item.url}`);
      this.failuresInARow++;
      const allBroken = this.failuresInARow >= this.count();
      if (allBroken) this.failuresInARow = 0;
      this.timer = window.setTimeout(() => this.next(), allBroken ? ALL_FAILED_RETRY_MS : 500);
    };

    this.loadTimer = window.setTimeout(() => fail('load timeout'), LOAD_TIMEOUT_MS);
    if (item.type === 'video') {
      const v = layer.video;
      v.oncanplay = () => {
        v.oncanplay = null;
        ready();
        if (!this.paused) void this.playVideo(v);
      };
      v.onerror = () => fail('video error');
      v.src = item.url;
      v.load();
    } else {
      const img = layer.img;
      img.onload = ready;
      img.onerror = () => fail('image error');
      img.src = item.url;
    }
  }

  private async playVideo(v: HTMLVideoElement): Promise<void> {
    try {
      await v.play();
    } catch (err) {
      this.recordError(`play() rejected: ${String(err)}`);
    }
  }

  /** Fades the back layer in, the front layer out, then empties the old one. */
  private reveal(incoming: Layer, type: ManifestItem['type']): void {
    const outgoing = this.layers[this.front]!;
    incoming.img.style.display = type === 'image' ? 'block' : 'none';
    incoming.video.style.display = type === 'video' ? 'block' : 'none';
    void incoming.root.offsetWidth; // start the transition from opacity 0
    incoming.root.style.opacity = '1';
    outgoing.root.style.opacity = '0';
    outgoing.video.pause();

    const use = outgoing.use;
    const delay = this.manifest && this.manifest.transition === 'fade' ? FADE_MS + 50 : 0;
    window.setTimeout(() => {
      if (outgoing.use === use) emptyLayer(outgoing); // unless it was reused meanwhile
    }, delay);

    this.front = this.layers.indexOf(incoming);
    this.currentVideo = type === 'video' ? incoming.video : null;
  }

  private schedule(item: ManifestItem, layer: Layer): void {
    if (item.durationSec != null) {
      const ms = item.durationSec * 1000;
      if (this.paused) this.remainingMs = ms;
      else this.startTimer(ms);
    } else {
      this.remainingMs = 0;
    }
    if (item.type !== 'video') return;

    const v = layer.video;
    v.onended = () => {
      if (item.durationSec == null) {
        if (!this.paused) this.next();
      } else {
        void this.playVideo(v); // shorter than its slot: loop until the timer
      }
    };
    // A stuck video (decoder hiccup, broken file) must not freeze the loop.
    let lastTime = -1;
    let lastMove = Date.now();
    this.stallTimer = window.setInterval(() => {
      if (this.paused) {
        lastMove = Date.now();
        return;
      }
      if (v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        lastMove = Date.now();
      } else if (Date.now() - lastMove > VIDEO_STALL_MS) {
        this.recordError(`video stalled: ${item.url}`);
        this.next();
      }
    }, 5000);
  }

  private preloadNext(): void {
    const n = this.count();
    if (!this.manifest || n < 2) return;
    const nextItem = this.manifest.items[(this.index + 1) % n];
    if (nextItem && nextItem.type === 'image') this.preloader.src = nextItem.url;
    else this.preloader.removeAttribute('src');
  }

  private recordError(msg: string): void {
    this.errors.push(msg.slice(0, 200));
    if (this.errors.length > 5) this.errors.shift();
  }

  // ---------- idle screen: faculty name + clock ----------

  private showIdle(): void {
    const m = this.manifest;
    clear(this.idle);
    const name = el('div', 'idle-name', m ? m.facultyName : '');
    const time = el('div', 'idle-time');
    const date = el('div', 'idle-date');
    this.idle.appendChild(name);
    this.idle.appendChild(time);
    this.idle.appendChild(date);
    this.idle.style.display = 'flex';
    const tz = m ? m.timezone : undefined;
    const tick = () => {
      const now = new Date();
      time.textContent = formatTime(now, tz, { hour: '2-digit', minute: '2-digit' });
      date.textContent = formatTime(now, tz, { weekday: 'long', day: 'numeric', month: 'long' });
    };
    tick();
    window.clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(tick, 10_000);
  }

  private hideIdle(): void {
    window.clearInterval(this.clockTimer);
    this.clockTimer = undefined;
    this.idle.style.display = 'none';
    clear(this.idle);
  }
}

function formatTime(d: Date, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat('hr-HR', { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('hr-HR', opts).format(d);
  }
}
