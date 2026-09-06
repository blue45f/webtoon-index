import { strict as assert } from "node:assert";

import { test } from "vitest";

import {
  buildSpatialStoryboardPlan as build,
  normalizeSpatialStoryboardSettings as normalize,
  parseSpatialStoryboardSettings as parse,
  serializeSpatialStoryboardPlan as serialize,
  SPATIAL_STORYBOARD_DEFAULTS as defaults,
  SPATIAL_STORYBOARD_MAX_FILE_BYTES as maxBytes,
} from "./studio-bg3d-spatial-storyboard";

const shots = Array.from({ length: 9 }, (_, i) => ({ id: `shot-${i}`, name: `컷 ${i + 1}` }));
const file = (settings = defaults) => JSON.stringify({ kind: "toonstudio.spatial-storyboard-plan", version: 1, settings });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("defaults are stable and detached", () => { assert.deepEqual(normalize(), defaults); assert.notEqual(normalize(), defaults); });
test("empty scene produces zero pages", () => { assert.equal(build([]).pageCount, 0); assert.equal(build([]).panels.length, 0); });
test("focus assigns one shot per page", () => { const p = build(shots, { layout: "focus" }); assert.equal(p.pageCount, 9); assert.equal(p.panels[8]!.page, 8); });
test("focus remains centered in RTL", () => { for (const p of build(shots, { layout: "focus", direction: "rtl" }).panels) close(p.position[0], 0); });
test("wall keeps every panel on the same depth plane", () => { for (const p of build(shots, { layout: "wall" }).panels) { assert.equal(p.position[2], -2); assert.equal(p.yawDegrees, 0); } });
test("arc panels maintain the viewing radius", () => { for (const p of build(shots).panels) close(Math.hypot(p.position[0], p.position[2]), 2); });
test("arc panel normals point to the viewer", () => { for (const p of build(shots).panels) { const r = p.yawDegrees * Math.PI / 180; close(Math.sin(r), -p.position[0] / 2); close(Math.cos(r), -p.position[2] / 2); } });
test("RTL mirrors placement but not canonical reading IDs", () => { const a = build(shots); const b = build(shots, { direction: "rtl" }); a.panels.forEach((p, i) => { assert.equal(p.shotId, b.panels[i]!.shotId); close(p.position[0], -b.panels[i]!.position[0]); close(p.yawDegrees, -b.panels[i]!.yawDegrees); }); });
test("last page is centered rather than left aligned", () => { const p = build(shots); const last = p.panels.filter((x) => x.page === p.pageCount - 1); close(last.reduce((sum, x) => sum + x.position[0], 0), 0); });
test("distance is clamped to editorial bounds", () => { assert.equal(normalize({ distanceMeters: -1 }).distanceMeters, 0.75); assert.equal(normalize({ distanceMeters: 999 }).distanceMeters, 6); });
test("non-finite values fall back", () => { assert.equal(normalize({ panelWidthMeters: Infinity }).panelWidthMeters, defaults.panelWidthMeters); assert.equal(normalize({ distanceMeters: NaN }).distanceMeters, defaults.distanceMeters); });
test("numeric dimensions are bounded", () => { const p = normalize({ panelWidthMeters: -1, aspectRatio: 100, gapMeters: 0, eyeHeightMeters: 0, maxArcDegrees: 999 }); assert.equal(p.panelWidthMeters, 0.2); assert.equal(p.aspectRatio, 2.4); assert.equal(p.gapMeters, 0.02); assert.equal(p.eyeHeightMeters, 0.8); assert.equal(p.maxArcDegrees, 140); });
test("duplicate IDs are omitted with notice", () => { const p = build([shots[0]!, shots[0]!]); assert.equal(p.panels.length, 1); assert.equal(p.omittedCount, 1); assert.ok(p.warnings.length); });
test("external and prototype IDs are rejected", () => { const p = build(["https://bad.test", "__proto__", "constructor", "prototype", "", "a".repeat(81)].map((id) => ({ id, name: "bad" }))); assert.equal(p.panels.length, 0); assert.equal(p.omittedCount, 6); });
test("96-shot budget is enforced without mutating source", () => { const source = Array.from({ length: 120 }, (_, i) => Object.freeze({ id: `s${i}`, name: "A" })); Object.freeze(source); const p = build(source); assert.equal(p.panels.length, 96); assert.equal(p.omittedCount, 24); assert.equal(source.length, 120); });
test("long labels are bounded", () => assert.equal(build([{ id: "s", name: "가".repeat(200) }]).panels[0]!.label.length, 160));
test("blank labels receive a visible fallback", () => assert.equal(build([{ id: "s", name: "" }]).panels[0]!.label, "컷 1"));
test("panel height respects aspect ratio", () => close(build(shots, { panelWidthMeters: 1, aspectRatio: 2 }).panels[0]!.heightMeters, 0.5));
test("near-view warning is not silently suppressed", () => assert.ok(build(shots, { distanceMeters: 0.75 }).warnings.some((w) => w.includes("1m 미만"))));
test("oversized panel emits a field-of-view warning", () => assert.ok(build(shots, { distanceMeters: 0.75, panelWidthMeters: 2 }).warnings.some((w) => w.includes("넓은 시야"))));
test("panel wider than arc is called out", () => assert.ok(build(shots, { distanceMeters: 0.75, panelWidthMeters: 2, maxArcDegrees: 40 }).warnings.some((w) => w.includes("배치 범위"))));
test("below-floor placement is called out", () => assert.ok(build(shots, { panelWidthMeters: 2, aspectRatio: 0.5, eyeHeightMeters: 0.8 }).warnings.some((w) => w.includes("바닥"))));
test("JSON is explicitly planning-only", () => { const p = JSON.parse(serialize(build(shots))); assert.equal(p.status, "planning-only"); assert.equal(p.immersiveRuntimeIncluded, false); assert.equal(p.transition, "manual-cut"); });
test("export never spreads source camera or device fields", () => { const privateShot = { id: "s", name: "A", camera: { position: [123, 456, 789] }, xrPose: "secret", assetUrl: "https://example.test" }; const s = serialize(build([privateShot])); assert.ok(!s.includes("xrPose")); assert.ok(!s.includes("assetUrl")); assert.ok(!s.includes("camera")); });
test("all layouts round trip settings", () => { for (const layout of ["arc", "focus", "wall"] as const) assert.deepEqual(parse(serialize(build(shots, { layout }))), normalize({ layout })); });
test("maximum multibyte export remains importable", () => { const p = build(Array.from({ length: 96 }, (_, i) => ({ id: `s${i}`, name: "漫".repeat(160) }))); const text = serialize(p); assert.ok(new TextEncoder().encode(text).byteLength < maxBytes); assert.deepEqual(parse(text), defaults); });
test("settings import ignores all external scene commands", () => { const p = JSON.parse(file()); p.panels = [{ shotId: "delete-all", camera: "bad" }]; p.xrSession = {}; const s = parse(JSON.stringify(p)); assert.deepEqual(s, defaults); assert.equal(Object.keys(s).length, 8); });
test("invalid JSON is rejected", () => assert.throws(() => parse("{")));
test("null and array roots are rejected", () => { assert.throws(() => parse("null")); assert.throws(() => parse("[]")); });
test("unknown version is rejected", () => assert.throws(() => parse(file().replace('"version":1', '"version":2'))));
test("unknown kind is rejected", () => assert.throws(() => parse(file().replace("toonstudio.spatial-storyboard-plan", "unknown"))));
test("invalid layout is rejected", () => { const p = JSON.parse(file()); p.settings.layout = "fly"; assert.throws(() => parse(JSON.stringify(p))); });
test("invalid direction is rejected", () => { const p = JSON.parse(file()); p.settings.direction = "up"; assert.throws(() => parse(JSON.stringify(p))); });
test("missing numeric dimension is rejected", () => { const p = JSON.parse(file()); delete p.settings.distanceMeters; assert.throws(() => parse(JSON.stringify(p))); });
test("numeric strings are rejected", () => { const p = JSON.parse(file()); p.settings.distanceMeters = "2"; assert.throws(() => parse(JSON.stringify(p))); });
test("huge exponents are rejected", () => assert.throws(() => parse(file().replace('"distanceMeters":2', '"distanceMeters":1e309'))));
test("oversized input is rejected before parsing", () => assert.throws(() => parse(" ".repeat(maxBytes + 1))));
test("valid out-of-range import is clamped", () => assert.equal(parse(file({ ...defaults, distanceMeters: 999 })).distanceMeters, 6));
test("layout remains finite across deterministic boundary matrix", () => {
  for (const layout of ["arc", "focus", "wall"] as const) for (const distanceMeters of [0.75, 2, 6]) for (const panelWidthMeters of [0.2, 0.72, 2]) for (const maxArcDegrees of [40, 100, 140]) {
    const p = build(shots, { layout, distanceMeters, panelWidthMeters, maxArcDegrees });
    assert.equal(p.panels.length, shots.length);
    assert.ok(p.pageCount >= 1 && p.pageCount <= shots.length);
    for (const panel of p.panels) { assert.ok(panel.position.every(Number.isFinite)); assert.ok(Number.isFinite(panel.yawDegrees)); assert.ok(panel.position[2] < 0); }
  }
});
