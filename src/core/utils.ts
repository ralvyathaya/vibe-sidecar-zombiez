export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface RuntimePerformanceProfile {
  touchLike: boolean;
  lowPower: boolean;
  balanced: boolean;
  maxPixelRatio: number;
  enableVehicleShadows: boolean;
  enableAntialias: boolean;
}

let cachedRuntimePerformanceProfile: RuntimePerformanceProfile | null = null;

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;

const nativeRandom = Math.random.bind(Math);
let activeRandomSeed: number | null = null;

const normalizeSeed = (seed: number): number => {
  const normalized = Math.floor(Math.abs(seed)) >>> 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
};

export const setGameRandomSeed = (seed: number): void => {
  let state = normalizeSeed(seed);
  activeRandomSeed = state;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const restoreNativeRandom = (): void => {
  if (activeRandomSeed === null) {
    return;
  }

  activeRandomSeed = null;
  Math.random = nativeRandom;
};

export const randomRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

export const randomInt = (min: number, max: number): number =>
  Math.floor(randomRange(min, max + 1));

export const approach = (value: number, target: number, delta: number): number => {
  if (value < target) {
    return Math.min(value + delta, target);
  }

  return Math.max(value - delta, target);
};

export const formatDistance = (distance: number): string => `${Math.floor(distance)}m`;

export const sampleRoadCurveOffset = (
  zPosition: number,
  elapsedTime: number,
  frequency: number,
  amplitude: number,
): number =>
  Math.sin((zPosition - elapsedTime * 12) * frequency) * amplitude;

export const getRuntimePerformanceProfile = (): RuntimePerformanceProfile => {
  if (cachedRuntimePerformanceProfile) {
    return cachedRuntimePerformanceProfile;
  }

  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const touchPoints =
    typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : 0;
  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
      : null;
  const hardwareConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
  const devicePixelRatioValue =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
  const touchLike = coarsePointer || touchPoints > 0;
  const estimatedPixelLoad =
    viewportWidth * viewportHeight * Math.pow(Math.min(devicePixelRatioValue, 2), 2);
  const lowPower =
    touchLike ||
    (deviceMemory !== null && deviceMemory <= 4) ||
    (hardwareConcurrency !== null && hardwareConcurrency <= 4);
  const balanced =
    !lowPower &&
    ((deviceMemory !== null && deviceMemory <= 8) ||
      (hardwareConcurrency !== null && hardwareConcurrency <= 8) ||
      estimatedPixelLoad >= 2_600_000);

  cachedRuntimePerformanceProfile = {
    touchLike,
    lowPower,
    balanced,
    maxPixelRatio: lowPower ? 1.05 : balanced ? 1.18 : 1.32,
    enableVehicleShadows: !lowPower && !balanced,
    enableAntialias: !lowPower && !balanced && devicePixelRatioValue <= 1.25,
  };

  return cachedRuntimePerformanceProfile;
};
