import fs from 'node:fs';
import path from 'node:path';
import fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { SpatialSceneManager } from './scene/spatial-scene.js';
import type { BoundingBox2D, Point3D, ShotType } from './types.js';
import { getZoneById, getZoneTargetPoint } from './venue/model.js';
import { solvePtzForTarget } from './camera/solver.js';
import { getCameraWorldPose, projectBoundingBoxToFloor, triangulateCameras } from './camera/projection.js';
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

  // 3D Occluders list for broadcast AR keymasking
  app.get('/api/v1/occluders', async () => {
    return sceneManager.venue.occluders ?? [];
  });

  // Specific 3D occluder
  app.get<{ Params: { id: string } }>('/api/v1/occluders/:id', async (req, reply) => {
    const occluder = (sceneManager.venue.occluders ?? []).find((o) => o.id === req.params.id);
    if (!occluder) {
      return reply.code(404).send({ error: 'Occluder not found' });
    }
    return occluder;
  });

  // Serve 3D model assets (.glb / .gltf)
  app.get<{ Params: { filename: string } }>('/models/:filename', async (req, reply) => {
    const filename = path.basename(req.params.filename);
    const modelPath = path.resolve('models', filename);

    if (!fs.existsSync(modelPath)) {
      return reply.code(404).send({ error: `3D model ${filename} not found` });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.glb' ? 'model/gltf-binary' : ext === '.gltf' ? 'model/gltf+json' : 'application/octet-stream';

    reply.header('Content-Type', contentType);
    reply.header('Access-Control-Allow-Origin', '*');
    const stream = fs.createReadStream(modelPath);
    return reply.send(stream);
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

  // Triangulation: Intersect rays from 2 cameras (optical theodolite / FreeD survey)
  app.post<{
    Body: {
      cam1: {
        cameraId: string;
        pan?: number | undefined;
        panDeg?: number | undefined;
        tilt?: number | undefined;
        tiltDeg?: number | undefined;
        zoom?: number | undefined;
        u?: number | undefined;
        v?: number | undefined;
      };
      cam2: {
        cameraId: string;
        pan?: number | undefined;
        panDeg?: number | undefined;
        tilt?: number | undefined;
        tiltDeg?: number | undefined;
        zoom?: number | undefined;
        u?: number | undefined;
        v?: number | undefined;
      };
    };
  }>('/api/v1/triangulate', async (req, reply) => {
    const { cam1: cam1Input, cam2: cam2Input } = req.body ?? {};
    if (!cam1Input?.cameraId || !cam2Input?.cameraId) {
      return reply.code(400).send({ error: 'Missing cam1.cameraId or cam2.cameraId' });
    }

    const snapshot = sceneManager.getSnapshot();
    const cam1 = snapshot.cameras[cam1Input.cameraId];
    const cam2 = snapshot.cameras[cam2Input.cameraId];

    if (!cam1) {
      return reply.code(404).send({ error: `Camera ${cam1Input.cameraId} not found` });
    }
    if (!cam2) {
      return reply.code(404).send({ error: `Camera ${cam2Input.cameraId} not found` });
    }

    const tel1 = {
      camId: cam1.telemetry?.camId ?? 1,
      pan: cam1Input.pan ?? cam1Input.panDeg ?? cam1.telemetry?.pan ?? 0,
      tilt: cam1Input.tilt ?? cam1Input.tiltDeg ?? cam1.telemetry?.tilt ?? 0,
      roll: cam1.telemetry?.roll ?? 0,
      zoom: cam1Input.zoom ?? cam1.telemetry?.zoom ?? 0,
    };

    const tel2 = {
      camId: cam2.telemetry?.camId ?? 2,
      pan: cam2Input.pan ?? cam2Input.panDeg ?? cam2.telemetry?.pan ?? 0,
      tilt: cam2Input.tilt ?? cam2Input.tiltDeg ?? cam2.telemetry?.tilt ?? 0,
      roll: cam2.telemetry?.roll ?? 0,
      zoom: cam2Input.zoom ?? cam2.telemetry?.zoom ?? 0,
    };

    const pose1 = getCameraWorldPose(cam1.mount, tel1);
    const pose2 = getCameraWorldPose(cam2.mount, tel2);

    const uv1 = { u: cam1Input.u ?? 0.5, v: cam1Input.v ?? 0.5 };
    const uv2 = { u: cam2Input.u ?? 0.5, v: cam2Input.v ?? 0.5 };

    const result = triangulateCameras(pose1, pose2, uv1, uv2);
    if (!result) {
      return reply.code(422).send({ error: 'Rays are parallel or do not converge' });
    }

    const zone = findZoneAtPoint(sceneManager.venue, result.point);

    return {
      ok: true,
      point: {
        x: Math.round(result.point.x * 1000) / 1000,
        y: Math.round(result.point.y * 1000) / 1000,
        z: Math.round(result.point.z * 1000) / 1000,
      },
      errorMeters: Math.round(result.errorMeters * 1000) / 1000,
      t1: Math.round(result.t1 * 100) / 100,
      t2: Math.round(result.t2 * 100) / 100,
      isBehindCamera: result.isBehindCamera,
      zone: zone ? { id: zone.id, name: zone.name } : null,
      cameras: {
        cam1: {
          id: cam1Input.cameraId,
          position: pose1.position,
          panDeg: Math.round(pose1.panDeg * 10) / 10,
          tiltDeg: Math.round(pose1.tiltDeg * 10) / 10,
        },
        cam2: {
          id: cam2Input.cameraId,
          position: pose2.position,
          panDeg: Math.round(pose2.panDeg * 10) / 10,
          tiltDeg: Math.round(pose2.tiltDeg * 10) / 10,
        },
      },
    };
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
