import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY_EVENT_TYPES, GatewayClient, gatewayEventsUrl } from '../src/scene/gateway-client.js';
import type { SpatialSceneManager } from '../src/scene/spatial-scene.js';

function fake() {
  const calls: string[] = [];
  const mgr = {
    updateFreed: () => calls.push('freed'),
    updateDetections: () => calls.push('perception'),
    on: () => mgr,
    off: () => mgr,
  } as unknown as SpatialSceneManager;
  return { calls, client: new GatewayClient(mgr, { gatewayUrl: 'http://gw:1/' }) };
}

test('events URL lists exactly the handled types', () => {
  assert.equal(gatewayEventsUrl('http://gw:1/'), `http://gw:1/api/v1/events?types=${GATEWAY_EVENT_TYPES.join(',')}`);
  assert.deepEqual([...GATEWAY_EVENT_TYPES], ['freed', 'perception']);
});

test('handles freed and perception, by event name or wrapped type', () => {
  const { calls, client } = fake();
  client.handleGatewayEvent('{"camId":1}', 'freed');
  client.handleGatewayEvent('{"cameraId":"cam1","objects":[]}', 'perception');
  client.handleGatewayEvent('{"type":"freed","data":{"camId":1}}');
  assert.deepEqual(calls, ['freed', 'perception', 'freed']);
});

test('unhandled types and bad frames are ignored', () => {
  const { calls, client } = fake();
  client.handleGatewayEvent('{"x":1}', 'audio-telemetry');
  client.handleGatewayEvent('{"type":"audio-telemetry","data":{"a":1}}');
  client.handleGatewayEvent('not json', 'freed');
  assert.deepEqual(calls, []);
});
