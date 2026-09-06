/** Tests the production playback effect using mocked React hooks, JSX and browser events.
 * No React renderer or real browser is used. Run the Playwright gate separately.
 * Run: node tools/verify-studio-promo-preview.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(process.argv[2] ?? new URL("../apps/web/src/domains/creator/promo/PromoPreview.tsx", import.meta.url), "utf8");
const { outputText, diagnostics } = ts.transpileModule(source, {
  fileName: "PromoPreview.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  reportDiagnostics: true,
});
assert.equal(diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);

function preview({ hidden = false, hasAudio = true, playing = true } = {}) {
  let pauses = 0;
  let nextId = 0;
  let refIndex = 0;
  let stateIndex = 0;
  const effects = [];
  const listeners = new Set();
  const frames = new Map();
  const values = [new Map(), 0, playing, "", false];
  const audio = hasAudio ? { pause: () => { pauses += 1; }, volume: 0 } : null;
  const refs = [{ current: null }, { current: audio }, { current: 0 }, { current: null }];
  const document = {
    hidden,
    addEventListener: (type, listener) => { assert.equal(type, "visibilitychange"); listeners.add(listener); },
    removeEventListener: (type, listener) => { assert.equal(type, "visibilitychange"); listeners.delete(listener); },
  };
  const react = {
    useRef: () => refs[refIndex++],
    useState: () => {
      const index = stateIndex++;
      return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useEffect: (effect, dependencies) => { effects.push({ effect, dependencies }); },
  };
  const jsx = (type, props) => ({ type, props });
  const project = {
    title: "fixture", ratio: "9:16", seconds: 15, panels: [],
    audio: hasAudio ? { src: "fixture", volume: 0.25 } : null,
  };
  const exports = {};
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "./promo-canvas": { drawPromoFrame: () => {}, loadPromoImages: async () => new Map() },
    "./promo-model": { PROMO_FPS: 30, promoAudioGain: () => 0.25, promoFrameCount: () => 450, promoSize: () => ({ width: 480, height: 854 }) },
  };
  runInNewContext(outputText, {
    exports, document, AbortController, encodeURIComponent,
    requestAnimationFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => { frames.delete(id); },
    require: (name) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  exports.PromoPreview({ project, disabled: false });
  // Execute only the real playback effect. This deliberately does not simulate React scheduling.
  const playback = effects.filter(({ dependencies }) => dependencies.length === 3 && dependencies[0] === playing && dependencies[1] === 450);
  assert.equal(playback.length, 1, "Playback effect must be located unambiguously");
  const cleanup = playback[0].effect();
  return {
    frames, listeners, values,
    cleanup: () => cleanup?.(),
    pauses: () => pauses,
    visibility: (value) => { document.hidden = value; for (const listener of [...listeners]) listener(); },
    tick: (now) => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(now); },
  };
}

test("visibility change pauses audio immediately without needing a new animation frame", () => {
  const run = preview();
  assert.equal(run.frames.size, 1);
  run.visibility(true);
  assert.equal(run.pauses(), 1);
  assert.equal(run.frames.size, 0);
  assert.equal(run.values[2], false);
  run.visibility(false);
  assert.equal(run.frames.size, 0, "Returning to the tab must not auto-resume playback");
  assert.equal(run.values[2], false);
  run.cleanup();
  assert.equal(run.listeners.size, 0);
});

test("an already-hidden tab does not leave audio or frames running", () => {
  const run = preview({ hidden: true });
  assert.equal(run.pauses(), 1);
  assert.equal(run.frames.size, 0);
  assert.equal(run.values[2], false);
  run.cleanup();
});

test("visibility cancellation works without a BGM element", () => {
  const run = preview({ hasAudio: false });
  run.visibility(true);
  assert.equal(run.frames.size, 0);
  assert.equal(run.values[2], false);
  run.cleanup();
});

test("visible playback advances and cleanup releases its callbacks", () => {
  const run = preview();
  run.tick(1000);
  run.tick(2000);
  assert.equal(run.values[1], 30);
  assert.equal(run.frames.size, 1);
  run.cleanup();
  assert.equal(run.frames.size, 0);
  assert.equal(run.listeners.size, 0);
  assert.equal(run.pauses(), 1);
  run.visibility(true);
  assert.equal(run.pauses(), 1, "Unmounted listener must not fire again");
});

test("paused preview pauses audio without allocating a playback loop", () => {
  const run = preview({ playing: false });
  assert.equal(run.pauses(), 1);
  assert.equal(run.frames.size, 0);
  assert.equal(run.listeners.size, 0);
  run.cleanup();
});
