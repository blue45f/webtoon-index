import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { LESSONS, READINGS, TERMS } from "./learning-content";
import { canComplete, clamp, depthPoint, EMPTY_LESSON, emptyProgress, LAST_FRAME, matchesSearch, parseProgress, timelineReducer } from "./learning-model";

const termIds = TERMS.map((term) => term.id);
const parse = (value: unknown) => parseProgress(JSON.stringify(value), LESSONS, termIds);

describe("webtoon learning content contract", () => {
  it("ships ten original lessons and thirty-six unique terms", () => {
    assert.equal(LESSONS.length, 10);
    assert.equal(TERMS.length, 36);
    assert.equal(new Set(LESSONS.map((item) => item.id)).size, LESSONS.length);
    assert.equal(new Set(termIds).size, TERMS.length);
    assert.equal(LESSONS.filter((item) => item.track === "studio").length, 2);
    assert.equal(new Set(LESSONS.map((item) => item.lab)).size, 6);
  });
  it("has valid source links, cross-links, exercises and quizzes for every lesson", () => {
    for (const lesson of LESSONS) {
      assert.match(lesson.id, /^[a-z0-9-]+$/u);
      assert.equal(lesson.sections.length, 3);
      assert.ok(lesson.sections.every((section) => section.title && section.text.length > 80));
      assert.ok(lesson.task && lesson.mistake && lesson.checks.length >= 3);
      assert.ok(lesson.quiz.answer >= 0 && lesson.quiz.answer < lesson.quiz.options.length);
      assert.ok(lesson.quiz.explanation);
      assert.ok(lesson.terms.every((term) => termIds.includes(term)));
      assert.ok(lesson.sources.length > 0);
      assert.ok(lesson.sources.every((id) => READINGS[id]?.url.startsWith("https://")));
    }
  });
  it("gives every term a definition, example, caution and real lesson", () => {
    for (const term of TERMS) {
      assert.ok(term.definition && term.example && term.caution && term.english);
      assert.ok(LESSONS.some((lesson) => lesson.id === term.lesson));
    }
  });
});

describe("search and progress validation", () => {
  it("searches Korean spacing and English case without a network request", () => {
    assert.equal(matchesSearch("소 실 점", ["소실점"]), true);
    assert.equal(matchesSearch("CLIPPING", ["Clipping"]), true);
    assert.equal(matchesSearch("　", ["밑색"]), true);
    assert.equal(matchesSearch("ｐａｎｅｌ", ["Panel"]), true);
    assert.equal(matchesSearch("없는 단어", ["콘티"]), false);
  });
  it("creates independent empty records", () => {
    const first = emptyProgress(); first.bookmarks.push("panel");
    assert.deepEqual(emptyProgress().bookmarks, []);
  });
  it("recovers from malformed, missing and oversized storage", () => {
    for (const raw of [null, "", "{", "null", "[]", "x".repeat(200001)]) {
      assert.deepEqual(parseProgress(raw, LESSONS, termIds), emptyProgress());
    }
    assert.deepEqual(parse({ version: 2, lessons: {} }), emptyProgress());
  });
  it("ignores unknown lessons and invalid bookmarks", () => {
    const result = parse({ version: 1, lessons: { unknown: { completed: true } }, bookmarks: ["panel", "panel", "no-such-term", null, 7] });
    assert.deepEqual(result.lessons, {});
    assert.deepEqual(result.bookmarks, ["panel"]);
  });
  it("rejects a forged completion flag", () => {
    const lesson = LESSONS[0];
    const result = parse({ version: 1, lessons: { [lesson.id]: { completed: true, checks: [], answer: lesson.quiz.answer } } });
    assert.equal(result.lessons[lesson.id].completed, false);
    assert.equal(canComplete(lesson, EMPTY_LESSON), false);
  });
  it("preserves completion only with every check and the correct answer", () => {
    const lesson = LESSONS[0];
    const progress = { completed: true, checks: lesson.checks.map((_, index) => index), answer: lesson.quiz.answer, notes: "실습 메모" };
    assert.equal(canComplete(lesson, progress), true);
    assert.deepEqual(parse({ version: 1, lessons: { [lesson.id]: progress } }).lessons[lesson.id], progress);
    assert.equal(canComplete(lesson, { ...progress, answer: (lesson.quiz.answer + 1) % lesson.quiz.options.length }), false);
  });
  it("bounds notes, choice indexes and checklist indexes", () => {
    const id = LESSONS[0].id;
    const result = parse({ version: 1, lessons: { [id]: { checks: [0, 0, -1, 1.5, 999, "1"], answer: 999, notes: "가".repeat(5000), completed: true } } }).lessons[id];
    assert.deepEqual(result.checks, [0]);
    assert.equal(result.answer, null);
    assert.equal(result.notes.length, 4000);
    assert.equal(result.completed, false);
  });
  it("preserves notes as plain strings and rejects invalid record shapes", () => {
    const id = LESSONS[0].id;
    const notes = "<script>alert(1)</script>";
    assert.equal(parse({ version: 1, lessons: { [id]: { notes } } }).lessons[id].notes, notes);
    assert.deepEqual(parse({ version: 1, lessons: [] }).lessons, {});
    assert.deepEqual(parse({ version: 1, lessons: { [id]: null } }).lessons, {});
  });
});

describe("bounded explanatory timeline and perspective geometry", () => {
  it("is paused initially and does not advance while paused", () => {
    const state = { frame: 0, playing: false };
    assert.strictEqual(timelineReducer(state, { type: "tick", delta: 10 }), state);
    assert.deepEqual(timelineReducer(state, { type: "toggle" }), { frame: 0, playing: true });
  });
  it("seeks within range and pauses", () => {
    assert.deepEqual(timelineReducer({ frame: 100, playing: true }, { type: "seek", frame: -4 }), { frame: 0, playing: false });
    assert.equal(timelineReducer({ frame: 0, playing: true }, { type: "seek", frame: 900 }).frame, LAST_FRAME);
    assert.equal(timelineReducer({ frame: 0, playing: true }, { type: "seek", frame: Number.NaN }).frame, 0);
  });
  it("stops at the end and replays from the beginning", () => {
    const ended = timelineReducer({ frame: 295, playing: true }, { type: "tick", delta: 10 });
    assert.deepEqual(ended, { frame: LAST_FRAME, playing: false });
    assert.deepEqual(timelineReducer(ended, { type: "toggle" }), { frame: 0, playing: true });
  });
  it("limits elapsed time after a suspended tab", () => {
    assert.equal(timelineReducer({ frame: 100, playing: true }, { type: "tick", delta: 10000 }).frame, 115);
    assert.equal(timelineReducer({ frame: 100, playing: true }, { type: "tick", delta: -5 }).frame, 100);
    assert.equal(timelineReducer({ frame: 100, playing: true }, { type: "tick", delta: Infinity }).frame, 100);
  });
  it("converges projected corners on the same vanishing point", () => {
    assert.deepEqual(depthPoint(100, 200, 460, 130, 0), [100, 200]);
    assert.deepEqual(depthPoint(100, 200, 460, 130, 1), [460, 130]);
    assert.deepEqual(depthPoint(100, 200, 460, 130, .5), [280, 165]);
    assert.equal(clamp(Infinity, 0, 100), 0);
  });
});
