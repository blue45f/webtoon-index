import assert from "node:assert/strict";

import { test } from "vitest";

import { CREATOR_HOME_SECTIONS, bindCreatorSectionNavigation, creatorSectionFromHash, creatorWorkflowIndex, focusCreatorSection, isPlainCreatorJump, type CreatorNavigationHost } from "./creator-home-navigation";

test("public jump links have unique targets and bilingual labels", () => {
  assert.equal(new Set(CREATOR_HOME_SECTIONS.map((section) => section.id)).size, 4);
  for (const section of CREATOR_HOME_SECTIONS) {
    assert(section.ko.length > 0 && section.en.length > 0);
    assert.equal(creatorSectionFromHash(`#${section.id}`), section);
  }
});

test("the existing film fragment resolves to its readable heading", () => {
  assert.equal(creatorSectionFromHash("#creator-film")?.headingId, "creator-film-title");
  assert.equal(creatorSectionFromHash("#creator-%66ilm")?.id, "creator-film");
});

for (const hash of ["", "#", "creator-film", "#unknown", "#%E0%A4%A", "#%", "#%2563reator-film", "#creator-film?play=1", "#creator-film\"[onclick]", "#creator-film/../../studio", `#${"a".repeat(200)}`]) {
  test(`unknown or malformed fragment does not become a selector: ${hash.slice(0, 40)}`, () => {
    assert.equal(creatorSectionFromHash(hash), undefined);
    assert.equal(focusCreatorSection(hash, () => { throw new Error("Must not query the DOM"); }), false);
  });
}

test("left and right wrap around the three available workflows", () => {
  assert.equal(creatorWorkflowIndex("ArrowRight", 2, 3), 0);
  assert.equal(creatorWorkflowIndex("ArrowLeft", 0, 3), 2);
  assert.equal(creatorWorkflowIndex("ArrowRight", 0, 3), 1);
  assert.equal(creatorWorkflowIndex("ArrowLeft", 2, 3), 1);
});

test("Home and End select the boundary workflows without hijacking native activation", () => {
  assert.equal(creatorWorkflowIndex("Home", 2, 3), 0);
  assert.equal(creatorWorkflowIndex("End", 0, 3), 2);
  for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "Escape"]) {
    assert.equal(creatorWorkflowIndex(key, 1, 3), null);
  }
});

test("invalid counts are rejected and invalid selected indexes normalize safely", () => {
  for (const count of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(creatorWorkflowIndex("End", 0, count), null);
  }
  for (const current of [-1, 5, 1.5, Number.NaN, Infinity]) {
    assert.equal(creatorWorkflowIndex("ArrowRight", current, 3), 1);
  }
  assert.equal(creatorWorkflowIndex("ArrowLeft", 0, 1), 0);
});

test("modifier and non-primary clicks keep their browser behavior", () => {
  const event = { button: 0, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  assert.equal(isPlainCreatorJump(event), true);
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "defaultPrevented"] as const) {
    assert.equal(isPlainCreatorJump({ ...event, [modifier]: true }), false);
  }
  assert.equal(isPlainCreatorJump({ ...event, button: 1 }), false);
  assert.equal(isPlainCreatorJump({ ...event, button: 2 }), false);
});

test("focus follows the known heading without a second native click scroll", () => {
  const calls: unknown[] = [];
  assert.equal(focusCreatorSection("#creator-film", (id) => {
    assert.equal(id, "creator-film-title");
    return { focus: (options) => calls.push(options), scrollIntoView: () => { throw new Error("Do not scroll twice"); } };
  }), true);
  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.equal(focusCreatorSection("#creator-film", () => null), false);
});

function navigationHarness(initialHash = "#creator-film") {
  let hash = initialHash;
  let serial = 0;
  let subscription: (() => void) | undefined;
  let unsubscribed = 0;
  const frames = new Map<number, () => void>();
  const cancelled: number[] = [];
  const calls: unknown[][] = [];
  const host: CreatorNavigationHost = {
    getHash: () => hash,
    findTarget: (id) => ({
      scrollIntoView: (options) => calls.push(["scroll", id, options]),
      focus: (options) => calls.push(["focus", id, options]),
    }),
    requestFrame: (callback) => { frames.set(++serial, callback); return serial; },
    // Retain cancelled callbacks so tests can deliberately run an already queued one.
    cancelFrame: (id) => { cancelled.push(id); },
    subscribe: (callback) => {
      subscription = callback;
      return () => { unsubscribed += 1; subscription = undefined; };
    },
  };
  return {
    host, calls, frames, cancelled,
    get unsubscribed() { return unsubscribed; },
    change(value: string, notify = true) { hash = value; if (notify) subscription?.(); },
    flush(id: number) { const callback = frames.get(id); frames.delete(id); callback?.(); },
  };
}

test("lazy initial fragment lands after mount with instant scrolling and readable focus", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  assert.equal(h.calls.length, 0);
  h.flush(1);
  assert.deepEqual(h.calls, [
    ["scroll", "creator-film-title", { block: "start", behavior: "instant" }],
    ["focus", "creator-film-title", { preventScroll: true }],
  ]);
  dispose();
});

test("initial homepage without a known fragment leaves focus and scroll untouched", () => {
  const h = navigationHarness("");
  const dispose = bindCreatorSectionNavigation(h.host);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.calls, []);
  dispose();
});

test("rapid fragment navigation focuses only the newest destination", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  h.change("#creator-process-title");
  h.change("#creator-faq-title");
  assert.deepEqual(h.cancelled, [1, 2]);
  h.flush(1); h.flush(2);
  assert.deepEqual(h.calls, []);
  h.flush(3);
  assert.equal(h.calls[1][1], "creator-faq-title");
  dispose();
});

test("returning to the same hash cannot revive an older scheduled focus", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  h.change("#creator-faq-title");
  h.change("#creator-film");
  h.flush(1);
  assert.deepEqual(h.calls, []);
  h.flush(3);
  assert.equal(h.calls.length, 2);
  dispose();
});

test("native back and forward fragment changes remain actionable", () => {
  const h = navigationHarness("#creator-faq-title");
  const dispose = bindCreatorSectionNavigation(h.host);
  h.flush(1);
  h.change("#creator-film"); h.flush(2);
  h.change("#creator-faq-title"); h.flush(3);
  assert.deepEqual(h.calls.filter((call) => call[0] === "focus").map((call) => call[1]), ["creator-faq-title", "creator-film-title", "creator-faq-title"]);
  dispose();
});

test("an invalid new fragment cancels the pending focus", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  h.change("#%E0%A4%A");
  h.flush(1);
  assert.deepEqual(h.calls, []);
  dispose();
});

test("a changed URL without an event cannot apply an obsolete destination", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  h.change("#creator-faq-title", false);
  h.flush(1);
  assert.deepEqual(h.calls, []);
  dispose();
});

test("unmount cancels delayed focus and unsubscribes exactly once", () => {
  const h = navigationHarness();
  const dispose = bindCreatorSectionNavigation(h.host);
  dispose(); dispose();
  h.flush(1); h.change("#creator-faq-title");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.cancelled, [1]);
  assert.equal(h.unsubscribed, 1);
  assert.equal(h.frames.size, 0);
});
