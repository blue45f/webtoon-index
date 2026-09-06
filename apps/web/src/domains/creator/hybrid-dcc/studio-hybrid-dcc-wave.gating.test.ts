/**
 * Wave gating: deepened partial paths (collab/FBX/IFC/STEP/CAD) + multi-step product loop.
 */
import { describe, expect, it } from "vitest";

import {
  buildStudioCadRectangleSketch,
  createStudioCadSketch,
  diagnoseStudioCadConstraints,
  snapStudioCadSketchAxes,
} from "../studio-cad-kernel-lite";
import {
  createStudioAsciiFbxTriangleFixture,
  importStudioFbxAsciiDocument,
  importStudioFbxDocument,
  parseStudioFbxAsciiHeader,
  sniffStudioFbxBinaryHeader,
} from "../studio-fbx-ascii-import";
import {
  importStudioIfcShell,
  importStudioStepShell,
} from "../studio-mesh-format-adapters";
import { unpackStudioToon3dPackage } from "../studio-toon3d-package";

import {
  STUDIO_DCC_KERNEL_COVERAGE_REGISTRY,
  STUDIO_DCC_KERNEL_COVERAGE_REVISION,
  assertKernelPartialCeilingNotes,
  assertWebtoonObjectCreatorV1KernelCoverage,
} from "./studio-dcc-catalog-registry";
import {
  collabAppendOp,
  collabCanEdit,
  collabConflictReport,
  collabExpireStaleLocks,
  collabJoin,
  collabLatestGeometryHints,
  collabMergeOpLogs,
  collabRoomDigest,
  createStudioDccCollabRoom,
  STUDIO_DCC_COLLAB_SHELL_REVISION,
} from "./studio-dcc-collab-shell";
import {
  runStudioHybridDccWaveProductLoop,
} from "./studio-hybrid-dcc-workspace";


describe("collab shell deepenings", () => {
  it("locks, merges op logs, and reports concurrent geometry-hint conflicts", () => {
    expect(STUDIO_DCC_COLLAB_SHELL_REVISION).toBeGreaterThanOrEqual(4);
    let a = createStudioDccCollabRoom("room-wave");
    a = collabJoin(a, { peerId: "p1", displayName: "One", color: "#111" }, 1000);
    a = collabJoin(a, { peerId: "p2", displayName: "Two", color: "#222" }, 1000);
    a = collabAppendOp(a, {
      kind: "lock",
      peerId: "p1",
      assetId: "mesh-a",
      at: 1100,
    });
    expect(a.locks["mesh-a"]).toBe("p1");
    a = collabAppendOp(a, {
      kind: "geometry-hint",
      peerId: "p1",
      assetId: "mesh-a",
      geometryHash: "h-p1",
      at: 1200,
    });
    a = collabAppendOp(a, {
      kind: "geometry-hint",
      peerId: "p2",
      assetId: "mesh-a",
      geometryHash: "h-p2",
      at: 1300,
    });
    const conflicts = collabConflictReport(a, 5000);
    expect(conflicts.some((c) => c.reason === "concurrent-geometry-hints")).toBe(true);
    const hints = collabLatestGeometryHints(a);
    expect(hints["mesh-a"]?.hash).toBe("h-p2");
    expect(hints["mesh-a"]?.peerId).toBe("p2");

    let b = createStudioDccCollabRoom("room-wave");
    b = collabJoin(b, { peerId: "p3", displayName: "Three", color: "#333" }, 2000);
    b = collabAppendOp(b, {
      kind: "chat",
      peerId: "p3",
      text: "hi",
      at: 2100,
    });
    const merged = collabMergeOpLogs(a, b);
    expect(merged.peers.length).toBeGreaterThanOrEqual(3);
    expect(merged.ops.some((op) => op.kind === "chat")).toBe(true);
    // Rebuild from empty locks: epoch tracks appends only (not pre-seeded join epochs).
    expect(merged.ops.length).toBeGreaterThanOrEqual(a.ops.length);
    expect(merged.epoch).toBe(merged.ops.length);
    expect(merged.locks["mesh-a"]).toBe("p1");
  });

  it("select-before-lock is not contention; select-after-lock is", () => {
    let room = createStudioDccCollabRoom("room-lock-timing");
    room = collabJoin(room, { peerId: "holder", displayName: "H", color: "#0a0" }, 1000);
    room = collabJoin(room, { peerId: "other", displayName: "O", color: "#a00" }, 1000);
    // Historical select before any lock must not count as contention
    room = collabAppendOp(room, {
      kind: "select",
      peerId: "other",
      assetIds: ["mesh-x"],
      at: 1100,
    });
    room = collabAppendOp(room, {
      kind: "lock",
      peerId: "holder",
      assetId: "mesh-x",
      at: 2000,
    });
    expect(room.locks["mesh-x"]).toBe("holder");
    const beforeOnly = collabConflictReport(room);
    expect(beforeOnly.some((c) => c.reason === "lock-contention" && c.assetId === "mesh-x")).toBe(
      false,
    );

    // Select after lock by non-holder is contention
    room = collabAppendOp(room, {
      kind: "select",
      peerId: "other",
      assetIds: ["mesh-x"],
      at: 2100,
    });
    const afterSelect = collabConflictReport(room);
    const lockConflict = afterSelect.find(
      (c) => c.reason === "lock-contention" && c.assetId === "mesh-x",
    );
    expect(lockConflict).toBeDefined();
    expect(lockConflict!.peerIds).toContain("holder");
    expect(lockConflict!.peerIds).toContain("other");
  });

  it("merge of related rooms does not duplicate shared ops", () => {
    const sharedChat = {
      kind: "chat" as const,
      peerId: "p1",
      text: "shared",
      at: 1500,
    };
    let left = createStudioDccCollabRoom("room-dedupe");
    left = collabJoin(left, { peerId: "p1", displayName: "One", color: "#111" }, 1000);
    left = collabAppendOp(left, {
      kind: "lock",
      peerId: "p1",
      assetId: "mesh-d",
      at: 1200,
    });
    left = collabAppendOp(left, sharedChat);

    let right = createStudioDccCollabRoom("room-dedupe");
    right = collabJoin(right, { peerId: "p1", displayName: "One", color: "#111" }, 1000);
    right = collabJoin(right, { peerId: "p2", displayName: "Two", color: "#222" }, 1100);
    // Same shared history + one unique op on right
    right = collabAppendOp(right, {
      kind: "lock",
      peerId: "p1",
      assetId: "mesh-d",
      at: 1200,
    });
    right = collabAppendOp(right, sharedChat);
    right = collabAppendOp(right, {
      kind: "chat",
      peerId: "p2",
      text: "only-right",
      at: 1600,
    });

    const merged = collabMergeOpLogs(left, right);
    const sharedCount = merged.ops.filter(
      (op) => op.kind === "chat" && op.peerId === "p1" && op.text === "shared" && op.at === 1500,
    ).length;
    expect(sharedCount).toBe(1);
    const lockCount = merged.ops.filter(
      (op) => op.kind === "lock" && op.assetId === "mesh-d" && op.peerId === "p1" && op.at === 1200,
    ).length;
    expect(lockCount).toBe(1);
    expect(merged.locks["mesh-d"]).toBe("p1");
    expect(merged.ops.some((op) => op.kind === "chat" && op.text === "only-right")).toBe(true);
    // Replay from empty locks — single lock application, not double
    expect(Object.keys(merged.locks)).toEqual(["mesh-d"]);
  });

  it("canEdit, expire stale locks, and room digest are pure-TS collab hygiene", () => {
    let room = createStudioDccCollabRoom("room-hygiene");
    room = collabJoin(room, { peerId: "ghost", displayName: "G", color: "#666" }, 1000);
    room = collabAppendOp(room, {
      kind: "lock",
      peerId: "ghost",
      assetId: "mesh-stale",
      at: 1100,
    });
    room = collabJoin(room, { peerId: "alive", displayName: "A", color: "#0f0" }, 100_000);
    room = collabAppendOp(room, {
      kind: "lock",
      peerId: "alive",
      assetId: "mesh-live",
      at: 100_100,
    });
    expect(collabCanEdit(room, "alive", "mesh-live")).toBe(true);
    expect(collabCanEdit(room, "alive", "mesh-stale")).toBe(false);
    expect(collabCanEdit(room, "ghost", "mesh-stale")).toBe(true);
    // ghost lastSeenAt=1100 is outside TTL; alive lastSeenAt=100100 stays
    const expired = collabExpireStaleLocks(room, 100_100 + 5_000, 60_000);
    expect(expired.locks["mesh-stale"]).toBeUndefined();
    expect(expired.locks["mesh-live"]).toBe("alive");
    const digest = collabRoomDigest(expired);
    expect(digest).toContain("e");
    expect(digest).toContain("mesh-live=alive");
    expect(collabRoomDigest(expired)).toBe(digest);
  });
});

describe("FBX binary honesty", () => {
  it("returns structured sniff + report without fabricating meshes on empty binary", () => {
    const bytes = new Uint8Array(40);
    const magic = new TextEncoder().encode("Kaydara FBX Binary  ");
    bytes.set(magic);
    // version 7500 little-endian at offset 23
    bytes[23] = 7500 & 0xff;
    bytes[24] = (7500 >> 8) & 0xff;
    bytes[25] = (7500 >> 16) & 0xff;
    bytes[26] = (7500 >> 24) & 0xff;
    const sniff = sniffStudioFbxBinaryHeader(bytes);
    expect(sniff.magicOk).toBe(true);
    expect(sniff.version).toBe(7500);
    expect(sniff.byteLength).toBe(40);
    const result = importStudioFbxDocument(bytes);
    // Empty binary body: parse walks nodes, does not invent triangle soup
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.binary?.version).toBe(7500);
      expect(["P", "X"]).toContain(result.report?.fidelity.geometry);
      expect(result.report?.committed).toBe(false);
      expect(result.report?.sourceHash.startsWith("sha256:")).toBe(true);
    }
  });

  it("parses ASCII FBX header stats on the shipped import path", () => {
    const fixture = createStudioAsciiFbxTriangleFixture();
    const header = parseStudioFbxAsciiHeader(fixture);
    expect(header.fbxVersion).toBe(7400);
    expect(header.headerVersion).toBe(1003);
    expect(header.geometryMeshCount).toBeGreaterThanOrEqual(1);
    expect(header.modelCount).toBeGreaterThanOrEqual(1);
    const imported = importStudioFbxAsciiDocument(fixture);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.header.fbxVersion).toBe(7400);
      expect(imported.meshes.length).toBe(1);
      expect(["A", "B"]).toContain(imported.report.fidelity.geometry);
      expect(imported.report.warnings.some((w) => w.includes("geometryMeshCount="))).toBe(true);
    }
  });
});

describe("IFC/STEP AABB shell fidelity", () => {
  it("builds AABB shell with semantic extras for IFC", () => {
    const ifc = importStudioIfcShell(
      [
        "ISO-10303-21;",
        "DATA;",
        "#1=IFCCARTESIANPOINT((0.,0.,0.));",
        "#2=IFCCARTESIANPOINT((2.,1.,3.));",
        "#3=IFCSPACE('0$1','Hall','',$,$,$,$,$,.ELEMENT.,$,$);",
        "#4=IFCBUILDINGSTOREY('0$2','L1','',$,$,$,$,$,.ELEMENT.,$);",
        "#5=IFCWALL('0abcdefghij0123456789A','W',$,$,$,$,$,$,$);",
        "#6=IFCDOOR('0abcdefghij0123456789B','D',$,$,$,$,$,$,$);",
        "#7=IFCWINDOW('0abcdefghij0123456789C','Win',$,$,$,$,$,$,$);",
        "#8=IFCCOLUMN('0abcdefghij0123456789D','C1',$,$,$,$,$,$,$);",
        "#9=IFCBEAM('0abcdefghij0123456789E','B1',$,$,$,$,$,$,$);",
        "ENDSEC;",
      ].join("\n"),
    );
    expect(ifc.meshes.length).toBeGreaterThanOrEqual(1);
    expect(["A", "B"]).toContain(ifc.report.fidelity.geometry);
    expect(ifc.extras?.doorCount).toBe(1);
    expect(ifc.extras?.windowCount).toBe(1);
    expect(ifc.extras?.columnCount).toBe(1);
    expect(ifc.extras?.beamCount).toBe(1);
    expect((ifc.extras?.globalIds as string[]).length).toBeGreaterThan(0);
    expect((ifc.extras?.storeys as string[])?.includes("L1")).toBe(true);
    expect(ifc.extras?.aabbVertexCount).toBe(8);
  });

  it("builds AABB shell with shell/product counts for STEP", () => {
    const step = importStudioStepShell(
      [
        "#10=CARTESIAN_POINT('',(0.,0.,0.));",
        "#20=CARTESIAN_POINT('',(1.,2.,3.));",
        "#30=PRODUCT('Bracket','Bracket','',(#40));",
        "#50=ADVANCED_FACE('',(#60),#70,.T.);",
        "#80=CLOSED_SHELL('',(#50));",
        "#90=DIRECTION('',(0.,1.,0.));",
        "#100=MANIFOLD_SOLID_BREP('',#80);",
        "#110=AXIS2_PLACEMENT_3D('',#10,#90,#90);",
        "#120=SI_UNIT(*,.METRE.);",
      ].join("\n"),
    );
    expect(step.meshes.length).toBeGreaterThanOrEqual(1);
    expect(["A", "B"]).toContain(step.report.fidelity.geometry);
    expect(step.extras?.closedShells).toBe(1);
    expect(step.extras?.directions).toBe(1);
    expect(step.extras?.manifoldSolidBreps).toBe(1);
    expect(step.extras?.axis2Placements).toBe(1);
    expect(step.extras?.siMetre).toBe(true);
    expect((step.extras?.products as string[])?.includes("Bracket")).toBe(true);
    expect(step.extras?.aabbVertexCount).toBe(8);
  });
});

describe("CAD constraint diagnostics deepenings", () => {
  it("verifies coincident/equal/distance and axis snap", () => {
    const open = createStudioCadSketch(
      [
        { kind: "line", a: [0, 0], b: [1, 0.0004] },
        { kind: "line", a: [1, 0], b: [1, 1] },
        { kind: "line", a: [1, 1], b: [0, 1] },
        { kind: "line", a: [0, 1], b: [0, 0] },
      ],
      [
        { kind: "horizontal", curveIndex: 0 },
        { kind: "vertical", curveIndex: 1 },
        { kind: "coincident", a: 0, b: 1, endA: "b", endB: "a" },
        { kind: "equal", a: 0, b: 2 },
        { kind: "distance", a: 0, b: 2, value: 1 },
      ],
    );
    const snapped = snapStudioCadSketchAxes(open);
    const report = diagnoseStudioCadConstraints(snapped);
    expect(report.satisfied.length).toBeGreaterThanOrEqual(3);
    // near-horizontal snapped then horizontal constraint should pass
    expect(report.conflicts.some((c) => c.includes("horizontal"))).toBe(false);

    const bad = createStudioCadSketch(
      [
        { kind: "line", a: [0, 0], b: [1, 0] },
        { kind: "line", a: [2, 0], b: [3, 0] },
      ],
      [{ kind: "coincident", a: 0, b: 1, endA: "b", endB: "a" }],
    );
    const badReport = diagnoseStudioCadConstraints(bad);
    expect(badReport.conflicts.some((c) => c.includes("coincident"))).toBe(true);
  });

  it("rectangle recipe satisfies angle constraints on the shipped diagnose API", () => {
    const rect = buildStudioCadRectangleSketch(2, 1);
    const report = diagnoseStudioCadConstraints(rect);
    expect(report.conflicts).toHaveLength(0);
    expect(report.satisfied.length).toBe(rect.constraints.length);
    expect(report.state === "fully-constrained" || report.degreesOfFreedom === 0).toBe(true);
  });
});

describe("wave multi-step product loop", () => {
  it("geo-nodes → edit → IFC import → retarget/BOM/collab → .toon3d with concrete metrics", async () => {
    const result = await runStudioHybridDccWaveProductLoop("wave-gate-1");
    expect(result.metrics.assetCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.shotCount).toBe(4);
    expect(result.metrics.bomLines).toBeGreaterThan(0);
    expect(result.metrics.collabEpoch).toBeGreaterThan(0);
    expect(result.metrics.collabOps).toBeGreaterThanOrEqual(2);
    expect(result.metrics.uvMode).toBe("box");
    expect(result.metrics.packageHash.startsWith("sha256:")).toBe(true);
    expect(result.metrics.documentHasGeo).toBe(true);
    expect(result.metrics.importFormat).toBe("ifc");
    expect(["A", "B"]).toContain(result.metrics.importGeometryFidelity);
    expect(result.metrics.diagnosticErrors).toBe(0);
    expect(result.workspace.collab.locks[result.workspace.activeAssetId ?? ""]).toBeDefined();
    const unpacked = unpackStudioToon3dPackage(result.package);
    expect(unpacked.shotCount).toBe(4);
    expect(unpacked.document.documentId).toBe("wave-gate-1");
    expect(result.package.files["shots/shots.json"]).toContain("shot-1");
  });
});

describe("callable-kernel compatibility registry revision", () => {
  it("keeps §12.1 kernel coverage without claiming product delivery", () => {
    expect(STUDIO_DCC_KERNEL_COVERAGE_REVISION).toBeGreaterThanOrEqual(8);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.some((entry) => entry.id === "WS-WAVE-LOOP")).toBe(true);
    const doc008 = STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.find((entry) => entry.id === "DOC-008");
    expect(doc008?.kernelStatus).toBe("kernel-shipped");
    expect(doc008?.apis).toContain("exerciseStudioDccYjsSceneMetadataConvergence");
    expect(doc008?.apis).toContain("collabCanEdit");
    for (const id of ["CAD-001", "FMT-FBX", "FMT-IFC", "FMT-STEP"] as const) {
      const entry = STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.find((candidate) => candidate.id === id);
      expect(entry?.kernelStatus).toBe("kernel-shipped");
      expect(entry?.ceilingNote).toBeUndefined();
    }
    const { ok, missing } = assertWebtoonObjectCreatorV1KernelCoverage();
    expect(missing).toEqual([]);
    expect(ok).toBe(true);
    const ceiling = assertKernelPartialCeilingNotes();
    expect(ceiling.missing).toEqual([]);
    expect(ceiling.ok).toBe(true);
  });
});
