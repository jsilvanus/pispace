import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon2D, pointInSpatialZone, polygonCentroid } from '../src/math/polygon.js';
import type { SpatialZone } from '../src/types.js';

test('point in 2D polygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  assert.equal(pointInPolygon2D({ x: 2, y: 2 }, square), true);
  assert.equal(pointInPolygon2D({ x: 5, y: 2 }, square), false);
  assert.equal(pointInPolygon2D({ x: -1, y: 2 }, square), false);
  assert.equal(pointInPolygon2D({ x: 2, y: 5 }, square), false);
});

test('point in 3D spatial zone prism', () => {
  const zone: SpatialZone = {
    id: 'test_zone',
    name: 'Test Zone',
    floorHeight: 0.5,
    ceilingHeight: 3.0,
    polygon: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
  };

  // Inside
  assert.equal(pointInSpatialZone({ x: 1, y: 1, z: 1.0 }, zone), true);
  // Outside height
  assert.equal(pointInSpatialZone({ x: 1, y: 1, z: 0.2 }, zone), false);
  assert.equal(pointInSpatialZone({ x: 1, y: 1, z: 4.0 }, zone), false);
  // Outside polygon
  assert.equal(pointInSpatialZone({ x: 3, y: 1, z: 1.0 }, zone), false);
});

test('polygon centroid', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  const c = polygonCentroid(square);
  assert.equal(Math.round(c.x), 2);
  assert.equal(Math.round(c.y), 2);
});
