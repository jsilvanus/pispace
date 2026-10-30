import type { SpatialSceneManager } from './spatial-scene.js';
import type { CameraFreeDTelemetry, SpatialScene } from '../types.js';

export interface GatewayClientOptions {
  gatewayUrl: string;
  apiKey?: string | undefined;
  reconnectDelayMs?: number | undefined;
}

export class GatewayClient {
  private readonly gatewayUrl: string;
  private readonly apiKey?: string | undefined;
  private readonly sceneManager: SpatialSceneManager;
  private readonly reconnectDelayMs: number;
  private abortController: AbortController | null = null;
  private running = false;
  private scenePushDebounceTimer: NodeJS.Timeout | null = null;

  private readonly onSceneUpdated = (scene: SpatialScene) => {
    this.scheduleScenePush(scene);
  };

  private readonly onZoneEntered = (evt: {
    trackId: number;
    zoneId: string;
    zoneName: string;
    sourceCameraId: string;
    position?: { x: number; y: number; z: number } | undefined;
  }) => {
    this.pushZoneEvent({
      event: 'entered',
      ...evt,
      timestamp: new Date().toISOString(),
    });
  };

  private readonly onZoneLeft = (evt: {
    trackId: number;
    zoneId: string;
    zoneName: string;
    sourceCameraId: string;
  }) => {
    this.pushZoneEvent({
      event: 'left',
      ...evt,
      timestamp: new Date().toISOString(),
    });
  };

  constructor(sceneManager: SpatialSceneManager, options: GatewayClientOptions) {
    this.sceneManager = sceneManager;
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    // Attach outbound listeners to push spatial changes into PiGateway
    this.sceneManager.on('scene-updated', this.onSceneUpdated);
    this.sceneManager.on('subject-entered-zone', this.onZoneEntered);
    this.sceneManager.on('subject-left-zone', this.onZoneLeft);

    // Initial push of scene
    this.scheduleScenePush(this.sceneManager.getSnapshot());

    // Connect inbound SSE
    this.connectLoop();
  }

  public stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.scenePushDebounceTimer) {
      clearTimeout(this.scenePushDebounceTimer);
      this.scenePushDebounceTimer = null;
    }

    this.sceneManager.off('scene-updated', this.onSceneUpdated);
    this.sceneManager.off('subject-entered-zone', this.onZoneEntered);
    this.sceneManager.off('subject-left-zone', this.onZoneLeft);
  }

  private scheduleScenePush(scene: SpatialScene): void {
    if (!this.running) return;
    if (this.scenePushDebounceTimer) return;

    this.scenePushDebounceTimer = setTimeout(() => {
      this.scenePushDebounceTimer = null;
      this.pushSceneToGateway(scene);
    }, 100);
    this.scenePushDebounceTimer.unref();
  }

  public async pushSceneToGateway(scene: SpatialScene): Promise<void> {
    try {
      const url = `${this.gatewayUrl}/api/v1/spatial/scene`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(scene),
      });
    } catch {
      // Gateway may be offline or starting up; will retry on next change
    }
  }

  public async pushZoneEvent(evt: {
    event: 'entered' | 'left';
    trackId: number;
    zoneId: string;
    zoneName: string;
    sourceCameraId: string;
    position?: { x: number; y: number; z: number } | undefined;
    timestamp: string;
  }): Promise<void> {
    try {
      const url = `${this.gatewayUrl}/api/v1/spatial/events`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(evt),
      });
    } catch {
      // Gateway offline
    }
  }

  private async connectLoop(): Promise<void> {
    while (this.running) {
      try {
        this.abortController = new AbortController();
        const eventsUrl = `${this.gatewayUrl}/api/v1/events`;

        const res = await fetch(eventsUrl, {
          signal: this.abortController.signal,
          headers: { Accept: 'text/event-stream' },
        });

        if (!res.ok || !res.body) {
          throw new Error(`Failed to connect to gateway SSE: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (this.running) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const rawData = trimmed.slice(5).trim();
              this.handleGatewayEvent(rawData);
            }
          }
        }
      } catch (err: unknown) {
        if (!this.running) break;
        // Wait and reconnect
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
      }
    }
  }

  private handleGatewayEvent(rawData: string): void {
    try {
      const evt = JSON.parse(rawData);
      if (!evt || typeof evt !== 'object') return;

      if (evt.type === 'freed' && evt.data) {
        this.sceneManager.updateFreed(evt.data as CameraFreeDTelemetry);
      } else if (evt.type === 'perception' && evt.data) {
        const { cameraId, objects } = evt.data;
        if (cameraId && Array.isArray(objects)) {
          this.sceneManager.updateDetections(cameraId, objects);
        }
      }
    } catch {
      // Ignore unparseable frames
    }
  }
}
