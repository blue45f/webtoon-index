import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  beginStudioStrokePointerSession,
  claimStudioStrokeMoveTransport,
  collectStudioStrokePointerBatch,
  isStudioTopLevelWindowBlur,
  isStudioLeftContactDown,
  isStudioStrokePointerEvent,
  normalizeStudioPointerSampleChannelsV2,
  resolveStudioPointerCaptureLoss,
  STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS,
  shouldCancelStudioFingerStrokeForAdditionalContact,
  shouldCommitStudioStrokeOnPointerCancel,
  shouldEndStudioStrokeForReleasedContact,
  shouldPreserveStudioStrokeOnTransportAbort,
  tryCaptureStudioStrokePointer,
  tryReleaseStudioStrokePointer,
  type StudioPointerEventLike,
} from "./studio-pointer-input";

const pointerInputSource = readFileSync(new URL("./studio-pointer-input.ts", import.meta.url), "utf8");

function sample(
  x: number,
  overrides: Partial<StudioPointerEventLike> = {}
): StudioPointerEventLike {
  return {
    pointerId: 7,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: x + 1,
    pressure: 0.5,
    tangentialPressure: 0,
    tiltX: 10,
    tiltY: -5,
    altitudeAngle: 1,
    azimuthAngle: 0.2,
    twist: 20,
    width: 1,
    height: 1,
    timeStamp: x,
    ...overrides,
  };
}

describe("studio pointer input", () => {
  it("normalizes the full Pointer Events sensor set without retaining a device identifier", () => {
    const result = normalizeStudioPointerSampleChannelsV2(sample(-0, {
      clientX: -0,
      clientY: 12,
      pressure: 0.75,
      tangentialPressure: -0.4,
      tiltX: -35,
      tiltY: 18,
      altitudeAngle: Math.PI / 3,
      azimuthAngle: Math.PI * 2,
      twist: 360,
      width: 8.5,
      height: 4.25,
      timeStamp: 12_345.5,
    }), "authoritative");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      authority: "authoritative",
      persistence: "durable",
      pointerId: 7,
      pointerType: "pen",
      clientX: 0,
      clientY: 12,
      pressure: 0.75,
      tangentialPressure: -0.4,
      tiltX: -35,
      tiltY: 18,
      altitudeAngle: Math.PI / 3,
      azimuthAngle: 0,
      twist: 0,
      contactWidth: 8.5,
      contactHeight: 4.25,
      sourceTimeMilliseconds: 12_345.5,
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect("persistentDeviceId" in result.value).toBe(false);
  });

  it("marks predictions preview-only and materializes only Pointer Events neutral defaults", () => {
    const result = normalizeStudioPointerSampleChannelsV2({
      pointerId: undefined,
      pointerType: "future-vendor-pointer",
      clientX: 10,
      clientY: 20,
    }, "predicted-preview");

    expect(result).toEqual({
      ok: true,
      value: {
        authority: "predicted-preview",
        persistence: "preview-only",
        pointerId: 1,
        pointerType: "unknown",
        clientX: 10,
        clientY: 20,
        pressure: 0,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        altitudeAngle: Math.PI / 2,
        azimuthAngle: 0,
        twist: 0,
        contactWidth: 1,
        contactHeight: 1,
        sourceTimeMilliseconds: 0,
      },
    });
  });

  it("fails closed on malformed, unbounded, or accessor-backed sensor channels", () => {
    const normalize = (overrides: Partial<StudioPointerEventLike>) =>
      normalizeStudioPointerSampleChannelsV2(sample(1, overrides), "authoritative");

    expect(normalize({ pressure: 1.01 })).toEqual({
      ok: false,
      reason: "invalid-pressure",
    });
    expect(normalize({ tangentialPressure: -1.01 })).toEqual({
      ok: false,
      reason: "invalid-pressure",
    });
    expect(normalize({ altitudeAngle: Math.PI })).toEqual({
      ok: false,
      reason: "invalid-orientation",
    });
    expect(normalize({ azimuthAngle: -0.01 })).toEqual({
      ok: false,
      reason: "invalid-orientation",
    });
    expect(normalize({
      width: STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxContactDimension + 1,
    })).toEqual({
      ok: false,
      reason: "invalid-contact-geometry",
    });
    expect(normalize({ timeStamp: Number.POSITIVE_INFINITY })).toEqual({
      ok: false,
      reason: "invalid-timestamp",
    });
    expect(normalize({
      clientX:
        STUDIO_POINTER_SAMPLE_CHANNELS_V2_LIMITS.maxClientCoordinateAbsolute + 1,
    })).toEqual({
      ok: false,
      reason: "invalid-coordinate",
    });

    const detached = {
      ...sample(1),
      get altitudeAngle(): never {
        throw new Error("detached PointerEvent");
      },
    };
    expect(normalizeStudioPointerSampleChannelsV2(
      detached,
      "authoritative",
    )).toEqual({
      ok: false,
      reason: "invalid-pointer",
    });
  });

  it("opens only a primary left-contact stroke and keeps a legacy Safari pointer fallback", () => {
    expect(beginStudioStrokePointerSession(sample(1, { isPrimary: false }))).toBeNull();
    expect(beginStudioStrokePointerSession(sample(1, { button: 2 }))).toBeNull();
    expect(beginStudioStrokePointerSession(sample(1, { button: 0, buttons: 2 }))).toBeNull();
    expect(beginStudioStrokePointerSession(sample(1, { button: -1 }))).toMatchObject({
      pointerId: 7,
      pointerType: "pen",
    });
    expect(beginStudioStrokePointerSession(sample(1, { pointerType: "mouse", button: -1, buttons: 1 }))).toMatchObject({
      pointerId: 7,
      pointerType: "mouse",
    });
    expect(beginStudioStrokePointerSession(sample(1, { pointerType: "mouse", buttons: 1 }))).toMatchObject({
      pointerId: 7,
      pointerType: "mouse",
    });

    expect(beginStudioStrokePointerSession(sample(1))).toMatchObject({ pointerId: 7, pointerType: "pen" });
    expect(beginStudioStrokePointerSession(sample(1, { pointerId: undefined }))?.pointerId).toBe(1);
    expect(beginStudioStrokePointerSession(sample(1, { pointerId: Number.NaN }))).toBeNull();
    expect(beginStudioStrokePointerSession(sample(1, { pointerId: -1 }))).toBeNull();
  });

  it("treats mouse left contact via buttons mask and rejects middle/right", () => {
    expect(isStudioLeftContactDown(sample(1, { pointerType: "mouse", button: 0, buttons: 1 }))).toBe(true);
    expect(isStudioLeftContactDown(sample(1, { pointerType: "mouse", button: -1, buttons: 1 }))).toBe(true);
    expect(isStudioLeftContactDown(sample(1, { pointerType: "mouse", button: -1, buttons: 0 }))).toBe(false);
    expect(isStudioLeftContactDown(sample(1, { pointerType: "mouse", button: 2, buttons: 2 }))).toBe(false);
    expect(isStudioLeftContactDown(sample(1, { pointerType: "mouse", button: 1, buttons: 4 }))).toBe(false);
    // pointerdown without buttons still starts on primary button index 0
    expect(isStudioLeftContactDown(sample(1, { button: 0, buttons: undefined }))).toBe(true);
  });

  it("ends mouse/unknown strokes when buttons reports release mid-drag, not pen/touch", () => {
    const mouse = beginStudioStrokePointerSession(sample(1, { pointerType: "mouse", buttons: 1 }))!;
    const pen = beginStudioStrokePointerSession(sample(1, { pointerType: "pen" }))!;
    const touch = beginStudioStrokePointerSession(sample(1, { pointerType: "touch" }))!;
    const unknown = beginStudioStrokePointerSession(sample(1, { pointerType: "unknown", buttons: 1 }))!;

    expect(shouldEndStudioStrokeForReleasedContact(mouse, sample(2, { pointerType: "mouse", buttons: 0 }))).toBe(
      true
    );
    expect(shouldEndStudioStrokeForReleasedContact(mouse, sample(2, { pointerType: "mouse", buttons: 1 }))).toBe(
      false
    );
    expect(shouldEndStudioStrokeForReleasedContact(mouse, sample(2, { pointerId: 99, buttons: 0 }))).toBe(false);
    expect(shouldEndStudioStrokeForReleasedContact(pen, sample(2, { pointerType: "pen", buttons: 0 }))).toBe(false);
    expect(shouldEndStudioStrokeForReleasedContact(touch, sample(2, { pointerType: "touch", buttons: 0 }))).toBe(
      false
    );
    expect(
      shouldEndStudioStrokeForReleasedContact(unknown, sample(2, { pointerType: "unknown", buttons: 0 }))
    ).toBe(true);
    expect(shouldEndStudioStrokeForReleasedContact(null, sample(2, { buttons: 0 }))).toBe(false);
    expect(
      shouldEndStudioStrokeForReleasedContact(mouse, sample(2, { pointerType: "mouse", buttons: undefined }))
    ).toBe(false);
  });

  it("retains a stroke when capture is lost and finishes only a released mouse contact", () => {
    const mouse = beginStudioStrokePointerSession(
      sample(1, { pointerType: "mouse", buttons: 1 })
    )!;
    const pen = beginStudioStrokePointerSession(sample(1, { pointerType: "pen", buttons: 1 }))!;

    expect(
      resolveStudioPointerCaptureLoss(
        mouse,
        sample(2, { pointerType: "mouse", buttons: 1 })
      )
    ).toBe("retain");
    expect(
      resolveStudioPointerCaptureLoss(
        mouse,
        sample(2, { pointerType: "mouse", buttons: 0 })
      )
    ).toBe("finish");
    expect(
      resolveStudioPointerCaptureLoss(
        pen,
        sample(2, { pointerType: "pen", buttons: 0 })
      )
    ).toBe("retain");
    expect(
      resolveStudioPointerCaptureLoss(
        mouse,
        sample(2, { pointerId: 99, pointerType: "mouse", buttons: 0 })
      )
    ).toBe("foreign");
    expect(resolveStudioPointerCaptureLoss(null, sample(2))).toBe("foreign");
  });

  it("keeps the visible mouse and pen prefix on pointercancel but discards touch navigation", () => {
    const mouse = beginStudioStrokePointerSession(sample(1, { pointerType: "mouse" }))!;
    const pen = beginStudioStrokePointerSession(sample(1, { pointerType: "pen" }))!;
    const touch = beginStudioStrokePointerSession(sample(1, { pointerType: "touch" }))!;
    const unknown = beginStudioStrokePointerSession(sample(1, { pointerType: "unknown" }))!;

    expect(shouldCommitStudioStrokeOnPointerCancel(mouse, sample(2))).toBe(true);
    expect(shouldCommitStudioStrokeOnPointerCancel(pen, sample(2))).toBe(true);
    expect(shouldCommitStudioStrokeOnPointerCancel(unknown, sample(2))).toBe(true);
    expect(shouldCommitStudioStrokeOnPointerCancel(touch, sample(2))).toBe(false);
    expect(
      shouldCommitStudioStrokeOnPointerCancel(mouse, sample(2, { pointerId: 99 }))
    ).toBe(false);
    expect(shouldCommitStudioStrokeOnPointerCancel(null, sample(2))).toBe(false);
  });

  it("does not treat a focused toolbar control blurring into the canvas as a window abort", () => {
    const windowTarget = {};
    const toolbarButton = {};

    expect(isStudioTopLevelWindowBlur(windowTarget, windowTarget)).toBe(true);
    expect(isStudioTopLevelWindowBlur(toolbarButton, windowTarget)).toBe(false);
    expect(isStudioTopLevelWindowBlur(null, windowTarget)).toBe(false);
  });

  it("preserves visible mouse and pen ink on transport abort but cancels touch navigation", () => {
    const mouse = beginStudioStrokePointerSession(sample(1, { pointerType: "mouse" }))!;
    const pen = beginStudioStrokePointerSession(sample(1, { pointerType: "pen" }))!;
    const touch = beginStudioStrokePointerSession(sample(1, { pointerType: "touch" }))!;
    const unknown = beginStudioStrokePointerSession(sample(1, { pointerType: "unknown" }))!;

    expect(shouldPreserveStudioStrokeOnTransportAbort(mouse)).toBe(true);
    expect(shouldPreserveStudioStrokeOnTransportAbort(pen)).toBe(true);
    expect(shouldPreserveStudioStrokeOnTransportAbort(unknown)).toBe(true);
    expect(shouldPreserveStudioStrokeOnTransportAbort(touch)).toBe(false);
    expect(shouldPreserveStudioStrokeOnTransportAbort(null)).toBe(false);
  });

  it("binds every move/up/cancel decision to the pointer that opened the stroke", () => {
    const session = beginStudioStrokePointerSession(sample(1));
    expect(session).not.toBeNull();
    expect(isStudioStrokePointerEvent(session, sample(2))).toBe(true);
    expect(isStudioStrokePointerEvent(session, sample(2, { pointerId: 8 }))).toBe(false);
    expect(isStudioStrokePointerEvent(session, sample(2, { pointerId: Number.NaN }))).toBe(false);

    const wrong = collectStudioStrokePointerBatch(session!, sample(2, { pointerId: 8 }));
    expect(wrong.authoritative).toEqual([]);
    expect(wrong.predicted).toEqual([]);
    expect(wrong.session).toBe(session);
  });

  it("cancels a finger stroke for two-finger navigation but treats touch beside a pen as palm input", () => {
    const finger = beginStudioStrokePointerSession(
      sample(1, { pointerId: 2, pointerType: "touch" })
    )!;
    expect(
      shouldCancelStudioFingerStrokeForAdditionalContact(
        finger,
        sample(2, { pointerId: 3, pointerType: "touch", isPrimary: false })
      )
    ).toBe(true);
    expect(
      shouldCancelStudioFingerStrokeForAdditionalContact(
        finger,
        sample(2, { pointerId: 2, pointerType: "touch" })
      )
    ).toBe(false);

    const pen = beginStudioStrokePointerSession(sample(1, { pointerType: "pen" }))!;
    expect(
      shouldCancelStudioFingerStrokeForAdditionalContact(
        pen,
        sample(2, { pointerId: 8, pointerType: "touch", isPrimary: false })
      )
    ).toBe(false);
  });

  it("preserves coalesced delivery order without inventing a processed parent sample", () => {
    const down = sample(1);
    const session = beginStudioStrokePointerSession(down)!;
    const a = sample(2);
    const b = sample(3);
    const current = sample(4, { getCoalescedEvents: () => [a, b] });

    const batch = collectStudioStrokePointerBatch(session, current);
    expect(batch.authoritative).toEqual([a, b]);

    const includesCurrent = sample(5);
    includesCurrent.getCoalescedEvents = () => [includesCurrent];
    expect(collectStudioStrokePointerBatch(batch.session, includesCurrent).authoritative).toEqual([
      includesCurrent,
    ]);
  });

  it("keeps browser delivery order even when reduced or mixed clocks are not monotonic", () => {
    const session = beginStudioStrokePointerSession(sample(1, { timeStamp: 40 }))!;
    const firstDelivered = sample(2, { timeStamp: 30 });
    const secondDelivered = sample(3, { timeStamp: 10 });
    const current = sample(4, {
      timeStamp: 20,
      getCoalescedEvents: () => [firstDelivered, secondDelivered],
    });
    expect(collectStudioStrokePointerBatch(session, current).authoritative).toEqual([
      firstDelivered,
      secondDelivered,
    ]);
  });

  it("does not collapse distinct coordinates or professional stylus channels that share a timestamp", () => {
    const session = beginStudioStrokePointerSession(sample(0, { timeStamp: 0 }))!;
    const a = sample(1, { timeStamp: 0 });
    const b = sample(2, { timeStamp: 0 });
    const pressureChange = sample(2, { timeStamp: 0, pressure: 0.8 });
    const barrelChange = sample(2, { timeStamp: 0, pressure: 0.8, tangentialPressure: 0.4 });
    const tiltChange = sample(2, { timeStamp: 0, pressure: 0.8, tangentialPressure: 0.4, tiltX: 30 });
    const angleChange = sample(2, {
      timeStamp: 0,
      pressure: 0.8,
      tangentialPressure: 0.4,
      tiltX: 30,
      altitudeAngle: 0.6,
      azimuthAngle: 1.1,
    });
    const twistChange = sample(2, {
      timeStamp: 0,
      pressure: 0.8,
      tangentialPressure: 0.4,
      tiltX: 30,
      altitudeAngle: 0.6,
      azimuthAngle: 1.1,
      twist: 90,
    });
    const contactChange = sample(2, {
      timeStamp: 0,
      pressure: 0.8,
      tangentialPressure: 0.4,
      tiltX: 30,
      altitudeAngle: 0.6,
      azimuthAngle: 1.1,
      twist: 90,
      width: 3,
      height: 2,
    });
    const current = sample(3, {
      timeStamp: 0,
      getCoalescedEvents: () => [
        a,
        b,
        b,
        pressureChange,
        barrelChange,
        tiltChange,
        angleChange,
        twistChange,
        contactChange,
      ],
    });

    expect(collectStudioStrokePointerBatch(session, current).authoritative).toEqual([
      a,
      b,
      pressureChange,
      barrelChange,
      tiltChange,
      angleChange,
      twistChange,
      contactChange,
    ]);
  });

  it("preserves a genuine loop-back inside one coalesced delivery", () => {
    const session = beginStudioStrokePointerSession(sample(0, { timeStamp: 0 }))!;
    const a = sample(1, { timeStamp: 0 });
    const b = sample(2, { timeStamp: 0 });
    const loopBack = sample(1, { timeStamp: 0 });
    const c = sample(3, { timeStamp: 0 });
    const parent = sample(4, {
      timeStamp: 0,
      getCoalescedEvents: () => [a, b, loopBack, c],
    });

    const batch = collectStudioStrokePointerBatch(session, parent);

    expect(batch.authoritative).toEqual([a, b, loopBack, c]);
    expect(batch.diagnostics).toMatchObject({
      authoritativeAcceptedCount: 4,
      duplicateCount: 0,
      overlapReplayCount: 0,
    });
  });

  it("deduplicates normalized scalar identities without JSON allocation in the hardware hot path", () => {
    const down = sample(0, {
      pointerType: "PEN",
      timeStamp: -0,
      pressure: Number.NaN,
      tangentialPressure: Number.POSITIVE_INFINITY,
    });
    const session = beginStudioStrokePointerSession(down)!;
    const equivalent = sample(0, {
      pointerType: "pen",
      timeStamp: 0,
      pressure: 0,
      tangentialPressure: 0,
    });

    expect(collectStudioStrokePointerBatch(session, equivalent).authoritative).toEqual([]);
    expect(session.lastAuthoritativeSample).toMatchObject({
      pointerId: 7,
      pointerType: "pen",
      timeStamp: -0,
      pressure: 0,
      tangentialPressure: 0,
    });
    expect(pointerInputSource).not.toContain("JSON.stringify");
    expect(pointerInputSource).toContain("samePointerSampleIdentity(identity, previousSample)");
  });

  it("keeps durable ink on processed pointermove and ignores raw updates without poisoning it", () => {
    const initial = beginStudioStrokePointerSession(sample(1))!;
    const moveA = sample(2);
    const fallback = claimStudioStrokeMoveTransport(initial, moveA, "pointermove");
    expect(fallback.accepted).toBe(true);
    expect(fallback.session.moveTransport).toBe("pointermove");

    const foreignRaw = claimStudioStrokeMoveTransport(
      fallback.session,
      sample(3, { pointerId: 99 }),
      "pointerrawupdate"
    );
    expect(foreignRaw).toEqual({ accepted: false, session: fallback.session });

    const rawB = sample(3);
    const raw = claimStudioStrokeMoveTransport(fallback.session, rawB, "pointerrawupdate");
    expect(raw).toEqual({ accepted: false, session: fallback.session });

    const final = sample(4);
    const duplicatedMove = sample(4, { getCoalescedEvents: () => [moveA, rawB, final] });
    const processed = claimStudioStrokeMoveTransport(raw.session, duplicatedMove, "pointermove");
    expect(processed.accepted).toBe(true);
    const recovered = collectStudioStrokePointerBatch(processed.session, duplicatedMove);
    expect(recovered.authoritative).toEqual([moveA, rawB, final]);
    expect(
      collectStudioStrokePointerBatch(recovered.session, final).authoritative
    ).toEqual([]);
    expect(
      claimStudioStrokeMoveTransport(raw.session, sample(5), "pointerrawupdate").accepted
    ).toBe(false);
    expect(raw.session.moveTransport).toBe("pointermove");
  });

  it("lets normal pointerup own one final parent endpoint even when stale move history is exposed", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const priorMove = sample(50);
    const release = sample(100, {
      pressure: 0,
      buttons: 0,
      getCoalescedEvents: () => [priorMove],
    });

    const batch = collectStudioStrokePointerBatch(session, release, {
      authoritativeSource: "parent-only",
    });

    expect(batch.authoritative).toEqual([release]);
    expect(batch.authoritative.at(-1)?.clientX).toBe(100);
    expect(
      collectStudioStrokePointerBatch(batch.session, release, {
        authoritativeSource: "parent-only",
      }).authoritative
    ).toEqual([]);
  });

  it("deduplicates only an adjacent final sample across batches, not a later loop-back", () => {
    const down = sample(1, { timeStamp: 0 });
    const session = beginStudioStrokePointerSession(down)!;
    const first = collectStudioStrokePointerBatch(session, sample(2, { timeStamp: 0 }));
    const repeated = collectStudioStrokePointerBatch(first.session, sample(2, { timeStamp: 0 }));
    expect(repeated.authoritative).toEqual([]);

    const away = collectStudioStrokePointerBatch(repeated.session, sample(3, { timeStamp: 0 }));
    const loopBack = sample(2, { timeStamp: 0 });
    expect(collectStudioStrokePointerBatch(away.session, loopBack).authoritative).toEqual([loopBack]);
  });

  it("drops a browser's overlapping coalesced replay while preserving the new suffix", () => {
    const down = sample(0);
    const session = beginStudioStrokePointerSession(down)!;
    const a = sample(1);
    const b = sample(2);
    const c = sample(3);
    const firstParent = sample(3.5, { getCoalescedEvents: () => [a, b, c] });
    const first = collectStudioStrokePointerBatch(session, firstParent);
    expect(first.authoritative).toEqual([a, b, c]);

    const d = sample(4);
    const secondParent = sample(4.5, { getCoalescedEvents: () => [b, c, d] });
    const second = collectStudioStrokePointerBatch(first.session, secondParent);

    expect(second.authoritative).toEqual([d]);
    expect(second.diagnostics).toMatchObject({
      authoritativeCandidateCount: 3,
      authoritativeAcceptedCount: 1,
      duplicateCount: 0,
      overlapReplayCount: 2,
      maximumAuthoritativeGap: Math.hypot(1, 1),
    });
  });

  it("does not mistake a non-contiguous prior coordinate for browser replay", () => {
    const session = beginStudioStrokePointerSession(sample(0))!;
    const a = sample(1);
    const b = sample(2);
    const c = sample(3);
    const first = collectStudioStrokePointerBatch(
      session,
      sample(3.5, { getCoalescedEvents: () => [a, b, c] })
    );
    const loopBack = sample(1);
    const d = sample(4);
    const second = collectStudioStrokePointerBatch(
      first.session,
      sample(4.5, { getCoalescedEvents: () => [loopBack, d] })
    );

    expect(second.authoritative).toEqual([loopBack, d]);
    expect(second.diagnostics.overlapReplayCount).toBe(0);
  });

  it("keeps overlap classification linear at the full retained delivery window", () => {
    const session = beginStudioStrokePointerSession(sample(0))!;
    const firstSamples = Array.from({ length: 128 }, (_, index) => sample(index + 1));
    const first = collectStudioStrokePointerBatch(
      session,
      sample(129, { getCoalescedEvents: () => firstSamples })
    );
    const secondSamples = Array.from({ length: 128 }, (_, index) => sample(index + 129));
    const second = collectStudioStrokePointerBatch(
      first.session,
      sample(257, { getCoalescedEvents: () => secondSamples })
    );

    expect(second.authoritative).toEqual(secondSamples);
    // The former any-match scans needed 8,128 current-delivery + 16,384 previous-delivery
    // comparisons for this input. Ordered overlap rejects it in one bounded 128-sample pass.
    expect(second.diagnostics.overlapComparisonCount).toBe(128);
    expect(second.diagnostics.overlapReplayCount).toBe(0);
  });

  it("measures duplicate, regression, and large-gap input without reordering new geometry", () => {
    const session = beginStudioStrokePointerSession(sample(0, { timeStamp: 100 }))!;
    const a = sample(10, { timeStamp: 90 });
    const duplicateA = sample(10, { timeStamp: 90 });
    const b = sample(30, { timeStamp: 80 });
    const current = sample(31, {
      timeStamp: 70,
      getCoalescedEvents: () => [a, duplicateA, b],
    });

    const batch = collectStudioStrokePointerBatch(session, current);

    expect(batch.authoritative).toEqual([a, b]);
    expect(batch.diagnostics).toMatchObject({
      authoritativeCandidateCount: 3,
      authoritativeAcceptedCount: 2,
      duplicateCount: 1,
      authoritativeTimeRegressionCount: 2,
      maximumAuthoritativeGap: Math.hypot(20, 20),
    });
  });

  it("keeps prediction preview causal and removes repeated estimates", () => {
    const session = beginStudioStrokePointerSession(sample(0, { timeStamp: 100 }))!;
    const authority = sample(10, { timeStamp: 110 });
    const behind = sample(11, { timeStamp: 105 });
    const future = sample(12, { timeStamp: 120 });
    const duplicateFuture = sample(12, { timeStamp: 120 });
    const current = sample(10, {
      timeStamp: 110,
      getCoalescedEvents: () => [authority],
      getPredictedEvents: () => [behind, future, duplicateFuture],
    });

    const batch = collectStudioStrokePointerBatch(session, current, { includePredicted: true });

    expect(batch.authoritative).toEqual([authority]);
    expect(batch.predicted).toEqual([future]);
    expect(batch.diagnostics).toMatchObject({
      predictedAcceptedCount: 1,
      predictedDuplicateCount: 1,
      predictedBehindAuthorityCount: 1,
    });
  });

  it("falls back to the current event when coalesced APIs are absent, throw, or return junk", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const absent = sample(2);
    expect(collectStudioStrokePointerBatch(session, absent).authoritative).toEqual([absent]);

    const throwing = sample(3, {
      getCoalescedEvents: () => {
        throw new Error("unsupported");
      },
    });
    expect(collectStudioStrokePointerBatch(session, throwing).authoritative).toEqual([throwing]);

    const junk = sample(4, { getCoalescedEvents: () => ({ length: 1 }) });
    expect(collectStudioStrokePointerBatch(session, junk).authoritative).toEqual([junk]);

    const predictedThrow = sample(5, {
      getPredictedEvents: () => {
        throw new Error("unsupported");
      },
    });
    expect(
      collectStudioStrokePointerBatch(session, predictedThrow, { includePredicted: true }).predicted
    ).toEqual([]);
  });

  it("filters malformed related entries and falls back when every coalesced candidate is unusable", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const foreign = sample(2, { pointerId: 99 });
    const current = sample(3, {
      getCoalescedEvents: () => [null, 42, {}, foreign],
    });

    expect(() => collectStudioStrokePointerBatch(session, current)).not.toThrow();
    expect(collectStudioStrokePointerBatch(session, current).authoritative).toEqual([current]);
  });

  it("keeps valid samples in mixed related lists while ignoring malformed predictions", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const authoritative = sample(2);
    const foreign = sample(3, { pointerId: 99 });
    const prediction = sample(5);
    const current = sample(4, {
      getCoalescedEvents: () => [null, authoritative, 42, foreign, {}],
      getPredictedEvents: () => [undefined, {}, foreign, "junk", prediction],
    });

    const batch = collectStudioStrokePointerBatch(session, current, { includePredicted: true });
    expect(batch.authoritative).toEqual([authoritative]);
    expect(batch.predicted).toEqual([prediction]);
  });

  it("keeps coalesced and predicted detail for the legacy missing-pointerId session", () => {
    const down = sample(0, { pointerId: undefined });
    const session = beginStudioStrokePointerSession(down)!;
    const first = sample(1, { pointerId: undefined });
    const second = sample(2, { pointerId: undefined });
    const prediction = sample(4, { pointerId: undefined });
    const parent = sample(3, {
      pointerId: undefined,
      getCoalescedEvents: () => [first, second],
      getPredictedEvents: () => [prediction],
    });

    const batch = collectStudioStrokePointerBatch(session, parent, { includePredicted: true });
    expect(batch.authoritative).toEqual([first, second]);
    expect(batch.predicted).toEqual([prediction]);
  });

  it("skips related samples with throwing optional getters and falls back to the parent", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const malformed = {
      pointerId: 7,
      clientX: 2,
      clientY: 3,
      get pressure(): never {
        throw new Error("detached sample");
      },
    };
    const current = sample(4, {
      getCoalescedEvents: () => [malformed],
      getPredictedEvents: () => [malformed],
    });

    expect(() => collectStudioStrokePointerBatch(
      session,
      current,
      { includePredicted: true }
    )).not.toThrow();
    const batch = collectStudioStrokePointerBatch(session, current, { includePredicted: true });
    expect(batch.authoritative).toEqual([current]);
    expect(batch.predicted).toEqual([]);
  });

  it("does not manufacture a repeated parent when unusable coalesced entries remain", () => {
    const down = sample(1);
    const session = beginStudioStrokePointerSession(down)!;
    const repeated = {
      ...down,
      getCoalescedEvents: () => [sample(2, { pointerId: 99 })],
    };

    expect(collectStudioStrokePointerBatch(session, repeated).authoritative).toEqual([]);
  });

  it("keeps predictions preview-only so the same later hardware sample remains authoritative", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const prediction = sample(4);
    const current = sample(2, { getPredictedEvents: () => [prediction] });
    const previewBatch = collectStudioStrokePointerBatch(session, current, { includePredicted: true });
    expect(previewBatch.authoritative).toEqual([current]);
    expect(previewBatch.predicted).toEqual([prediction]);

    const actualBatch = collectStudioStrokePointerBatch(previewBatch.session, prediction);
    expect(actualBatch.authoritative).toEqual([prediction]);
  });

  it("filters foreign coalesced/predicted pointers without reordering valid samples", () => {
    const session = beginStudioStrokePointerSession(sample(1))!;
    const a = sample(2);
    const foreign = sample(3, { pointerId: 99 });
    const predicted = sample(5);
    const current = sample(4, {
      getCoalescedEvents: () => [a, foreign],
      getPredictedEvents: () => [foreign, predicted],
    });
    const batch = collectStudioStrokePointerBatch(session, current, { includePredicted: true });
    expect(batch.authoritative).toEqual([a]);
    expect(batch.predicted).toEqual([predicted]);
  });

  it("lets exactly one matching release claim a session, preserving one stroke per undo", () => {
    let session = beginStudioStrokePointerSession(sample(1));
    let undoEntries = 0;
    const release = (event: StudioPointerEventLike) => {
      if (!isStudioStrokePointerEvent(session, event)) return;
      undoEntries += 1;
      session = null;
    };

    release(sample(2, { pointerId: 99 }));
    release(sample(3));
    release(sample(4));
    expect(undoEntries).toBe(1);
  });

  it("captures and releases defensively across unsupported and detached DOM targets", () => {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    expect(tryCaptureStudioStrokePointer({ setPointerCapture }, 7)).toBe(true);
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    expect(
      tryReleaseStudioStrokePointer(
        { hasPointerCapture: () => true, releasePointerCapture },
        7
      )
    ).toBe(true);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(
      tryReleaseStudioStrokePointer(
        { hasPointerCapture: () => false, releasePointerCapture },
        7
      )
    ).toBe(false);

    expect(
      tryCaptureStudioStrokePointer(
        {
          setPointerCapture: () => {
            throw new DOMException("detached");
          },
        },
        7
      )
    ).toBe(false);
    expect(
      tryReleaseStudioStrokePointer(
        {
          releasePointerCapture: () => {
            throw new DOMException("detached");
          },
        },
        7
      )
    ).toBe(false);
  });
});
