import {
  AdditiveBlending,
  Camera,
  CanvasTexture,
  ConeGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { GameConfig, GameStateType, RideState } from '../../core/types';
import { approach } from '../../core/utils';

export class VehicleRigSystem {
  private readonly vehicleRig = new Group();
  private readonly obstructionShakeGroup = new Group();
  private readonly vehicleSpace = new Group();
  private readonly modelRoot = new Group();
  private readonly seatPivot = new Group();
  private readonly cameraYaw = new Group();
  private readonly cameraPitch = new Group();
  private readonly sidecarLatchAnchor = new Group();
  private readonly headlightPivot = new Group();
  private readonly headlightTarget = new Group();
  private readonly headlight = new SpotLight(0xffffff, 1);
  private readonly focusHeadlight = new SpotLight(0xffffff, 0);
  private readonly headlightFill = new PointLight(0xffffff, 0.4);
  private readonly headlightCone: Mesh;
  private readonly focusHeadlightCone: Mesh;
  private readonly headlightBeamSheet: Mesh;
  private readonly focusHeadlightBeamSheet: Mesh;
  private readonly headlightRoadSplash: Mesh;
  private readonly focusHeadlightRoadSplash: Mesh;
  private readonly headlightGlow: Sprite;
  private readonly focusHeadlightGlow: Sprite;
  private readonly beamTexture: CanvasTexture;
  private readonly splashTexture: CanvasTexture;
  private readonly glowTexture: CanvasTexture;
  private readonly baseRigOffset = new Vector3();
  private readonly baseModelPosition = new Vector3();
  private readonly baseModelRotation = new Vector3();
  private readonly baseSeatPivotPosition = new Vector3();
  private readonly baseCameraOffset = new Vector3();
  private readonly lookDownReveal = new Vector3();
  private readonly baseLatchPosition = new Vector3();
  private readonly baseHeadlightPosition = new Vector3();
  private readonly baseHeadlightTargetPosition = new Vector3();
  private loadedScene: Object3D | null = null;
  private time = 0;
  private hitShake = 0;
  private lastHitFlash = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const rig = this.config.vehicle.stage1Rig;
    const baseConeLength = Math.max(6, rig.headlightDistance * 0.9);
    const baseConeRadius = Math.max(
      1.8,
      Math.tan(MathUtils.degToRad(rig.headlightAngleDegrees)) * baseConeLength * 0.7,
    );
    const focusConeLength = Math.max(10, rig.focusHeadlightDistance * 0.92);
    const focusConeRadius = Math.max(
      1.2,
      Math.tan(MathUtils.degToRad(rig.focusHeadlightAngleDegrees)) * focusConeLength * 0.5,
    );
    const baseSplashWidth = Math.max(4.6, baseConeRadius * 2.4);
    const baseSplashLength = Math.max(7.2, baseConeLength * 0.72);
    const focusSplashWidth = Math.max(5.2, focusConeRadius * 2.8);
    const focusSplashLength = Math.max(11.5, focusConeLength * 0.62);

    this.beamTexture = this.createBeamTexture();
    this.splashTexture = this.createSplashTexture();
    this.glowTexture = this.createGlowTexture();

    this.vehicleRig.name = 'VehicleRig';
    this.obstructionShakeGroup.name = 'VehicleObstructionShake';
    this.vehicleSpace.name = 'VehicleSpace';
    this.modelRoot.name = 'VehicleModelRoot';
    this.seatPivot.name = 'VehicleSeatPivot';
    this.cameraYaw.name = 'VehicleCameraYaw';
    this.cameraPitch.name = 'VehicleCameraPitch';

    this.baseRigOffset.set(...rig.position);
    this.baseModelPosition.set(...rig.modelPosition);
    this.baseModelRotation.set(
      MathUtils.degToRad(rig.modelRotationDegrees[0]),
      MathUtils.degToRad(rig.modelRotationDegrees[1]),
      MathUtils.degToRad(rig.modelRotationDegrees[2]),
    );
    this.baseSeatPivotPosition.set(...rig.seatPivotPosition);
    this.baseCameraOffset.set(...rig.cameraOffset);
    this.lookDownReveal.set(...rig.lookDownReveal);
    this.baseLatchPosition.set(...rig.sidecarLatchPosition);
    this.baseHeadlightPosition.set(...rig.headlightPosition);
    this.baseHeadlightTargetPosition.set(...rig.headlightTargetPosition);

    this.headlightPivot.name = 'VehicleHeadlightPivot';
    this.headlightTarget.name = 'VehicleHeadlightTarget';
    this.headlight.color.setHex(rig.headlightColor);
    this.headlight.intensity = rig.headlightIntensity;
    this.headlight.distance = rig.headlightDistance;
    this.headlight.angle = MathUtils.degToRad(rig.headlightAngleDegrees);
    this.headlight.penumbra = rig.headlightPenumbra;
    this.headlight.decay = rig.headlightDecay;
    this.headlight.castShadow = false;
    this.focusHeadlight.color.setHex(rig.focusHeadlightColor);
    this.focusHeadlight.intensity = 0;
    this.focusHeadlight.distance = rig.focusHeadlightDistance;
    this.focusHeadlight.angle = MathUtils.degToRad(rig.focusHeadlightAngleDegrees);
    this.focusHeadlight.penumbra = rig.focusHeadlightPenumbra;
    this.focusHeadlight.decay = rig.focusHeadlightDecay;
    this.focusHeadlight.castShadow = false;
    this.headlightFill.color.setHex(rig.headlightFillColor);
    this.headlightFill.intensity = rig.headlightFillIntensity;
    this.headlightFill.distance = rig.headlightFillDistance;
    this.headlightFill.decay = 1.8;
    this.headlight.target = this.headlightTarget;
    this.focusHeadlight.target = this.headlightTarget;
    this.headlightCone = new Mesh(
      new ConeGeometry(baseConeRadius, baseConeLength, 18, 1, true),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.focusHeadlightCone = new Mesh(
      new ConeGeometry(focusConeRadius, focusConeLength, 20, 1, true),
      new MeshBasicMaterial({
        color: rig.focusHeadlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightBeamSheet = new Mesh(
      new PlaneGeometry(baseConeRadius * 1.8, baseConeLength),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0.42,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.focusHeadlightBeamSheet = new Mesh(
      new PlaneGeometry(focusConeRadius * 1.35, focusConeLength),
      new MeshBasicMaterial({
        color: rig.focusHeadlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightRoadSplash = new Mesh(
      new PlaneGeometry(baseSplashWidth, baseSplashLength),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.splashTexture,
        transparent: true,
        opacity: 0.48,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.focusHeadlightRoadSplash = new Mesh(
      new PlaneGeometry(focusSplashWidth, focusSplashLength),
      new MeshBasicMaterial({
        color: rig.focusHeadlightColor,
        map: this.splashTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightGlow = new Sprite(
      new SpriteMaterial({
        color: rig.headlightColor,
        map: this.glowTexture,
        transparent: true,
        opacity: 0.78,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.focusHeadlightGlow = new Sprite(
      new SpriteMaterial({
        color: rig.focusHeadlightColor,
        map: this.glowTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.headlightCone.rotation.x = -Math.PI * 0.5;
    this.focusHeadlightCone.rotation.x = -Math.PI * 0.5;
    this.headlightCone.position.z = -baseConeLength * 0.5;
    this.focusHeadlightCone.position.z = -focusConeLength * 0.5;
    this.headlightBeamSheet.rotation.x = -Math.PI * 0.5;
    this.focusHeadlightBeamSheet.rotation.x = -Math.PI * 0.5;
    this.headlightBeamSheet.position.set(0, -0.02, -baseConeLength * 0.48);
    this.focusHeadlightBeamSheet.position.set(0, 0.03, -focusConeLength * 0.5);
    this.headlightRoadSplash.rotation.x = -Math.PI * 0.5;
    this.focusHeadlightRoadSplash.rotation.x = -Math.PI * 0.5;
    this.headlightRoadSplash.position.set(0, -0.24, -baseSplashLength * 0.5);
    this.focusHeadlightRoadSplash.position.set(0, -0.235, -focusSplashLength * 0.52);
    this.headlightGlow.position.set(0, 0.01, -0.2);
    this.focusHeadlightGlow.position.set(0, 0.02, -0.22);
    this.headlightGlow.scale.setScalar(0.8);
    this.focusHeadlightGlow.scale.setScalar(1.2);
    this.headlightCone.renderOrder = 4;
    this.focusHeadlightCone.renderOrder = 4;
    this.headlightBeamSheet.renderOrder = 4;
    this.focusHeadlightBeamSheet.renderOrder = 4;
    this.headlightRoadSplash.renderOrder = 3;
    this.focusHeadlightRoadSplash.renderOrder = 3;
    this.headlightGlow.renderOrder = 5;
    this.focusHeadlightGlow.renderOrder = 5;
    this.headlightPivot.position.copy(this.baseHeadlightPosition);
    this.headlight.position.set(0, 0, 0);
    this.focusHeadlight.position.set(0, 0, -0.02);
    this.headlightFill.position.set(0, 0, -0.1);
    this.headlightTarget.position.copy(this.baseHeadlightTargetPosition);
    this.headlightPivot.add(
      this.headlightCone,
      this.focusHeadlightCone,
      this.headlightBeamSheet,
      this.focusHeadlightBeamSheet,
      this.headlightRoadSplash,
      this.focusHeadlightRoadSplash,
      this.headlightGlow,
      this.focusHeadlightGlow,
      this.headlight,
      this.focusHeadlight,
      this.headlightFill,
    );

    this.seatPivot.position.copy(this.baseSeatPivotPosition);
    this.cameraYaw.position.copy(this.baseCameraOffset);
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);

    this.vehicleSpace.add(
      this.modelRoot,
      this.seatPivot,
      this.sidecarLatchAnchor,
      this.headlightPivot,
      this.headlightTarget,
    );
    this.seatPivot.add(this.cameraYaw);
    this.cameraYaw.add(this.cameraPitch);
    this.obstructionShakeGroup.add(this.vehicleSpace);
    this.vehicleRig.add(this.obstructionShakeGroup);

    this.camera.parent?.add(this.vehicleRig);
    this.cameraPitch.add(this.camera);
    this.reset();
    void this.loadVehicleModel();
  }

  getCameraYawPivot(): Object3D {
    return this.cameraYaw;
  }

  getCameraPitchPivot(): Object3D {
    return this.cameraPitch;
  }

  getSidecarLatchAnchor(): Object3D {
    return this.sidecarLatchAnchor;
  }

  reset(): void {
    this.time = 0;
    this.hitShake = 0;
    this.lastHitFlash = 0;
    this.vehicleRig.position.set(0, 0, 0);
    this.vehicleRig.rotation.set(0, 0, 0);
    this.obstructionShakeGroup.position.set(0, 0, 0);
    this.obstructionShakeGroup.rotation.set(0, 0, 0);
    this.vehicleSpace.position.set(0, 0, 0);
    this.vehicleSpace.rotation.set(0, 0, 0);
    this.seatPivot.position.copy(this.baseSeatPivotPosition);
    this.seatPivot.rotation.set(0, 0, 0);
    this.cameraYaw.position.copy(this.baseCameraOffset);
    this.cameraYaw.rotation.set(0, 0, 0);
    this.cameraPitch.rotation.set(0, 0, 0);
    this.modelRoot.position.copy(this.baseModelPosition);
    this.modelRoot.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);
    this.sidecarLatchAnchor.rotation.set(0, 0, 0);
    this.headlightPivot.position.copy(this.baseHeadlightPosition);
    this.headlightPivot.rotation.set(0, 0, 0);
    this.headlightTarget.position.copy(this.baseHeadlightTargetPosition);
    this.headlight.intensity = this.config.vehicle.stage1Rig.headlightIntensity;
    this.focusHeadlight.intensity = 0;
    this.headlightFill.intensity = this.config.vehicle.stage1Rig.headlightFillIntensity;
    (this.headlightCone.material as MeshBasicMaterial).opacity = 0.18;
    (this.focusHeadlightCone.material as MeshBasicMaterial).opacity = 0;
    (this.headlightBeamSheet.material as MeshBasicMaterial).opacity = 0.42;
    (this.focusHeadlightBeamSheet.material as MeshBasicMaterial).opacity = 0;
    (this.headlightRoadSplash.material as MeshBasicMaterial).opacity = 0.48;
    (this.focusHeadlightRoadSplash.material as MeshBasicMaterial).opacity = 0;
    (this.headlightGlow.material as SpriteMaterial).opacity = 0.78;
    (this.focusHeadlightGlow.material as SpriteMaterial).opacity = 0;
    this.vehicleRig.visible = true;
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    turnAmount: number,
    hitFlash: number,
    gameState: GameStateType,
    ride: RideState | null = null,
  ): void {
    const rig = this.config.vehicle.stage1Rig;
    this.time += deltaTime;
    const running = gameState === 'running';
    const lookDown = MathUtils.clamp(this.cameraPitch.rotation.x, 0, MathUtils.degToRad(40));
    const lookDownAlpha = lookDown / MathUtils.degToRad(40);
    const turnSign = Math.abs(this.camera.rotation.z) > 0.001 ? -Math.sign(this.camera.rotation.z) : 0;
    const laneDirection = ride ? Math.sign(ride.targetLaneIndex - ride.laneIndex) : 0;
    const laneTravel = ride ? Math.sin(ride.laneChangeAlpha * Math.PI) : 0;
    const rideShake = ride?.cameraShake ?? 0;
    const latchShake = ride?.latchActive ? rig.latchShakeAmplitude : 0;
    const failureShake = (ride?.failureSeverity ?? 0) * rig.failureShakeAmplitude;
    const laneCutJolt = ride?.laneCutJolt ?? 0;
    const potholeJolt = ride?.potholeJolt ?? 0;
    const barrelJolt = ride?.barrelJolt ?? 0;

    this.vehicleRig.position.copy(playerPosition).add(this.baseRigOffset);

    if (hitFlash > this.lastHitFlash + 0.18) {
      this.hitShake = Math.min(
        1,
        this.hitShake + rig.damageShakeAmplitude + hitFlash * rig.damageShakeAmplitude,
      );
    }
    this.lastHitFlash = hitFlash;
    this.hitShake = approach(this.hitShake, 0, deltaTime * rig.damageShakeDecay);

    const swayAlpha = running ? 1 : 0.2;
    const swayX = Math.sin(this.time * rig.swayFrequency) * rig.swayAmplitude[0] * swayAlpha;
    const swayY =
      Math.cos(this.time * (rig.swayFrequency * 1.11)) * rig.swayAmplitude[1] * swayAlpha;
    const swayZ =
      Math.sin(this.time * (rig.swayFrequency * 0.75)) * rig.swayAmplitude[2] * swayAlpha;
    const vibration =
      Math.sin(this.time * rig.vibrationFrequency) * rig.vibrationAmplitude * swayAlpha;
    const turnShift = turnSign * turnAmount * rig.turnShift;
    const turnRoll = MathUtils.degToRad(rig.turnRollDegrees) * turnSign * turnAmount;
    const laneShift = laneDirection * laneTravel * rig.laneShift;
    const laneRoll = MathUtils.degToRad(rig.laneRollDegrees) * laneDirection * laneTravel;
    const cutOvershoot = laneDirection * laneCutJolt * 0.12;
    const wheelHop = Math.sin(this.time * 28) * potholeJolt * 0.08;
    const slamRoll = Math.sin(this.time * 20) * barrelJolt * 0.05;

    // The whole vehicle and seat move together as one ride space, so the model
    // feels seated/world-attached while the FPS weapon remains a separate child
    // of the camera itself.
    this.vehicleSpace.position.set(
      swayX + turnShift + vibration * 0.65 + laneShift + cutOvershoot,
      swayY + vibration * 0.45 + rideShake * 0.3 + wheelHop,
      swayZ,
    );
    this.vehicleSpace.rotation.set(
      vibration * 0.06 + rideShake * 0.18 + wheelHop * 0.4,
      -turnShift * 0.08 + laneShift * 0.18 + cutOvershoot * 0.45,
      turnRoll + laneRoll + vibration * 0.12 + slamRoll,
    );

    this.cameraYaw.position.set(
      this.baseCameraOffset.x + this.lookDownReveal.x * lookDownAlpha,
      this.baseCameraOffset.y + this.lookDownReveal.y * lookDownAlpha,
      this.baseCameraOffset.z + this.lookDownReveal.z * lookDownAlpha,
    );
    this.sidecarLatchAnchor.position.set(
      this.baseLatchPosition.x + laneShift * 0.6,
      this.baseLatchPosition.y + rideShake * 0.12,
      this.baseLatchPosition.z,
    );
    this.headlightPivot.position.set(
      this.baseHeadlightPosition.x + laneShift * 0.28,
      this.baseHeadlightPosition.y + rideShake * 0.22 + wheelHop * 0.45,
      this.baseHeadlightPosition.z,
    );
    this.headlightPivot.rotation.set(
      wheelHop * 0.55 + rideShake * 0.18,
      laneShift * 0.05 + cutOvershoot * 0.08,
      slamRoll * 0.2,
    );
    this.headlightTarget.position.set(
      this.baseHeadlightTargetPosition.x + laneShift * 0.34,
      this.baseHeadlightTargetPosition.y,
      this.baseHeadlightTargetPosition.z,
    );
    const headlightFailureDrop = 1 - Math.min(0.3, (ride?.failureSeverity ?? 0) * 0.16);
    const focusBeamAlpha =
      (ride?.focusBeamStrength ?? 0) * (ride?.focusBeamOverheated ? 0 : 1);
    this.headlight.intensity =
      rig.headlightIntensity * (running ? 1 : 0.86) * headlightFailureDrop;
    this.focusHeadlight.intensity =
      rig.focusHeadlightIntensity *
      focusBeamAlpha *
      (running ? 1 : 0.82) *
      headlightFailureDrop;
    this.headlightFill.intensity =
      rig.headlightFillIntensity * (running ? 1 : 0.82) * headlightFailureDrop;
    (this.headlightCone.material as MeshBasicMaterial).opacity =
      (running ? 0.22 : 0.16) * headlightFailureDrop;
    (this.focusHeadlightCone.material as MeshBasicMaterial).opacity =
      0.34 * focusBeamAlpha * headlightFailureDrop;
    (this.headlightBeamSheet.material as MeshBasicMaterial).opacity =
      (running ? 0.56 : 0.4) * headlightFailureDrop;
    (this.focusHeadlightBeamSheet.material as MeshBasicMaterial).opacity =
      0.72 * focusBeamAlpha * headlightFailureDrop;
    (this.headlightRoadSplash.material as MeshBasicMaterial).opacity =
      (running ? 0.62 : 0.46) * headlightFailureDrop;
    (this.focusHeadlightRoadSplash.material as MeshBasicMaterial).opacity =
      0.78 * focusBeamAlpha * headlightFailureDrop;
    (this.headlightGlow.material as SpriteMaterial).opacity =
      (running ? 0.88 : 0.68) * headlightFailureDrop;
    (this.focusHeadlightGlow.material as SpriteMaterial).opacity =
      0.86 * focusBeamAlpha * headlightFailureDrop;
    this.headlightGlow.scale.setScalar(0.8 + rideShake * 3.2);
    this.focusHeadlightGlow.scale.setScalar(1.1 + focusBeamAlpha * 0.75 + rideShake * 2.4);

    const shakeNoiseA = Math.sin(this.time * 42.0);
    const shakeNoiseB = Math.cos(this.time * 37.0);
    const shakeNoiseC = Math.sin(this.time * 29.0);
    const totalShake =
      this.hitShake +
      latchShake +
      failureShake +
      rideShake +
      potholeJolt * 0.04 +
      barrelJolt * 0.05;
    this.obstructionShakeGroup.position.set(
      shakeNoiseA * totalShake,
      shakeNoiseB * totalShake * 0.65,
      0,
    );
    this.obstructionShakeGroup.rotation.set(
      shakeNoiseB * totalShake * 0.18,
      shakeNoiseC * totalShake * 0.1,
      shakeNoiseA * totalShake * 0.2,
    );
  }

  destroy(): void {
    this.vehicleRig.removeFromParent();
    this.disposeObject(this.loadedScene);
  }

  private async loadVehicleModel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();

      try {
        const gltf = await loader.loadAsync(this.config.vehicle.stage1Rig.assetPath);
        this.mountModel(gltf.scene);
        return;
      } catch (primaryError) {
        console.warn('Failed to load textured sidecar GLB, trying fallback.', primaryError);
      }

      const fallback = await loader.loadAsync(this.config.vehicle.stage1Rig.fallbackAssetPath);
      this.mountModel(fallback.scene);
    } catch (error) {
      console.warn('Failed to load sidecar GLBs.', error);
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.modelRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.prepareModel(model);
    model.position.copy(this.baseModelPosition);
    model.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    model.scale.setScalar(this.config.vehicle.stage1Rig.modelScale);
    this.modelRoot.add(model);
    this.loadedScene = model;
  }

  private prepareModel(model: Object3D): void {
    model.traverse((object) => {
      object.frustumCulled = false;

      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 1;
      maybeMesh.castShadow = false;
      maybeMesh.receiveShadow = false;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = Math.max(litMaterial.roughness, 0.88);
        }
      }
    });
  }

  private disposeObject(root: Object3D | null): void {
    if (!root) {
      return;
    }

    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.geometry.dispose();
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        material.dispose();
      }
    });
  }

  private createBeamTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight beam texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';

    const outerGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    outerGradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    outerGradient.addColorStop(0.2, 'rgba(255,255,255,0.42)');
    outerGradient.addColorStop(0.58, 'rgba(255,255,255,0.14)');
    outerGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = outerGradient;
    context.beginPath();
    context.moveTo(canvas.width * 0.44, 0);
    context.quadraticCurveTo(canvas.width * 0.11, canvas.height * 0.26, canvas.width * 0.04, canvas.height);
    context.lineTo(canvas.width * 0.96, canvas.height);
    context.quadraticCurveTo(canvas.width * 0.89, canvas.height * 0.26, canvas.width * 0.56, 0);
    context.closePath();
    context.fill();

    const coreGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    coreGradient.addColorStop(0, 'rgba(255,255,255,1)');
    coreGradient.addColorStop(0.12, 'rgba(255,255,255,0.92)');
    coreGradient.addColorStop(0.4, 'rgba(255,255,255,0.26)');
    coreGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = coreGradient;
    context.beginPath();
    context.moveTo(canvas.width * 0.485, 0);
    context.quadraticCurveTo(canvas.width * 0.35, canvas.height * 0.18, canvas.width * 0.28, canvas.height);
    context.lineTo(canvas.width * 0.72, canvas.height);
    context.quadraticCurveTo(canvas.width * 0.65, canvas.height * 0.18, canvas.width * 0.515, 0);
    context.closePath();
    context.fill();

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createSplashTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight splash texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width * 0.5, canvas.height * 0.42);
    context.scale(1, 1.55);
    const gradient = context.createRadialGradient(0, 0, 18, 0, 0, 188);
    gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.74)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.24)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, 188, 0, Math.PI * 2);
    context.fill();
    context.setTransform(1, 0, 0, 1, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createGlowTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight glow texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 0.5,
      6,
      canvas.width * 0.5,
      canvas.height * 0.5,
      canvas.width * 0.5,
    );
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.52, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.5, 0, Math.PI * 2);
    context.fill();

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
}
