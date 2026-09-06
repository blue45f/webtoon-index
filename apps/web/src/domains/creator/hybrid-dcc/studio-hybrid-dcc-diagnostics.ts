/**
 * DOC-015 corruption scanner — orphan assets, invalid references, bad mesh diagnostics.
 */

import {
  diagnoseStudioEditableMesh,
  type StudioEditableMesh,
  type StudioMeshDiagnostic,
} from "../studio-editable-half-edge-mesh";

import { normalizeStudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";

import type { StudioHybridDccDocumentState } from "./studio-hybrid-dcc-document";

export const STUDIO_HYBRID_DCC_DIAGNOSTICS_REVISION = 1 as const;

export type StudioHybridCorruptionCode =
  | "orphan-asset"
  | "dangling-dependency"
  | "missing-geometry"
  | "bad-mesh"
  | "rights-missing"
  | "object-transform-missing"
  | "object-transform-invalid"
  | "object-transform-orphan"
  | "empty-document";

export interface StudioHybridCorruptionFinding {
  readonly code: StudioHybridCorruptionCode;
  readonly severity: "error" | "warning" | "info";
  readonly targetId: string;
  readonly message: string;
  readonly meshDiagnostics?: readonly StudioMeshDiagnostic[];
}

export interface StudioHybridCorruptionReport {
  readonly revision: typeof STUDIO_HYBRID_DCC_DIAGNOSTICS_REVISION;
  readonly findings: readonly StudioHybridCorruptionFinding[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly repairable: readonly string[];
}

export function scanStudioHybridDccCorruption(
  state: StudioHybridDccDocumentState,
): StudioHybridCorruptionReport {
  const findings: StudioHybridCorruptionFinding[] = [];
  const assetIds = new Set(Object.keys(state.geometry.records));

  if (assetIds.size === 0 && state.commandCount === 0) {
    findings.push({
      code: "empty-document",
      severity: "info",
      targetId: state.documentId,
      message: "Document has no geometry assets",
    });
  }

  for (const edge of state.dependencies) {
    if (edge.fromId !== "shot:*" && !assetIds.has(edge.fromId) && !edge.fromId.includes("*")) {
      // dependency from missing asset
      if (!assetIds.has(edge.fromId)) {
        findings.push({
          code: "dangling-dependency",
          severity: "error",
          targetId: edge.fromId,
          message: `Dependency from missing asset ${edge.fromId} → ${edge.toId}`,
        });
      }
    }
  }

  const rightsIds = new Set(state.rightsBom.map((r) => r.assetId));
  for (const id of assetIds) {
    if (!Object.hasOwn(state.objectTransforms, id)) {
      findings.push({
        code: "object-transform-missing",
        severity: "error",
        targetId: id,
        message: `Asset ${id} has no canonical object transform`,
      });
    } else {
      try {
        normalizeStudioHybridDccObjectTransform(state.objectTransforms[id]);
      } catch (error) {
        findings.push({
          code: "object-transform-invalid",
          severity: "error",
          targetId: id,
          message: `Asset ${id} has an invalid object transform: ${error instanceof Error ? error.message : "invalid value"}`,
        });
      }
    }
    if (!rightsIds.has(id)) {
      findings.push({
        code: "rights-missing",
        severity: "warning",
        targetId: id,
        message: `Asset ${id} has no Rights BOM record`,
      });
    }
    const record = state.geometry.records[id];
    if (!record) {
      findings.push({
        code: "missing-geometry",
        severity: "error",
        targetId: id,
        message: `Geometry authority missing for ${id}`,
      });
      continue;
    }
    const meshDiags = diagnoseStudioEditableMesh(record.mesh);
    const errors = meshDiags.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      findings.push({
        code: "bad-mesh",
        severity: "error",
        targetId: id,
        message: `Mesh ${id} has ${errors.length} topology error(s)`,
        meshDiagnostics: meshDiags,
      });
    }
  }

  for (const id of Object.keys(state.objectTransforms)) {
    if (!assetIds.has(id)) {
      findings.push({
        code: "object-transform-orphan",
        severity: "warning",
        targetId: id,
        message: `Object transform for missing asset ${id}`,
      });
    }
  }

  // Orphan rights (rights without geometry)
  for (const r of state.rightsBom) {
    if (!assetIds.has(r.assetId)) {
      findings.push({
        code: "orphan-asset",
        severity: "warning",
        targetId: r.assetId,
        message: `Rights BOM entry for missing asset ${r.assetId}`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const repairable = findings
    .filter((f) => f.code === "orphan-asset" || f.code === "rights-missing")
    .map((f) => f.targetId);

  return {
    revision: STUDIO_HYBRID_DCC_DIAGNOSTICS_REVISION,
    findings,
    errorCount,
    warningCount,
    repairable,
  };
}

/** Drop orphan rights entries (safe repair). */
export function repairStudioHybridOrphanRights(
  state: StudioHybridDccDocumentState,
): StudioHybridDccDocumentState {
  const assetIds = new Set(Object.keys(state.geometry.records));
  return {
    ...state,
    rightsBom: state.rightsBom.filter((r) => assetIds.has(r.assetId)),
  };
}

export function assertStudioMeshHealthy(mesh: StudioEditableMesh): boolean {
  return diagnoseStudioEditableMesh(mesh).every((d) => d.severity !== "error");
}
