import fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { SpatialSceneManager } from './scene/spatial-scene.js';
import type { BoundingBox2D, Point3D, ShotType } from './types.js';
import { getZoneById, getZoneTargetPoint } from './venue/model.js';
import { solvePtzForTarget } from './camera/solver.js';
import { getCameraWorldPose, projectBoundingBoxToFloor } from './camera/projection.js';
import { findZoneAtPoint } from './venue/model.js';

export function createServer(
  sceneManager: SpatialSceneManager,
  config: AppConfig
): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  // Health check
  app.get('/health', async () => {
    return { ok: true, service: 'pispace', version: '0.1.0' };
  });

  // Current venue model (geometry, dimensions, cameras, zones)
  app.get('/api/v1/venue', async () => {
    return sceneManager.venue;
  });

  // Current live scene
  app.get('/api/v1/scene', async () => {
    return sceneManager.getSnapshot();
  });

  // Venue spatial zones list
  app.get('/api/v1/zones', async () => {
    return sceneManager.venue.zones.map((z) => ({
      ...z,
      targetPoint: getZoneTargetPoint(z),
    }));
  });

  // Specific zone
  app.get<{ Params: { zoneId: string } }>('/api/v1/zones/:zoneId', async (req, reply) => {
    const zone = getZoneById(sceneManager.venue, req.params.zoneId);
    if (!zone) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    return {
      ...zone,
      targetPoint: getZoneTargetPoint(zone),
    };
  });

  // Push FreeD telemetry directly
  app.post<{
    Body: {
      camId: number;
      pan: number;
      tilt: number;
      roll: number;
      zoom: number;
      focus?: number | undefined;
    };
  }>('/api/v1/freed', async (req, reply) => {
    const { camId, pan, tilt, roll, zoom, focus } = req.body ?? {};
    if (camId == null || pan == null || tilt == null || zoom == null) {
      return reply.code(400).send({ error: 'Missing required FreeD fields' });
    }
    sceneManager.updateFreed({
      camId,
      pan,
      tilt,
      roll: roll ?? 0,
      zoom,
      focus,
      receivedAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  // Push 2D perception detections directly
  app.post<{
    Body: {
      cameraId: string;
      objects: Array<{
        trackId: number;
        bbox: BoundingBox2D;
        label?: string | undefined;
        confidence?: number | undefined;
      }>;
    };
  }>('/api/v1/perception', async (req, reply) => {
    const { cameraId, objects } = req.body ?? {};
    if (!cameraId || !Array.isArray(objects)) {
      return reply.code(400).send({ error: 'Missing cameraId or objects array' });
    }
    const updated = sceneManager.updateDetections(cameraId, objects);
    return { ok: true, count: updated.length, subjects: updated };
  });

  // Project a 2D bounding box to 3D world coordinates
  app.post<{
    Body: {
      cameraId: string;
      bbox: BoundingBox2D;
      stageHeightMeters?: number | undefined;
    };
  }>('/api/v1/project', async (req, reply) => {
    const { cameraId, bbox, stageHeightMeters = 0.4 } = req.body ?? {};
    const cam = sceneManager.getSnapshot().cameras[cameraId];
    if (!cam) {
      return reply.code(404).send({ error: `Camera ${cameraId} not found` });
    }

    const pose = getCameraWorldPose(cam.mount, cam.telemetry);
    const proj = projectBoundingBoxToFloor(pose, bbox, stageHeightMeters);
    if (!proj) {
      return reply.code(422).send({ error: 'Ray does not intersect plane or points away' });
    }

    const zone = findZoneAtPoint(sceneManager.venue, proj.standingPosition);

    return {
      standingPosition: proj.standingPosition,
      zone: zone ? { id: zone.id, name: zone.name } : null,
      opticalPose: {
        panDeg: pose.panDeg,
        tiltDeg: pose.tiltDeg,
        hfovDeg: pose.hfovDeg,
      },
    };
  });

  // Inverse solver: Target -> Required Pan, Tilt, Zoom
  app.post<{
    Body: {
      cameraId: string;
      target: { x: number; y: number; z: number } | { zoneId: string };
      shotType?: ShotType | undefined;
    };
  }>('/api/v1/solve-ptz', async (req, reply) => {
    const { cameraId, target, shotType = 'medium' } = req.body ?? {};
    const cam = sceneManager.venue.cameras[cameraId];
    if (!cam) {
      return reply.code(404).send({ error: `Camera ${cameraId} not found in venue model` });
    }

    let targetPoint: Point3D;
    let targetZoneId: string | null = null;

    if ('zoneId' in target) {
      const zone = getZoneById(sceneManager.venue, target.zoneId);
      if (!zone) {
        return reply.code(404).send({ error: `Zone ${target.zoneId} not found` });
      }
      targetPoint = getZoneTargetPoint(zone);
      targetZoneId = zone.id;
    } else if ('x' in target && 'y' in target && 'z' in target) {
      targetPoint = target;
    } else {
      return reply.code(400).send({ error: 'Invalid target specification' });
    }

    const solution = solvePtzForTarget(cam, targetPoint, { shotType, targetZoneId });
    return solution;
  });

  // Server-Sent Events (SSE) stream for live spatial changes
  app.get('/api/v1/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    // Send initial scene snapshot
    reply.raw.write(`event: scene\ndata: ${JSON.stringify(sceneManager.getSnapshot())}\n\n`);

    const onSceneUpdated = (scene: unknown) => {
      reply.raw.write(`event: scene\ndata: ${JSON.stringify(scene)}\n\n`);
    };

    const onZoneEntered = (evt: unknown) => {
      reply.raw.write(`event: subject-entered-zone\ndata: ${JSON.stringify(evt)}\n\n`);
    };

    const onZoneLeft = (evt: unknown) => {
      reply.raw.write(`event: subject-left-zone\ndata: ${JSON.stringify(evt)}\n\n`);
    };

    sceneManager.on('scene-updated', onSceneUpdated);
    sceneManager.on('subject-entered-zone', onZoneEntered);
    sceneManager.on('subject-left-zone', onZoneLeft);

    req.raw.on('close', () => {
      sceneManager.off('scene-updated', onSceneUpdated);
      sceneManager.off('subject-entered-zone', onZoneEntered);
      sceneManager.off('subject-left-zone', onZoneLeft);
    });
  });

  return app;
}
