import assert from 'node:assert/strict';
import test from 'node:test';
import { measureWearableFramePixels } from './studio-wearable-frame-evidence.mjs';
const width = 160, height = 160;
function image() { const pixels = new Uint8Array(width * height * 4); for (let i = 0; i < pixels.length; i += 4) { pixels.set([229, 231, 235, 255], i); } return pixels; }
function rectangle(pixels, x, y, w, h, color = [3, 12, 20, 255]) { for (let row = y; row < y + h; row++) { for (let col = x; col < x + w; col++) { pixels.set(color, (row * width + col) * 4); } } return pixels; }
test('accepts a visible two-color phone without demanding many material colors', () => {
  const evidence = measureWearableFramePixels(rectangle(image(), 50, 10, 60, 140), width, height);
  assert.equal(evidence.nonblank, true); assert.equal(evidence.largestComponent, 8400);
});
test('accepts a narrow but resolved side silhouette', () => assert.equal(measureWearableFramePixels(rectangle(image(), 79, 10, 4, 140), width, height).nonblank, true));
test('rejects empty, uniform black and transparent frames', () => {
  for (const pixels of [image(), rectangle(image(), 0, 0, width, height), new Uint8Array(width * height * 4)]) { assert.equal(measureWearableFramePixels(pixels, width, height).nonblank, false); }
});
test('rejects isolated colored noise even when its color count and total area are large', () => {
  const pixels = image();
  for (let y = 2; y < 158; y += 4) { for (let x = 2; x < 158; x += 4) { rectangle(pixels, x, y, 1, 1, [x, y, 0, 255]); } }
  const evidence = measureWearableFramePixels(pixels, width, height);
  assert.ok(evidence.foregroundPixels > 1000); assert.equal(evidence.largestComponent, 1); assert.equal(evidence.nonblank, false);
});
test('rejects tiny unresolved geometry and malformed input', () => {
  assert.equal(measureWearableFramePixels(rectangle(image(), 80, 80, 2, 2), width, height).nonblank, false);
  assert.equal(measureWearableFramePixels([], width, height).nonblank, false);
});
