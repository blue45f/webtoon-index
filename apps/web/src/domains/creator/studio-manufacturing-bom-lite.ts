/**
 * Manufacturing / print BOM lite (CAD-P4 subset) — material & part rollup for props.
 * Pure data; not a full PLM/ERP system.
 */

export const STUDIO_MANUFACTURING_BOM_REVISION = 1 as const;

export type StudioBomUnit = "ea" | "m" | "m2" | "m3" | "kg";

export interface StudioBomLine {
  readonly id: string;
  readonly partName: string;
  readonly materialId: string;
  readonly quantity: number;
  readonly unit: StudioBomUnit;
  readonly sourceAssetId?: string;
  readonly notes?: string;
}

export interface StudioBomMaterial {
  readonly id: string;
  readonly name: string;
  readonly densityKgPerM3?: number;
  readonly costPerUnit?: number;
  readonly finish?: string;
}

export interface StudioManufacturingBom {
  readonly revision: typeof STUDIO_MANUFACTURING_BOM_REVISION;
  readonly documentId: string;
  readonly materials: readonly StudioBomMaterial[];
  readonly lines: readonly StudioBomLine[];
}

export function createStudioManufacturingBom(
  documentId: string,
  materials: readonly StudioBomMaterial[] = [],
  lines: readonly StudioBomLine[] = [],
): StudioManufacturingBom {
  return {
    revision: STUDIO_MANUFACTURING_BOM_REVISION,
    documentId,
    materials: [...materials],
    lines: [...lines],
  };
}

export function bomAddMaterial(
  bom: StudioManufacturingBom,
  material: StudioBomMaterial,
): StudioManufacturingBom {
  return {
    ...bom,
    materials: [...bom.materials.filter((m) => m.id !== material.id), material],
  };
}

export function bomAddLine(
  bom: StudioManufacturingBom,
  line: StudioBomLine,
): StudioManufacturingBom {
  if (!(line.quantity > 0) || !Number.isFinite(line.quantity)) {
    throw new Error("bom line quantity must be positive finite");
  }
  return {
    ...bom,
    lines: [...bom.lines.filter((l) => l.id !== line.id), line],
  };
}

export function bomRollupByMaterial(
  bom: StudioManufacturingBom,
): readonly {
  readonly materialId: string;
  readonly materialName: string;
  readonly totalQuantity: number;
  readonly unit: StudioBomUnit;
  readonly lineCount: number;
}[] {
  const byMat = new Map<
    string,
    { materialId: string; materialName: string; totalQuantity: number; unit: StudioBomUnit; lineCount: number }
  >();
  for (const line of bom.lines) {
    const mat = bom.materials.find((m) => m.id === line.materialId);
    const key = `${line.materialId}:${line.unit}`;
    const prev = byMat.get(key);
    if (prev) {
      prev.totalQuantity += line.quantity;
      prev.lineCount += 1;
    } else {
      byMat.set(key, {
        materialId: line.materialId,
        materialName: mat?.name ?? line.materialId,
        totalQuantity: line.quantity,
        unit: line.unit,
        lineCount: 1,
      });
    }
  }
  return [...byMat.values()];
}

export function bomEstimateMassKg(bom: StudioManufacturingBom): number {
  let mass = 0;
  for (const line of bom.lines) {
    const mat = bom.materials.find((m) => m.id === line.materialId);
    if (!mat?.densityKgPerM3) continue;
    if (line.unit === "m3") mass += line.quantity * mat.densityKgPerM3;
    if (line.unit === "kg") mass += line.quantity;
  }
  return mass;
}

/** Seed BOM lines from room/build part ids (prop production aid). */
export function bomFromAssetParts(
  documentId: string,
  parts: readonly { id: string; name: string; materialId?: string; volumeM3?: number }[],
): StudioManufacturingBom {
  let bom = createStudioManufacturingBom(documentId, [
    { id: "mat-default", name: "Default plastic", densityKgPerM3: 1050, finish: "matte" },
    { id: "mat-wood", name: "Plywood", densityKgPerM3: 600, finish: "raw" },
  ]);
  parts.forEach((p, i) => {
    bom = bomAddLine(bom, {
      id: `line-${i}-${p.id}`,
      partName: p.name,
      materialId: p.materialId ?? "mat-default",
      quantity: p.volumeM3 && p.volumeM3 > 0 ? p.volumeM3 : 1,
      unit: p.volumeM3 && p.volumeM3 > 0 ? "m3" : "ea",
      sourceAssetId: p.id,
    });
  });
  return bom;
}
