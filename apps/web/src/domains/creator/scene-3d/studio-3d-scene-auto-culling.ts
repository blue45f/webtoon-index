/**
 * Studio 3D Architectural Scene Auto-Culling & Time-of-Day Atmosphere Swapper
 *
 * Inspired by Acon3D & SketchUp Webtoon Pipeline:
 * - Camera line-of-sight obstruction auto-culling (automatically hides ceilings and front walls blocking the camera)
 * - 5 Time-of-Day Atmosphere & Lighting presets (Noon Sun, Sunset Golden Hour, Blue Hour Dusk, Cyberpunk Neon Night, Eerie Mist)
 * - Dynamic architectural components (doors, windows open/close interpolation)
 */

export type TimeOfDayPreset =
  | "noon-clear-sky"
  | "golden-hour-sunset"
  | "blue-hour-dusk"
  | "cyberpunk-neon-night"
  | "eerie-fog-mist";

export type ArchitecturalComponentRole =
  | "ceiling"
  | "wall-front"
  | "wall-back"
  | "wall-left"
  | "wall-right"
  | "floor"
  | "door-dynamic"
  | "window-dynamic"
  | "pillar";

export interface ArchitecturalElement {
  readonly id: string;
  readonly role: ArchitecturalComponentRole;
  readonly boundingBox: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly normal: readonly [number, number, number]; // outward normal
  readonly isOpenable?: boolean;
  readonly openAngleDeg?: number; // 0 (closed) to 90 (fully open)
}

export interface AtmosphereLightingProfile {
  readonly sunAltitudeDeg: number;
  readonly sunAzimuthDeg: number;
  readonly sunColorHex: string;
  readonly sunIntensity: number;
  readonly ambientColorHex: string;
  readonly ambientIntensity: number;
  readonly skyHorizonColorHex: string;
  readonly shadowSoftness: number;
  readonly fogDensity: number;
}

export class Studio3DSceneAutoCulling {
  private timeOfDay: TimeOfDayPreset = "noon-clear-sky";
  private autoCullFrontObstructions = true;
  private elements: Map<string, ArchitecturalElement> = new Map();

  constructor(initialTimeOfDay: TimeOfDayPreset = "noon-clear-sky") {
    this.timeOfDay = initialTimeOfDay;
  }

  public getTimeOfDay(): TimeOfDayPreset {
    return this.timeOfDay;
  }

  public setTimeOfDay(preset: TimeOfDayPreset): void {
    this.timeOfDay = preset;
  }

  public isAutoCullEnabled(): boolean {
    return this.autoCullFrontObstructions;
  }

  public setAutoCull(enabled: boolean): void {
    this.autoCullFrontObstructions = enabled;
  }

  public registerElement(element: ArchitecturalElement): void {
    this.elements.set(element.id, element);
  }

  public unregisterElement(id: string): void {
    this.elements.delete(id);
  }

  public getElements(): readonly ArchitecturalElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Resolves exact sun angle, colors, and shadows for the selected time-of-day.
   */
  public evaluateAtmosphereLighting(preset: TimeOfDayPreset = this.timeOfDay): AtmosphereLightingProfile {
    switch (preset) {
      case "noon-clear-sky":
        return {
          sunAltitudeDeg: 72,
          sunAzimuthDeg: 145,
          sunColorHex: "#fffbeb",
          sunIntensity: 1.3,
          ambientColorHex: "#93c5fd",
          ambientIntensity: 0.45,
          skyHorizonColorHex: "#60a5fa",
          shadowSoftness: 0.15,
          fogDensity: 0.002,
        };
      case "golden-hour-sunset":
        return {
          sunAltitudeDeg: 14,
          sunAzimuthDeg: 250,
          sunColorHex: "#ff7a00",
          sunIntensity: 1.6,
          ambientColorHex: "#831843",
          ambientIntensity: 0.35,
          skyHorizonColorHex: "#c026d3",
          shadowSoftness: 0.65,
          fogDensity: 0.008,
        };
      case "blue-hour-dusk":
        return {
          sunAltitudeDeg: -6,
          sunAzimuthDeg: 280,
          sunColorHex: "#3b82f6",
          sunIntensity: 0.3,
          ambientColorHex: "#1e1b4b",
          ambientIntensity: 0.5,
          skyHorizonColorHex: "#1e293b",
          shadowSoftness: 0.85,
          fogDensity: 0.015,
        };
      case "cyberpunk-neon-night":
        return {
          sunAltitudeDeg: -35,
          sunAzimuthDeg: 0,
          sunColorHex: "#06b6d4",
          sunIntensity: 0.2,
          ambientColorHex: "#4c0519",
          ambientIntensity: 0.6,
          skyHorizonColorHex: "#09090b",
          shadowSoftness: 0.4,
          fogDensity: 0.02,
        };
      case "eerie-fog-mist":
        return {
          sunAltitudeDeg: 25,
          sunAzimuthDeg: 90,
          sunColorHex: "#cbd5e1",
          sunIntensity: 0.5,
          ambientColorHex: "#475569",
          ambientIntensity: 0.8,
          skyHorizonColorHex: "#94a3b8",
          shadowSoftness: 0.95,
          fogDensity: 0.075,
        };
    }
  }

  /**
   * Evaluates component visibility based on camera position and view target.
   * Auto-hides ceilings or walls positioned between camera and target.
   */
  public evaluateComponentVisibility(
    cameraPos: readonly [number, number, number],
    targetPos: readonly [number, number, number],
  ): Map<string, { readonly isVisible: boolean; readonly opacity: number }> {
    const results = new Map<string, { isVisible: boolean; opacity: number }>();

    const camX = cameraPos[0];
    const camY = cameraPos[1];
    const camZ = cameraPos[2];

    const tarX = targetPos[0];
    const tarY = targetPos[1];
    const tarZ = targetPos[2];

    const viewDirX = tarX - camX;
    const _viewDirY = tarY - camY;
    const viewDirZ = tarZ - camZ;

    for (const [id, el] of this.elements.entries()) {
      if (!this.autoCullFrontObstructions) {
        results.set(id, { isVisible: true, opacity: 1.0 });
        continue;
      }

      // If camera is above ceiling, cull ceiling so user can see inside
      if (el.role === "ceiling") {
        const ceilingY = (el.boundingBox.min[1] + el.boundingBox.max[1]) / 2;
        if (camY > ceilingY && tarY <= ceilingY) {
          results.set(id, { isVisible: false, opacity: 0.0 });
          continue;
        }
      }

      // Check wall facing direction vs view vector
      // A wall facing towards the camera from between camera and target obstructs the view
      const wallCenterX = (el.boundingBox.min[0] + el.boundingBox.max[0]) / 2;
      const wallCenterZ = (el.boundingBox.min[2] + el.boundingBox.max[2]) / 2;

      const toWallX = wallCenterX - camX;
      const toWallZ = wallCenterZ - camZ;
      const dot = toWallX * viewDirX + toWallZ * viewDirZ;

      // Normal dot product with view vector
      const normalDot = el.normal[0] * viewDirX + el.normal[2] * viewDirZ;

      if (dot > 0 && normalDot > 0 && (el.role === "wall-front" || el.role === "wall-left" || el.role === "wall-right")) {
        // Wall is between camera and target and facing away from camera (back-culling the obstructing front wall)
        results.set(id, { isVisible: false, opacity: 0.0 });
      } else {
        results.set(id, { isVisible: true, opacity: 1.0 });
      }
    }

    return results;
  }
}
