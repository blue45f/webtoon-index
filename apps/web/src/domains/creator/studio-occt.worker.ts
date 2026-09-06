/// <reference lib="webworker" />

import {
  occtBooleanCutBoxes,
  occtFilletBox,
  occtLoftedTower,
  occtMakeBoxSolid,
  occtMakeSphereSolid,
  occtCircularPatternBox,
  occtDraftPrismOnBox,
  occtFillet2dExtrudeSolid,
  occtLinearPatternBox,
  occtMakePipeShellSolid,
  occtMakePipeSolid,
  occtMakeThickShellBox,
  occtMakeTorusSolid,
  occtMakeWedgeSolid,
  occtMirrorBox,
  occtOffsetShapeBox,
  occtRevolveCylinderLike,
  occtSectionBoxByPlane,
  occtStepRoundTripBox,
} from "./studio-occt-wasm-facade";

import type {
  StudioOcctWorkerRequest,
  StudioOcctWorkerResponse,
} from "./studio-occt-worker-protocol";

const workerScope = self as DedicatedWorkerGlobalScope;

async function runOperation(
  operation: StudioOcctWorkerRequest["operation"],
) {
  switch (operation.kind) {
    case "box":
      return occtMakeBoxSolid(...operation.size);
    case "sphere":
      return occtMakeSphereSolid(operation.radius);
    case "torus":
      return occtMakeTorusSolid(operation.majorRadius, operation.minorRadius);
    case "pipe":
      return occtMakePipeSolid(operation.length, operation.radius);
    case "mirror-box":
      return occtMirrorBox(operation.size[0], operation.size[1], operation.size[2]);
    case "thick-shell-box":
      return occtMakeThickShellBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.thickness,
      );
    case "wedge":
      return occtMakeWedgeSolid(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.ltx,
      );
    case "offset-shape-box":
      return occtOffsetShapeBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.offset,
      );
    case "fillet2d-extrude":
      return occtFillet2dExtrudeSolid(
        operation.width,
        operation.height,
        operation.depth,
        operation.filletRadius,
      );
    case "pipe-shell":
      return occtMakePipeShellSolid(operation.length, operation.radius);
    case "section-box":
      return occtSectionBoxByPlane(operation.size[0], operation.size[1], operation.size[2]);
    case "draft-prism":
      return occtDraftPrismOnBox(
        operation.baseSize,
        operation.profileInset,
        operation.height,
        operation.angle,
      );
    case "linear-pattern-box":
      return occtLinearPatternBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.offsetX,
        operation.count,
      );
    case "circular-pattern-box":
      return occtCircularPatternBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.radius,
        operation.count,
      );
    case "step-roundtrip-box": {
      const step = await occtStepRoundTripBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
      );
      if (!step.ok) {
        return { ok: false as const, code: step.code, detail: step.detail };
      }
      return {
        ok: true as const,
        bodyKind: step.bodyKind,
        mesh: step.mesh,
        faceCount: step.faceCount,
        triangleCount: step.triangleCount,
        vertexCount: step.vertexCount,
        volumeApprox: step.volumeApprox,
        topology: step.topology,
        massProperties: step.massProperties,
        backend: "opencascade-wasm" as const,
        operation: step.operation,
        loadPath: step.loadPath,
      };
    }
    case "revolve":
      return occtRevolveCylinderLike(operation.radius, operation.height);
    case "fillet-box":
      return occtFilletBox(
        operation.size[0],
        operation.size[1],
        operation.size[2],
        operation.radius,
      );
    case "loft":
      return occtLoftedTower(operation.levels);
    case "cut-boxes":
      return occtBooleanCutBoxes(operation.a, operation.b);
    default: {
      const _exhaustive: never = operation;
      return {
        ok: false as const,
        code: "unknown-op",
        detail: String(_exhaustive),
      };
    }
  }
}

workerScope.addEventListener("message", (event: MessageEvent<StudioOcctWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    const result = await runOperation(request.operation);
    const response: StudioOcctWorkerResponse = { id: request.id, result };
    workerScope.postMessage(response);
  })().catch((error: unknown) => {
    const response: StudioOcctWorkerResponse = {
      id: request.id,
      result: {
        ok: false,
        code: "occt-worker-failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
    workerScope.postMessage(response);
  });
});

export {};
