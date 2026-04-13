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
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import type { GameConfig } from './types';

export class RendererSystem {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(72, 1, 0.1, 220);
  readonly renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });

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
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.className = 'game-canvas';

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

  private addLighting(): void {
    const skyLight = new HemisphereLight(0xd9ecfb, 0x7b7c79, 1.7);
    this.scene.add(skyLight);

    const sunLight = new DirectionalLight(0xfff3d7, 1.7);
    sunLight.position.set(20, 26, -20);
    this.scene.add(sunLight);

    const fillLight = new DirectionalLight(0xd6e7f5, 0.42);
    fillLight.position.set(-12, 14, 16);
    this.scene.add(fillLight);
  }

  private addSun(): void {
    const sunCore = new Mesh(
      new SphereGeometry(4.8, 18, 18),
      new MeshBasicMaterial({
        color: 0xfff1c2,
        fog: false,
      }),
    );
    sunCore.position.set(58, 42, -148);

    const sunHalo = new Mesh(
      new SphereGeometry(7.2, 16, 16),
      new MeshBasicMaterial({
        color: 0xffe4a3,
        transparent: true,
        opacity: 0.11,
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
      color: 0xf6fbff,
      transparent: true,
      opacity: 0.82,
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
}
