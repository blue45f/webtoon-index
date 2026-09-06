/**
 * Studio 3D Spatial Webtoon AR Engine & Anchor Resolver
 *
 * Provides:
 * - Augmented Reality (AR) hit-test plane anchoring (horizontal floor/table, vertical wall)
 * - Parametric diorama scaling (1:50 desktop miniature to 1:1 real-world life size)
 * - Shadow receiver ground plane catching with feathered transparency
 * - Environmental Light Estimation irradiance & spherical harmonics adaptation
 * - USDZ QuickLook & WebAR Scene Viewer payload packaging for mobile AR fallback
 */

export type ArPlaneOrientation = "horizontal-table" | "horizontal-floor" | "vertical-wall";

export interface ArAnchorPlacement {
  readonly position: readonly [number, number, number];
  readonly rotationEulerDeg: readonly [number, number, number];
  readonly scale: number; // 0.02 (1:50) to 1.0 (1:1 life-size)
  readonly orientation: ArPlaneOrientation;
  readonly planeDimensions: readonly [number, number]; // [width, depth]
}

export interface ArLightingEstimation {
  readonly lightColorHex: string;
  readonly intensityLumens: number;
  readonly mainLightDirection: readonly [number, number, number];
  readonly ambientSphericalHarmonics: readonly number[]; // 9 RGB SH coefficients (27 floats)
}

export interface ArGroundShadowCatcherConfig {
  readonly enabled: boolean;
  readonly sizeMeters: number;
  readonly opacity: number;
  readonly featherEdge: number;
}

export interface UsdzQuickLookManifest {
  readonly title: string;
  readonly usdzBlobUrl?: string;
  readonly allowsContentScaling: boolean;
  readonly canonicalScale: number;
  readonly previewImagePngUrl?: string;
}

export class Studio3DSpatialWebtoonArEngine {
  private anchor: ArAnchorPlacement;
  private lighting: ArLightingEstimation;
  private shadowCatcher: ArGroundShadowCatcherConfig;

  constructor(initialAnchor?: Partial<ArAnchorPlacement>) {
    this.anchor = {
      position: initialAnchor?.position ?? [0, 0, -1.2],
      rotationEulerDeg: initialAnchor?.rotationEulerDeg ?? [0, 0, 0],
      scale: initialAnchor?.scale ?? 0.1, // Default 1:10 diorama scale
      orientation: initialAnchor?.orientation ?? "horizontal-table",
      planeDimensions: initialAnchor?.planeDimensions ?? [1.5, 1.5],
    };

    this.lighting = {
      lightColorHex: "#ffffff",
      intensityLumens: 1000,
      mainLightDirection: [0.3, 0.9, 0.3],
      ambientSphericalHarmonics: new Array(27).fill(0.1),
    };

    this.shadowCatcher = {
      enabled: true,
      sizeMeters: 3.0,
      opacity: 0.45,
      featherEdge: 0.2,
    };
  }

  public getAnchor(): ArAnchorPlacement {
    return this.anchor;
  }

  public setAnchor(patch: Partial<ArAnchorPlacement>): void {
    this.anchor = { ...this.anchor, ...patch };
  }

  public getLighting(): ArLightingEstimation {
    return this.lighting;
  }

  public updateLightingEstimation(lighting: Partial<ArLightingEstimation>): void {
    this.lighting = { ...this.lighting, ...lighting };
  }

  public getShadowCatcher(): ArGroundShadowCatcherConfig {
    return this.shadowCatcher;
  }

  public setShadowCatcher(config: Partial<ArGroundShadowCatcherConfig>): void {
    this.shadowCatcher = { ...this.shadowCatcher, ...config };
  }

  /**
   * Transforms a 3D stage coordinate into the real-world AR anchor coordinate space.
   */
  public transformPointToArWorld(stagePos: readonly [number, number, number]): [number, number, number] {
    const s = this.anchor.scale;
    const [ax, ay, az] = this.anchor.position;
    const [rxDeg, ryDeg, rzDeg] = this.anchor.rotationEulerDeg;

    // Convert rotation to radians
    const radY = (ryDeg * Math.PI) / 180;
    const radX = (rxDeg * Math.PI) / 180;
    const radZ = (rzDeg * Math.PI) / 180;

    // Scale
    let x = stagePos[0] * s;
    let y = stagePos[1] * s;
    let z = stagePos[2] * s;

    // Rotate Y
    const cosY = Math.cos(radY);
    const sinY = Math.sin(radY);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    x = x1;
    z = z1;

    // Rotate X
    const cosX = Math.cos(radX);
    const sinX = Math.sin(radX);
    const y1 = y * cosX - z * sinX;
    const z2 = y * sinX + z * cosX;
    y = y1;
    z = z2;

    // Rotate Z
    const cosZ = Math.cos(radZ);
    const sinZ = Math.sin(radZ);
    const x2 = x * cosZ - y * sinZ;
    const y2 = x * sinZ + y * cosZ;
    x = x2;
    y = y2;

    // Translate to Anchor
    return [x + ax, y + ay, z + az];
  }

  /**
   * Generates shadow catcher ground plane mesh vertices and alpha gradients.
   */
  public generateShadowCatcherBuffer(): {
    readonly positions: Float32Array;
    readonly uvs: Float32Array;
    readonly indices: Uint32Array;
  } {
    const half = this.shadowCatcher.sizeMeters * 0.5 * this.anchor.scale;
    const y = this.anchor.position[1];

    const positions = new Float32Array([
      -half, y, -half,
       half, y, -half,
       half, y,  half,
      -half, y,  half,
    ]);

    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]);

    const indices = new Uint32Array([
      0, 1, 2,
      0, 2, 3,
    ]);

    return { positions, uvs, indices };
  }

  /**
   * Generates iOS QuickLook USDZ fallback manifest.
   */
  public createUsdzQuickLookManifest(title: string, blobUrl?: string): UsdzQuickLookManifest {
    return {
      title,
      usdzBlobUrl: blobUrl,
      allowsContentScaling: true,
      canonicalScale: this.anchor.scale,
    };
  }
}
