import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SpatialSceneManager } from '../src/scene/spatial-scene.js';
import { KESKUSKIRKKO_VENUE } from '../src/venue/keskuskirkko.js';

test('Fastify server routes', async () => {
  const sceneManager = new SpatialSceneManager({
    venue: KESKUSKIRKKO_VENUE,
  });

  const app = createServer(sceneManager, {
    port: 3108,
    host: '127.0.0.1',
    gatewayUrl: 'http://127.0.0.1:3100',
  });

  // Health
  const resHealth = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(resHealth.statusCode, 200);
  assert.equal(resHealth.json().ok, true);

  // Scene
  const resScene = await app.inject({ method: 'GET', url: '/api/v1/scene' });
  assert.equal(resScene.statusCode, 200);
  assert.ok(resScene.json().cameras.cam1);

  // Zones
  const resZones = await app.inject({ method: 'GET', url: '/api/v1/zones' });
  assert.equal(resZones.statusCode, 200);
  assert.ok(Array.isArray(resZones.json()));
  assert.ok(resZones.json().some((z: any) => z.id === 'pulpit'));

  // Occluders
  const resOcc = await app.inject({ method: 'GET', url: '/api/v1/occluders' });
  assert.equal(resOcc.statusCode, 200);
  assert.ok(Array.isArray(resOcc.json()));
  assert.ok(resOcc.json().some((o: any) => o.id === 'pulpit_facade'));

  // Solve PTZ for Pulpit
  const resSolve = await app.inject({
    method: 'POST',
    url: '/api/v1/solve-ptz',
    payload: {
      cameraId: 'cam1',
      target: { zoneId: 'pulpit' },
      shotType: 'close_up',
    },
  });
  assert.equal(resSolve.statusCode, 200);
  const solveJson = resSolve.json();
  assert.equal(solveJson.cameraId, 'cam1');
  assert.equal(solveJson.targetZoneId, 'pulpit');
  assert.ok(typeof solveJson.pan === 'number');
  assert.ok(typeof solveJson.tilt === 'number');
  assert.ok(typeof solveJson.zoom === 'number');

  // Push FreeD Telemetry
  const resFreed = await app.inject({
    method: 'POST',
    url: '/api/v1/freed',
    payload: {
      camId: 1,
      pan: 10.5,
      tilt: -5.0,
      roll: 0,
      zoom: 1500,
    },
  });
  assert.equal(resFreed.statusCode, 200);
  assert.equal(resFreed.json().ok, true);

  // Verify updated camera
  const sceneAfter = sceneManager.getSnapshot();
  assert.equal(sceneAfter.cameras.cam1?.telemetry?.pan, 10.5);

  // Triangulation between cam1 and cam2
  // We can solve ptz for a target point first, then pass those angles back to triangulate!
  const targetPt = { x: 0, y: 5, z: 0.4 };
  const s1 = app.inject({
    method: 'POST',
    url: '/api/v1/solve-ptz',
    payload: { cameraId: 'cam1', target: targetPt },
  });
  const s2 = app.inject({
    method: 'POST',
    url: '/api/v1/solve-ptz',
    payload: { cameraId: 'cam2', target: targetPt },
  });
  const [resS1, resS2] = await Promise.all([s1, s2]);
  const sol1 = resS1.json();
  const sol2 = resS2.json();

  const resTri = await app.inject({
    method: 'POST',
    url: '/api/v1/triangulate',
    payload: {
      cam1: { cameraId: 'cam1', panDeg: sol1.pan, tiltDeg: sol1.tilt },
      cam2: { cameraId: 'cam2', panDeg: sol2.pan, tiltDeg: sol2.tilt },
    },
  });
  assert.equal(resTri.statusCode, 200);
  const triData = resTri.json();
  assert.equal(triData.ok, true);
  assert.ok(triData.errorMeters < 0.05); // within 5cm
  assert.ok(Math.abs(triData.point.x - targetPt.x) < 0.1);
  assert.ok(Math.abs(triData.point.y - targetPt.y) < 0.1);
  assert.ok(Math.abs(triData.point.z - targetPt.z) < 0.1);

  sceneManager.stop();
  await app.close();
});
