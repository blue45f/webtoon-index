/** Control-flow regression tests for production recording code with mocked browser/codec boundaries.
 * Not a substitute for Playwright native recording or the Remotion H.264 render gate.
 * Run: node tools/verify-studio-promo-recording.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(process.argv[2] ?? new URL("../apps/web/src/domains/creator/promo/promo-media.ts", import.meta.url), "utf8");
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal(diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);

async function recording({ preAborted = false, stopThrows = false, failFinalProgress = false, manualCapture = true, supportedMimes } = {}) { // NOSONAR javascript:S3776
  let clock = 0;
  let nextId = 0;
  let trackStops = 0;
  let frameRequests = 0;
  const contextOptions = [];
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const canvases = [];
  const recorders = [];
  const progress = [];
  const controller = new AbortController();
  if (preAborted) controller.abort();
  const track = { stop: () => { trackStops += 1; }, ...(manualCapture ? { requestFrame: () => { frameRequests += 1; } } : {}) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class Canvas {
    width = 0;
    height = 0;
    getContext(_kind, options) { contextOptions.push(options); return {}; }
    captureStream() { return stream; }
  }
  class Recorder {
    static isTypeSupported(mime) { return supportedMimes ? supportedMimes.includes(mime) : true; }
    state = "inactive";
    mimeType = "video/webm;codecs=vp9,opus";
    ondataavailable = null;
    onstop = null;
    onerror = null;
    constructor(_stream, options) { this.mimeType = options.mimeType; recorders.push(this); }
    start() { this.state = "recording"; }
    stop() {
      if (stopThrows) throw new Error("codec stop failed");
      this.state = "inactive";
      // Deliberately do not emit onstop: browsers flush final data first.
    }
  }
  const document = {
    hidden: false,
    createElement: () => { const canvas = new Canvas(); canvases.push(canvas); return canvas; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const mocks = {
    "./promo-canvas": { drawPromoFrame: () => {}, loadPromoImages: async () => new Map() },
    "./promo-model": {
      PROMO_FPS: 30,
      promoFrameCount: (project) => project.seconds * 30,
      promoSize: () => ({ width: 720, height: 1280 }),
    },
  };
  const exports = {};
  runInNewContext(outputText, {
    exports, require: (id) => { assert.ok(Object.hasOwn(mocks, id), `Unexpected import: ${id}`); return mocks[id]; },
    document, HTMLCanvasElement: Canvas, MediaRecorder: Recorder, Blob, DOMException,
    performance: { now: () => clock },
    requestAnimationFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const outcome = exports.recordPromoVideo({ seconds: 15, ratio: "9:16", panels: [{}], audio: null }, {
    signal: controller.signal,
    onProgress: (value) => {
      if (value === 1 && failFinalProgress) throw new Error("UI callback failed");
      progress.push(value);
    },
  }).then((blob) => ({ blob }), (error) => ({ error }));
  await new Promise((resolve) => setImmediate(resolve));
  const recorder = recorders[0];
  const data = (size) => recorder.ondataavailable?.({ data: size === undefined ? new Blob(["encoded-frame"]) : { size } });
  const tick = (now) => {
    clock = now;
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback(clock));
  };
  return {
    recorder, document, canvases, controller, progress, data, tick, contextOptions,
    frameRequests: () => frameRequests,
    end() {
      data();
      tick(15_000);
      tick(15_020);
      tick(15_040);
    },
    stopEvent() { recorder.onstop?.(); },
    hide() { document.hidden = true; listeners.get("visibilitychange")?.(); },
    timeout() { for (const callback of [...timers.values()]) callback(); },
    async result() {
      let timer;
      try {
        return await Promise.race([outcome, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("recording promise never settled")), 500); })]);
      } finally { clearTimeout(timer); }
    },
    cleaned() {
      assert.equal(trackStops, preAborted ? 0 : 1);
      assert.equal(listeners.size, 0);
      assert.equal(timers.size, 0);
      assert.equal(frames.size, 0);
      for (const canvas of canvases) { assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); }
    },
  };
}

async function rejectsRecording(context, pattern) {
  const result = await context.result();
  assert.ok(result.error, "an incomplete/failed recording must not produce a success blob");
  assert.match(result.error.message, pattern);
  assert.ok(!context.progress.includes(1), "failure must not report 100% success");
  context.cleaned();
}

test("normal recording resolves with supported MIME and releases resources", async () => {
  const context = await recording(); context.end(); context.stopEvent();
  const { blob, error } = await context.result();
  assert.equal(error, undefined); assert.ok(blob.size > 0); assert.match(blob.type, /^video\/webm/u);
  assert.equal(context.progress.at(-1), 1); context.cleaned();
});
test("oversized final data chunk is rejected after stop was requested", async () => {
  const context = await recording(); context.end(); context.data(150_000_001); context.stopEvent();
  await rejectsRecording(context, /용량 제한/u);
});
test("late encoder error is not ignored during final data flush", async () => {
  const context = await recording(); context.end(); context.recorder.onerror(); context.stopEvent();
  await rejectsRecording(context, /인코딩/u);
});
test("cancellation during final flush never downloads a successful blob", async () => {
  const context = await recording(); context.end(); context.controller.abort(); context.stopEvent();
  await rejectsRecording(context, /취소/u);
});
test("hiding the tab during final flush rejects the recording", async () => {
  const context = await recording(); context.end(); context.hide(); context.stopEvent();
  await rejectsRecording(context, /다른 탭/u);
});
test("already-aborted operation allocates no canvas or encoder", async () => {
  const context = await recording({ preAborted: true });
  await rejectsRecording(context, /취소/u);
  assert.equal(context.canvases.length, 0); assert.equal(context.recorder, undefined);
});
test("unexpected native stop rejects incomplete footage", async () => {
  const context = await recording(); context.data(); context.recorder.state = "inactive"; context.stopEvent();
  await rejectsRecording(context, /예상보다 일찍/u);
});
test("missing native stop event hits watchdog and releases resources", async () => {
  const context = await recording(); context.end(); context.timeout();
  await rejectsRecording(context, /제한 시간/u);
});
test("throwing encoder stop still settles and releases media tracks", async () => {
  const context = await recording({ stopThrows: true }); context.end();
  await rejectsRecording(context, /안전하게 종료/u);
});
test("failing final progress callback rejects instead of hanging", async () => {
  const context = await recording({ failFinalProgress: true }); context.end(); context.stopEvent();
  await rejectsRecording(context, /마무리/u);
});


test("default recording uses opaque canvas and lower-latency VP8", async () => {
  const context = await recording(); context.end(); context.stopEvent();
  const { blob } = await context.result();
  assert.equal(blob.type, "video/webm;codecs=vp8,opus");
  assert.equal(context.contextOptions[0].alpha, false);
  assert.equal(context.frameRequests(), 1);
  context.cleaned();
});
test("the final canvas frame gets a paint opportunity before native stop", async () => {
  const context = await recording(); context.data(); context.tick(15_000);
  assert.equal(context.recorder.state, "recording");
  assert.equal(context.frameRequests(), 1);
  context.tick(15_020);
  assert.equal(context.recorder.state, "recording");
  context.tick(15_040);
  assert.equal(context.recorder.state, "inactive");
  context.stopEvent();
  assert.ok((await context.result()).blob.size > 0);
  context.cleaned();
});
test("cancellation while the final canvas frame is being painted still rejects", async () => {
  const context = await recording(); context.data(); context.tick(15_000);
  context.controller.abort(); context.stopEvent();
  await rejectsRecording(context, /취소/u);
});
test("automatic canvas capture remains usable without requestFrame", async () => {
  const context = await recording({ manualCapture: false }); context.end(); context.stopEvent();
  assert.ok((await context.result()).blob.size > 0);
  context.cleaned();
});
test("VP9-only environments retain their correctly labeled supported fallback", async () => {
  const context = await recording({ supportedMimes: ["video/webm;codecs=vp9,opus"] });
  context.end(); context.stopEvent();
  assert.equal((await context.result()).blob.type, "video/webm;codecs=vp9,opus");
  context.cleaned();
});
