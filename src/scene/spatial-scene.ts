import { EventEmitter } from 'node:events';
import type {
  VenueModel,
  SpatialScene,
  CameraSpatialState,
  CameraFreeDTelemetry,
  Subject3D,
  BoundingBox2D,
} from '../types.js';
import {
  getCameraWorldPose,
  computeCameraFrustum,
  projectBoundingBoxToFloor,
} from '../camera/projection.js';
import { findZoneAtPoint } from '../venue/model.js';

export interface SpatialSceneOptions {
  venue: VenueModel;
  subjectStaleMs?: number | undefined;
}

export class SpatialSceneManager extends EventEmitter {
  public readonly venue: VenueModel;
  private readonly cameras = new Map<string, CameraSpatialState>();
  private readonly subjects = new Map<string, Subject3D>();
  private readonly subjectStaleMs: number;
  private sweeperInterval: NodeJS.Timeout | null = null;

  constructor(options: SpatialSceneOptions) {
    super();
    this.venue = options.venue;
    this.subjectStaleMs = options.subjectStaleMs ?? 5000;

    // Initialize configured cameras
    for (const [id, mount] of Object.entries(this.venue.cameras)) {
      this.cameras.set(id, {
        id,
        mount,
        telemetry: null,
        frustum: null,
        isStreaming: false,
        onAir: false,
      });
    }

    this.startSweeper();
  }

  public stop(): void {
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
      this.sweeperInterval = null;
    }
  }

  private startSweeper(): void {
    this.sweeperInterval = setInterval(() => {
      this.sweepStaleSubjects();
    }, 1000);
    this.sweeperInterval.unref();
  }

  private sweepStaleSubjects(): void {
    const now = Date.now();
    let changed = false;

    for (const [key, subject] of this.subjects.entries()) {
      const age = now - new Date(subject.lastSeenAt).getTime();
      if (age > this.subjectStaleMs) {
        this.subjects.delete(key);
        changed = true;
        this.emit('subject-left-zone', {
          trackId: subject.trackId,
          zoneId: subject.zoneId,
          zoneName: subject.zoneName,
          sourceCameraId: subject.sourceCameraId,
        });
      }
    }

    if (changed) {
      this.emit('scene-updated', this.getSnapshot());
    }
  }

  public updateFreed(telemetry: CameraFreeDTelemetry): void {
    // FreeD camId is typically 1, 2, etc. Map to string ID (cam1, cam2)
    const cameraId = `cam${telemetry.camId}`;
    const cam = this.cameras.get(cameraId);
    if (!cam) return;

    cam.telemetry = telemetry;
    const pose = getCameraWorldPose(cam.mount, telemetry);
    cam.frustum = computeCameraFrustum(pose, 0.4);

    // Check if camera optical axis intersects a venue zone
    if (cam.frustum.targetIntersection) {
      const zone = findZoneAtPoint(this.venue, cam.frustum.targetIntersection);
      cam.frustum.activeZoneId = zone?.id ?? null;
    }

    this.emit('camera-updated', cam);
    this.emit('scene-updated', this.getSnapshot());
  }

  public updateDetections(
    cameraId: string,
    detections: Array<{
      trackId: number;
      bbox: BoundingBox2D;
      label?: string | undefined;
      confidence?: number | undefined;
    }>
  ): Subject3D[] {
    const cam = this.cameras.get(cameraId);
    if (!cam) return [];

    const pose = getCameraWorldPose(cam.mount, cam.telemetry);
    const updatedSubjects: Subject3D[] = [];
    const nowIso = new Date().toISOString();

    for (const det of detections) {
      // Test candidate floor elevations (e.g. pulpit 1.3m, chancel 0.4m, nave 0.0m)
      const candidateElevations = [1.3, 0.4, 0.0];
      let bestSubject: Subject3D | null = null;

      for (const elev of candidateElevations) {
        const proj = projectBoundingBoxToFloor(pose, det.bbox, elev);
        if (!proj) continue;

        const zone = findZoneAtPoint(this.venue, proj.standingPosition);
        if (zone) {
          bestSubject = {
            trackId: det.trackId,
            sourceCameraId: cameraId,
            position: {
              x: Math.round(proj.standingPosition.x * 100) / 100,
              y: Math.round(proj.standingPosition.y * 100) / 100,
              z: elev,
            },
            headHeight: Math.round((proj.headRay.origin.z + 1.8) * 100) / 100,
            zoneId: zone.id,
            zoneName: zone.name,
            confidence: det.confidence ?? 0.8,
            label: det.label ?? 'person',
            lastSeenAt: nowIso,
          };
          break; // Found matching zone
        }
      }

      // If outside recognized zones, fall back to nave floor 0.0
      if (!bestSubject) {
        const proj = projectBoundingBoxToFloor(pose, det.bbox, 0.0);
        if (proj) {
          bestSubject = {
            trackId: det.trackId,
            sourceCameraId: cameraId,
            position: {
              x: Math.round(proj.standingPosition.x * 100) / 100,
              y: Math.round(proj.standingPosition.y * 100) / 100,
              z: 0.0,
            },
            headHeight: 1.8,
            zoneId: null,
            zoneName: null,
            confidence: det.confidence ?? 0.5,
            label: det.label ?? 'person',
            lastSeenAt: nowIso,
          };
        }
      }

      if (bestSubject) {
        const subjectKey = `${cameraId}_${det.trackId}`;
        const previous = this.subjects.get(subjectKey);

        this.subjects.set(subjectKey, bestSubject);
        updatedSubjects.push(bestSubject);

        // Detect zone entry / change
        if (previous?.zoneId !== bestSubject.zoneId) {
          if (previous?.zoneId) {
            this.emit('subject-left-zone', {
              trackId: det.trackId,
              zoneId: previous.zoneId,
              zoneName: previous.zoneName,
              sourceCameraId: cameraId,
            });
          }
          if (bestSubject.zoneId) {
            this.emit('subject-entered-zone', {
              trackId: det.trackId,
              zoneId: bestSubject.zoneId,
              zoneName: bestSubject.zoneName,
              sourceCameraId: cameraId,
              position: bestSubject.position,
            });
          }
        }
      }
    }

    if (updatedSubjects.length > 0) {
      this.emit('scene-updated', this.getSnapshot());
    }

    return updatedSubjects;
  }

  public getSnapshot(): SpatialScene {
    const activeZonesSet = new Set<string>();
    const subjectsList = Array.from(this.subjects.values());

    for (const sub of subjectsList) {
      if (sub.zoneId) {
        activeZonesSet.add(sub.zoneId);
      }
    }

    const camerasRecord: Record<string, CameraSpatialState> = {};
    for (const [id, cam] of this.cameras.entries()) {
      camerasRecord[id] = { ...cam };
    }

    return {
      updatedAt: new Date().toISOString(),
      cameras: camerasRecord,
      subjects: subjectsList,
      activeZones: Array.from(activeZonesSet),
    };
  }
}
