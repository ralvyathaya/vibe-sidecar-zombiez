import { Vector3 } from 'three';
import { GAME_CONFIG } from '../core/config';
import { GameLoop } from '../core/GameLoop';
import { RendererSystem } from '../core/Renderer';
import type { GameStateType } from '../core/types';
import { UISystem } from '../ui/UISystem';
import { EnemySystem } from './systems/EnemySystem';
import { InputSystem } from './systems/InputSystem';
import { PlayerSystem } from './systems/PlayerSystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { WeaponSystem } from './systems/WeaponSystem';
import { WorldSystem } from './systems/WorldSystem';

export class Game {
  private readonly shell = document.createElement('div');
  private readonly rendererSystem: RendererSystem;
  private readonly inputSystem: InputSystem;
  private readonly playerSystem: PlayerSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly enemySystem: EnemySystem;
  private readonly spawnSystem: SpawnSystem;
  private readonly worldSystem: WorldSystem;
  private readonly uiSystem: UISystem;
  private readonly gameLoop: GameLoop;
  private readonly playerPosition = new Vector3();
  private readonly playerForward = new Vector3();

  private state: GameStateType = 'menu';
  private suppressUnlockPause = false;

  constructor(root: HTMLElement) {
    this.shell.className = 'game-shell';
    root.append(this.shell);

    this.rendererSystem = new RendererSystem(this.shell, GAME_CONFIG);
    this.inputSystem = new InputSystem(this.rendererSystem.renderer.domElement);
    this.playerSystem = new PlayerSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.rendererSystem.scene.add(this.rendererSystem.camera);

    this.worldSystem = new WorldSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.enemySystem = new EnemySystem(this.rendererSystem.scene, GAME_CONFIG);
    this.weaponSystem = new WeaponSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.spawnSystem = new SpawnSystem(GAME_CONFIG);
    this.uiSystem = new UISystem(root);
    this.gameLoop = new GameLoop(
      (deltaTime) => this.update(deltaTime),
      () => this.rendererSystem.render(),
    );

    this.inputSystem.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'running' && !this.suppressUnlockPause) {
        this.setState('paused');
      }

      if (this.suppressUnlockPause) {
        this.suppressUnlockPause = false;
      }
    };

    this.uiSystem.onPrimaryAction = () => {
      if (this.state === 'menu' || this.state === 'dead') {
        this.resetGame();
      }

      this.inputSystem.clearTransientInput();
      this.setState('running');
      this.inputSystem.requestPointerLock();
    };

    this.resetGame();
    this.setState('menu');
  }

  start(): void {
    this.gameLoop.start();
  }

  destroy(): void {
    this.gameLoop.stop();
    this.inputSystem.destroy();
    this.weaponSystem.destroy();
    this.rendererSystem.destroy();
  }

  private update(deltaTime: number): void {
    if (this.state === 'running') {
      this.playerSystem.updateRunning(deltaTime, this.inputSystem);
      this.spawnSystem.update(deltaTime, this.enemySystem);
      this.enemySystem.update(
        deltaTime,
        this.playerSystem.getPosition(this.playerPosition),
        GAME_CONFIG.player.forwardSpeed,
        (damage, sourceX) => {
          this.playerSystem.applyDamage(damage, sourceX);
        },
      );
      this.weaponSystem.updateRunning(
        deltaTime,
        this.inputSystem,
        this.playerSystem,
        this.enemySystem,
      );

      const obstacleDamage = this.worldSystem.update(
        deltaTime,
        this.playerSystem.state.strafeX,
      );
      if (obstacleDamage > 0) {
        this.playerSystem.applyDamage(obstacleDamage);
      }

      if (!this.playerSystem.state.alive) {
        this.handleDeath();
      }
    } else {
      this.playerSystem.updateIdle(deltaTime);
      this.weaponSystem.updateIdle(deltaTime);
    }

    this.uiSystem.update({
      gameState: this.state,
      player: this.playerSystem.state,
      weapon: this.weaponSystem.getStatus(this.playerSystem),
      elapsedSeconds: this.spawnSystem.elapsedSeconds,
      radarContacts: this.enemySystem.getRadarContacts(
        this.playerSystem.getPosition(this.playerPosition),
        this.playerSystem.getFacingDirection(this.playerForward),
      ),
    });
  }

  private handleDeath(): void {
    if (this.state === 'dead') {
      return;
    }

    this.setState('dead');
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }
  }

  private resetGame(): void {
    this.playerSystem.reset();
    this.weaponSystem.reset(this.playerSystem);
    this.enemySystem.reset();
    this.spawnSystem.reset();
    this.worldSystem.reset();
  }

  private setState(nextState: GameStateType): void {
    this.state = nextState;
    this.uiSystem.setState(nextState);
  }
}
