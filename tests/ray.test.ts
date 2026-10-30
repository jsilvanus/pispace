import test from 'node:test';
import assert from 'node:assert/strict';
import { createRay, rayPointAt, intersectRayPlane, intersectRayHorizontalPlane } from '../src/math/ray.js';
import { vec3 } from '../src/math/vector3.js';

test('ray creation and point evaluation', () => {
  const r = createRay(vec3(0, 0, 10), vec3(0, 0, -1));
  const p = rayPointAt(r, 4);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  assert.equal(p.z, 6);
});

test('ray plane intersection', () => {
  // Ray pointing straight down from z = 5 towards floor at z = 0
  const ray = createRay(vec3(2, 3, 5), vec3(0, 0, -1));
  const hit = intersectRayHorizontalPlane(ray, 0);

  assert.ok(hit);
  assert.equal(hit.t, 5);
  assert.equal(hit.point.x, 2);
  assert.equal(hit.point.y, 3);
  assert.equal(hit.point.z, 0);
});

test('ray parallel to plane returns null', () => {
  // Ray pointing horizontal at z = 5
  const ray = createRay(vec3(0, 0, 5), vec3(1, 0, 0));
  const hit = intersectRayHorizontalPlane(ray, 0);
  assert.equal(hit, null);
});

test('ray pointing away from plane returns null', () => {
  // Ray at z = 5 pointing up (z = +1), floor at z = 0
  const ray = createRay(vec3(0, 0, 5), vec3(0, 0, 1));
  const hit = intersectRayHorizontalPlane(ray, 0);
  assert.equal(hit, null);
});
