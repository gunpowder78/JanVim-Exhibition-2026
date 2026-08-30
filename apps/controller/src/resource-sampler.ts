const SAMPLE_INTERVAL_MS = 5_000;
const PROCESS_ROLES = ["controller", "renderer", "janvim"] as const;

type ProcessRole = (typeof PROCESS_ROLES)[number];

export type ResourceSamplerTimerHandle = number | object;

export interface ResourceSamplerTimerAdapter {
  setInterval(callback: () => void, delayMs: number): ResourceSamplerTimerHandle;
  clearInterval(id: ResourceSamplerTimerHandle): void;
}

export interface ProcessSampleAdapter {
  sample(pid: number): Promise<{ rssBytes: number; handleCount: number }>;
}

export type ScalarAggregate = {
  count: number;
  min: number | null;
  max: number | null;
  final: number | null;
};

type ProcessAggregate = { rssBytes: ScalarAggregate; handleCount: ScalarAggregate };

export type ResourceSummary = {
  controller: ProcessAggregate;
  renderer: ProcessAggregate;
  janvim: ProcessAggregate;
  sampleIncomplete: boolean;
};

export class ResourceSampler {
  private readonly aggregates: Record<ProcessRole, ProcessAggregate> = {
    controller: emptyProcessAggregate(),
    renderer: emptyProcessAggregate(),
    janvim: emptyProcessAggregate(),
  };
  private pids: Record<ProcessRole, number> | undefined;
  private timerId: ResourceSamplerTimerHandle | undefined;
  private samplePromise: Promise<void> | undefined;
  private finishPromise: Promise<ResourceSummary> | undefined;
  private sampleGeneration = 0;
  private started = false;
  private finished = false;
  private disposed = false;
  private sampleIncomplete = false;

  public constructor(
    private readonly options: {
      adapter: ProcessSampleAdapter;
      timers: ResourceSamplerTimerAdapter;
    },
  ) {}

  public start(pids: { controller: number; renderer: number; janvim: number }): void {
    if (this.disposed) throw new Error("resource sampler has been disposed");
    if (this.started) throw new Error("resource sampler has already started");
    for (const role of PROCESS_ROLES) assertPid(pids[role]);

    this.started = true;
    this.sampleGeneration += 1;
    this.pids = { ...pids };
    this.timerId = this.options.timers.setInterval(
      () => this.sampleBoundary(),
      SAMPLE_INTERVAL_MS,
    );
    void this.beginSample();
  }

  public sampleBoundary(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.started) return Promise.reject(new Error("resource sampler has not started"));
    if (this.finished) {
      return this.finishPromise?.then(() => undefined) ?? Promise.resolve();
    }
    return this.beginSample();
  }

  public finish(): Promise<ResourceSummary> {
    if (this.disposed) return Promise.reject(new Error("resource sampler has been disposed"));
    if (!this.started) return Promise.reject(new Error("resource sampler has not started"));
    if (this.finishPromise !== undefined) return this.finishPromise;

    this.finished = true;
    if (this.timerId !== undefined) {
      this.options.timers.clearInterval(this.timerId);
      this.timerId = undefined;
    }
    this.finishPromise = (async () => {
      if (this.samplePromise !== undefined) await this.samplePromise;
      await this.beginSample();
      return this.snapshot();
    })();
    return this.finishPromise;
  }

  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.finished = true;
    this.sampleGeneration += 1;
    const timerId = this.timerId;
    this.timerId = undefined;
    this.pids = undefined;
    this.samplePromise = undefined;
    this.finishPromise = undefined;
    if (timerId !== undefined) this.options.timers.clearInterval(timerId);
  }

  public diagnostics(): { timerCount: 0 | 1; sampleInFlight: boolean } {
    return {
      timerCount: this.timerId === undefined ? 0 : 1,
      sampleInFlight: this.samplePromise !== undefined,
    };
  }

  private beginSample(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.samplePromise !== undefined) return this.samplePromise;

    const generation = this.sampleGeneration;
    const pids = this.pids;
    if (pids === undefined) {
      return Promise.reject(new Error("resource sampler PIDs are unavailable"));
    }
    const samplePromise = this.collectSample(generation, pids)
      .catch(() => {
        if (this.isCurrentSampleGeneration(generation)) {
          this.sampleIncomplete = true;
        }
      })
      .finally(() => {
        if (
          this.isCurrentSampleGeneration(generation) &&
          this.samplePromise === samplePromise
        ) {
          this.samplePromise = undefined;
        }
      });
    this.samplePromise = samplePromise;
    return samplePromise;
  }

  private async collectSample(
    generation: number,
    pids: Record<ProcessRole, number>,
  ): Promise<void> {
    for (const role of PROCESS_ROLES) {
      if (!this.isCurrentSampleGeneration(generation)) return;
      try {
        const sample = await this.options.adapter.sample(pids[role]);
        if (!this.isCurrentSampleGeneration(generation)) return;
        if (!isValidScalar(sample.rssBytes) || !isValidScalar(sample.handleCount)) {
          this.sampleIncomplete = true;
          continue;
        }
        updateAggregate(this.aggregates[role].rssBytes, sample.rssBytes);
        updateAggregate(this.aggregates[role].handleCount, sample.handleCount);
      } catch {
        if (!this.isCurrentSampleGeneration(generation)) return;
        this.sampleIncomplete = true;
      }
    }
  }

  private isCurrentSampleGeneration(generation: number): boolean {
    return !this.disposed && generation === this.sampleGeneration;
  }

  private snapshot(): ResourceSummary {
    return {
      controller: cloneProcessAggregate(this.aggregates.controller),
      renderer: cloneProcessAggregate(this.aggregates.renderer),
      janvim: cloneProcessAggregate(this.aggregates.janvim),
      sampleIncomplete: this.sampleIncomplete,
    };
  }
}

function emptyScalarAggregate(): ScalarAggregate {
  return { count: 0, min: null, max: null, final: null };
}

function emptyProcessAggregate(): ProcessAggregate {
  return { rssBytes: emptyScalarAggregate(), handleCount: emptyScalarAggregate() };
}

function updateAggregate(aggregate: ScalarAggregate, value: number): void {
  aggregate.count += 1;
  aggregate.min = aggregate.min === null ? value : Math.min(aggregate.min, value);
  aggregate.max = aggregate.max === null ? value : Math.max(aggregate.max, value);
  aggregate.final = value;
}

function cloneProcessAggregate(aggregate: ProcessAggregate): ProcessAggregate {
  return {
    rssBytes: { ...aggregate.rssBytes },
    handleCount: { ...aggregate.handleCount },
  };
}

function assertPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("process PID must be a positive safe integer");
  }
}

function isValidScalar(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
