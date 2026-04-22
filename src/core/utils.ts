export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface RuntimePerformanceProfile {
  touchLike: boolean;
  lowPower: boolean;
  maxPixelRatio: number;
  enableVehicleShadows: boolean;
}

let cachedRuntimePerformanceProfile: RuntimePerformanceProfile | null = null;

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;

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
  const touchLike = coarsePointer || touchPoints > 0;
  const lowPower = touchLike || (deviceMemory !== null && deviceMemory <= 6);

  cachedRuntimePerformanceProfile = {
    touchLike,
    lowPower,
    maxPixelRatio: lowPower ? 1.25 : 1.75,
    enableVehicleShadows: !lowPower,
  };

  return cachedRuntimePerformanceProfile;
};
