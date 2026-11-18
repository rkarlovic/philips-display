/**
 * Tiny in-process job queue with named lanes, each with its own concurrency
 * (LibreOffice: 1, everything else: 2). Every job gets an AbortSignal and a timeout.
 */
export class TimeoutError extends Error {
  constructor() {
    super('job timed out');
  }
}

interface Job {
  run: (signal: AbortSignal) => Promise<void>;
  timeoutMs: number;
}

export class JobQueue<Lane extends string> {
  private readonly waiting = new Map<Lane, Job[]>();
  private readonly running = new Map<Lane, number>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency: Record<Lane, number>,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  add(lane: Lane, timeoutMs: number, run: (signal: AbortSignal) => Promise<void>): void {
    const list = this.waiting.get(lane) ?? [];
    list.push({ run, timeoutMs });
    this.waiting.set(lane, list);
    this.pump(lane);
  }

  get size(): number {
    let n = 0;
    for (const l of this.waiting.values()) n += l.length;
    for (const r of this.running.values()) n += r;
    return n;
  }

  /** Resolves once nothing is queued or running (used by tests and shutdown). */
  onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(lane: Lane): void {
    const list = this.waiting.get(lane) ?? [];
    while ((this.running.get(lane) ?? 0) < this.concurrency[lane] && list.length > 0) {
      const job = list.shift()!;
      this.running.set(lane, (this.running.get(lane) ?? 0) + 1);
      void this.execute(job).finally(() => {
        this.running.set(lane, (this.running.get(lane) ?? 1) - 1);
        this.pump(lane);
        if (this.size === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((w) => w());
        }
      });
    }
  }

  private async execute(job: Job): Promise<void> {
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new TimeoutError();
        ac.abort(err);
        reject(err);
      }, job.timeoutMs);
    });
    try {
      await Promise.race([job.run(ac.signal), timeout]);
    } catch (err) {
      this.onError(err);
    } finally {
      clearTimeout(timer);
    }
  }
}
