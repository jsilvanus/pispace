import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vec3,
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  normalize,
  distance,
  degToRad,
  radToDeg,
} from '../src/math/vector3.js';

test('vector3 basic operations', () => {
  const v1 = vec3(1, 2, 3);
  const v2 = vec3(4, 5, 6);

  assert.deepEqual(add(v1, v2), { x: 5, y: 7, z: 9 });
  assert.deepEqual(sub(v2, v1), { x: 3, y: 3, z: 3 });
  assert.deepEqual(scale(v1, 2), { x: 2, y: 4, z: 6 });

  assert.equal(dot(v1, v2), 4 + 10 + 18); // 32
  assert.deepEqual(cross(vec3(1, 0, 0), vec3(0, 1, 0)), { x: 0, y: 0, z: 1 });

  assert.equal(length(vec3(3, 4, 0)), 5);
  const n = normalize(vec3(0, 5, 0));
  assert.deepEqual(n, { x: 0, y: 1, z: 0 });

  assert.equal(distance(vec3(1, 1, 1), vec3(1, 4, 5)), 5);
  assert.equal(degToRad(180), Math.PI);
  assert.equal(radToDeg(Math.PI), 180);
});
