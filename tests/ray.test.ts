import test from 'node:test';
import assert from 'node:assert/strict';
import { createRay, rayPointAt, intersectRayPlane, intersectRayHorizontalPlane, triangulateRays } from '../src/math/ray.js';
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

test('triangulate intersecting rays', () => {
  // Ray 1 from (0, 0, 0) pointing along +X
  const r1 = createRay(vec3(0, 0, 0), vec3(1, 0, 0));
  // Ray 2 from (5, -5, 0) pointing along +Y
  const r2 = createRay(vec3(5, -5, 0), vec3(0, 1, 0));

  const result = triangulateRays(r1, r2);
  assert.ok(result);
  assert.ok(result.errorMeters < 1e-5);
  assert.equal(Math.round(result.point.x), 5);
  assert.equal(Math.round(result.point.y), 0);
  assert.equal(Math.round(result.point.z), 0);
  assert.equal(result.isBehindCamera, false);
});

test('triangulate skew rays with residual error', () => {
  // Ray 1 passes through (0, 0, 0) towards +X
  const r1 = createRay(vec3(0, 0, 0), vec3(1, 0, 0));
  // Ray 2 passes through (2, 0, 0.1) towards +Y
  const r2 = createRay(vec3(2, -2, 0.1), vec3(0, 1, 0));

  const result = triangulateRays(r1, r2);
  assert.ok(result);
  // Distance of closest approach should be 0.1m
  assert.ok(Math.abs(result.errorMeters - 0.1) < 1e-4);
  assert.equal(Math.round(result.point.x), 2);
  assert.equal(Math.round(result.point.y), 0);
  assert.ok(Math.abs(result.point.z - 0.05) < 1e-4);
});

test('triangulate parallel rays returns null', () => {
  const r1 = createRay(vec3(0, 0, 0), vec3(0, 1, 0));
  const r2 = createRay(vec3(2, 0, 0), vec3(0, 1, 0));
  const result = triangulateRays(r1, r2);
  assert.equal(result, null);
});
