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
import { lerp } from './utils';

export class RendererSystem {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(72, 1, 0.1, 220);
  readonly renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  private currentClearColor = 0;
  private currentFogColor = 0;
  private currentFogNear = 0;
  private currentFogFar = 0;
  private currentExposure = 0;
  private readonly composer: EffectComposer;
  private readonly speedPass: SpeedShaderPass;
  private readonly outputPass: OutputPass;
  private speedEffectTime = 0;
  private speedEffectSpeed = 0;
  private speedEffectIntensity = 0;

  constructor(
    private readonly mount: HTMLElement,
    private readonly config: GameConfig,
  ) {
    this.scene.background = new Color(this.config.renderer.clearColor);
    this.scene.fog = new Fog(
      this.config.renderer.fogColor,
      this.config.renderer.fogNear,
      this.config.renderer.fogFar,
    );

    this.camera.position.set(0, this.config.player.eyeHeight, 0);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.config.renderer.exposure;
    const maybePhysicalRenderer = this.renderer as WebGLRenderer & {
      useLegacyLights?: boolean;
    };
    if (typeof maybePhysicalRenderer.useLegacyLights === 'boolean') {
      maybePhysicalRenderer.useLegacyLights = false;
    }
    this.renderer.shadowMap.enabled = true;
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
      // Edge-only streaks: center stays readable, corners carry most of the sprint punch.
      edgeStart: 0.77,
      edgeStrength: 0.78,
      lineDensity: 132,
      lineLength: 28,
      lineSoftness: 0.2,
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
    this.composer.render();
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

    this.scene.background = new Color(this.currentClearColor);
    const fog = this.scene.fog as Fog;
    fog.color = new Color(this.currentFogColor);
    fog.near = this.currentFogNear;
    fog.far = this.currentFogFar;
    this.renderer.toneMappingExposure = this.currentExposure;
  }

  updateSpeedEffect(deltaTime: number, ride: RideState | null): void {
    this.speedEffectTime += deltaTime;
    const targetSpeed = ride
      ? Math.min(
          1,
          Math.max(
            0,
            (ride.speedMultiplier - 1) / 0.24,
            (ride.floorItMode ? ride.driveBoostStrength * 0.9 : 0),
          ),
        )
      : 0;
    const targetIntensity = targetSpeed <= 0.02 ? 0 : Math.min(1, targetSpeed * 1.08);
    const smoothing = Math.min(1, deltaTime * 7.5);
    this.speedEffectSpeed = lerp(this.speedEffectSpeed, targetSpeed, smoothing);
    this.speedEffectIntensity = lerp(this.speedEffectIntensity, targetIntensity, smoothing * 0.86);
    this.speedPass.setTime(this.speedEffectTime);
    this.speedPass.setSpeed(this.speedEffectSpeed);
    this.speedPass.setIntensity(this.speedEffectIntensity);
    this.speedPass.enabled = this.speedEffectIntensity > 0.008 || targetIntensity > 0.008;
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
    const start = new Color(startHex);
    const end = new Color(endHex);
    start.lerp(end, t);
    return start.getHex();
  }
}
