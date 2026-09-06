/**
 * Dependency-free regression gate for the exact production math modules.
 * Run: node --experimental-strip-types --test scripts/verify-character-contact-naturalness.mjs
 * This is NOT a real-VRM/browser/mesh-collision test and does not replace core CI.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refineStudioVrmContact, sameStudioVrmContactValues, planStudioVrmContactReplay, releaseStudioVrmContactReplay } from '../apps/web/src/domains/creator/vrm/studio-vrm-contact-refinement.ts';
import { resolveStudioVrmPortraitBounds } from '../apps/web/src/domains/creator/vrm/studio-vrm-portrait-framing.ts';

function rig(initial, evaluate, overrides = {}) {
  let angles = [...initial];
  let writes = 0;
  const options = {
    initial, limits: initial.map(() => 1.75), goal: 1e-5,
    apply: (next) => { angles = [...next]; writes += 1; },
    measure: () => evaluate(angles),
    ...overrides,
  };
  return { run: () => refineStudioVrmContact(options), read: () => angles, writes: () => writes };
}
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('invalid baseline measurements never write or return NaN metadata', () => {
  for (const measurement of [NaN, Infinity, -1, null]) {
    const subject = rig([0.4], () => measurement);
    const result = subject.run();
    assert.equal(subject.writes(), 0);
    assert.equal(result.reason, 'invalid');
    assert.equal(result.before, null);
    assert.equal(result.after, null);
  }
});

test('already contacting and zero-pass requests perform no writes', () => {
  for (const overrides of [{}, { maxPasses: 0 }]) {
    const subject = rig([0.4], () => 0, overrides);
    assert.equal(subject.run().reason, 'already-contact');
    assert.equal(subject.writes(), 0);
  }
  const subject = rig([0.4], () => 1, { maxPasses: 0 });
  assert.equal(subject.run().reason, 'no-improvement');
  assert.equal(subject.writes(), 0);
});

test('left and right hands retain their bend polarity', () => {
  for (const sign of [-1, 1]) {
    const initial = [0.4, 0.6, 0.3].map((value) => sign * value);
    const subject = rig(initial, (values) => Math.hypot(...values.map((value) => Math.abs(value) - 0.85)));
    const result = subject.run();
    assert.equal(result.reason, 'improved');
    assert.ok(result.after < result.before);
    assert.deepEqual(subject.read(), result.angles);
    result.angles.forEach((value) => assert.equal(Math.sign(value), sign));
  }
});

test('grouped refinement preserves a contacting finger while improving another', () => {
  let angles = [0.8, 0.2];
  const result = refineStudioVrmContact({
    initial: [...angles], limits: [1.5, 1.5], goal: 0.0001, groups: [[0], [1]],
    apply: (next) => { angles = [...next]; },
    measure: () => Math.max(Math.abs(angles[0] - 0.8), Math.abs(angles[1] - 0.8)),
    measureContacts: () => [Math.abs(angles[0] - 0.8), Math.abs(angles[1] - 0.8)],
  });
  assert.equal(result.reason, 'improved');
  assert.equal(angles[0], 0.8);
  assert.ok(angles[1] > 0.2);
});

test('a non-worst finger can improve without moving the worst finger', () => {
  let angles = [0.2, 0.2];
  const result = refineStudioVrmContact({
    initial: [...angles], limits: [1.5, 1.5], goal: 0.01, groups: [[0], [1]],
    apply: (next) => { angles = [...next]; },
    measure: () => 2,
    measureContacts: () => [2, 1 - angles[1]],
  });
  assert.equal(result.reason, 'improved');
  assert.equal(result.before, 2);
  assert.equal(result.after, 2); // Vector error improved; max alone cannot see it.
  assert.equal(angles[0], 0.2);
  assert.ok(angles[1] > 0.2);
});

test('a candidate improving the aggregate cannot make a different contact worse', () => {
  let angles = [0.2, 0.2];
  const initial = [...angles];
  const result = refineStudioVrmContact({
    initial, limits: [1.5, 1.5], goal: 0.01, groups: [[0], [1]],
    apply: (next) => { angles = [...next]; },
    measure: () => 1 - angles[1],
    measureContacts: () => [0.1 + (angles[1] - initial[1]), 1 - angles[1]],
  });
  assert.equal(result.reason, 'no-improvement');
  assert.deepEqual(angles, initial);
});

test('over-curled fingers can relax only when measured contact improves', () => {
  for (const sign of [-1, 1]) {
    const subject = rig([0.8 * sign], (values) => Math.abs(Math.abs(values[0]) - 0.6), { allowRelaxation: true });
    const result = subject.run();
    assert.equal(result.reason, 'improved');
    assert.ok(result.after < result.before);
    assert.ok(Math.abs(subject.read()[0]) < 0.8);
    assert.equal(Math.sign(subject.read()[0]), sign);
  }
});

test('legacy scalar callers do not silently opt in to opening', () => {
  const subject = rig([0.8], (values) => Math.abs(values[0] - 0.6));
  assert.equal(subject.run().reason, 'no-improvement');
  assert.deepEqual(subject.read(), [0.8]);
});

test('angular budget is total across all passes, not replenished every pass', () => {
  for (const sign of [-1, 1]) {
    const initial = [0.4 * sign, 0.7 * sign];
    const subject = rig(initial, (values) => 4 - values.reduce((sum, value) => sum + Math.abs(value), 0), {
      maxPasses: 1000, maxAngularChange: 0.12,
    });
    const result = subject.run();
    result.angles.forEach((value, index) => assert.ok(Math.abs(value - initial[index]) <= 0.12000001));
  }
});

test('an initially over-limit joint is not curled even further', () => {
  const subject = rig([2], (values) => 4 - values[0], { limits: [1] });
  subject.run();
  assert.deepEqual(subject.read(), [2]);
});

test('evaluation budget bounds grouped worst-case work', () => {
  let angles = Array(12).fill(0.2);
  let measurements = 0;
  const result = refineStudioVrmContact({
    initial: [...angles], limits: Array(12).fill(1.7), goal: 0,
    groups: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]],
    maxPasses: 1000, maxEvaluations: 7, allowRelaxation: true,
    apply: (next) => { angles = [...next]; }, measure: () => 1,
    measureContacts: () => { measurements += 1; return [2 - angles[0], 2 - angles[3], 2 - angles[6], 2 - angles[9]]; },
  });
  assert.equal(result.evaluations, measurements);
  assert.ok(measurements <= 7);
  assert.deepEqual(angles, result.angles);
});

test('invalid, overlapping, missing and sparse groups fail without mutation', () => {
  const configurations = [
    { groups: [[0], [0]] }, { groups: [[0]] }, { groups: [[0], [2]] },
    { groups: [[], [0, 1]] }, { groups: [[NaN], [1]] }, { groups: Array(2) },
    { limits: Array(2) }, { initial: Array(2) }, { maxEvaluations: Infinity },
    { maxAngularChange: -1 }, { maxPasses: NaN },
  ];
  for (const overrides of configurations) {
    const subject = rig([0.2, 0.3], () => 1, overrides);
    assert.equal(subject.run().reason, 'invalid');
    assert.equal(subject.writes(), 0);
  }
});

test('invalid contact vectors are never treated as successful contact', () => {
  for (const contacts of [[0], [NaN, 0], [0, Infinity], Array(2), null]) {
    const subject = rig([0.2, 0.3], () => 1, { groups: [[0], [1]], measureContacts: () => contacts });
    assert.equal(subject.run().reason, 'invalid');
    assert.equal(subject.writes(), 0);
  }
});

test('rejected and non-finite trials restore the last accepted pose', () => {
  for (const evaluate of [
    (values) => values[0],
    (values) => values[0] === 0.4 ? 1 : NaN,
  ]) {
    const subject = rig([0.4], evaluate);
    const result = subject.run();
    assert.equal(result.reason, 'no-improvement');
    assert.deepEqual(subject.read(), [0.4]);
  }
});

test('measurement exceptions restore the authored pose even after a good trial', () => {
  const subject = rig([0.4], (values) => {
    if (values[0] > 0.45) throw new Error('simulated missing bone');
    return 1 - values[0];
  });
  const result = subject.run();
  assert.equal(result.reason, 'invalid');
  assert.equal(result.restored, true);
  assert.deepEqual(subject.read(), [0.4]);
});

test('rollback failure is explicit and does not escape the frame callback', () => {
  let writes = 0;
  const result = refineStudioVrmContact({
    initial: [0.4], limits: [1], goal: 0, measure: () => 1,
    apply: () => { writes += 1; throw new Error('removed runtime'); },
  });
  assert.equal(result.reason, 'restore-failed');
  assert.equal(result.restored, false);
  assert.equal(result.after, null);
  assert.deepEqual(result.angles, []);
  assert.equal(writes, 2);
});

test('adapter writes cannot corrupt rollback snapshots through array aliasing', () => {
  const initial = [0.4];
  let output = null;
  const result = refineStudioVrmContact({
    initial, limits: [1], goal: 0, measure: () => 1,
    apply: (angles) => { output = [...angles]; angles[0] = 999; },
  });
  assert.deepEqual(initial, [0.4]);
  assert.deepEqual(output, [0.4]);
  assert.equal(result.reason, 'restore-failed');
});

test('cache equality rejects sparse arrays and invalid tolerances', () => {
  assert.equal(sameStudioVrmContactValues([NaN], [NaN]), false);
  assert.equal(sameStudioVrmContactValues(Array(2), Array(2)), false);
  assert.equal(sameStudioVrmContactValues([1], [99], Infinity), false);
  assert.equal(sameStudioVrmContactValues([1], [1], -1), false);
  assert.equal(sameStudioVrmContactValues([1], [1 + 1e-8]), true);
});

const body = { min: [-0.5, 0, -0.2], max: [0.5, 1.8, 0.35] };
const landmarks = {
  head: [0, 1.55, 0], neck: [0, 1.43, 0],
  leftEye: [0.032, 1.64, 0.09], rightEye: [-0.032, 1.64, 0.09],
  chest: [0, 1.18, 0], leftUpperArm: [0.25, 1.38, 0], rightUpperArm: [-0.25, 1.38, 0],
};
const transformLandmarks = (fn) => Object.fromEntries(Object.entries(landmarks).map(([name, value]) => [name, fn(value)]));

test('portrait framing follows translation and scale for all portrait presets', () => {
  for (const id of ['closeup', 'dramaticEye', 'bust']) {
    const original = resolveStudioVrmPortraitBounds(id, body, landmarks);
    assert.ok(original);
    for (const scale of [0.2, 0.5, 1, 2, 5]) {
      const fn = (v) => [v[0] * scale + 3, v[1] * scale - 2, v[2] * scale + 4];
      const transformed = resolveStudioVrmPortraitBounds(id, { min: fn(body.min), max: fn(body.max) }, transformLandmarks(fn));
      assert.ok(transformed);
      for (const edge of ['min', 'max']) transformed[edge].forEach((value, axis) => near(value, fn(original[edge])[axis]));
    }
  }
});

test('lying portraits keep their head scale and rotate their headroom', () => {
  const fn = (v) => [v[1], v[0], -v[2]];
  const lyingBody = { min: [0, -0.5, -0.35], max: [1.8, 0.5, 0.2] };
  for (const id of ['closeup', 'dramaticEye', 'bust']) {
    const upright = resolveStudioVrmPortraitBounds(id, body, landmarks);
    const lying = resolveStudioVrmPortraitBounds(id, lyingBody, transformLandmarks(fn));
    assert.ok(upright && lying);
    near(lying.max[0] - lying.min[0], upright.max[1] - upright.min[1]);
    near(lying.max[1] - lying.min[1], upright.max[0] - upright.min[0]);
    near(lying.max[2] - lying.min[2], upright.max[2] - upright.min[2]);
  }
});

test('reclining a flattened body does not reject an otherwise usable head rig', () => {
  const flatBody = { min: [0, -0.01, -0.2], max: [1.8, 0.01, 0.2] };
  assert.ok(resolveStudioVrmPortraitBounds('closeup', flatBody, { head: [1.55, 0, 0], neck: [1.43, 0, 0] }));
});

test('stale neck and collapsed eye pairs use the safe landmark fallback', () => {
  const withoutNeck = resolveStudioVrmPortraitBounds('closeup', body, { head: landmarks.head });
  const staleNeck = resolveStudioVrmPortraitBounds('closeup', body, { head: landmarks.head, neck: [50, -50, 50] });
  assert.deepEqual(staleNeck, withoutNeck);
  const collapsedEyes = resolveStudioVrmPortraitBounds('closeup', body, { head: landmarks.head, leftEye: landmarks.head, rightEye: landmarks.head });
  assert.deepEqual(collapsedEyes, withoutNeck);
});

test('bust bounds include chest and shoulders without becoming a full-body crop', () => {
  const face = resolveStudioVrmPortraitBounds('closeup', body, landmarks);
  const bust = resolveStudioVrmPortraitBounds('bust', body, landmarks);
  assert.ok(face && bust);
  assert.ok(bust.min[1] < face.min[1]);
  assert.ok(bust.max[0] > face.max[0]);
  assert.ok(bust.min[1] > body.min[1]);
  for (const point of [landmarks.chest, landmarks.leftUpperArm, landmarks.rightUpperArm]) {
    point.forEach((value, axis) => assert.ok(value >= bust.min[axis] && value <= bust.max[axis]));
  }
});

test('invalid bounds and external landmarks never create non-finite camera regions', () => {
  for (const point of [[], Array(3), [NaN, 0, 0], [Infinity, 0, 0], [99, 99, 99]]) {
    assert.equal(resolveStudioVrmPortraitBounds('closeup', body, { head: point }), null);
  }
  assert.equal(resolveStudioVrmPortraitBounds('closeup', { min: [1, 1, 1], max: [0, 0, 0] }, landmarks), null);
  assert.equal(resolveStudioVrmPortraitBounds('closeup', { min: Array(3), max: [1, 1, 1] }, landmarks), null);
  for (const id of ['custom', 'overShoulder', 'front', 'fullBody']) assert.equal(resolveStudioVrmPortraitBounds(id, body, landmarks), null);
});

test('128 deterministic mixed-hand cases retain each baseline contact or improve it', () => {
  let seed = 749;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let sample = 0; sample < 128; sample += 1) {
    const sign = sample % 2 ? -1 : 1;
    const initial = Array.from({ length: 4 }, () => sign * (0.2 + random() * 0.9));
    const targets = Array.from({ length: 4 }, () => 0.2 + random() * 0.9);
    let angles = [...initial];
    const distances = () => angles.map((value, index) => Math.abs(Math.abs(value) - targets[index]));
    const before = distances();
    const result = refineStudioVrmContact({
      initial, limits: [1.4, 1.4, 1.4, 1.4], groups: [[0], [1], [2], [3]], goal: 0.01,
      allowRelaxation: true, maxAngularChange: 0.25,
      apply: (next) => { angles = [...next]; }, measure: () => Math.max(...distances()), measureContacts: distances,
    });
    assert.equal(result.restored, true);
    assert.ok(result.evaluations <= 64);
    assert.deepEqual(angles, result.angles);
    distances().forEach((distance, index) => {
      assert.ok(distance <= before[index] + 1e-9);
      assert.ok(Math.abs(angles[index] - initial[index]) <= 0.250000001);
      assert.equal(Math.sign(angles[index]), sign);
    });
  }
});

const cached = () => ({ input: [0.3, 0.4], output: [0.5, 0.6], shape: [0, 0, 1, 1], context: [0.02, 0.03, 1, 0, 1] });

test('replays a cached correction after the base pose resets the fingers', () => {
  const cache = cached();
  const plan = planStudioVrmContactReplay(cache, cache.input, cache.shape, cache.context);
  assert.equal(plan.kind, 'replay');
  assert.deepEqual(plan.angles, cache.output);
});

test('does not amplify an already corrected pose across 1000 unchanged frames', () => {
  const cache = cached();
  let current = [...cache.output];
  for (let frame = 0; frame < 1000; frame += 1) {
    const plan = planStudioVrmContactReplay(cache, current, cache.shape, cache.context);
    assert.equal(plan.kind, 'unchanged');
    current = [...plan.angles];
  }
  assert.deepEqual(current, cache.output);
});

test('a moved contact re-solves from the authored input rather than the previous correction', () => {
  const cache = cached();
  const plan = planStudioVrmContactReplay(cache, cache.output, cache.shape, [0.2, 0.3, 1, 0, 1]);
  assert.equal(plan.kind, 'solve');
  assert.deepEqual(plan.angles, cache.input);
});

test('new curl edits and changes to non-curl rotation or scale survive cache replay', () => {
  const cache = cached();
  const edited = [0.7, 0.9];
  const plan = planStudioVrmContactReplay(cache, edited, cache.shape, cache.context);
  assert.equal(plan.kind, 'solve');
  assert.deepEqual(plan.angles, edited);
  const changedShape = [0.1, 0, 1.4, 1];
  const newShape = planStudioVrmContactReplay(cache, cache.output, changedShape, cache.context);
  assert.equal(newShape.kind, 'solve');
  assert.deepEqual(newShape.angles, cache.output);
});

test('cleanup restores only the correction still owned by this pass', () => {
  const cache = cached();
  assert.deepEqual(releaseStudioVrmContactReplay(cache, cache.output, cache.shape), cache.input);
  assert.equal(releaseStudioVrmContactReplay(cache, [0.7, 0.9], cache.shape), null);
  assert.equal(releaseStudioVrmContactReplay(cache, cache.output, [0.1, 0, 1.4, 1]), null);
  assert.equal(releaseStudioVrmContactReplay(cache, cache.input, cache.shape), null);
  assert.equal(releaseStudioVrmContactReplay(null, cache.output, cache.shape), null);
});

test('invalid current values cannot match a cached pose or claim cleanup ownership', () => {
  const cache = cached();
  assert.equal(planStudioVrmContactReplay(cache, [NaN, 0.6], cache.shape, cache.context).kind, 'solve');
  assert.equal(releaseStudioVrmContactReplay(cache, [NaN, 0.6], cache.shape), null);
  assert.equal(releaseStudioVrmContactReplay(cache, cache.output, [NaN, 0, 1, 1]), null);
});

test('returned replay plans do not alias stored poses', () => {
  const cache = cached();
  const plan = planStudioVrmContactReplay(cache, cache.input, cache.shape, cache.context);
  plan.angles[0] = 999;
  assert.deepEqual(cache.output, [0.5, 0.6]);
  const release = releaseStudioVrmContactReplay(cache, cache.output, cache.shape);
  release[0] = 999;
  assert.deepEqual(cache.input, [0.3, 0.4]);
});
