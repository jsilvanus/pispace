import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SpatialSceneManager } from '../src/scene/spatial-scene.js';
import { KESKUSKIRKKO_VENUE } from '../src/venue/keskuskirkko.js';
import { getCameraWorldPose, computeCameraFrustum } from '../src/camera/projection.js';
// @ts-expect-error plain JS module without types
import * as geo from '../web/live-geometry.js';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lookDirection matches the server projection (pan clockwise from +Y)', () => {
  const mount = { id: 'c', name: 'c', position: { x: 1, y: 2, z: 3 }, baseOrientation: { pan: 30, tilt: -10, roll: 0 } };
  const pose = getCameraWorldPose(mount, { camId: 1, pan: 40, tilt: -5, roll: 0, zoom: 0 });
  const axis = computeCameraFrustum(pose).opticalAxis;
  const d = geo.lookDirection(70, -15);
  near(d.x, axis.x); near(d.y, axis.y); near(d.z, axis.z);
});

test('frustumCorners straddle the look direction', () => {
  const c = geo.frustumCorners({ x: 0, y: 0, z: 0 }, 0, 0, 90, 60, 1);
  // Looking along +Y: left corners at -X, right at +X, top above.
  near(c[0].x, -1); near(c[1].x, 1); near(c[0].y, 1);
  assert.ok(c[0].z > 0 && c[3].z < 0);
});

test('floorHeightAt picks the highest floor or zone under the point', () => {
  const venue = {
    floors: [{ polygon: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], elevation: 0.4 }],
    zones: [{ polygon: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }], floorHeight: 2.7 }],
  };
  assert.equal(geo.floorHeightAt(venue, { x: 0, y: 0 }), 0.4);
  assert.equal(geo.floorHeightAt(venue, { x: 5.8, y: 5.2 }), 2.7);
  assert.equal(geo.floorHeightAt(venue, { x: 10, y: 10 }), 0);
});

test('rayHitPlane, subject aim point, colours and ageing', () => {
  assert.deepEqual(geo.rayHitPlane({ x: 0, y: 0, z: 2 }, { x: 0, y: 1, z: -1 }, 0), { x: 0, y: 2, z: 0 });
  assert.equal(geo.rayHitPlane({ x: 0, y: 0, z: 2 }, { x: 0, y: 1, z: 1 }, 0), null);
  near(geo.subjectAimPoint({ position: { x: 0, y: 0, z: 0.4 }, headHeight: 1.8 }).z, 0.4 + 1.44);
  assert.equal(geo.trackColor(3), geo.trackColor(13));
  const now = Date.parse('2026-11-10T10:00:10Z');
  const scene = { subjects: [{ lastSeenAt: '2026-11-10T10:00:09Z' }, { lastSeenAt: '2026-11-10T10:00:00Z' }] };
  assert.equal(geo.freshSubjects(scene, now, 5000).length, 1);
});

test('server serves the live page, module, three.js, and CORS for listed origins', async () => {
  const app = createServer(new SpatialSceneManager({ venue: KESKUSKIRKKO_VENUE }), {
    port: 0, host: '127.0.0.1', gatewayUrl: 'http://127.0.0.1:3000', corsOrigins: ['http://mapper.local'],
  });
  const page = await app.inject({ method: 'GET', url: '/live' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /mountLiveView/);
  const mod = await app.inject({ method: 'GET', url: '/web/live-view.js' });
  assert.equal(mod.statusCode, 200);
  assert.match(mod.headers['content-type'] as string, /javascript/);
  assert.equal((await app.inject({ method: 'GET', url: '/web/..%2Fpackage.json' })).statusCode, 404);
  const three = await app.inject({ method: 'GET', url: '/vendor/three/three.module.js' });
  assert.equal(three.statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/vendor/three/three.cjs' })).statusCode, 404);

  const ok = await app.inject({ method: 'GET', url: '/api/v1/scene', headers: { origin: 'http://mapper.local' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'http://mapper.local');
  const other = await app.inject({ method: 'GET', url: '/api/v1/scene', headers: { origin: 'http://evil.local' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
  const pre = await app.inject({ method: 'OPTIONS', url: '/api/v1/solve-ptz', headers: { origin: 'http://mapper.local', 'access-control-request-method': 'POST' } });
  assert.equal(pre.statusCode, 204);
  await app.close();
});
