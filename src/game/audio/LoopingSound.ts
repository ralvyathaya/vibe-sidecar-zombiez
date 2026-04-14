type LoopingSoundOptions = {
  volume?: number;
  playbackRate?: number;
  highpassHz?: number;
  lowpassHz?: number;
};

type LoopWindow = {
  start: number;
  end: number;
};

export class LoopingSound {
  private readonly defaultVolume: number;
  private readonly defaultPlaybackRate: number;
  private readonly highpassHz: number;
  private readonly lowpassHz: number;

  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private highpassNode: BiquadFilterNode | null = null;
  private lowpassNode: BiquadFilterNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private bufferPromise: Promise<AudioBuffer> | null = null;
  private loopWindow: LoopWindow | null = null;
  private desiredPlaying = false;
  private currentVolume: number;
  private currentPlaybackRate: number;

  constructor(
    private readonly source: string,
    options: LoopingSoundOptions = {},
  ) {
    this.defaultVolume = options.volume ?? 1;
    this.defaultPlaybackRate = options.playbackRate ?? 1;
    this.highpassHz = options.highpassHz ?? 0;
    this.lowpassHz = options.lowpassHz ?? 0;
    this.currentVolume = this.defaultVolume;
    this.currentPlaybackRate = this.defaultPlaybackRate;
  }

  play(
    volume = this.defaultVolume,
    playbackRate = this.defaultPlaybackRate,
  ): void {
    this.desiredPlaying = true;
    this.currentVolume = volume;
    this.currentPlaybackRate = playbackRate;
    void this.ensurePlaying();
  }

  pause(): void {
    this.desiredPlaying = false;
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    this.gainNode?.gain.cancelScheduledValues(now);
    this.gainNode?.gain.setTargetAtTime(0, now, 0.03);
    window.setTimeout(() => {
      if (!this.desiredPlaying && this.context && this.context.state === 'running') {
        void this.context.suspend();
      }
    }, 70);
  }

  stop(): void {
    this.desiredPlaying = false;
    if (!this.context) {
      return;
    }

    this.stopSource();
    if (this.context.state === 'running') {
      void this.context.suspend();
    }
  }

  destroy(): void {
    this.stop();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }
    this.context = null;
    this.gainNode = null;
    this.highpassNode = null;
    this.lowpassNode = null;
    this.bufferPromise = null;
    this.loopWindow = null;
  }

  private async ensurePlaying(): Promise<void> {
    const context = this.ensureContext();
    const buffer = await this.loadBuffer(context);

    if (!this.desiredPlaying) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    if (!this.sourceNode) {
      this.startSource(buffer);
    }

    const now = context.currentTime;
    this.gainNode?.gain.cancelScheduledValues(now);
    this.gainNode?.gain.setTargetAtTime(this.currentVolume, now, 0.02);
    this.sourceNode?.playbackRate.setTargetAtTime(this.currentPlaybackRate, now, 0.03);
  }

  private ensureContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = 0;

    let tail: AudioNode = this.gainNode;

    if (this.lowpassHz > 0) {
      this.lowpassNode = this.context.createBiquadFilter();
      this.lowpassNode.type = 'lowpass';
      this.lowpassNode.frequency.value = this.lowpassHz;
      tail.connect(this.lowpassNode);
      tail = this.lowpassNode;
    }

    if (this.highpassHz > 0) {
      this.highpassNode = this.context.createBiquadFilter();
      this.highpassNode.type = 'highpass';
      this.highpassNode.frequency.value = this.highpassHz;
      tail.connect(this.highpassNode);
      tail = this.highpassNode;
    }

    tail.connect(this.context.destination);
    return this.context;
  }

  private async loadBuffer(context: AudioContext): Promise<AudioBuffer> {
    if (this.bufferPromise) {
      return this.bufferPromise;
    }

    this.bufferPromise = fetch(this.source)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
      .then((buffer) => {
        this.loopWindow = this.detectLoopWindow(buffer);
        return buffer;
      });

    return this.bufferPromise;
  }

  private detectLoopWindow(buffer: AudioBuffer): LoopWindow {
    const channelData = buffer.getChannelData(0);
    const threshold = 0.0035;
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.max(64, Math.floor(sampleRate * 0.004));
    let firstIndex = 0;
    let lastIndex = channelData.length - 1;

    for (let index = 0; index < channelData.length; index += windowSize) {
      let peak = 0;
      for (let offset = 0; offset < windowSize && index + offset < channelData.length; offset += 1) {
        peak = Math.max(peak, Math.abs(channelData[index + offset]));
      }
      if (peak > threshold) {
        firstIndex = index;
        break;
      }
    }

    for (let index = channelData.length - 1; index >= 0; index -= windowSize) {
      let peak = 0;
      for (let offset = 0; offset < windowSize && index - offset >= 0; offset += 1) {
        peak = Math.max(peak, Math.abs(channelData[index - offset]));
      }
      if (peak > threshold) {
        lastIndex = index;
        break;
      }
    }

    const leadTrim = Math.max(0, firstIndex / sampleRate - 0.005);
    const tailTrim = Math.min(buffer.duration, lastIndex / sampleRate + 0.005);
    if (tailTrim - leadTrim < 0.2) {
      return { start: 0, end: buffer.duration };
    }

    return { start: leadTrim, end: tailTrim };
  }

  private startSource(buffer: AudioBuffer): void {
    const context = this.context;
    const gainNode = this.gainNode;
    if (!context || !gainNode) {
      return;
    }

    const sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = true;
    if (this.loopWindow) {
      sourceNode.loopStart = this.loopWindow.start;
      sourceNode.loopEnd = this.loopWindow.end;
    }
    sourceNode.playbackRate.value = this.currentPlaybackRate;
    sourceNode.connect(gainNode);
    sourceNode.onended = () => {
      if (this.sourceNode === sourceNode) {
        this.sourceNode = null;
      }
    };
    sourceNode.start(0, this.loopWindow?.start ?? 0);
    this.sourceNode = sourceNode;
  }

  private stopSource(): void {
    if (!this.sourceNode) {
      return;
    }

    this.sourceNode.stop();
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }
}
