export class GameLoop {
  private readonly fixedStep: number;
  private readonly maxCatchUpSteps: number;
  private accumulator = 0;
  private lastTimestamp = 0;
  private frameId = 0;

  constructor(
    private readonly update: (deltaTime: number) => void,
    private readonly render: () => void,
    targetFps = 60,
    maxCatchUpSteps = 3,
  ) {
    this.fixedStep = 1 / targetFps;
    this.maxCatchUpSteps = Math.max(1, maxCatchUpSteps);
    this.tick = this.tick.bind(this);
  }

  start(): void {
    if (this.frameId !== 0) {
      return;
    }

    this.lastTimestamp = performance.now();
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.frameId === 0) {
      return;
    }

    window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  // Fixed-step simulation keeps input, collisions, and spawn timing predictable.
  private tick(timestamp: number): void {
    const deltaSeconds = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
    this.lastTimestamp = timestamp;
    this.accumulator += deltaSeconds;
    let steps = 0;

    while (this.accumulator >= this.fixedStep && steps < this.maxCatchUpSteps) {
      this.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps += 1;
    }

    if (steps >= this.maxCatchUpSteps && this.accumulator >= this.fixedStep) {
      // Drop excess catch-up work after a hitch so the next frame recovers quickly
      // instead of spiraling into more long frames.
      this.accumulator = this.fixedStep * 0.5;
    }

    this.render();
    this.frameId = window.requestAnimationFrame(this.tick);
  }
}
