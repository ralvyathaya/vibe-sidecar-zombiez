import { ShaderMaterial, Uniform, Vector2 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface SpeedShaderTuning {
  edgeStart: number;
  edgeStrength: number;
  lineDensity: number;
  lineLength: number;
  lineSoftness: number;
}

const DEFAULT_TUNING: SpeedShaderTuning = {
  edgeStart: 0.76,
  edgeStrength: 0.72,
  lineDensity: 126,
  lineLength: 26,
  lineSoftness: 0.18,
};

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform float edgeStart;
  uniform float edgeStrength;
  uniform float lineDensity;
  uniform float lineLength;
  uniform float lineSoftness;

  varying vec2 vUv;

  const float TAU = 6.28318530718;

  float hash11(float p) {
    return fract(sin(p * 127.1 + 311.7) * 43758.5453123);
  }

  float streakLayer(
    vec2 dir,
    float radius,
    float edgeMask,
    float density,
    float lengthScale,
    float softness,
    float timeShift
  ) {
    float angle01 = atan(dir.y, dir.x) / TAU + 0.5;
    float angularCoord = angle01 * density + timeShift;
    float cell = floor(angularCoord);
    float local = abs(fract(angularCoord) - 0.5);
    float seed = hash11(cell * 17.13 + floor(radius * 96.0) * 0.71);

    float width = mix(0.24, 0.075, min(1.0, density / 160.0));
    float soft = max(0.004, width * (0.28 + softness * 1.35));
    float band = 1.0 - smoothstep(width, width + soft, local);

    float travel = fract(
      (1.0 - radius) * (lengthScale * mix(0.85, 1.5, seed)) -
      uTime * (6.0 + uSpeed * 28.0) +
      seed * 11.0
    );
    float segmentLength = mix(0.2, 0.86, edgeMask) * mix(0.82, 1.18, seed);
    float segmentSoft = 0.035 + softness * 0.14;
    float segment =
      smoothstep(0.0, segmentSoft, travel) *
      (1.0 - smoothstep(segmentLength, segmentLength + segmentSoft * 1.5, travel));

    return band * segment * mix(0.55, 1.0, seed);
  }

  void main() {
    vec4 sceneColor = texture2D(tDiffuse, vUv);

    vec2 safeResolution = max(uResolution, vec2(1.0));
    vec2 halfSpan = vec2(0.5, 0.5);
    vec2 centeredUv = (vUv - uCenter) / halfSpan;
    vec2 aspectCentered = centeredUv;
    aspectCentered.x *= safeResolution.x / safeResolution.y;

    float radius = min(1.0, length(aspectCentered) / length(vec2(safeResolution.x / safeResolution.y, 1.0)));
    vec2 dir = length(aspectCentered) > 0.0001 ? normalize(aspectCentered) : vec2(0.0, -1.0);

    // Box distance keeps the center clean while making the outer screen band the only active region.
    float boxRadius = max(abs(centeredUv.x), abs(centeredUv.y));
    float edgeMask = smoothstep(edgeStart, 1.0, boxRadius);
    float cornerBoost = smoothstep(0.86, 1.24, length(centeredUv));
    float borderBoost = edgeMask * edgeMask * (1.0 + cornerBoost * 0.28);

    float density = max(8.0, lineDensity);
    float lengthScale = max(2.0, lineLength);
    float softness = clamp(lineSoftness, 0.01, 1.0);

    float layerA = streakLayer(dir, radius, edgeMask, density, lengthScale, softness, 0.0);
    float layerB = streakLayer(dir, radius, edgeMask, density * 0.72, lengthScale * 0.66, softness * 1.15, 13.0);
    float layerC = streakLayer(dir, radius, edgeMask, density * 1.18, lengthScale * 0.44, softness * 0.9, 37.0);
    float streaks = max(layerA, max(layerB * 0.74, layerC * 0.5));

    float intensity = uIntensity * edgeStrength * borderBoost;
    vec3 streakTint = mix(vec3(0.78, 0.8, 0.83), vec3(0.92, 0.94, 0.97), cornerBoost);
    vec3 color = sceneColor.rgb + streakTint * streaks * intensity;

    gl_FragColor = vec4(color, sceneColor.a);
  }
`;

const createShaderMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      tDiffuse: new Uniform(null),
      uTime: new Uniform(0),
      uSpeed: new Uniform(0),
      uIntensity: new Uniform(0),
      uResolution: new Uniform(new Vector2(1, 1)),
      uCenter: new Uniform(new Vector2(0.5, 0.5)),
      edgeStart: new Uniform(DEFAULT_TUNING.edgeStart),
      edgeStrength: new Uniform(DEFAULT_TUNING.edgeStrength),
      lineDensity: new Uniform(DEFAULT_TUNING.lineDensity),
      lineLength: new Uniform(DEFAULT_TUNING.lineLength),
      lineSoftness: new Uniform(DEFAULT_TUNING.lineSoftness),
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });

export class SpeedShaderPass extends ShaderPass {
  readonly tuning: SpeedShaderTuning;

  constructor(tuning: Partial<SpeedShaderTuning> = {}) {
    super(createShaderMaterial(), 'tDiffuse');
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.enabled = false;
    this.applyTuning();
  }

  setTime(time: number): void {
    this.uniforms.uTime.value = time;
  }

  setSpeed(speed: number): void {
    this.uniforms.uSpeed.value = Math.min(1, Math.max(0, speed));
  }

  setIntensity(intensity: number): void {
    this.uniforms.uIntensity.value = Math.min(1, Math.max(0, intensity));
  }

  setCenter(x: number, y: number): void {
    this.uniforms.uCenter.value.set(x, y);
  }

  setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  // Tuning lives here so the renderer can keep a small, readable setup surface.
  updateTuning(tuning: Partial<SpeedShaderTuning>): void {
    Object.assign(this.tuning, tuning);
    this.applyTuning();
  }

  private applyTuning(): void {
    this.uniforms.edgeStart.value = this.tuning.edgeStart;
    this.uniforms.edgeStrength.value = this.tuning.edgeStrength;
    this.uniforms.lineDensity.value = this.tuning.lineDensity;
    this.uniforms.lineLength.value = this.tuning.lineLength;
    this.uniforms.lineSoftness.value = this.tuning.lineSoftness;
  }
}
