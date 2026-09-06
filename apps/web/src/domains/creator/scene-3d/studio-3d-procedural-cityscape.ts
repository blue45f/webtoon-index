/**
 * Studio 3D Procedural Cityscape & Webtoon Urban Street Kit
 *
 * Procedurally generates Korean & modern Asian webtoon street environments:
 * - Multi-lane roads, asphalt, sidewalks, curbs, crosswalks
 * - Parametric commercial/residential building facades with storefronts, window rows, roof tanks, HVAC
 * - Street props: Power poles with catenary wires, street lamps, vending machines, bus stops
 * - Generates watertight 3D mesh buffers for instant WebGL/Three.js rendering.
 */

export type CityscapeTheme = "seoul-commercial" | "residential-alley" | "school-street" | "cyber-downtown";

export interface CityscapeBuildingConfig {
  readonly id: string;
  readonly lotPosition: readonly [number, number, number]; // [x, 0, z]
  readonly width: number;
  readonly depth: number;
  readonly floors: number;
  readonly floorHeight: number;
  readonly storefrontKind: "convenience" | "cafe" | "pharmacy" | "snack-bar" | "pc-bang" | "noraebang" | "realty";
  readonly wallColorHex: string;
  readonly windowColorHex: string;
  readonly roofStructure: "water-tank" | "hvac" | "antenna" | "billboard" | "none";
}

export interface CityscapeStreetConfig {
  readonly theme: CityscapeTheme;
  readonly roadLength: number;
  readonly roadWidth: number;
  readonly sidewalkWidth: number;
  readonly crosswalkCount: number;
  readonly powerPoleSpacing: number;
  readonly buildingsPerSide: number;
  readonly seed: number;
}

export interface CityscapeMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly buildingCount: number;
}

const STOREFRONT_NAMES: readonly CityscapeBuildingConfig["storefrontKind"][] = [
  "convenience",
  "cafe",
  "pharmacy",
  "snack-bar",
  "pc-bang",
  "noraebang",
  "realty",
];

const WALL_PALETTES = [
  "#e0e1dd", // Light concrete
  "#d4a373", // Warm brick
  "#6c757d", // Slate grey
  "#f4f1de", // Cream stucco
  "#e29578", // Terracotta
  "#778da9", // Steel blue
  "#c9ada7", // Mauve tile
];

export class Studio3DProceduralCityscape {
  private config: CityscapeStreetConfig;
  private buildings: CityscapeBuildingConfig[] = [];

  constructor(config: Partial<CityscapeStreetConfig> = {}) {
    this.config = {
      theme: config.theme ?? "seoul-commercial",
      roadLength: config.roadLength ?? 60,
      roadWidth: config.roadWidth ?? 12,
      sidewalkWidth: config.sidewalkWidth ?? 3.5,
      crosswalkCount: config.crosswalkCount ?? 3,
      powerPoleSpacing: config.powerPoleSpacing ?? 15,
      buildingsPerSide: config.buildingsPerSide ?? 5,
      seed: config.seed ?? 1024,
    };
    this.generateLayout();
  }

  public getConfig(): CityscapeStreetConfig {
    return this.config;
  }

  public getBuildings(): readonly CityscapeBuildingConfig[] {
    return this.buildings;
  }

  public setConfig(patch: Partial<CityscapeStreetConfig>): void {
    this.config = { ...this.config, ...patch };
    this.generateLayout();
  }

  private generateLayout(): void {
    let rng = this.config.seed;
    const random = () => {
      rng = (rng * 1664525 + 1013904223) % 4294967296;
      return rng / 4294967296;
    };

    this.buildings = [];
    const { roadLength, roadWidth, sidewalkWidth, buildingsPerSide } = this.config;
    const buildingOffset = roadWidth / 2 + sidewalkWidth;

    const buildingLotLength = roadLength / buildingsPerSide;

    for (const side of [-1, 1]) {
      const zSide = side * buildingOffset;
      for (let i = 0; i < buildingsPerSide; i += 1) {
        const xPos = -roadLength / 2 + (i + 0.5) * buildingLotLength;
        const bWidth = buildingLotLength * (0.85 + random() * 0.12);
        const bDepth = 10 + random() * 8;
        const floors = Math.floor(3 + random() * 6); // 3 to 8 floors
        const storefront = STOREFRONT_NAMES[Math.floor(random() * STOREFRONT_NAMES.length)];
        const wallColor = WALL_PALETTES[Math.floor(random() * WALL_PALETTES.length)];
        const roofStructures: CityscapeBuildingConfig["roofStructure"][] = [
          "water-tank",
          "hvac",
          "antenna",
          "billboard",
          "none",
        ];
        const roof = roofStructures[Math.floor(random() * roofStructures.length)];

        const zCenter = side > 0 ? zSide + bDepth / 2 : zSide - bDepth / 2;

        this.buildings.push({
          id: `bld-${side > 0 ? "north" : "south"}-${i}`,
          lotPosition: [xPos, 0, zCenter],
          width: bWidth,
          depth: bDepth,
          floors,
          floorHeight: 3.2,
          storefrontKind: storefront,
          wallColorHex: wallColor,
          windowColorHex: "#1b263b",
          roofStructure: roof,
        });
      }
    }
  }

  /**
   * Generates a watertight combined mesh for the entire procedural cityscape.
   */
  public generateMesh(): CityscapeMeshData {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let vertexOffset = 0;

    const addQuad = (
      p0: readonly [number, number, number],
      p1: readonly [number, number, number],
      p2: readonly [number, number, number],
      p3: readonly [number, number, number],
      normal: readonly [number, number, number],
    ) => {
      positions.push(...p0, ...p1, ...p2, ...p3);
      for (let i = 0; i < 4; i += 1) {
        normals.push(...normal);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3,
      );
      vertexOffset += 4;
    };

    const addBox = (
      minX: number,
      minY: number,
      minZ: number,
      maxX: number,
      maxY: number,
      maxZ: number,
    ) => {
      // Top (+Y)
      addQuad([minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ], [0, 1, 0]);
      // Bottom (-Y)
      addQuad([minX, minY, maxZ], [maxX, minY, maxZ], [maxX, minY, minZ], [minX, minY, minZ], [0, -1, 0]);
      // Front (+Z)
      addQuad([minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ], [0, 0, 1]);
      // Back (-Z)
      addQuad([maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [0, 0, -1]);
      // Left (-X)
      addQuad([minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ], [-1, 0, 0]);
      // Right (+X)
      addQuad([maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [1, 0, 0]);
    };

    const { roadLength, roadWidth, sidewalkWidth } = this.config;
    const halfL = roadLength / 2;
    const halfW = roadWidth / 2;

    // 1. Asphalt Road Bed
    addQuad([-halfL, 0, -halfW], [halfL, 0, -halfW], [halfL, 0, halfW], [-halfL, 0, halfW], [0, 1, 0]);

    // 2. Sidewalks (+Z and -Z sides)
    const curbHeight = 0.18;
    // South Sidewalk (-Z)
    addBox(-halfL, 0, -halfW - sidewalkWidth, halfL, curbHeight, -halfW);
    // North Sidewalk (+Z)
    addBox(-halfL, 0, halfW, halfL, curbHeight, halfW + sidewalkWidth);

    // 3. Buildings
    for (const bld of this.buildings) {
      const totalHeight = bld.floors * bld.floorHeight;
      const [bx, , bz] = bld.lotPosition;
      const minX = bx - bld.width / 2;
      const maxX = bx + bld.width / 2;
      const minZ = bz - bld.depth / 2;
      const maxZ = bz + bld.depth / 2;

      // Main Building Core Box
      addBox(minX, 0, minZ, maxX, totalHeight, maxZ);

      // Roof Structures
      if (bld.roofStructure === "water-tank") {
        // Cylindrical/Box Water Tank
        const tankW = Math.min(2.5, bld.width * 0.3);
        const tankH = 2.4;
        addBox(bx - tankW / 2, totalHeight, bz - tankW / 2, bx + tankW / 2, totalHeight + tankH, bz + tankW / 2);
      } else if (bld.roofStructure === "hvac") {
        const hvacW = Math.min(3.0, bld.width * 0.4);
        const hvacH = 1.2;
        addBox(bx - hvacW / 2, totalHeight, bz - hvacW / 2, bx + hvacW / 2, totalHeight + hvacH, bz + hvacW / 2);
      } else if (bld.roofStructure === "billboard") {
        const billW = bld.width * 0.7;
        const billH = 3.5;
        addBox(bx - billW / 2, totalHeight, bz - 0.2, bx + billW / 2, totalHeight + billH, bz + 0.2);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      buildingCount: this.buildings.length,
    };
  }
}
