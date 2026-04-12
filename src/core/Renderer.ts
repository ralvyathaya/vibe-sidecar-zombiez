import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
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
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.className = 'game-canvas';

    this.mount.appendChild(this.renderer.domElement);
    this.addLighting();
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
    const skyLight = new HemisphereLight(0xffd8a8, 0x49321e, 1.5);
    this.scene.add(skyLight);

    const sunLight = new DirectionalLight(0xfff0c4, 1.8);
    sunLight.position.set(12, 18, 6);
    this.scene.add(sunLight);
  }

  private resize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
