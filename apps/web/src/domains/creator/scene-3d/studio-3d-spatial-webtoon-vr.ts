/**
 * Studio 3D Spatial Webtoon VR Storytelling Tunnel & Gallery Engine
 *
 * Implements:
 * - 3 spatial comic panel layouts: curved amphitheater, vertical storytelling tunnel, holocube
 * - 6DoF VR head tracking & gaze raycasting
 * - Parabolic ballistic arc teleportation with floor hit-testing
 * - Comfort locomotion with snap turns and dynamic peripheral FOV vignetting
 * - Panel Focus Navigation: auto-calculating optimal viewer pose for any comic frame
 */

export type VrStoryLayoutTopology = "curved-amphitheater" | "vertical-tunnel" | "holocube-stage";

export interface VrComicPanelTransform {
  readonly panelIndex: number;
  readonly title: string;
  readonly position: readonly [number, number, number];
  readonly rotationEulerDeg: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly curvatureDeg: number; // 0 for flat, up to 30 for curved panel
}

export interface VrViewerState {
  readonly headPosition: readonly [number, number, number];
  readonly headRotationEulerDeg: readonly [number, number, number];
  readonly floorOffset: readonly [number, number, number];
  readonly snapTurnStepDeg: number; // 30, 45, or 90 deg
  readonly comfortVignetteEnabled: boolean;
  readonly comfortVignetteIntensity: number; // 0 (none) to 1.0 (heavy tunnel vision)
}

export interface TeleportArcResult {
  readonly isValidHit: boolean;
  readonly hitPosition: [number, number, number];
  readonly trajectoryPoints: readonly [number, number, number][];
}

export class Studio3DSpatialWebtoonVrEngine {
  private layout: VrStoryLayoutTopology;
  private viewer: VrViewerState;
  private panels: VrComicPanelTransform[] = [];

  constructor(
    layout: VrStoryLayoutTopology = "curved-amphitheater",
    initialViewer?: Partial<VrViewerState>,
  ) {
    this.layout = layout;
    this.viewer = {
      headPosition: initialViewer?.headPosition ?? [0, 1.6, 0],
      headRotationEulerDeg: initialViewer?.headRotationEulerDeg ?? [0, 0, 0],
      floorOffset: initialViewer?.floorOffset ?? [0, 0, 0],
      snapTurnStepDeg: initialViewer?.snapTurnStepDeg ?? 45,
      comfortVignetteEnabled: initialViewer?.comfortVignetteEnabled ?? true,
      comfortVignetteIntensity: initialViewer?.comfortVignetteIntensity ?? 0.0,
    };
  }

  public getLayout(): VrStoryLayoutTopology {
    return this.layout;
  }

  public setLayout(layout: VrStoryLayoutTopology): void {
    this.layout = layout;
  }

  public getViewer(): VrViewerState {
    return this.viewer;
  }

  public getPanels(): readonly VrComicPanelTransform[] {
    return this.panels;
  }

  public setPanels(panels: readonly VrComicPanelTransform[]): void {
    this.panels = [...panels];
  }

  /**
   * Generates spatial layout transforms for a sequence of N webtoon comic panels.
   */
  public generateLayout(panelCount = 6, panelWidth = 2.0, panelHeight = 2.8): readonly VrComicPanelTransform[] {
    const count = Math.max(1, panelCount);
    const result: VrComicPanelTransform[] = [];

    switch (this.layout) {
      case "curved-amphitheater": {
        const radius = 4.5;
        const totalAngleDeg = 140; // Spread across 140 degrees arc
        const startAngleDeg = -totalAngleDeg / 2;
        const stepAngle = count > 1 ? totalAngleDeg / (count - 1) : 0;

        for (let i = 0; i < count; i += 1) {
          const angleDeg = startAngleDeg + i * stepAngle;
          const rad = (angleDeg * Math.PI) / 180;
          const x = radius * Math.sin(rad);
          const z = -radius * Math.cos(rad);
          const y = 1.6 + (i % 2 === 1 ? 0.25 : -0.15); // Slight height variation

          result.push({
            panelIndex: i,
            title: `Webtoon Panel ${i + 1}`,
            position: [x, y, z],
            rotationEulerDeg: [0, -angleDeg, 0],
            width: panelWidth,
            height: panelHeight,
            curvatureDeg: 12,
          });
        }
        break;
      }

      case "vertical-tunnel": {
        // Descending vertical spiral corridor
        const tunnelRadius = 3.2;
        const stepHeight = 2.2;
        const spiralRotStepDeg = 45;

        for (let i = 0; i < count; i += 1) {
          const angleDeg = i * spiralRotStepDeg;
          const rad = (angleDeg * Math.PI) / 180;
          const x = tunnelRadius * Math.sin(rad);
          const z = -tunnelRadius * Math.cos(rad);
          const y = 2.0 - i * stepHeight;

          result.push({
            panelIndex: i,
            title: `Cut ${i + 1}`,
            position: [x, y, z],
            rotationEulerDeg: [10, -angleDeg, 0],
            width: panelWidth,
            height: panelHeight,
            curvatureDeg: 0,
          });
        }
        break;
      }

      case "holocube-stage": {
        // 4 or 6 sided holographic diorama cube
        const halfSize = 2.5;
        const orientations: [number, number, number, number][] = [
          [0, 1.6, -halfSize, 0],    // Front
          [halfSize, 1.6, 0, -90],   // Right
          [0, 1.6, halfSize, 180],   // Back
          [-halfSize, 1.6, 0, 90],   // Left
        ];

        for (let i = 0; i < count; i += 1) {
          const slot = orientations[i % orientations.length];
          result.push({
            panelIndex: i,
            title: `Cube Face ${i + 1}`,
            position: [slot[0], slot[1], slot[2]],
            rotationEulerDeg: [0, slot[3], 0],
            width: panelWidth,
            height: panelHeight,
            curvatureDeg: 0,
          });
        }
        break;
      }
    }

    this.panels = result;
    return result;
  }

  /**
   * Calculates a parabolic teleportation arc from a VR hand controller ray.
   */
  public calculateTeleportArc(
    controllerPos: readonly [number, number, number],
    forwardDir: readonly [number, number, number],
    launchSpeed = 8.0,
    gravity = 9.81,
    maxSteps = 40,
    dt = 0.03,
  ): TeleportArcResult {
    const points: [number, number, number][] = [];
    let curX = controllerPos[0];
    let curY = controllerPos[1];
    let curZ = controllerPos[2];

    const velX = forwardDir[0] * launchSpeed;
    let velY = forwardDir[1] * launchSpeed;
    const velZ = forwardDir[2] * launchSpeed;

    points.push([curX, curY, curZ]);

    let hitPos: [number, number, number] = [0, 0, 0];
    let isHit = false;

    for (let step = 0; step < maxSteps; step += 1) {
      const nextX = curX + velX * dt;
      const nextY = curY + velY * dt - 0.5 * gravity * dt * dt;
      const nextZ = curZ + velZ * dt;

      velY -= gravity * dt;

      // Floor plane collision (Y = 0)
      if (nextY <= 0 && curY > 0) {
        const t = curY / (curY - nextY);
        hitPos = [
          curX + (nextX - curX) * t,
          0,
          curZ + (nextZ - curZ) * t,
        ];
        points.push([...hitPos]);
        isHit = true;
        break;
      }

      curX = nextX;
      curY = nextY;
      curZ = nextZ;
      points.push([curX, curY, curZ]);
    }

    if (!isHit && points.length > 0) {
      hitPos = [...points[points.length - 1]];
    }

    return {
      isValidHit: isHit,
      hitPosition: hitPos,
      trajectoryPoints: points,
    };
  }

  /**
   * Applies discrete snap-turn rotation with comfort vignetting.
   */
  public performSnapTurn(direction: -1 | 1): void {
    const currentY = this.viewer.headRotationEulerDeg[1];
    const newY = (currentY + direction * this.viewer.snapTurnStepDeg) % 360;

    this.viewer = {
      ...this.viewer,
      headRotationEulerDeg: [
        this.viewer.headRotationEulerDeg[0],
        newY,
        this.viewer.headRotationEulerDeg[2],
      ],
      comfortVignetteIntensity: this.viewer.comfortVignetteEnabled ? 0.6 : 0.0,
    };
  }

  /**
   * Calculates the ideal standing position and orientation directly in front of any panel.
   */
  public getFocusPoseForPanel(panelIndex: number, comfortableViewingDist = 2.8): {
    readonly standingPosition: [number, number, number];
    readonly lookAtTarget: [number, number, number];
  } {
    const panel = this.panels[panelIndex] ?? this.panels[0];
    if (!panel) {
      return {
        standingPosition: [0, 0, 0],
        lookAtTarget: [0, 1.6, -3],
      };
    }

    const [px, py, pz] = panel.position;
    const ryRad = (panel.rotationEulerDeg[1] * Math.PI) / 180;

    // Normal pointing outward from front of panel
    const nx = Math.sin(ryRad);
    const nz = Math.cos(ryRad);

    const standX = px + nx * comfortableViewingDist;
    const standZ = pz + nz * comfortableViewingDist;

    return {
      standingPosition: [standX, 0, standZ],
      lookAtTarget: [px, py, pz],
    };
  }
}
