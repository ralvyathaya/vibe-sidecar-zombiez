type SoundEffectPoolOptions = {
  poolSize?: number;
  volume?: number;
  playbackRate?: number;
};

export class SoundEffectPool {
  private readonly pool: HTMLAudioElement[];
  private readonly defaultVolume: number;
  private readonly defaultPlaybackRate: number;
  private cursor = 0;

  constructor(
    private readonly source: string,
    options: SoundEffectPoolOptions = {},
  ) {
    const poolSize = options.poolSize ?? 3;
    this.defaultVolume = options.volume ?? 1;
    this.defaultPlaybackRate = options.playbackRate ?? 1;

    this.pool = Array.from({ length: poolSize }, () => {
      const audio = new Audio(this.source);
      audio.preload = 'auto';
      audio.volume = this.defaultVolume;
      audio.playbackRate = this.defaultPlaybackRate;
      audio.crossOrigin = 'anonymous';
      return audio;
    });
  }

  play(
    volume = this.defaultVolume,
    playbackRate = this.defaultPlaybackRate,
  ): void {
    const voice = this.pickVoice();
    voice.pause();
    voice.currentTime = 0;
    voice.volume = volume;
    voice.playbackRate = playbackRate;
    void voice.play().catch(() => {
      // Browsers may reject playback until after an interaction; the game retries on the next valid action.
    });
  }

  stopAll(): void {
    for (const voice of this.pool) {
      voice.pause();
      voice.currentTime = 0;
    }
  }

  destroy(): void {
    this.stopAll();
    for (const voice of this.pool) {
      voice.removeAttribute('src');
      voice.load();
    }
  }

  private pickVoice(): HTMLAudioElement {
    const availableVoice = this.pool.find((voice) => voice.paused || voice.ended);
    if (availableVoice) {
      return availableVoice;
    }

    const voice = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return voice;
  }
}
