import type { SpatialSceneManager } from './spatial-scene.js';
import type { CameraFreeDTelemetry } from '../types.js';

export interface GatewayClientOptions {
  gatewayUrl: string;
  reconnectDelayMs?: number | undefined;
}

export class GatewayClient {
  private readonly gatewayUrl: string;
  private readonly sceneManager: SpatialSceneManager;
  private readonly reconnectDelayMs: number;
  private abortController: AbortController | null = null;
  private running = false;

  constructor(sceneManager: SpatialSceneManager, options: GatewayClientOptions) {
    this.sceneManager = sceneManager;
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.connectLoop();
  }

  public stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
