import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SpeedShaderPass } from './post/SpeedShaderPass';
import type { GameConfig, RideState, RunEventType, RunSegment } from './types';
import { approach, getRuntimePerformanceProfile, lerp } from './utils';

export class RendererSystem {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(72, 1, 0.1, 220);
  readonly renderer: WebGLRenderer;
  private currentClearColor = 0;
  private currentFogColor = 0;
  private currentFogNear = 0;
  private currentFogFar = 0;
  private currentExposure = 0;
  private readonly backgroundColor = new Color();
  private readonly fogColor = new Color();
  private readonly colorLerpStart = new Color();
  private readonly colorLerpEnd = new Color();
  private readonly composer: EffectComposer;
  private readonly speedPass: SpeedShaderPass;
  private readonly outputPass: OutputPass;
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private speedEffectTime = 0;
  private speedEffectSpeed = 0;
  private speedEffectIntensity = 0;

  constructor(
    private readonly mount: HTMLElement,
    private readonly config: GameConfig,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: !this.runtimeProfile.lowPower,
      powerPreference: 'high-performance',
    });

    this.backgroundColor.setHex(this.config.renderer.clearColor);
    this.fogColor.setHex(this.config.renderer.fogColor);
    this.scene.background = this.backgroundColor;
    this.scene.fog = new Fog(
      this.config.renderer.fogColor,
      this.config.renderer.fogNear,
      this.config.renderer.fogFar,
    );
    (this.scene.fog as Fog).color = this.fogColor;

    this.camera.position.set(0, this.config.player.eyeHeight, 0);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.runtimeProfile.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.config.renderer.exposure;
    const maybePhysicalRenderer = this.renderer as WebGLRenderer & {
      useLegacyLights?: boolean;
    };
    if (typeof maybePhysicalRenderer.useLegacyLights === 'boolean') {
      maybePhysicalRenderer.useLegacyLights = false;
    }
    this.renderer.shadowMap.enabled = this.runtimeProfile.enableVehicleShadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    this.currentClearColor = this.config.renderer.clearColor;
    this.currentFogColor = this.config.renderer.fogColor;
    this.currentFogNear = this.config.renderer.fogNear;
    this.currentFogFar = this.config.renderer.fogFar;
    this.currentExposure = this.config.renderer.exposure;

    this.mount.appendChild(this.renderer.domElement);
    this.addLighting();
    this.addSun();
    this.addStars();
    this.addClouds();
    const renderPass = new RenderPass(this.scene, this.camera);
    this.speedPass = new SpeedShaderPass({
      // Edge-only streaks: sparse continuous lines, much calmer than the previous
      // segmented burst look.
      edgeStart: 0.81,
      edgeStrength: 0.34,
      lineDensity: 54,
      lineLength: 18,
      lineSoftness: 0.08,
    });
    this.speedPass.setCenter(0.5, 0.5);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.speedPass);
    // Keep tone mapping and output color conversion active even when post-processing
    // is in the chain, otherwise the night scene can look flatter/darker as soon as
    // the sprint composer path is involved.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  render(): void {
    if (this.speedPass.enabled) {
      this.composer.render();
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }

  updateAtmosphere(deltaTime: number, segment: RunSegment, activeEvent: RunEventType = 'none'): void {
    const target = this.config.renderer.atmosphere[segment];
    const smoothing = Math.min(1, deltaTime * 2.4);
    const fogMultiplier =
      activeEvent === 'blackoutStretch'
        ? this.config.pacing.events.blackoutFogMultiplier
        : 1;
    this.currentClearColor = this.lerpColor(this.currentClearColor, target.clearColor, smoothing);
    this.currentFogColor = this.lerpColor(this.currentFogColor, target.fogColor, smoothing);
    this.currentFogNear = lerp(this.currentFogNear, target.fogNear * fogMultiplier, smoothing);
    this.currentFogFar = lerp(this.currentFogFar, target.fogFar * fogMultiplier, smoothing);
    this.currentExposure = lerp(
      this.currentExposure,
      target.exposure * (activeEvent === 'blackoutStretch' ? 0.9 : 1),
      smoothing,
    );

    const fog = this.scene.fog as Fog;
    this.backgroundColor.setHex(this.currentClearColor);
    this.fogColor.setHex(this.currentFogColor);
    fog.near = this.currentFogNear;
    fog.far = this.currentFogFar;
    this.renderer.toneMappingExposure = this.currentExposure;
  }

  updateSpeedEffect(deltaTime: number, ride: RideState | null): void {
    this.speedEffectTime += deltaTime;
    const targetSpeed = ride
      ? (() => {
          const speedPressure = Math.max(0, (ride.speedMultiplier - 1.04) / 0.18);
          const floorItBoost = ride.floorItMode
            ? 0.18 + ride.driveBoostStrength * 0.72
            : 0;
          const nitroBoost = ride.nitroActive
            ? 0.4 + Math.max(speedPressure * 0.5, 0.08)
            : 0;
          const brakeCut = ride.brakeMode ? ride.driveBrakeStrength * 0.46 : 0;
          return Math.min(1, Math.max(0, speedPressure, floorItBoost, nitroBoost) - brakeCut);
        })()
      : 0;
    const targetIntensity = targetSpeed <= 0.035 ? 0 : Math.min(1, targetSpeed * 0.72);
    const speedRate = targetSpeed > this.speedEffectSpeed ? 6.5 : 13.5;
    const intensityRate = targetIntensity > this.speedEffectIntensity ? 6 : 15.5;
    this.speedEffectSpeed = approach(this.speedEffectSpeed, targetSpeed, deltaTime * speedRate);
    this.speedEffectIntensity = approach(
      this.speedEffectIntensity,
      targetIntensity,
      deltaTime * intensityRate,
    );
    this.speedPass.setTime(this.speedEffectTime);
    this.speedPass.setSpeed(this.speedEffectSpeed);
    this.speedPass.setIntensity(this.speedEffectIntensity);
    this.speedPass.enabled = this.speedEffectIntensity > 0.006 || targetIntensity > 0.006;
  }

  private addLighting(): void {
    const skyLight = new HemisphereLight(0xc9ddff, 0x1a1d22, 0.28);
    this.scene.add(skyLight);

    const moonLight = new DirectionalLight(0x97afd0, 0.16);
    moonLight.position.set(-8, 10, -4);
    this.scene.add(moonLight);

    const fillLight = new DirectionalLight(0x47566e, 0.08);
    fillLight.position.set(12, 10, 14);
    this.scene.add(fillLight);
  }

  private addSun(): void {
    const sunCore = new Mesh(
      new SphereGeometry(2.2, 16, 16),
      new MeshBasicMaterial({
        color: 0xbcd6ff,
        fog: false,
      }),
    );
    sunCore.position.set(-56, 40, -164);

    const sunHalo = new Mesh(
      new SphereGeometry(4.8, 14, 14),
      new MeshBasicMaterial({
        color: 0x7ea7ff,
        transparent: true,
        opacity: 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sunHalo.position.copy(sunCore.position);

    this.scene.add(sunHalo, sunCore);
  }

  private addStars(): void {
    const starCount = 180;
    const positions = new Float32Array(starCount * 3);

    for (let index = 0; index < starCount; index += 1) {
      const spreadX = (Math.random() - 0.5) * 220;
      const spreadY = 22 + Math.random() * 34;
      const spreadZ = -70 - Math.random() * 170;
      positions[index * 3] = spreadX;
      positions[index * 3 + 1] = spreadY;
      positions[index * 3 + 2] = spreadZ;
    }

    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const stars = new Points(
      starGeometry,
      new PointsMaterial({
        color: 0xe3ebff,
        size: 0.72,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        fog: false,
      }),
    );
    stars.renderOrder = 1;
    this.scene.add(stars);
  }

  private addClouds(): void {
    const cloudMaterial = new MeshBasicMaterial({
      color: 0x243140,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      fog: false,
    });
    const puffGeometry = new SphereGeometry(1, 8, 6);
    const cloudSpecs = [
      { position: [-52, 34, -138], scale: 5.8 },
      { position: [-18, 39, -170], scale: 4.9 },
      { position: [16, 35, -150], scale: 5.2 },
      { position: [48, 31, -132], scale: 4.4 },
      { position: [74, 37, -184], scale: 6.1 },
    ] as const;

    for (const spec of cloudSpecs) {
      const cloud = new Group();
      const puffs = [
        { x: -1.8, y: 0, z: 0, scale: 0.92 },
        { x: -0.5, y: 0.5, z: 0.35, scale: 1.08 },
        { x: 1, y: 0.2, z: -0.15, scale: 0.98 },
        { x: 2.1, y: -0.1, z: 0.2, scale: 0.78 },
      ];

      for (const puff of puffs) {
        const mesh = new Mesh(puffGeometry, cloudMaterial);
        mesh.position.set(puff.x, puff.y, puff.z);
        mesh.scale.set(spec.scale * puff.scale, spec.scale * puff.scale * 0.62, spec.scale * puff.scale * 0.78);
        cloud.add(mesh);
      }

      cloud.position.set(spec.position[0], spec.position[1], spec.position[2]);
      this.scene.add(cloud);
    }
  }

  private resize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.speedPass.setResolution(
      width * this.renderer.getPixelRatio(),
      height * this.renderer.getPixelRatio(),
    );
  }

  private lerpColor(startHex: number, endHex: number, t: number): number {
    this.colorLerpStart.setHex(startHex);
    this.colorLerpEnd.setHex(endHex);
    this.colorLerpStart.lerp(this.colorLerpEnd, t);
    return this.colorLerpStart.getHex();
  }
}
