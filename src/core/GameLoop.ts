export class GameLoop {
  private readonly fixedStep: number;
  private accumulator = 0;
  private lastTimestamp = 0;
  private frameId = 0;

  constructor(
    private readonly update: (deltaTime: number) => void,
    private readonly render: () => void,
    targetFps = 60,
  ) {
    this.fixedStep = 1 / targetFps;
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

    while (this.accumulator >= this.fixedStep) {
      this.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    this.render();
    this.frameId = window.requestAnimationFrame(this.tick);
  }
}
