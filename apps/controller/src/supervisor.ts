const RESTART_WINDOW_MS = 10 * 60 * 1_000;
const RESTART_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export type RestartDecision =
  | {
      allowed: true;
      attempt: 1 | 2 | 3;
      delayMs: (typeof RESTART_DELAYS_MS)[number];
    }
  | { allowed: false; reason: "restart-limit" };

export class RestartBudget {
  private history: number[] = [];
  private lastNowMs: number | undefined;

  public reserve(nowMs: number): RestartDecision {
    this.observeMonotonicTime(nowMs);
    this.prune(nowMs);

    const attemptIndex = this.history.length;
    const delayMs = RESTART_DELAYS_MS[attemptIndex];
    if (delayMs === undefined) {
      return { allowed: false, reason: "restart-limit" };
    }

    this.history.push(nowMs);
    return { allowed: true, attempt: (attemptIndex + 1) as 1 | 2 | 3, delayMs };
  }

  public diagnostics(nowMs: number): { attemptsInWindow: number } {
    this.observeMonotonicTime(nowMs);
    this.prune(nowMs);
    return { attemptsInWindow: this.history.length };
  }

  private observeMonotonicTime(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new Error("monotonic time must be a finite non-negative number");
    }
    if (this.lastNowMs !== undefined && nowMs < this.lastNowMs) {
      throw new Error("monotonic time must not decrease");
    }
    this.lastNowMs = nowMs;
  }

  private prune(nowMs: number): void {
    this.history = this.history.filter(
      (timestamp) => nowMs - timestamp < RESTART_WINDOW_MS,
    );
  }
}

export class GenerationGate {
  private generationId: number;

  public constructor(initialGenerationId = 1) {
    if (!GenerationGate.isValid(initialGenerationId)) {
      throw new Error("generation ID must be a positive safe integer");
    }
    this.generationId = initialGenerationId;
  }

  public current(): number {
    return this.generationId;
  }

  public invalidate(): number {
    if (this.generationId === Number.MAX_SAFE_INTEGER) {
      throw new Error("generation ID cannot exceed the maximum safe integer");
    }
    this.generationId += 1;
    return this.generationId;
  }

  public isCurrent(generationId: number): boolean {
    return GenerationGate.isValid(generationId) && generationId === this.generationId;
  }

  private static isValid(generationId: number): boolean {
    return Number.isSafeInteger(generationId) && generationId > 0;
  }
}
