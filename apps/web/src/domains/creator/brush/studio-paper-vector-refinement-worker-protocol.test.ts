import { describe, expect, it } from "vitest";

import {
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
  createStudioPaperVectorRefinementWorkerExecuteMessage,
  decodeStudioPaperVectorRefinementWorkerArtifact,
  decodeStudioPaperVectorRefinementWorkerRequest,
  encodeStudioPaperVectorRefinementWorkerArtifact,
  snapshotStudioPaperVectorRefinementWorkerInboundMessage,
  snapshotStudioPaperVectorRefinementWorkerOutboundMessage,
  studioPaperVectorRefinementWorkerArtifactTransfers,
  studioPaperVectorRefinementWorkerExecuteTransfers,
} from "./studio-paper-vector-refinement-worker-protocol";

import type {
  StudioPaperVectorRefinementArtifact,
  StudioPaperVectorRefinementRequest,
} from "./studio-paper-vector-refinement-provider";

const PATH = "M 0 0 L 10 10";
const HASH = `sha256:${"a".repeat(64)}` as const;

function request(
  command: StudioPaperVectorRefinementRequest["command"] = {
    kind: "simplify",
    pathData: PATH,
    tolerance: 1,
  },
): StudioPaperVectorRefinementRequest {
  return {
    kind: "studio-paper-vector-refinement/request",
    version: 1,
    requestSequence: 7,
    engineEpoch: 4,
    stage: "settled",
    command,
  };
}

function artifact(): StudioPaperVectorRefinementArtifact {
  return {
    kind: "studio-paper-vector-refinement/artifact",
    version: 1,
    pathData: PATH,
    contours: [
      Object.freeze({
        points: Object.freeze([0, 0, 10, 10]),
        closed: false,
      }),
    ],
    bounds: Object.freeze({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      width: 10,
      height: 10,
    }),
    empty: false,
    curveCount: 1,
    subpathCount: 1,
    receipt: Object.freeze({
      kind: "studio-paper-vector-refinement/receipt",
      version: 1,
      requestSequence: 7,
      engineEpoch: 4,
      command: "simplify",
      inputFingerprint: HASH,
      outputFingerprint: HASH,
      replayFingerprint: HASH,
      package: Object.freeze({ name: "paper", version: "0.12.18" }),
      execution: Object.freeze({
        stage: "settled",
        geometryBoundary: "studio-engine-vector-geometry-provider",
        project: "ephemeral-isolated",
        dynamicImport: true,
      }),
      budget: Object.freeze({
        inputPathDataCodeUnits: PATH.length,
        outputPathDataCodeUnits: PATH.length,
        outputCurveCount: 1,
        outputSubpathCount: 1,
        outputFlattenedPointCount: 2,
        delegatedPathNumberCurveAndWorkBudgets: true,
      }),
      authority: Object.freeze({
        mainScene: false,
        document: false,
        history: false,
        persistence: false,
        output: "settled-vector-refinement-suggestion",
      }),
      capabilitiesUsed: Object.freeze([
        "refine:simplify",
        "execution:settled-only",
        "project:ephemeral-isolated",
        "output:serializable-svg-path-data",
        "output:frozen-flattened-contours",
        "authority:none",
      ]),
      complete: true,
    }),
  } as StudioPaperVectorRefinementArtifact;
}

function artifactWithContour(
  points: readonly number[],
  closed: boolean,
): StudioPaperVectorRefinementArtifact {
  const base = artifact();
  return {
    ...base,
    contours: [
      Object.freeze({
        points: Object.freeze([...points]),
        closed,
      }),
    ],
    receipt: {
      ...base.receipt,
      budget: {
        ...base.receipt.budget,
        outputFlattenedPointCount: points.length / 2,
      },
    },
  } as StudioPaperVectorRefinementArtifact;
}

function resultEnvelope(artifactCandidate: unknown) {
  return {
    type: "studio-paper-vector-refinement/result",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
    generation: 2,
    requestId: 3,
    requestSequence: 7,
    engineEpoch: 4,
    artifact: artifactCandidate,
  };
}

describe("studio Paper vector refinement Worker protocol", () => {
  it("snapshots strings into dedicated transferable UTF-8 buffers", () => {
    const mutable = {
      kind: "simplify" as const,
      pathData: PATH,
      tolerance: 1,
    };
    const message =
      createStudioPaperVectorRefinementWorkerExecuteMessage(
        2,
        3,
        request(mutable),
      );
    expect(message).not.toBeNull();
    if (message === null || message.command.kind === "boolean") return;
    mutable.pathData = "M 50 50 L 60 60";
    expect(new TextDecoder().decode(message.command.pathDataUtf8)).toBe(PATH);
    const transfers = studioPaperVectorRefinementWorkerExecuteTransfers(message);
    expect(transfers).toEqual([message.command.pathDataUtf8.buffer]);

    const cloned = structuredClone(message, { transfer: transfers });
    expect(message.command.pathDataUtf8.byteLength).toBe(0);
    expect(decodeStudioPaperVectorRefinementWorkerRequest(cloned)).toMatchObject({
      command: { kind: "simplify", pathData: PATH, tolerance: 1 },
    });
    expect(mutable.pathData).toBe("M 50 50 L 60 60");
  });

  it("transfers both independently owned boolean path buffers", () => {
    const message =
      createStudioPaperVectorRefinementWorkerExecuteMessage(
        2,
        3,
        request({
          kind: "boolean",
          operator: "unite",
          leftPathData: PATH,
          rightPathData: "M 5 5 L 15 15",
        }),
      );
    expect(message?.command.kind).toBe("boolean");
    if (message === null || message.command.kind !== "boolean") return;
    expect(message.command.leftPathDataUtf8.buffer).not.toBe(
      message.command.rightPathDataUtf8.buffer,
    );
    expect(studioPaperVectorRefinementWorkerExecuteTransfers(message)).toEqual([
      message.command.leftPathDataUtf8.buffer,
      message.command.rightPathDataUtf8.buffer,
    ]);
  });

  it("rejects partial views, SharedArrayBuffer and malformed UTF-8", () => {
    const base =
      createStudioPaperVectorRefinementWorkerExecuteMessage(
        2,
        3,
        request(),
      );
    expect(base).not.toBeNull();
    if (base === null || base.command.kind === "boolean") return;
    const backing = new ArrayBuffer(base.command.pathDataByteLength + 1);
    new Uint8Array(backing, 1).set(base.command.pathDataUtf8);
    expect(snapshotStudioPaperVectorRefinementWorkerInboundMessage({
      ...base,
      command: {
        ...base.command,
        pathDataUtf8: new Uint8Array(
          backing,
          1,
          base.command.pathDataByteLength,
        ),
      },
    })).toBeNull();

    if (typeof SharedArrayBuffer === "function") {
      const shared = new SharedArrayBuffer(base.command.pathDataByteLength);
      new Uint8Array(shared).set(base.command.pathDataUtf8);
      expect(snapshotStudioPaperVectorRefinementWorkerInboundMessage({
        ...base,
        command: {
          ...base.command,
          pathDataUtf8: new Uint8Array(shared),
        },
      })).toBeNull();
    }

    const malformed = Uint8Array.from([0xc3, 0x28]);
    expect(snapshotStudioPaperVectorRefinementWorkerInboundMessage({
      ...base,
      command: {
        ...base.command,
        pathDataUtf8: malformed,
        pathDataByteLength: malformed.byteLength,
      },
    })).toBeNull();
  });

  it("round-trips path and Float64 contour transfers into a deep-frozen artifact", () => {
    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(artifact());
    expect(encoded).not.toBeNull();
    if (encoded === null) return;
    expect(encoded.contours[0]?.points).toBeInstanceOf(Float64Array);
    const transfers =
      studioPaperVectorRefinementWorkerArtifactTransfers(encoded);
    expect(transfers).toEqual([
      encoded.pathDataUtf8.buffer,
      encoded.contours[0]?.points.buffer,
    ]);
    const cloned = structuredClone(encoded, { transfer: transfers });
    const decoded =
      decodeStudioPaperVectorRefinementWorkerArtifact(cloned);
    expect(decoded).toMatchObject({
      pathData: PATH,
      contours: [{ points: [0, 0, 10, 10], closed: false }],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.contours)).toBe(true);
    expect(Object.isFrozen(decoded?.contours[0]?.points)).toBe(true);
  });

  it("revalidates and deep-freezes fresh receipt snapshots after structured clone", () => {
    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(artifact());
    expect(encoded).not.toBeNull();
    if (encoded === null) return;

    const thawed = structuredClone(encoded);
    expect(Object.isFrozen(thawed.receipt)).toBe(false);
    expect(Object.isFrozen(thawed.receipt.package)).toBe(false);
    expect(Object.isFrozen(thawed.receipt.capabilitiesUsed)).toBe(false);

    const snapshot =
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(
        resultEnvelope(thawed),
      );
    expect(snapshot?.type).toBe("studio-paper-vector-refinement/result");
    if (snapshot?.type !== "studio-paper-vector-refinement/result") return;
    expect(snapshot.artifact.receipt).not.toBe(thawed.receipt);
    expect(Object.isFrozen(snapshot.artifact.receipt)).toBe(true);
    expect(Object.isFrozen(snapshot.artifact.receipt.package)).toBe(true);
    expect(Object.isFrozen(snapshot.artifact.receipt.execution)).toBe(true);
    expect(Object.isFrozen(snapshot.artifact.receipt.budget)).toBe(true);
    expect(Object.isFrozen(snapshot.artifact.receipt.authority)).toBe(true);
    expect(
      Object.isFrozen(snapshot.artifact.receipt.capabilitiesUsed),
    ).toBe(true);

    (
      thawed.receipt.package as { version: string }
    ).version = "mutated-after-snapshot";
    expect(snapshot.artifact.receipt.package.version).toBe("0.12.18");

    const decoded =
      decodeStudioPaperVectorRefinementWorkerArtifact(snapshot.artifact);
    expect(decoded?.receipt).not.toBe(snapshot.artifact.receipt);
    expect(Object.isFrozen(decoded?.receipt)).toBe(true);
    expect(Object.isFrozen(decoded?.receipt.package)).toBe(true);
    expect(Object.isFrozen(decoded?.receipt.execution)).toBe(true);
    expect(Object.isFrozen(decoded?.receipt.budget)).toBe(true);
    expect(Object.isFrozen(decoded?.receipt.authority)).toBe(true);
    expect(Object.isFrozen(decoded?.receipt.capabilitiesUsed)).toBe(true);
  });

  it("rejects semantically underspecified contours at encode, snapshot and decode boundaries", () => {
    expect(
      encodeStudioPaperVectorRefinementWorkerArtifact(
        artifactWithContour([0, 0], false),
      ),
    ).toBeNull();
    expect(
      encodeStudioPaperVectorRefinementWorkerArtifact(
        artifactWithContour([0, 0, 10, 10, 0, 0], true),
      ),
    ).toBeNull();

    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(artifact());
    expect(encoded).not.toBeNull();
    if (encoded === null) return;
    const invalidOpen = {
      ...structuredClone(encoded),
      contours: [
        {
          points: new Float64Array([0, 0]),
          closed: false,
        },
      ],
      receipt: {
        ...structuredClone(encoded.receipt),
        budget: {
          ...structuredClone(encoded.receipt.budget),
          outputFlattenedPointCount: 1,
        },
      },
    };
    expect(
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(
        resultEnvelope(invalidOpen),
      ),
    ).toBeNull();
    expect(
      decodeStudioPaperVectorRefinementWorkerArtifact(invalidOpen),
    ).toBeNull();

    const invalidClosed = {
      ...structuredClone(encoded),
      contours: [
        {
          points: new Float64Array([0, 0, 10, 10, 0, 0]),
          closed: true,
        },
      ],
      receipt: {
        ...structuredClone(encoded.receipt),
        budget: {
          ...structuredClone(encoded.receipt.budget),
          outputFlattenedPointCount: 3,
        },
      },
    };
    expect(
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(
        resultEnvelope(invalidClosed),
      ),
    ).toBeNull();
    expect(
      decodeStudioPaperVectorRefinementWorkerArtifact(invalidClosed),
    ).toBeNull();
  });

  it("accepts a closed contour with three distinct vertices and a repeated closure point", () => {
    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(
        artifactWithContour(
          [0, 0, 10, 0, 0, 10, 0, 0],
          true,
        ),
      );
    expect(encoded).not.toBeNull();
    if (encoded === null) return;
    const cloned = structuredClone(encoded);
    expect(
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(
        resultEnvelope(cloned),
      ),
    ).not.toBeNull();
    expect(
      decodeStudioPaperVectorRefinementWorkerArtifact(cloned),
    ).toMatchObject({
      contours: [
        {
          points: [0, 0, 10, 0, 0, 10, 0, 0],
          closed: true,
        },
      ],
    });
  });

  it("rejects receipts that fail validation even when called through decode directly", () => {
    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(artifact());
    expect(encoded).not.toBeNull();
    if (encoded === null) return;
    const invalidReceipt = {
      ...structuredClone(encoded),
      receipt: {
        ...structuredClone(encoded.receipt),
        budget: {
          ...structuredClone(encoded.receipt.budget),
          outputFlattenedPointCount: 999,
        },
      },
    };
    expect(
      decodeStudioPaperVectorRefinementWorkerArtifact(invalidReceipt),
    ).toBeNull();
  });

  it("validates exact ready/result envelopes and fixed hard budgets", () => {
    const ready = {
      type: "studio-paper-vector-refinement/ready",
      version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
      runtimeEpoch: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
      executionLocality: "dedicated-worker",
      mainThreadFallback: false,
      capabilities: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
      hardLimits: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
    };
    expect(
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(ready),
    ).toEqual(ready);
    expect(
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage({
        ...ready,
        legacyFallback: true,
      }),
    ).toBeNull();
  });
});
