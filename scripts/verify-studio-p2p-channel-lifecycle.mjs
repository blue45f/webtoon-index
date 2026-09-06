import assert from "node:assert/strict";
import { test } from "node:test";

import { bindStudioLiveP2pChannelLifecycle } from "../apps/web/src/domains/creator/live/studio-live-p2p-channel-lifecycle.ts";

class Channel {
  readyState = "connecting";
  onopen = null;
  onmessage = null;
  onclose = null;
  binaryType = "blob";
  closes = 0;
  capturedClose = null;
  close() {
    this.closes += 1;
    this.readyState = "closed";
    this.onclose?.({});
    this.capturedClose?.({});
  }
}

function harness() {
  const link = { closed: false, channel: null };
  const events = [];
  let active = true;
  const bind = (channel) => bindStudioLiveP2pChannelLifecycle({
    link, channel, isActive: () => active,
    resetNegotiation: () => events.push("reset"),
    onOpen: () => events.push("open"),
    onMessage: (value) => events.push(["message", value]),
    onClosed: () => events.push("closed"),
  });
  return { link, events, bind, deactivate: () => { active = false; } };
}

test("opens an already-open channel once and selects exact binary payloads", () => {
  const h = harness();
  const c = new Channel();
  c.readyState = "open";
  h.bind(c);
  c.onopen({});
  assert.equal(c.binaryType, "arraybuffer");
  assert.deepEqual(h.events, ["reset", "open"]);
});

test("channel-only closure releases its owner and resets negotiation", () => {
  const h = harness();
  const c = new Channel();
  h.bind(c);
  const queuedClose = c.onclose;
  c.close();
  queuedClose({});
  assert.equal(h.link.channel, null);
  assert.deepEqual(h.events, ["reset", "reset", "closed"]);
});

test("an old synchronous close cannot dispose its replacement", () => {
  const h = harness();
  const first = new Channel();
  h.bind(first);
  first.capturedClose = first.onclose;
  const next = new Channel();
  h.bind(next);
  assert.equal(h.link.channel, next);
  assert.equal(first.closes, 1);
  assert.deepEqual(h.events, ["reset", "reset"]);
});

test("queued old open and message callbacks cannot mutate the new channel", () => {
  const h = harness();
  const first = new Channel();
  h.bind(first);
  const oldOpen = first.onopen;
  const oldMessage = first.onmessage;
  const next = new Channel();
  h.bind(next);
  first.readyState = "open";
  oldOpen({});
  oldMessage({ data: "stale document update" });
  assert.deepEqual(h.events, ["reset", "reset"]);
  next.readyState = "open";
  next.onopen({});
  next.onmessage({ data: "current update" });
  assert.deepEqual(h.events.slice(-2), ["open", ["message", "current update"]]);
});

test("retired peer links ignore callbacks even when their channel is still open", () => {
  const h = harness();
  const c = new Channel();
  h.bind(c);
  h.deactivate();
  c.readyState = "open";
  c.onopen({});
  c.onmessage({ data: "retired generation" });
  c.onclose({});
  assert.deepEqual(h.events, ["reset"]);
});

test("closed peer links refuse new channels without reopening the session", () => {
  const h = harness();
  h.link.closed = true;
  const c = new Channel();
  h.bind(c);
  assert.equal(c.closes, 1);
  assert.equal(h.link.channel, null);
  assert.deepEqual(h.events, []);
});

test("closing channels fail immediately instead of stranding a peer link", () => {
  const h = harness();
  const c = new Channel();
  c.readyState = "closing";
  h.bind(c);
  assert.equal(h.link.channel, null);
  assert.deepEqual(h.events, ["reset", "reset", "closed"]);
});

test("rebinding the same channel preserves negotiated state and handlers", () => {
  const h = harness();
  const c = new Channel();
  h.bind(c);
  const message = c.onmessage;
  h.bind(c);
  assert.equal(c.onmessage, message);
  assert.equal(c.closes, 0);
  assert.deepEqual(h.events, ["reset"]);
});

test("messages received after closure are never forwarded", () => {
  const h = harness();
  const c = new Channel();
  h.bind(c);
  const message = c.onmessage;
  c.close();
  message({ data: "after-close update" });
  assert.deepEqual(h.events, ["reset", "reset", "closed"]);
});

test("a native close exception cannot prevent binding the replacement", () => {
  const h = harness();
  const first = new Channel();
  h.bind(first);
  first.close = () => { throw new Error("native channel already disposed"); };
  const next = new Channel();
  h.bind(next);
  assert.equal(h.link.channel, next);
  assert.deepEqual(h.events, ["reset", "reset"]);
});
