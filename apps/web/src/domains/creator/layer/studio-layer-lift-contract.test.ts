import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_KIND,
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
  STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES,
  calculateStudioSceneLayerLiftProviderReceiptSha256,
  isStudioSceneLayerLiftTrustedSuccess,
  parseStudioSceneLayerLiftLocalProviderReceipt,
  parseStudioSceneLayerLiftRequest,
  parseStudioSceneLayerLiftResult,
  parseStudioSceneLayerLiftSourceDescriptor,
} from "./studio-layer-lift-contract";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const hashBytes = (bytes: Uint8Array) =>
  `sha256:${sha256HexPortable(bytes)}` as const;

function source() {
  const bytes = new Uint8Array([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]);
  return {
    sourceId: "cut-001",
    sourceName: "episode-01-cut-001.png",
    mimeType: "image/png",
    width: 2,
    height: 2,
    pixelCount: 4,
    pixelFormat: "rgba8-srgb-straight",
    channels: 4,
    byteLength: 16,
    sha256: hashBytes(bytes),
    bytes,
  };
}

function sourceBinding() {
  return {
    sourceId: "cut-001",
    width: 2,
    height: 2,
    pixelCount: 4,
    byteLength: 16,
    sha256: source().sha256,
  };
}

function request() {
  return {
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "lift-001",
    source: source(),
    requestedRoles: ["background", "character", "line-art"],
  };
}

function rgba() {
  const bytes = new Uint8Array([
    10, 20, 30, 255,
    0, 0, 0, 0,
    70, 80, 90, 255,
    0, 0, 0, 0,
  ]);
  return {
    width: 2,
    height: 2,
    pixelCount: 4,
    encoding: "rgba8-srgb-straight",
    channels: 4,
    byteLength: 16,
    sha256: hashBytes(bytes),
    bytes,
  };
}

function mask() {
  const bytes = new Uint8Array([255, 0, 255, 0]);
  return {
    width: 2,
    height: 2,
    pixelCount: 4,
    encoding: "alpha8",
    channels: 1,
    byteLength: 4,
    sha256: hashBytes(bytes),
    bytes,
  };
}

function layer(layerId = "layer-background", order = 0) {
  return {
    layerId,
    role: "background",
    order,
    label: "배경",
    confidence: { score: 0.92, band: "high" },
    rgba: rgba(),
    mask: mask(),
  };
}

function receipt(outcome: "success" | "failure" = "success") {
  const unsigned = {
    kind: STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    providerId: "local-segmentation-v1",
    providerVersion: "1.2.0",
    execution: "local-device" as const,
    networkUsed: false as const,
    requestId: "lift-001",
    sourceSha256: source().sha256,
    inputByteLength: 16,
    outputByteLength: outcome === "success" ? 20 : 0,
    maskByteLength: outcome === "success" ? 4 : 0,
    layerCount: outcome === "success" ? 1 : 0,
    durationMilliseconds: 12.5,
    outcome,
  };
  return {
    ...unsigned,
    receiptSha256:
      calculateStudioSceneLayerLiftProviderReceiptSha256(unsigned),
  };
}

function success() {
  return {
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "lift-001",
    status: "success",
    source: sourceBinding(),
    layers: [layer()],
    confidence: { score: 0.88, band: "high" },
    diagnostics: [{
      code: "PARTIAL_BOUNDARY",
      severity: "warning",
      layerId: "layer-background",
      message: "미세한 경계는 마스크 보정이 필요할 수 있습니다.",
    }],
    receipt: receipt(),
  };
}

function failure() {
  return {
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "lift-001",
    status: "failure",
    source: sourceBinding(),
    code: "provider-unavailable",
    retryable: true,
    diagnostics: [{
      code: "PROVIDER_UNAVAILABLE",
      severity: "error",
      layerId: null,
      message: "로컬 레이어 분리 공급자를 사용할 수 없습니다.",
    }],
    receipt: receipt("failure"),
  };
}

function expectRejected(
  result: Readonly<{
    readonly ok: boolean;
    readonly reason?: string;
  }>,
  reason?: string,
) {
  expect(result.ok).toBe(false);
  if (!result.ok && reason) expect(result.reason).toBe(reason);
}

describe("Studio Scene Layer Lift contract", () => {
  it("publishes stable, product-owned names and explicit resource budgets", () => {
    expect(STUDIO_SCENE_LAYER_LIFT_CONTRACT_KIND)
      .toBe("toonspectrum.scene-layer-lift");
    expect(STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION).toBe(1);
    expect(STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND)
      .toBe("toonspectrum.scene-layer-lift/request");
    expect(STUDIO_SCENE_LAYER_LIFT_RESULT_KIND)
      .toBe("toonspectrum.scene-layer-lift/result");
    expect(STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES).toEqual(
      expect.arrayContaining([
        "background",
        "character",
        "line-art",
        "speech-bubble",
        "unclassified",
      ]),
    );
    expect(STUDIO_SCENE_LAYER_LIFT_BUDGETS).toMatchObject({
      maximumAxisPixels: expect.any(Number),
      maximumPixels: expect.any(Number),
      maximumInputBytes: expect.any(Number),
      maximumOutputBytes: expect.any(Number),
      maximumLayerCount: expect.any(Number),
      maximumMaskBytes: expect.any(Number),
      maximumSourceCharacters: expect.any(Number),
    });
    expect(Object.isFrozen(STUDIO_SCENE_LAYER_LIFT_BUDGETS)).toBe(true);
  });

  it("strictly parses, snapshots, and deeply freezes a request", () => {
    const input = request();
    const parsed = parseStudioSceneLayerLiftRequest(input);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).not.toBe(input);
    expect(parsed.value.source).not.toBe(input.source);
    expect(parsed.value.source.bytes).not.toBe(input.source.bytes);
    expect(parsed.value.source.bytes).toEqual(input.source.bytes);
    expect(parsed.value.requestedRoles).not.toBe(input.requestedRoles);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.source)).toBe(true);
    expect(Object.isFrozen(parsed.value.requestedRoles)).toBe(true);

    input.source.bytes.fill(0);
    input.requestedRoles[0] = "effect";
    expect(parsed.value.source.bytes[0]).toBe(10);
    expect(parsed.value.requestedRoles[0]).toBe("background");
  });

  it("recomputes source, layer-plane, mask, and provider-receipt authority hashes", () => {
    const sourceTamper = source();
    sourceTamper.bytes[0] ^= 0xff;
    expectRejected(parseStudioSceneLayerLiftRequest({
      ...request(),
      source: sourceTamper,
    }), "inconsistent-data");

    const rgbaTamper = success();
    rgbaTamper.layers[0]!.rgba.bytes[0] ^= 0xff;
    expectRejected(
      parseStudioSceneLayerLiftResult(rgbaTamper),
      "inconsistent-data",
    );

    const maskTamper = success();
    maskTamper.layers[0]!.mask.bytes[0] ^= 0xff;
    expectRejected(
      parseStudioSceneLayerLiftResult(maskTamper),
      "inconsistent-data",
    );

    const receiptTamper = success();
    receiptTamper.receipt.durationMilliseconds += 1;
    expectRejected(
      parseStudioSceneLayerLiftResult(receiptTamper),
      "inconsistent-data",
    );
  });

  it("parses the source descriptor independently and rejects invalid MIME, IDs, and digests", () => {
    expect(parseStudioSceneLayerLiftSourceDescriptor(source()).ok).toBe(true);

    for (const candidate of [
      { ...source(), sourceId: "../cut" },
      { ...source(), sourceId: "cut with spaces" },
      { ...source(), mimeType: "text/html" },
      { ...source(), mimeType: "image/png;charset=utf-8" },
      { ...source(), sha256: "sha256:ABC" },
      { ...source(), sha256: digest("A") },
      { ...source(), sourceName: " data:image/png;base64,AAAA " },
    ]) {
      expect(parseStudioSceneLayerLiftSourceDescriptor(candidate).ok).toBe(false);
    }
  });

  it("rejects unknown keys recursively instead of stripping them", () => {
    const top = { ...request(), unexpected: true };
    expect(parseStudioSceneLayerLiftRequest(top).ok).toBe(false);

    const nestedSource = request();
    Object.assign(nestedSource.source, { url: "https://example.test/cut.png" });
    expect(parseStudioSceneLayerLiftRequest(nestedSource).ok).toBe(false);

    const nestedLayer = success();
    Object.assign(nestedLayer.layers[0]!.mask, { base64: "AAAA" });
    expectRejected(parseStudioSceneLayerLiftResult(nestedLayer));

    const nestedConfidence = success();
    Object.assign(nestedConfidence.confidence, { modelScore: 0.88 });
    expectRejected(parseStudioSceneLayerLiftResult(nestedConfidence));

    const nestedReceipt = success();
    Object.assign(nestedReceipt.receipt, { endpoint: "https://example.test" });
    expectRejected(parseStudioSceneLayerLiftResult(nestedReceipt));
  });

  it("rejects accessors, class instances, symbol fields, and sparse arrays", () => {
    const accessor = request();
    Object.defineProperty(accessor.source, "sourceName", {
      enumerable: true,
      get: () => "must-not-run.png",
    });
    expect(parseStudioSceneLayerLiftRequest(accessor).ok).toBe(false);

    class SourceRecord {
      sourceId = "cut-001";
    }
    expect(parseStudioSceneLayerLiftSourceDescriptor(new SourceRecord()).ok)
      .toBe(false);

    const symbol = request();
    Object.defineProperty(symbol, Symbol("hidden"), {
      enumerable: true,
      value: true,
    });
    expect(parseStudioSceneLayerLiftRequest(symbol).ok).toBe(false);

    const sparse = request();
    sparse.requestedRoles = new Array(2);
    sparse.requestedRoles[0] = "background";
    expect(parseStudioSceneLayerLiftRequest(sparse).ok).toBe(false);
  });

  it("rejects NaN, infinities, fractions, and inconsistent confidence bands", () => {
    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0.01,
      1.01,
    ]) {
      const input = success();
      input.confidence.score = invalid;
      expectRejected(parseStudioSceneLayerLiftResult(input), "invalid-value");
    }

    const fractionalDimension = request();
    fractionalDimension.source.width = 1.5;
    expect(parseStudioSceneLayerLiftRequest(fractionalDimension).ok).toBe(false);

    const inconsistentBand = success();
    inconsistentBand.layers[0]!.confidence = { score: 0.79, band: "high" };
    expectRejected(
      parseStudioSceneLayerLiftResult(inconsistentBand),
      "inconsistent-data",
    );

    const nonFiniteDuration = success();
    nonFiniteDuration.receipt.durationMilliseconds = Number.POSITIVE_INFINITY;
    expectRejected(parseStudioSceneLayerLiftResult(nonFiniteDuration));
  });

  it("requires exact pixel, RGBA byte, and alpha-mask byte lengths", () => {
    const sourcePixelCount = request();
    sourcePixelCount.source.pixelCount = 3;
    expect(parseStudioSceneLayerLiftRequest(sourcePixelCount).ok).toBe(false);

    const sourceDeclaredBytes = request();
    sourceDeclaredBytes.source.byteLength = 15;
    expect(parseStudioSceneLayerLiftRequest(sourceDeclaredBytes).ok).toBe(false);

    const sourceActualBytes = request();
    sourceActualBytes.source.bytes = new Uint8Array(15);
    expect(parseStudioSceneLayerLiftRequest(sourceActualBytes).ok).toBe(false);

    const outputDeclaredBytes = success();
    outputDeclaredBytes.layers[0]!.rgba.byteLength = 15;
    expectRejected(parseStudioSceneLayerLiftResult(outputDeclaredBytes));

    const outputActualBytes = success();
    outputActualBytes.layers[0]!.rgba.bytes = new Uint8Array(15);
    expectRejected(parseStudioSceneLayerLiftResult(outputActualBytes));

    const maskDeclaredBytes = success();
    maskDeclaredBytes.layers[0]!.mask.byteLength = 3;
    expectRejected(parseStudioSceneLayerLiftResult(maskDeclaredBytes));

    const maskActualBytes = success();
    maskActualBytes.layers[0]!.mask.bytes = new Uint8Array(3);
    expectRejected(parseStudioSceneLayerLiftResult(maskActualBytes));

    const wrongLayerDimensions = success();
    wrongLayerDimensions.layers[0]!.mask.width = 1;
    wrongLayerDimensions.layers[0]!.mask.pixelCount = 2;
    wrongLayerDimensions.layers[0]!.mask.byteLength = 2;
    wrongLayerDimensions.layers[0]!.mask.bytes = new Uint8Array(2);
    expectRejected(parseStudioSceneLayerLiftResult(wrongLayerDimensions));
  });

  it("never accepts base64 or data URLs in place of owned raw mask bytes", () => {
    for (const bytes of [
      "AAAA",
      "data:application/octet-stream;base64,AAAA",
      [255, 0, 255, 0],
    ]) {
      const input = success();
      input.layers[0]!.mask.bytes = bytes as unknown as Uint8Array<ArrayBuffer>;
      expectRejected(parseStudioSceneLayerLiftResult(input));
    }
  });

  it("enforces axis, pixel, source text, role, and layer-count budgets", () => {
    const axis = request();
    axis.source.width =
      STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels + 1;
    expect(parseStudioSceneLayerLiftRequest(axis)).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });

    const pixels = request();
    pixels.source.width = STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels;
    pixels.source.height = STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels;
    pixels.source.pixelCount = pixels.source.width * pixels.source.height;
    expect(parseStudioSceneLayerLiftRequest(pixels)).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });

    const longName = request();
    longName.source.sourceName =
      "a".repeat(STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumSourceCharacters + 1);
    expect(parseStudioSceneLayerLiftRequest(longName).ok).toBe(false);

    const duplicateRole = request();
    duplicateRole.requestedRoles = ["background", "background"];
    expect(parseStudioSceneLayerLiftRequest(duplicateRole)).toMatchObject({
      ok: false,
      reason: "inconsistent-data",
    });

    const unknownRole = request();
    unknownRole.requestedRoles = ["background", "not-a-role"];
    expect(parseStudioSceneLayerLiftRequest(unknownRole).ok).toBe(false);

    const tooManyLayers = success();
    tooManyLayers.layers = Array.from(
      { length: STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerCount + 1 },
      (_, index) => layer(`layer-${index}`, index),
    );
    expect(parseStudioSceneLayerLiftResult(tooManyLayers)).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
  });

  it("rejects aggregate output work before touching or copying provider layer buffers", () => {
    let providerLayerReads = 0;
    const hostileLayer = new Proxy({}, {
      get() {
        providerLayerReads += 1;
        throw new Error("provider layer must not be inspected");
      },
      getOwnPropertyDescriptor() {
        providerLayerReads += 1;
        throw new Error("provider layer must not be inspected");
      },
      ownKeys() {
        providerLayerReads += 1;
        throw new Error("provider layer must not be inspected");
      },
    }) as ReturnType<typeof layer>;
    const input = success();
    input.source = {
      ...sourceBinding(),
      width: 4_096,
      height: 4_096,
      pixelCount: 16_777_216,
      byteLength: 67_108_864,
    };
    input.layers = Array.from({ length: 4 }, () => hostileLayer);

    expect(parseStudioSceneLayerLiftResult(input)).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
    expect(providerLayerReads).toBe(0);
  });

  it("parses a success result with defensive copies and exact receipt totals", () => {
    const input = success();
    const parsed = parseStudioSceneLayerLiftResult(input);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.status !== "success") return;
    expect(parsed.value.layers).not.toBe(input.layers);
    expect(parsed.value.layers[0]?.rgba.bytes)
      .not.toBe(input.layers[0]?.rgba.bytes);
    expect(parsed.value.layers[0]?.mask.bytes)
      .not.toBe(input.layers[0]?.mask.bytes);
    expect(parsed.value.diagnostics).not.toBe(input.diagnostics);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.layers)).toBe(true);
    expect(Object.isFrozen(parsed.value.layers[0])).toBe(true);
    expect(Object.isFrozen(parsed.value.layers[0]?.confidence)).toBe(true);
    expect(Object.isFrozen(parsed.value.diagnostics[0])).toBe(true);
    expect(Object.isFrozen(parsed.value.receipt)).toBe(true);

    input.layers[0]!.rgba.bytes.fill(0);
    input.layers[0]!.mask.bytes.fill(0);
    input.diagnostics[0]!.message = "mutated";
    expect(parsed.value.layers[0]?.rgba.bytes[0]).toBe(10);
    expect(parsed.value.layers[0]?.mask.bytes[0]).toBe(255);
    expect(parsed.value.diagnostics[0]?.message).not.toBe("mutated");
  });

  it("trusts only the exact strictly parsed success snapshot", () => {
    const raw = success();
    expect(isStudioSceneLayerLiftTrustedSuccess(raw)).toBe(false);

    const parsed = parseStudioSceneLayerLiftResult(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.status !== "success") return;

    expect(isStudioSceneLayerLiftTrustedSuccess(parsed.value)).toBe(true);
    expect(isStudioSceneLayerLiftTrustedSuccess({ ...parsed.value })).toBe(
      false,
    );
    expect(
      isStudioSceneLayerLiftTrustedSuccess(structuredClone(parsed.value)),
    ).toBe(false);
  });

  it("never identifies parsed provider failures as trusted successes", () => {
    const parsed = parseStudioSceneLayerLiftResult(failure());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.status).toBe("failure");
    expect(isStudioSceneLayerLiftTrustedSuccess(parsed.value)).toBe(false);
  });

  it("binds receipt identity, locality, digest, byte totals, and layer count", () => {
    expect(parseStudioSceneLayerLiftLocalProviderReceipt(receipt()).ok)
      .toBe(true);

    const cases = [
      { field: "networkUsed", value: true },
      { field: "execution", value: "remote" },
      { field: "sourceSha256", value: digest("e") },
      { field: "inputByteLength", value: 15 },
      { field: "outputByteLength", value: 19 },
      { field: "maskByteLength", value: 3 },
      { field: "layerCount", value: 2 },
      { field: "outcome", value: "failure" },
      { field: "receiptSha256", value: "sha256:short" },
    ] as const;
    for (const { field, value } of cases) {
      const input = success();
      Object.assign(input.receipt, { [field]: value });
      expectRejected(parseStudioSceneLayerLiftResult(input));
    }

    const maskOverBudget = receipt();
    maskOverBudget.maskByteLength =
      STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes + 1;
    maskOverBudget.outputByteLength = maskOverBudget.maskByteLength;
    expect(parseStudioSceneLayerLiftLocalProviderReceipt(maskOverBudget))
      .toMatchObject({ ok: false, reason: "budget-exceeded" });

    const outputOverBudget = receipt();
    outputOverBudget.outputByteLength =
      STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes + 1;
    expect(parseStudioSceneLayerLiftLocalProviderReceipt(outputOverBudget))
      .toMatchObject({ ok: false, reason: "budget-exceeded" });
  });

  it("rejects duplicate IDs, non-dense order, dangling diagnostics, and error diagnostics on success", () => {
    const duplicate = success();
    duplicate.layers = [layer("same", 0), layer("same", 1)];
    duplicate.receipt.layerCount = 2;
    duplicate.receipt.outputByteLength = 40;
    duplicate.receipt.maskByteLength = 8;
    expectRejected(parseStudioSceneLayerLiftResult(duplicate));

    const order = success();
    order.layers[0]!.order = 1;
    expectRejected(parseStudioSceneLayerLiftResult(order));

    const dangling = success();
    dangling.diagnostics[0]!.layerId = "missing-layer";
    expectRejected(parseStudioSceneLayerLiftResult(dangling));

    const error = success();
    error.diagnostics[0]!.severity = "error";
    expectRejected(parseStudioSceneLayerLiftResult(error));
  });

  it("parses fail-closed provider results as the other result discriminator", () => {
    const parsed = parseStudioSceneLayerLiftResult(failure());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      status: "failure",
      code: "provider-unavailable",
      retryable: true,
      receipt: {
        execution: "local-device",
        networkUsed: false,
        outcome: "failure",
        layerCount: 0,
        outputByteLength: 0,
        maskByteLength: 0,
      },
    });

    const missingError = failure();
    missingError.diagnostics[0]!.severity = "warning";
    expectRejected(parseStudioSceneLayerLiftResult(missingError));

    const layerDiagnostic = failure();
    Object.assign(layerDiagnostic.diagnostics[0]!, {
      layerId: "attempted-layer",
    });
    expectRejected(parseStudioSceneLayerLiftResult(layerDiagnostic));

    const successfulReceipt = failure();
    successfulReceipt.receipt = receipt();
    expectRejected(parseStudioSceneLayerLiftResult(successfulReceipt));
  });

  it("fails closed for unsupported kinds, versions, status values, and unreadable objects", () => {
    const requestKind = request();
    Object.assign(requestKind, { kind: "third-party.layer-lift" });
    expect(parseStudioSceneLayerLiftRequest(requestKind)).toMatchObject({
      ok: false,
      reason: "unsupported-kind",
    });

    const resultVersion = success();
    Object.assign(resultVersion, { version: 2 });
    expect(parseStudioSceneLayerLiftResult(resultVersion)).toMatchObject({
      ok: false,
      reason: "unsupported-version",
    });

    const invalidStatus = { ...success(), status: "complete" };
    expectRejected(parseStudioSceneLayerLiftResult(invalidStatus));

    const throwingProxy = new Proxy({}, {
      ownKeys() {
        throw new Error("must stay inside the parser");
      },
    });
    expect(parseStudioSceneLayerLiftRequest(throwingProxy)).toEqual({
      ok: false,
      reason: "invalid-shape",
      detail: "contract.unreadable",
    });
  });
});
