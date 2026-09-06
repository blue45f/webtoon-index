import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
// Execute the production controller verbatim, without a separate copied model or a DOM package.
const source = readFileSync(new URL("../apps/web/src/domains/creator/studio-2d-image-readiness.ts", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const { observeStudio2dImage } = process.env.VITEST
  ? await import("../apps/web/src/domains/creator/studio-2d-image-readiness.ts")
  : await import(/* @vite-ignore */ moduleUrl);
class FakeImage extends EventTarget {
  src = "/test.png";
  loading = "eager";
  complete = false;
  naturalWidth = 1200;
  naturalHeight = 800;
  getAttribute(name) { return name === "src" ? this.src : null; }
  load() { this.dispatchEvent(new Event("load")); }
  fail() { this.dispatchEvent(new Event("error")); }
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => queueMicrotask(resolve));
function setup(image, expected, timeout = 10000) {
  const states = [];
  const dispose = observeStudio2dImage(image, expected, (state) => states.push(state), timeout);
  return { states, dispose, latest: () => states.at(-1) };
}

test("insertion stays blocked until the real decode promise resolves", async () => {
  const image = new FakeImage(), decode = deferred(); image.decode = () => decode.promise;
  const run = setup(image);
  try {
    image.load(); assert.equal(run.latest().status, "loading");
    decode.resolve(); await flush(); assert.equal(run.latest().status, "ready");
    assert.deepEqual(run.latest().pixels, { width: 1200, height: 800 });
  } finally { run.dispose(); }
});
test("a rejected or synchronously throwing decoder cannot produce readiness", async () => {
  for (const decode of [() => Promise.reject(new Error("decode")), () => { throw new Error("decode"); }]) {
    const image = new FakeImage(); image.decode = decode; const run = setup(image);
    try { image.load(); await flush(); assert.equal(run.latest().reason, "decode"); } finally { run.dispose(); }
  }
});
test("a stalled request times out and late success cannot revive it", async () => {
  const image = new FakeImage(); const run = setup(image, undefined, 10);
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(run.latest().reason, "timeout");
    image.load(); assert.equal(run.latest().status, "error");
  } finally { run.dispose(); }
});
test("a stalled decoder times out and a late promise cannot revive it", async () => {
  const image = new FakeImage(), decode = deferred(); image.decode = () => decode.promise;
  const run = setup(image, undefined, 10);
  try {
    image.load(); await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(run.latest().reason, "timeout");
    decode.resolve(); await flush(); assert.equal(run.latest().status, "error");
  } finally { run.dispose(); }
});
test("unmount removes event handlers and discards in-flight decoding", async () => {
  const image = new FakeImage(), decode = deferred(); image.decode = () => decode.promise;
  const run = setup(image); image.load(); run.dispose(); const count = run.states.length;
  decode.resolve(); await flush(); image.fail(); image.load(); assert.equal(run.states.length, count);
});
test("a changed source cannot inherit a pending decode result", async () => {
  const image = new FakeImage(), decode = deferred(); image.decode = () => decode.promise;
  const run = setup(image);
  try {
    image.load(); image.src = "/replacement.png"; decode.resolve(); await flush();
    assert.equal(run.latest().status, "loading");
  } finally { run.dispose(); }
});
test("cached success is decoded even if load already fired", () => {
  const image = new FakeImage(); image.complete = true; const run = setup(image);
  try { assert.equal(run.latest().status, "ready"); } finally { run.dispose(); }
});
test("complete=true on a broken image never counts as success", () => {
  const image = new FakeImage(); image.complete = true; image.naturalWidth = 0; const run = setup(image);
  try { assert.equal(run.latest().status, "error"); } finally { run.dispose(); }
});
test("mismatches retain observed dimensions and remain blocked", () => {
  const image = new FakeImage(); const run = setup(image, { width: 1500, height: 800 });
  try { image.load(); assert.equal(run.latest().status, "mismatch"); assert.equal(run.latest().pixels.width, 1200); } finally { run.dispose(); }
});
test("zero, non-integral or oversized dimensions are rejected", () => {
  for (const [width, height] of [[0, 20], [NaN, 20], [1200.5, 20], [8193, 100], [8192, 8192]]) {
    const image = new FakeImage(); image.naturalWidth = width; image.naturalHeight = height; const run = setup(image);
    try { image.load(); assert.equal(run.latest().reason, "dimensions"); } finally { run.dispose(); }
  }
});
test("error and duplicate load events cannot authorize or repeatedly decode a file", async () => {
  const image = new FakeImage(), decode = deferred(); let calls = 0; image.decode = () => { calls++; return decode.promise; };
  const run = setup(image);
  try {
    image.load(); image.load(); assert.equal(calls, 1); image.fail(); decode.resolve(); await flush();
    assert.equal(run.latest().status, "error");
  } finally { run.dispose(); }
});
test("lazy offscreen images have no deadline until they approach the viewport", async () => {
  const original = globalThis.IntersectionObserver; let intersect; let disconnects = 0;
  globalThis.IntersectionObserver = class { constructor(callback) { intersect = callback; } observe() { return undefined; } disconnect() { disconnects++; } };
  const image = new FakeImage(); image.loading = "lazy"; const run = setup(image, undefined, 10);
  try {
    await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(run.latest().status, "loading");
    intersect([{ isIntersecting: false }]); await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(run.latest().status, "loading");
    intersect([{ isIntersecting: true }]); await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(run.latest().reason, "timeout"); assert.ok(disconnects > 0);
  } finally { run.dispose(); if (original === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = original; }
});
test("retry lifecycle and strict-mode-style setup-cleanup-setup do not leak results", async () => {
  const image = new FakeImage(), decode = deferred(); image.decode = () => decode.promise;
  const first = setup(image); image.load(); first.dispose();
  image.decode = () => Promise.resolve(); const retry = setup(image);
  try {
    image.load(); await flush(); assert.equal(retry.latest().status, "ready");
    decode.reject(new Error("old attempt")); await flush(); assert.equal(retry.latest().status, "ready");
    assert.equal(first.latest().status, "loading");
  } finally { retry.dispose(); }
});
