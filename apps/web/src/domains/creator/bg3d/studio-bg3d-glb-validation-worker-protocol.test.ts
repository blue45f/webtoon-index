import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES } from "./studio-bg3d-glb-validation";
import {
  STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
  isStudioBg3dGlbWorkerRequest,
  isStudioBg3dGlbWorkerResponse,
} from "./studio-bg3d-glb-validation-worker-protocol";

const METRICS = {
  byteSize: 4,
  jsonByteSize: 0,
  binByteSize: 0,
  nodes: 0,
  meshes: 0,
  meshPrimitives: 0,
  drawCalls: 0,
  triangles: 0,
  materials: 0,
  textures: 0,
  images: 0,
  imageBytes: 0,
  estimatedDecodedImageBytes: 0,
  maxImageDimension: 0,
  undeterminedImageDimensions: 0,
  lights: 0,
  animations: 0,
  animationChannels: 0,
  animationKeyframes: 0,
  animationValues: 0,
  skins: 0,
  joints: 0,
  morphTargets: 0,
  accessorElements: 0,
  estimatedDecodedGeometryBytes: 0,
} as const;

function successResponse(): Record<string, unknown> {
  return {
    version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: 1,
    result: {
      ok: true,
      code: "valid",
      message: "validated",
      profile: "desktop",
      verifiedSha256: `sha256:${"a".repeat(64)}`,
      verifiedBytes: new Uint8Array(4),
      cumulativeBytesAfter: 4,
      usesBasisTextures: false,
      requiresBasisTextures: false,
      metrics: { ...METRICS },
    },
  };
}

describe("studio BG3D worker protocol guards", () => {
  it("accepts only complete, typed success responses", () => {
    expect(isStudioBg3dGlbWorkerResponse(successResponse())).toBe(true);

    const invalidCases = [
      { path: "hash", mutate: (response: Record<string, unknown>) => {
        (response.result as Record<string, unknown>).verifiedSha256 = "sha256:not-a-hash";
      } },
      { path: "bytes", mutate: (response: Record<string, unknown>) => {
        (response.result as Record<string, unknown>).verifiedBytes = new ArrayBuffer(4);
      } },
      { path: "cumulative", mutate: (response: Record<string, unknown>) => {
        (response.result as Record<string, unknown>).cumulativeBytesAfter = -1;
      } },
      { path: "basis marker", mutate: (response: Record<string, unknown>) => {
        delete (response.result as Record<string, unknown>).usesBasisTextures;
      } },
      { path: "required basis marker", mutate: (response: Record<string, unknown>) => {
        delete (response.result as Record<string, unknown>).requiresBasisTextures;
      } },
      { path: "required basis invariant", mutate: (response: Record<string, unknown>) => {
        (response.result as Record<string, unknown>).requiresBasisTextures = true;
      } },
      { path: "missing metric", mutate: (response: Record<string, unknown>) => {
        delete ((response.result as Record<string, unknown>).metrics as Record<string, unknown>).triangles;
      } },
      { path: "negative metric", mutate: (response: Record<string, unknown>) => {
        ((response.result as Record<string, unknown>).metrics as Record<string, unknown>).nodes = -1;
      } },
      { path: "mismatched byte metric", mutate: (response: Record<string, unknown>) => {
        ((response.result as Record<string, unknown>).metrics as Record<string, unknown>).byteSize = 5;
      } },
    ];
    for (const invalidCase of invalidCases) {
      const response = successResponse();
      invalidCase.mutate(response);
      expect(isStudioBg3dGlbWorkerResponse(response), invalidCase.path).toBe(false);
    }
  });

  it("accepts only declared validator failure codes with a non-empty message", () => {
    const base = {
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 3,
      result: { ok: false, code: "invalid-magic", message: "safe" },
    };
    expect(isStudioBg3dGlbWorkerResponse(base)).toBe(true);
    expect(isStudioBg3dGlbWorkerResponse({
      ...base,
      result: { ...base.result, code: "arbitrary-worker-code" },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerResponse({
      ...base,
      result: { ...base.result, message: "" },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerResponse({
      ...base,
      result: { ...base.result, code: "basis-transcode-failed" },
    })).toBe(true);
  });

  it("validates request envelopes and strips the non-cloneable digest adapter boundary", () => {
    const request = {
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "validate",
      requestId: 1,
      bytes: new ArrayBuffer(4),
      options: {
        declared: { byteSize: 4, sha256: "0".repeat(64), mimeType: "model/gltf-binary" },
        cumulative: { usedBytes: 0, maximumBytes: 1024 },
        profile: "desktop",
        budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      },
    };
    expect(isStudioBg3dGlbWorkerRequest(request)).toBe(true);
    expect(isStudioBg3dGlbWorkerRequest({
      ...request,
      options: { ...request.options, digest: () => new ArrayBuffer(32) },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerRequest({
      ...request,
      options: {
        ...request.options,
        basisTranscoderCapability: {
          protocolVersion: 1,
          transcoderId: "three@0.184.0/basis_transcoder",
        },
      },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerRequest({
      ...request,
      options: { ...request.options, basisPayloadPreflight: async () => true },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerRequest({
      ...request,
      options: { ...request.options, basisRuntimeProvider: async () => null },
    })).toBe(false);
    expect(isStudioBg3dGlbWorkerRequest({ ...request, requestId: 0 })).toBe(false);
    expect(isStudioBg3dGlbWorkerRequest({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "cancel",
      requestId: 2,
    })).toBe(true);
  });
});
