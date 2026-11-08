import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SpatialSceneManager } from '../src/scene/spatial-scene.js';
import { validateVenueModel } from '../src/venue/model.js';
import { resolveFurniture } from '../src/venue/layouts.js';
import { renderVenueSvg } from '../src/venue/svg-map.js';
import type { VenueModel } from '../src/types.js';

function venue(): VenueModel {
  return {
    name: 'Hall',
    description: '',
    dimensions: { widthMeters: 10, lengthMeters: 10, heightMeters: 5 },
    originDescription: '',
    cameras: {},
    zones: [{ id: 'z', name: 'Z', floorHeight: 0, ceilingHeight: 3, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
    furniture: [{ id: 'altar', name: 'Altar', kind: 'altar', center: { x: 0, y: 3, z: 0 }, size: { width: 2, depth: 1, height: 1 } }],
    objectTypes: [
      { id: 'lectern', name: 'Lukupulpetti', kind: 'other', size: { width: 0.6, depth: 0.5, height: 1.2 } },
      { id: 'tree', name: 'Joulukuusi', kind: 'other', shape: 'cylinder', size: { width: 1.5, depth: 1.5, height: 3 }, color: '#166534' },
    ],
    layouts: [
      { id: 'normal', name: 'Tavallinen', placements: [{ id: 'lectern1', typeId: 'lectern', center: { x: 2, y: 1, z: 0.4 } }] },
      {
        id: 'christmas',
        name: 'Joulu',
        placements: [
          { id: 'lectern1', typeId: 'lectern', center: { x: -2, y: 1, z: 0.4 }, rotationDeg: 20 },
          { id: 'tree1', typeId: 'tree', center: { x: 3, y: 2, z: 0 } },
        ],
      },
    ],
    activeLayout: 'normal',
  };
}

test('resolveFurniture merges fixed items with the active or named layout', () => {
  const v = venue();
  const active = resolveFurniture(v);
  assert.deepEqual(active.map((f) => f.id), ['altar', 'lectern1']);
  assert.equal(active[1]!.movable, true);
  assert.equal(active[1]!.name, 'Lukupulpetti');
  const xmas = resolveFurniture(v, 'christmas');
  assert.deepEqual(xmas.map((f) => f.id), ['altar', 'lectern1', 'tree1']);
  assert.equal(xmas[1]!.center.x, -2);
  assert.equal(xmas[2]!.shape, 'cylinder');
  assert.ok(renderVenueSvg(v, { layout: 'christmas' }).includes('<title>Joulukuusi</title>'));
  assert.ok(!renderVenueSvg(v).includes('<title>Joulukuusi</title>'));
});

test('validateVenueModel checks object types and layouts', () => {
  assert.equal(validateVenueModel(venue()).name, 'Hall');
  const bad = venue();
  bad.layouts![0]!.placements[0]!.typeId = 'nope';
  assert.throws(() => validateVenueModel(bad), /unknown object type "nope"/);
  const badActive = venue();
  badActive.activeLayout = 'easter';
  assert.throws(() => validateVenueModel(badActive), /activeLayout "easter"/);
});

test('layout switch and live moves need the edit key', async () => {
  const scene = new SpatialSceneManager({ venue: venue() });
  const app = createServer(scene, { port: 0, host: '127.0.0.1', gatewayUrl: 'http://127.0.0.1:3000', editKey: 'k' });
  const auth = { authorization: 'Bearer k' };
  try {
    const list = await app.inject({ method: 'GET', url: '/api/v1/venue/layouts' });
    assert.equal(list.json().active, 'normal');
    assert.equal(list.json().layouts.length, 2);

    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/venue/layout', payload: { layoutId: 'christmas' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/venue/layout', headers: auth, payload: { layoutId: 'x' } })).statusCode, 404);
    const sw = await app.inject({ method: 'POST', url: '/api/v1/venue/layout', headers: auth, payload: { layoutId: 'christmas' } });
    assert.equal(sw.statusCode, 200);
    const furn = (await app.inject({ method: 'GET', url: '/api/v1/venue/furniture' })).json();
    assert.ok(furn.some((f: { id: string }) => f.id === 'tree1'));

    const mv = await app.inject({ method: 'PATCH', url: '/api/v1/venue/placements/lectern1', headers: auth, payload: { center: { x: 1.5 }, rotationDeg: 90 } });
    assert.equal(mv.statusCode, 200);
    assert.deepEqual(mv.json().placement.center, { x: 1.5, y: 1, z: 0.4 });
    assert.equal(mv.json().placement.rotationDeg, 90);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/venue/placements/nope', headers: auth, payload: {} })).statusCode, 404);
  } finally {
    scene.stop();
  }
});
