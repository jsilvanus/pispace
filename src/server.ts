import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { AppConfig } from './config.js';
import type { SpatialSceneManager } from './scene/spatial-scene.js';
import type { BoundingBox2D, Point3D, ShotType } from './types.js';
import { getZoneById, getZoneTargetPoint, validateVenueModel } from './venue/model.js';
import { renderVenueSvg } from './venue/svg-map.js';
import { getActiveLayout, resolveFurniture } from './venue/layouts.js';
import { solvePtzForTarget } from './camera/solver.js';
import { getCameraWorldPose, projectBoundingBoxToFloor, triangulateCameras } from './camera/projection.js';
import { findZoneAtPoint } from './venue/model.js';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(PACKAGE_ROOT, 'web');
/** The live view's own files, the only names /web/ serves. */
const WEB_FILES: Record<string, string> = {
  'live-view.js': 'text/javascript; charset=utf-8',
  'live-geometry.js': 'text/javascript; charset=utf-8',
};
/** three.js build files the live view imports (three.module.js pulls in three.core.js). */
const THREE_FILES = new Set(['three.module.js', 'three.core.js']);

function resolveThreeBuild(): string | null {
  for (const dir of [path.join(PACKAGE_ROOT, 'node_modules/three/build'), path.resolve('node_modules/three/build')]) {
    if (fs.existsSync(path.join(dir, 'three.module.js'))) return dir;
  }
  return null;
}

/** Venue changes need PISPACE_EDIT_KEY as a Bearer token. Sends 403/401 and returns false otherwise. */
function makeEditKeyCheck(editKey: string | undefined) {
  return (authorization: string | undefined, reply: FastifyReply): boolean => {
    if (!editKey) {
      reply.code(403).send({ error: 'Venue editing is off: set PISPACE_EDIT_KEY' });
      return false;
    }
    const auth = authorization ?? '';
    const given = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    const want = Buffer.from(editKey);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      reply.code(401).send({ error: 'Invalid or missing edit key' });
      return false;
    }
    return true;
  };
}

export function createServer(
  sceneManager: SpatialSceneManager,
  config: AppConfig
): FastifyInstance {
  const app = fastify({
    logger: false,
  });
  const checkEditKey = makeEditKeyCheck(config.editKey);

  // CORS for pages on other origins that embed the live view (PISPACE_CORS_ORIGINS, comma separated;
  // '*' allows any). Unset = same origin only.
  const corsOrigins = config.corsOrigins ?? [];
  if (corsOrigins.length > 0) {
    app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (!origin) return;
      if (!corsOrigins.includes('*') && !corsOrigins.includes(origin)) return;
      reply.header('Access-Control-Allow-Origin', corsOrigins.includes('*') ? '*' : origin);
      reply.header('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        reply.header('Access-Control-Max-Age', '600');
        return reply.code(204).send();
      }
    });
  }

  // Live 3D view: a standalone page and the embeddable module (web/live-view.js).
  app.get('/live', async (_req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(fs.createReadStream(path.join(WEB_DIR, 'live.html')));
  });
  app.get<{ Params: { file: string } }>('/web/:file', async (req, reply) => {
    const type = WEB_FILES[req.params.file];
    if (!type) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', type);
    reply.header('Cache-Control', 'no-cache');
    return reply.send(fs.createReadStream(path.join(WEB_DIR, req.params.file)));
  });
  const threeBuild = resolveThreeBuild();
  app.get<{ Params: { file: string } }>('/vendor/three/:file', async (req, reply) => {
    if (!threeBuild || !THREE_FILES.has(req.params.file)) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', 'text/javascript; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(path.join(threeBuild, req.params.file)));
  });

  // Health check
  app.get('/health', async () => {
    return { ok: true, service: 'pispace', version: '0.1.0' };
  });

  // Current venue model (geometry, dimensions, cameras, zones)
  app.get('/api/v1/venue', async () => {
    return sceneManager.venue;
  });

  // Replace the venue model (church-3d-mapper push). Needs PISPACE_EDIT_KEY; kept in memory
  // only, so the venue file stays the source of truth after a restart.
  app.put('/api/v1/venue', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    if (!checkEditKey(req.headers.authorization, reply)) return reply;
    try {
      const venue = validateVenueModel(req.body);
      sceneManager.setVenue(venue);
      return { ok: true, name: venue.name, zones: venue.zones.length, persisted: false };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Layouts of movable objects (normal service, Christmas, concert ...)
  app.get('/api/v1/venue/layouts', async () => {
    const venue = sceneManager.venue;
    return {
      active: getActiveLayout(venue)?.id ?? null,
      objectTypes: venue.objectTypes ?? [],
      layouts: (venue.layouts ?? []).map((l) => ({ id: l.id, name: l.name, placements: l.placements.length })),
    };
  });

  // Fixed furniture plus the movable objects of a layout (?layout=<id>, default active)
  app.get<{ Querystring: { layout?: string } }>('/api/v1/venue/furniture', async (req, reply) => {
    if (req.query.layout && !(sceneManager.venue.layouts ?? []).some((l) => l.id === req.query.layout)) {
      return reply.code(404).send({ error: 'Unknown layout' });
    }
    return resolveFurniture(sceneManager.venue, req.query.layout);
  });

  // Switch the active layout (edit key)
  app.post<{ Body: { layoutId?: string } }>('/api/v1/venue/layout', async (req, reply) => {
    if (!checkEditKey(req.headers.authorization, reply)) return reply;
    const id = req.body?.layoutId;
    if (typeof id !== 'string' || !sceneManager.setActiveLayout(id)) {
      return reply.code(404).send({ error: 'Unknown layout' });
    }
    return { ok: true, active: id };
  });

  // Move one movable object of the active layout, e.g. the lectern during a service (edit key)
  app.patch<{ Params: { id: string }; Body: { center?: { x?: number; y?: number; z?: number }; rotationDeg?: number } }>(
    '/api/v1/venue/placements/:id',
    async (req, reply) => {
      if (!checkEditKey(req.headers.authorization, reply)) return reply;
      const moved = sceneManager.movePlacement(req.params.id, req.body ?? {});
      if (!moved) return reply.code(404).send({ error: 'No such placement in the active layout' });
      return { ok: true, placement: moved };
    },
  );

  // Top-down SVG map of the venue (?level=<levels id>&layout=<id>&scale=<px per m>&zones=0)
  app.get<{ Querystring: { level?: string; layout?: string; scale?: string; zones?: string } }>('/api/v1/venue/map.svg', async (req, reply) => {
    const scale = req.query.scale ? Number(req.query.scale) : undefined;
    if (scale !== undefined && (!Number.isFinite(scale) || scale < 2 || scale > 200)) {
      return reply.code(400).send({ error: 'scale must be between 2 and 200' });
    }
    if (req.query.level && !(sceneManager.venue.levels ?? []).some((l) => l.id === req.query.level)) {
      return reply.code(404).send({ error: 'Unknown level' });
    }
    if (req.query.layout && !(sceneManager.venue.layouts ?? []).some((l) => l.id === req.query.layout)) {
      return reply.code(404).send({ error: 'Unknown layout' });
    }
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    return renderVenueSvg(sceneManager.venue, { level: req.query.level, layout: req.query.layout, scale, zones: req.query.zones !== '0' });
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
    let modelPath = path.resolve(config.modelsDir ?? 'models', filename);
    // Generic models (e.g. camera CAD) ship with pispace; site models come from modelsDir.
    if (!fs.existsSync(modelPath)) modelPath = path.resolve('models', filename);

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

    const onVenueUpdated = () => {
      const v = sceneManager.venue;
      reply.raw.write(`event: venue-updated\ndata: ${JSON.stringify({ name: v.name, activeLayout: getActiveLayout(v)?.id ?? null })}\n\n`);
    };

    sceneManager.on('venue-updated', onVenueUpdated);
    sceneManager.on('scene-updated', onSceneUpdated);
    sceneManager.on('subject-entered-zone', onZoneEntered);
    sceneManager.on('subject-left-zone', onZoneLeft);

    req.raw.on('close', () => {
      sceneManager.off('venue-updated', onVenueUpdated);
      sceneManager.off('scene-updated', onSceneUpdated);
      sceneManager.off('subject-entered-zone', onZoneEntered);
      sceneManager.off('subject-left-zone', onZoneLeft);
    });
  });

  return app;
}
