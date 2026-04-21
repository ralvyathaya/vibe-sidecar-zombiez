import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import type { GameConfig, RunEventType, RunSegment } from './types';
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
    this.addClouds();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  render(): void {
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

    this.scene.background = new Color(this.currentClearColor);
    const fog = this.scene.fog as Fog;
    fog.color = new Color(this.currentFogColor);
    fog.near = this.currentFogNear;
    fog.far = this.currentFogFar;
    this.renderer.toneMappingExposure = this.currentExposure;
  }

  private addLighting(): void {
    const skyLight = new HemisphereLight(0xbfd7ff, 0x111111, 0.22);
    this.scene.add(skyLight);

    const moonLight = new DirectionalLight(0x8aa0c8, 0.12);
    moonLight.position.set(-8, 10, -4);
    this.scene.add(moonLight);

    const fillLight = new DirectionalLight(0x2e3c52, 0.05);
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

  private addClouds(): void {
    const cloudMaterial = new MeshBasicMaterial({
      color: 0x182330,
      transparent: true,
      opacity: 0.14,
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
  }

  private lerpColor(startHex: number, endHex: number, t: number): number {
    const start = new Color(startHex);
    const end = new Color(endHex);
    start.lerp(end, t);
    return start.getHex();
  }
}
