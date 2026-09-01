import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, isWithinGeofence } from '../src/utils/geofence.js';

test('distanceMeters returns ~0 for identical points', () => {
  assert.ok(distanceMeters(20.6736, -103.344, 20.6736, -103.344) < 1);
});

test('distanceMeters returns a known distance between two points', () => {
  // Guadalajara centro vs Zapopan centro, roughly 7km apart
  const d = distanceMeters(20.6736, -103.344, 20.7214, -103.3919);
  assert.ok(d > 6000 && d < 9000);
});

test('isWithinGeofence is true when inside the radius', () => {
  const sede = { lat: 20.6736, lng: -103.344, radio_metros: 200 };
  assert.equal(isWithinGeofence({ lat: 20.6737, lng: -103.3441 }, sede), true);
});

test('isWithinGeofence is false when outside the radius', () => {
  const sede = { lat: 20.6736, lng: -103.344, radio_metros: 50 };
  assert.equal(isWithinGeofence({ lat: 20.7214, lng: -103.3919 }, sede), false);
});
