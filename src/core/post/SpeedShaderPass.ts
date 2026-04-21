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
  edgeStart: 0.81,
  edgeStrength: 0.34,
  lineDensity: 54,
  lineLength: 18,
  lineSoftness: 0.08,
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
    float seed = hash11(cell * 17.13);
    float keep = step(0.62, seed);

    float width = mix(0.18, 0.055, min(1.0, density / 90.0));
    float soft = max(0.003, width * (0.18 + softness * 1.05));
    float band = 1.0 - smoothstep(width, width + soft, local);
    float reachStart = mix(0.82, 0.56, clamp(lengthScale / 28.0, 0.0, 1.0));
    float radialMask = smoothstep(reachStart, 1.0, radius);
    float pulse = 0.88 + 0.12 * sin(uTime * (1.6 + uSpeed * 1.8) + seed * TAU);

    return keep * band * radialMask * edgeMask * pulse * mix(0.72, 1.0, seed);
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
    float cornerBoost = smoothstep(0.88, 1.24, length(centeredUv));
    float borderBoost = edgeMask * edgeMask * (1.0 + cornerBoost * 0.14);

    float density = max(8.0, lineDensity);
    float lengthScale = max(2.0, lineLength);
    float softness = clamp(lineSoftness, 0.01, 1.0);

    float layerA = streakLayer(dir, radius, edgeMask, density, lengthScale, softness, uTime * 0.18);
    float layerB = streakLayer(dir, radius, edgeMask, density * 0.58, lengthScale * 0.9, softness * 1.12, 9.0 - uTime * 0.1);
    float streaks = max(layerA, layerB * 0.52);

    float intensity = uIntensity * edgeStrength * borderBoost * 0.7;
    vec3 streakTint = mix(vec3(0.76, 0.78, 0.8), vec3(0.88, 0.9, 0.93), cornerBoost);
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
