/**
 * Studio 3D Shaper Toon Maker Engine
 *
 * Inspired by Naver Webtoon Shaper (shaper.webtoons.com):
 * - Parametric Webtoon Character Archetypes (8-head Hero, 7.5-head Romance, 6-head Teen, 4-head SD Chibi)
 * - Modular Styling Slots (Hairstyle, Eyes, Brows, Nose, Lips, Outfits, Accessories)
 * - 3D Surface Ink Projection: Projects 2D ink strokes onto 3D mesh surface with barycentric coordinates
 *   so strokes automatically follow skeletal posing and deformation.
 * - Multi-Pass Layer Separation for Webtoon PSD Export
 */

export type CharacterArchetype =
  | "shonen-hero-8head"
  | "romance-lead-7head"
  | "teen-student-6head"
  | "sd-chibi-4head"
  | "muscular-heavy-8head";

export interface ArchetypeProportions {
  readonly headScale: readonly [number, number, number];
  readonly torsoScale: readonly [number, number, number];
  readonly limbLengthFactor: number;
  readonly shoulderWidthFactor: number;
  readonly legLengthRatio: number;
}

export interface StylingSlotSelection {
  readonly hairstyleId: string;
  readonly outfitId: string;
  readonly glassesId?: string;
  readonly eyeColorHex: string;
  readonly hairColorHex: string;
  readonly skinColorHex: string;
  readonly outfitPrimaryColorHex: string;
  readonly outfitSecondaryColorHex: string;
}

export interface SurfaceInkPoint {
  readonly triangleIndex: number;
  readonly barycentric: readonly [number, number, number]; // u, v, w
  readonly pressure: number;
  readonly localOffset: number; // distance along normal
}

export interface SurfaceInkStroke {
  readonly id: string;
  readonly targetMeshId: string;
  readonly points: readonly SurfaceInkPoint[];
  readonly colorHex: string;
  readonly width: number;
  readonly opacity: number;
}

export class Studio3DShaperToonMaker {
  private archetype: CharacterArchetype;
  private styling: StylingSlotSelection;
  private surfaceStrokes: SurfaceInkStroke[] = [];

  constructor(
    initialArchetype: CharacterArchetype = "shonen-hero-8head",
    initialStyling?: Partial<StylingSlotSelection>,
  ) {
    this.archetype = initialArchetype;
    this.styling = {
      hairstyleId: initialStyling?.hairstyleId ?? "short-messy-hero",
      outfitId: initialStyling?.outfitId ?? "korean-school-uniform-v1",
      glassesId: initialStyling?.glassesId,
      eyeColorHex: initialStyling?.eyeColorHex ?? "#2b1e16",
      hairColorHex: initialStyling?.hairColorHex ?? "#1c1c1e",
      skinColorHex: initialStyling?.skinColorHex ?? "#fbe3d5",
      outfitPrimaryColorHex: initialStyling?.outfitPrimaryColorHex ?? "#1a2530",
      outfitSecondaryColorHex: initialStyling?.outfitSecondaryColorHex ?? "#f0f2f5",
    };
  }

  public getArchetype(): CharacterArchetype {
    return this.archetype;
  }

  public setArchetype(archetype: CharacterArchetype): void {
    this.archetype = archetype;
  }

  public getStyling(): StylingSlotSelection {
    return this.styling;
  }

  public updateStyling(patch: Partial<StylingSlotSelection>): void {
    this.styling = { ...this.styling, ...patch };
  }

  public getSurfaceStrokes(): readonly SurfaceInkStroke[] {
    return this.surfaceStrokes;
  }

  public addSurfaceStroke(stroke: SurfaceInkStroke): void {
    this.surfaceStrokes.push(stroke);
  }

  public clearSurfaceStrokes(): void {
    this.surfaceStrokes = [];
  }

  /**
   * Resolves exact anatomical proportion scale vectors for the selected archetype.
   */
  public evaluateArchetypeProportions(): ArchetypeProportions {
    switch (this.archetype) {
      case "shonen-hero-8head":
        return {
          headScale: [0.95, 0.95, 0.95],
          torsoScale: [1.05, 1.0, 1.0],
          limbLengthFactor: 1.08,
          shoulderWidthFactor: 1.15,
          legLengthRatio: 0.58,
        };
      case "romance-lead-7head":
        return {
          headScale: [0.9, 0.9, 0.9],
          torsoScale: [0.95, 1.05, 0.95],
          limbLengthFactor: 1.12,
          shoulderWidthFactor: 1.0,
          legLengthRatio: 0.62,
        };
      case "teen-student-6head":
        return {
          headScale: [1.1, 1.1, 1.1],
          torsoScale: [0.9, 0.95, 0.9],
          limbLengthFactor: 0.95,
          shoulderWidthFactor: 0.92,
          legLengthRatio: 0.52,
        };
      case "sd-chibi-4head":
        return {
          headScale: [1.8, 1.8, 1.8],
          torsoScale: [0.75, 0.7, 0.75],
          limbLengthFactor: 0.65,
          shoulderWidthFactor: 0.75,
          legLengthRatio: 0.42,
        };
      case "muscular-heavy-8head":
        return {
          headScale: [0.92, 0.92, 0.92],
          torsoScale: [1.35, 1.15, 1.25],
          limbLengthFactor: 1.05,
          shoulderWidthFactor: 1.4,
          legLengthRatio: 0.55,
        };
    }
  }

  /**
   * Evaluates world-space positions of 3D surface ink points given current mesh vertex buffers.
   */
  public evaluateStrokeWorldPositions(
    stroke: SurfaceInkStroke,
    meshVertices: Float32Array, // 3 floats per vertex (x, y, z)
    meshIndices: Uint32Array,   // 3 indices per triangle (i0, i1, i2)
  ): readonly [number, number, number][] {
    const evaluated: [number, number, number][] = [];

    for (const pt of stroke.points) {
      const triIdx = pt.triangleIndex;
      const i0 = meshIndices[triIdx * 3];
      const i1 = meshIndices[triIdx * 3 + 1];
      const i2 = meshIndices[triIdx * 3 + 2];

      if (i0 === undefined || i1 === undefined || i2 === undefined) continue;

      const v0x = meshVertices[i0 * 3]!;
      const v0y = meshVertices[i0 * 3 + 1]!;
      const v0z = meshVertices[i0 * 3 + 2]!;

      const v1x = meshVertices[i1 * 3]!;
      const v1y = meshVertices[i1 * 3 + 1]!;
      const v1z = meshVertices[i1 * 3 + 2]!;

      const v2x = meshVertices[i2 * 3]!;
      const v2y = meshVertices[i2 * 3 + 1]!;
      const v2z = meshVertices[i2 * 3 + 2]!;

      const [u, v, w] = pt.barycentric;

      // P = u*v0 + v*v1 + w*v2
      const px = u * v0x + v * v1x + w * v2x;
      const py = u * v0y + v * v1y + w * v2y;
      const pz = u * v0z + v * v1z + w * v2z;

      evaluated.push([px, py, pz]);
    }

    return evaluated;
  }
}
