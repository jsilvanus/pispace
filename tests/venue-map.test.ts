import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SpatialSceneManager } from '../src/scene/spatial-scene.js';
import { validateVenueModel } from '../src/venue/model.js';
import { renderVenueSvg } from '../src/venue/svg-map.js';
import type { VenueModel } from '../src/types.js';

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

function sampleVenue(): VenueModel {
  return {
    name: 'Sample Hall',
    description: 'test',
    dimensions: { widthMeters: 10, lengthMeters: 20, heightMeters: 8 },
    originDescription: 'centre',
    cameras: { cam1: { id: 'cam1', name: 'Cam 1', position: { x: 0, y: -8, z: 3 }, baseOrientation: { pan: 0, tilt: 0, roll: 0 } } },
    zones: [{ id: 'nave', name: 'Nave', floorHeight: 0, ceilingHeight: 8, polygon: square(-4, -9, 4, -1) }],
    levels: [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'gallery', name: 'Gallery', elevation: 4 }],
    floors: [{ id: 'gallery_floor', name: 'Gallery', elevation: 4, polygon: square(-5, -10, 5, -7) }],
    walls: [{ id: 'w1', name: 'West <wall>', start: { x: -5, y: -10 }, end: { x: 5, y: -10 }, bottomZ: 0, topZ: 8, thickness: 0.4 }],
    furniture: [
      { id: 'pew1', name: 'Pew 1', kind: 'pew', center: { x: -2, y: -5, z: 0 }, size: { width: 4, depth: 0.5, height: 0.9 } },
      { id: 'organ', name: 'Organ', kind: 'organ', center: { x: 0, y: -9, z: 4 }, size: { width: 4, depth: 1, height: 5 }, rotationDeg: 10 },
      { id: 'table', name: 'Table', kind: 'table', shape: 'cylinder', center: { x: 3, y: -3, z: 0 }, size: { width: 1, depth: 1, height: 0.75 } },
    ],
    stairs: [{ id: 's1', name: 'Stair', polygon: square(4, -10, 5, -8), fromZ: 0, toZ: 4 }],
    exits: [{ id: 'e1', name: 'Main door', position: { x: 0, y: -10, z: 0 }, level: 'ground' }],
    rooms: [{ id: 'r1', name: 'Sacristy', floorZ: 0, polygon: square(3, 5, 5, 8) }],
  };
}

test('validateVenueModel accepts map elements and rejects bad ones', () => {
  assert.equal(validateVenueModel(sampleVenue()).name, 'Sample Hall');
  const dup = sampleVenue();
  dup.furniture!.push({ ...dup.furniture![0]! });
  assert.throws(() => validateVenueModel(dup), /Duplicate id "pew1"/);
  const badStair = sampleVenue() as unknown as Record<string, unknown>;
  badStair.stairs = [{ id: 's', name: 's', polygon: [{ x: 0, y: 0 }], fromZ: 0, toZ: 1 }];
  assert.throws(() => validateVenueModel(badStair), /at least 3 vertices/);
  const badWall = sampleVenue();
  badWall.walls![0]!.topZ = -1;
  assert.throws(() => validateVenueModel(badWall), /bottomZ <= topZ/);
});

test('renderVenueSvg draws every element and escapes names', () => {
  const svg = renderVenueSvg(sampleVenue());
  assert.match(svg, /^<svg /);
  for (const name of ['Pew 1', 'Organ', 'Table', 'Stair', 'Main door', 'Sacristy', 'Nave', 'Cam 1']) {
    assert.ok(svg.includes(`<title>${name}</title>`), name);
  }
  assert.ok(svg.includes('West &lt;wall&gt;'));
  // Gallery view fades ground-level pews but not the organ
  const gallery = renderVenueSvg(sampleVenue(), { level: 'gallery' });
  assert.match(gallery, /opacity="0.25"><title>Pew 1</);
  assert.doesNotMatch(gallery, /opacity="0.25"><title>Organ</);
});

test('PUT /api/v1/venue needs the edit key and replaces the venue', async () => {
  const base = { port: 0, host: '127.0.0.1', gatewayUrl: 'http://127.0.0.1:3000' };
  const scene = new SpatialSceneManager({ venue: sampleVenue() });
  try {
    const off = createServer(scene, base);
    const r0 = await off.inject({ method: 'PUT', url: '/api/v1/venue', payload: sampleVenue() });
    assert.equal(r0.statusCode, 403);

    const app = createServer(scene, { ...base, editKey: 'secret' });
    const r1 = await app.inject({ method: 'PUT', url: '/api/v1/venue', payload: sampleVenue() });
    assert.equal(r1.statusCode, 401);
    const r2 = await app.inject({ method: 'PUT', url: '/api/v1/venue', headers: { authorization: 'Bearer secret' }, payload: { name: 'x' } });
    assert.equal(r2.statusCode, 400);

    const next = { ...sampleVenue(), name: 'Renamed', cameras: { cam9: { ...sampleVenue().cameras.cam1!, id: 'cam9' } } };
    const r3 = await app.inject({ method: 'PUT', url: '/api/v1/venue', headers: { authorization: 'Bearer secret' }, payload: next });
    assert.equal(r3.statusCode, 200);
    assert.equal(scene.venue.name, 'Renamed');
    assert.deepEqual(Object.keys(scene.getSnapshot().cameras), ['cam9']);

    const map = await app.inject({ method: 'GET', url: '/api/v1/venue/map.svg?level=gallery' });
    assert.equal(map.statusCode, 200);
    assert.match(map.headers['content-type'] as string, /image\/svg\+xml/);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/venue/map.svg?level=nope' })).statusCode, 404);
  } finally {
    scene.stop();
  }
});
