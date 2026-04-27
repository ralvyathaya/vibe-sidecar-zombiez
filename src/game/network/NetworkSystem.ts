import type {
  CoopRole,
  CoopSessionState,
  CoopSnapshot,
  ControlProfile,
  GameplayRole,
  RemoteInputFrame,
} from '../../core/types';

type RelayEnvelope =
  | { type: 'created'; roomCode: string; role: CoopRole; seed: number }
  | { type: 'joined'; roomCode: string; role: CoopRole; peerRole?: GameplayRole | null; seed: number }
  | { type: 'peerJoined'; role: CoopRole }
  | { type: 'peerLeft' }
  | { type: 'input'; frame: RemoteInputFrame }
  | { type: 'snapshot'; snapshot: CoopSnapshot }
  | { type: 'control'; action: 'start' | 'retry'; seed: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

type OutgoingRelayMessage =
  | { type: 'create'; role: CoopRole }
  | { type: 'join'; roomCode: string; role: CoopRole }
  | { type: 'input'; frame: RemoteInputFrame }
  | { type: 'snapshot'; snapshot: CoopSnapshot }
  | { type: 'control'; action: 'start' | 'retry'; seed: number }
  | { type: 'ping' };

const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,6}$/;

export class NetworkSystem {
  onSessionChange?: (session: CoopSessionState) => void;
  onRemoteInput?: (frame: RemoteInputFrame) => void;
  onRemoteSnapshot?: (snapshot: CoopSnapshot) => void;
  onRemoteStart?: (seed: number) => void;
  onRemoteRetry?: (seed: number) => void;

  private socket: WebSocket | null = null;
  private pingTimer = 0;
  private session: CoopSessionState = {
    role: 'solo',
    selectedRole: 'gunner',
    isHost: false,
    activeProfile: 'legacyGunner',
    connection: 'offline',
    roomCode: '',
    peerConnected: false,
    peerRole: null,
    canStartRun: true,
    statusText: 'Solo with bot fallback',
    relayUrl: this.resolveRelayUrl(),
  };

  getSession(): CoopSessionState {
    return { ...this.session };
  }

  selectRole(role: GameplayRole): void {
    this.setSession({
      selectedRole: role,
      activeProfile: this.resolveActiveProfile(this.session.role, role),
    });
  }

  async createRoom(role: GameplayRole = 'driver'): Promise<void> {
    this.setSession({
      role,
      selectedRole: role,
      isHost: false,
      activeProfile: this.profileForOnlineRole(role),
      connection: 'connecting',
      roomCode: '',
      peerConnected: false,
      peerRole: null,
      canStartRun: false,
      statusText: 'Creating online room...',
    });
    await this.connect();
    this.send({ type: 'create', role });
  }

  async joinRoom(roomCode: string, role: GameplayRole = 'gunner'): Promise<void> {
    const normalizedCode = roomCode.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(normalizedCode)) {
      this.setSession({
        role,
        selectedRole: role,
        isHost: false,
        activeProfile: this.profileForOnlineRole(role),
        connection: 'error',
        roomCode: normalizedCode,
        peerConnected: false,
        peerRole: null,
        canStartRun: false,
        statusText: 'Room code must be 4-6 letters/numbers.',
      });
      return;
    }

    this.setSession({
      role,
      selectedRole: role,
      isHost: false,
      activeProfile: this.profileForOnlineRole(role),
      connection: 'connecting',
      roomCode: normalizedCode,
      peerConnected: false,
      peerRole: null,
      canStartRun: false,
      statusText: `Joining room ${normalizedCode}...`,
    });
    await this.connect();
    this.send({ type: 'join', roomCode: normalizedCode, role });
  }

  startSolo(): void {
    this.disconnect();
    this.setSession({
      role: 'solo',
      selectedRole: 'gunner',
      isHost: false,
      activeProfile: 'legacyGunner',
      connection: 'fallback',
      roomCode: '',
      peerConnected: false,
      peerRole: null,
      canStartRun: true,
      statusText: 'Solo with bot fallback',
    });
  }

  startDebugProfile(profile: ControlProfile): void {
    this.disconnect(false);
    const role = profile === 'driver' ? 'driver' : profile === 'coopGunner' ? 'gunner' : 'solo';
    this.setSession({
      role,
      selectedRole: profile === 'driver' ? 'driver' : 'gunner',
      isHost: false,
      activeProfile: profile,
      connection: 'fallback',
      roomCode: '',
      peerConnected: false,
      peerRole: null,
      canStartRun: true,
      statusText: `Debug local profile: ${profile}`,
    });
  }

  update(deltaTime: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.pingTimer = Math.max(0, this.pingTimer - deltaTime);
    if (this.pingTimer > 0) {
      return;
    }

    this.pingTimer = 8;
    this.send({ type: 'ping' });
  }

  sendInput(frame: RemoteInputFrame): void {
    if (!this.canSendRealtime()) {
      return;
    }

    this.send({ type: 'input', frame });
  }

  sendSnapshot(snapshot: CoopSnapshot): void {
    if (!this.canSendRealtime()) {
      return;
    }

    this.send({ type: 'snapshot', snapshot });
  }

  sendStart(seed: number): void {
    if (!this.canSendRealtime() || !this.session.canStartRun) {
      return;
    }

    this.send({ type: 'control', action: 'start', seed });
  }

  sendRetry(seed: number): void {
    if (!this.canSendRealtime() || !this.session.canStartRun) {
      return;
    }

    this.send({ type: 'control', action: 'retry', seed });
  }

  destroy(): void {
    this.disconnect();
  }

  private async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.disconnect(false);
    await new Promise<void>((resolve) => {
      try {
        const socket = new WebSocket(this.session.relayUrl);
        this.socket = socket;
        socket.addEventListener('open', () => {
          this.pingTimer = 1;
          resolve();
        }, { once: true });
        socket.addEventListener('message', (event) => {
          this.handleMessage(event.data);
        });
        socket.addEventListener('close', () => {
          this.socket = null;
          this.setSession({
            connection: this.session.connection === 'offline' ? 'offline' : 'fallback',
            peerConnected: false,
            peerRole: null,
            canStartRun: true,
            statusText: 'Relay disconnected. Continuing with bot fallback.',
          });
        });
        socket.addEventListener('error', () => {
          this.socket = null;
          this.setSession({
            connection: 'fallback',
            peerConnected: false,
            peerRole: null,
            canStartRun: true,
            statusText: 'Relay unavailable. Continuing with bot fallback.',
          });
          resolve();
        }, { once: true });
      } catch {
        this.setSession({
          connection: 'fallback',
          peerConnected: false,
          peerRole: null,
          canStartRun: true,
          statusText: 'Relay unavailable. Continuing with bot fallback.',
        });
        resolve();
      }
    });
  }

  private disconnect(updateSession = true): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.pingTimer = 0;
    if (updateSession) {
      this.setSession({
        role: 'solo',
        selectedRole: 'gunner',
        isHost: false,
        activeProfile: 'legacyGunner',
        connection: 'offline',
        roomCode: '',
        peerConnected: false,
        peerRole: null,
        canStartRun: true,
        statusText: 'Solo with bot fallback',
      });
    }
  }

  private handleMessage(rawData: unknown): void {
    let message: RelayEnvelope;
    try {
      message = JSON.parse(String(rawData)) as RelayEnvelope;
    } catch {
      return;
    }

    switch (message.type) {
      case 'created':
        this.setSession({
          role: message.role,
          selectedRole: message.role === 'driver' ? 'driver' : 'gunner',
          isHost: true,
          activeProfile: this.profileForOnlineRole(message.role === 'driver' ? 'driver' : 'gunner'),
          connection: 'hosting',
          roomCode: message.roomCode,
          peerConnected: false,
          peerRole: null,
          canStartRun: false,
          statusText: `Lobby ${message.roomCode}. Share the code and wait for the empty slot.`,
        });
        break;
      case 'joined':
        this.setSession({
          role: message.role,
          selectedRole: message.role === 'driver' ? 'driver' : 'gunner',
          isHost: false,
          activeProfile: this.profileForOnlineRole(message.role === 'driver' ? 'driver' : 'gunner'),
          connection: 'joined',
          roomCode: message.roomCode,
          peerConnected: true,
          peerRole: message.peerRole ?? null,
          canStartRun: false,
          statusText: `Joined lobby ${message.roomCode}. Room owner starts the run.`,
        });
        break;
      case 'peerJoined':
        this.setSession({
          connection: 'connected',
          peerConnected: true,
          peerRole: message.role === 'driver' ? 'driver' : 'gunner',
          canStartRun: this.session.isHost,
          statusText: `${this.session.roomCode || 'Room'} ready. Both seats are filled.`,
        });
        break;
      case 'peerLeft':
        this.setSession({
          connection: 'fallback',
          peerConnected: false,
          peerRole: null,
          canStartRun: true,
          statusText: 'Partner left. Bot fallback is active.',
        });
        break;
      case 'input':
        this.onRemoteInput?.(message.frame);
        break;
      case 'snapshot':
        this.onRemoteSnapshot?.(message.snapshot);
        break;
      case 'control':
        if (message.action === 'retry') {
          this.onRemoteRetry?.(message.seed);
        } else {
          this.onRemoteStart?.(message.seed);
        }
        break;
      case 'error':
        this.setSession({
          connection: 'error',
          peerConnected: false,
          peerRole: null,
          canStartRun: false,
          statusText: message.message,
        });
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  private send(message: OutgoingRelayMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private canSendRealtime(): boolean {
    return Boolean(
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this.session.role !== 'solo' &&
      this.session.connection !== 'offline' &&
      this.session.connection !== 'error',
    );
  }

  private setSession(next: Partial<CoopSessionState>): void {
    this.session = {
      ...this.session,
      ...next,
    };
    this.onSessionChange?.(this.getSession());
  }

  private resolveActiveProfile(role: CoopRole, selectedRole: GameplayRole): ControlProfile {
    if (role === 'solo') {
      return 'legacyGunner';
    }

    return this.profileForOnlineRole(selectedRole);
  }

  private profileForOnlineRole(role: GameplayRole): ControlProfile {
    return role === 'driver' ? 'driver' : 'coopGunner';
  }

  private resolveRelayUrl(): string {
    const envUrl = import.meta.env.VITE_COOP_WS_URL as string | undefined;
    if (envUrl) {
      return envUrl;
    }

    const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    if (isLocalhost) {
      return 'ws://localhost:8787';
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/coop`;
  }
}
