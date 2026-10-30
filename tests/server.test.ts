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

  sceneManager.stop();
  await app.close();
});
