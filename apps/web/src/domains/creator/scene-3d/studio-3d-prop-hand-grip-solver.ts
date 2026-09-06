/**
 * Studio 3D Prop Hand Grip Solver & Socket Snapping Engine
 *
 * Inspired by Clip Studio Paint 3D, MagicPoser & Acon3D:
 * - Automatically snaps 3D props (weapons, tools, items) to character skeletal sockets
 * - Solves 5-finger kinematic wrapping (Thumb, Index, Middle, Ring, Pinky) around prop bounding cylinders
 * - 6 Comic Grip Archetypes: Sword Power Grip, Gun Pistol Trigger, Phone Pinch Hold, Cup Wrap Grasp,
 *   Pen Precision Tripod, Relaxed Open Hold.
 */

export type HandGripArchetype =
  | "sword-power-grip"
  | "gun-pistol-trigger"
  | "phone-pinch-hold"
  | "cup-wrap-grasp"
  | "pen-precision-tripod"
  | "relaxed-open-hold";

export type CharacterSocketSlot =
  | "hand-right"
  | "hand-left"
  | "back-sheath"
  | "waist-holster"
  | "head-accessory"
  | "glasses-bridge";

export interface PropItemDescriptor {
  readonly id: string;
  readonly name: string;
  readonly defaultSocket: CharacterSocketSlot;
  readonly boundingRadius: number; // in meters (e.g. 0.015 for sword handle, 0.035 for cup)
  readonly recommendedGrip: HandGripArchetype;
  readonly localOffset: readonly [number, number, number];
  readonly localRotationEuler: readonly [number, number, number]; // [x, y, z] in degrees
}

export interface FingerJointFlexion {
  readonly metacarpalAngleDeg: number;
  readonly proximalAngleDeg: number;
  readonly intermediateAngleDeg: number;
  readonly distalAngleDeg: number;
}

export interface HandGripPoseResult {
  readonly thumb: FingerJointFlexion;
  readonly index: FingerJointFlexion;
  readonly middle: FingerJointFlexion;
  readonly ring: FingerJointFlexion;
  readonly pinky: FingerJointFlexion;
  readonly wristRotationDeg: readonly [number, number, number];
}

export class Studio3DPropHandGripSolver {
  private attachedProps: Map<string, { prop: PropItemDescriptor; socket: CharacterSocketSlot }> = new Map();

  public attachProp(prop: PropItemDescriptor, socket: CharacterSocketSlot = prop.defaultSocket): void {
    this.attachedProps.set(prop.id, { prop, socket });
  }

  public detachProp(propId: string): void {
    this.attachedProps.delete(propId);
  }

  public getAttachedProps(): readonly { prop: PropItemDescriptor; socket: CharacterSocketSlot }[] {
    return Array.from(this.attachedProps.values());
  }

  /**
   * Evaluates exact joint flexion angles for each of the 5 fingers wrapping around a prop.
   */
  public solveHandGrip(
    gripType: HandGripArchetype,
    propRadius = 0.02, // radius in meters
    tightnessFactor = 1.0, // 0.0 (loose) to 1.5 (tight)
  ): HandGripPoseResult {
    // Curvature factor: smaller objects require tighter curling
    const radiusCurvature = Math.min(1.5, Math.max(0.5, 0.025 / Math.max(0.005, propRadius)));
    const scalar = radiusCurvature * tightnessFactor;

    switch (gripType) {
      case "sword-power-grip":
        // All fingers firmly curled into a cylinder hold
        return {
          thumb: { metacarpalAngleDeg: 25 * scalar, proximalAngleDeg: 45 * scalar, intermediateAngleDeg: 55 * scalar, distalAngleDeg: 40 * scalar },
          index: { metacarpalAngleDeg: 10 * scalar, proximalAngleDeg: 60 * scalar, intermediateAngleDeg: 75 * scalar, distalAngleDeg: 50 * scalar },
          middle: { metacarpalAngleDeg: 12 * scalar, proximalAngleDeg: 65 * scalar, intermediateAngleDeg: 80 * scalar, distalAngleDeg: 55 * scalar },
          ring: { metacarpalAngleDeg: 15 * scalar, proximalAngleDeg: 70 * scalar, intermediateAngleDeg: 85 * scalar, distalAngleDeg: 60 * scalar },
          pinky: { metacarpalAngleDeg: 18 * scalar, proximalAngleDeg: 75 * scalar, intermediateAngleDeg: 85 * scalar, distalAngleDeg: 65 * scalar },
          wristRotationDeg: [5, 10, -5],
        };

      case "gun-pistol-trigger":
        // Index finger extended along the trigger, other fingers curled
        return {
          thumb: { metacarpalAngleDeg: 30 * scalar, proximalAngleDeg: 35 * scalar, intermediateAngleDeg: 40 * scalar, distalAngleDeg: 30 * scalar },
          index: { metacarpalAngleDeg: 5, proximalAngleDeg: 15, intermediateAngleDeg: 25, distalAngleDeg: 15 }, // Trigger finger extended
          middle: { metacarpalAngleDeg: 15 * scalar, proximalAngleDeg: 70 * scalar, intermediateAngleDeg: 85 * scalar, distalAngleDeg: 60 * scalar },
          ring: { metacarpalAngleDeg: 18 * scalar, proximalAngleDeg: 75 * scalar, intermediateAngleDeg: 85 * scalar, distalAngleDeg: 65 * scalar },
          pinky: { metacarpalAngleDeg: 20 * scalar, proximalAngleDeg: 75 * scalar, intermediateAngleDeg: 85 * scalar, distalAngleDeg: 65 * scalar },
          wristRotationDeg: [0, 5, 0],
        };

      case "phone-pinch-hold":
        // Thumb and 4 fingers opposing on flat phone edges
        return {
          thumb: { metacarpalAngleDeg: 35, proximalAngleDeg: 20, intermediateAngleDeg: 15, distalAngleDeg: 10 },
          index: { metacarpalAngleDeg: 10, proximalAngleDeg: 30, intermediateAngleDeg: 35, distalAngleDeg: 20 },
          middle: { metacarpalAngleDeg: 12, proximalAngleDeg: 35, intermediateAngleDeg: 40, distalAngleDeg: 25 },
          ring: { metacarpalAngleDeg: 15, proximalAngleDeg: 40, intermediateAngleDeg: 45, distalAngleDeg: 30 },
          pinky: { metacarpalAngleDeg: 25, proximalAngleDeg: 45, intermediateAngleDeg: 30, distalAngleDeg: 15 }, // Supporting bottom
          wristRotationDeg: [-10, 0, 15],
        };

      case "cup-wrap-grasp":
        // Wide cylindrical grasp
        return {
          thumb: { metacarpalAngleDeg: 40 * scalar, proximalAngleDeg: 25 * scalar, intermediateAngleDeg: 30 * scalar, distalAngleDeg: 20 * scalar },
          index: { metacarpalAngleDeg: 15 * scalar, proximalAngleDeg: 45 * scalar, intermediateAngleDeg: 50 * scalar, distalAngleDeg: 35 * scalar },
          middle: { metacarpalAngleDeg: 18 * scalar, proximalAngleDeg: 50 * scalar, intermediateAngleDeg: 55 * scalar, distalAngleDeg: 40 * scalar },
          ring: { metacarpalAngleDeg: 20 * scalar, proximalAngleDeg: 55 * scalar, intermediateAngleDeg: 60 * scalar, distalAngleDeg: 45 * scalar },
          pinky: { metacarpalAngleDeg: 22 * scalar, proximalAngleDeg: 55 * scalar, intermediateAngleDeg: 60 * scalar, distalAngleDeg: 45 * scalar },
          wristRotationDeg: [0, 0, 0],
        };

      case "pen-precision-tripod":
        // Thumb, index, and middle finger forming tripod pinch
        return {
          thumb: { metacarpalAngleDeg: 45, proximalAngleDeg: 30, intermediateAngleDeg: 20, distalAngleDeg: 15 },
          index: { metacarpalAngleDeg: 20, proximalAngleDeg: 45, intermediateAngleDeg: 50, distalAngleDeg: 30 },
          middle: { metacarpalAngleDeg: 25, proximalAngleDeg: 50, intermediateAngleDeg: 45, distalAngleDeg: 25 },
          ring: { metacarpalAngleDeg: 30, proximalAngleDeg: 60, intermediateAngleDeg: 65, distalAngleDeg: 45 },
          pinky: { metacarpalAngleDeg: 35, proximalAngleDeg: 65, intermediateAngleDeg: 70, distalAngleDeg: 50 },
          wristRotationDeg: [15, -10, 20],
        };

      case "relaxed-open-hold":
      default:
        // Naturally relaxed slightly curled hand
        return {
          thumb: { metacarpalAngleDeg: 10, proximalAngleDeg: 10, intermediateAngleDeg: 10, distalAngleDeg: 5 },
          index: { metacarpalAngleDeg: 5, proximalAngleDeg: 15, intermediateAngleDeg: 20, distalAngleDeg: 10 },
          middle: { metacarpalAngleDeg: 6, proximalAngleDeg: 20, intermediateAngleDeg: 25, distalAngleDeg: 12 },
          ring: { metacarpalAngleDeg: 8, proximalAngleDeg: 25, intermediateAngleDeg: 30, distalAngleDeg: 15 },
          pinky: { metacarpalAngleDeg: 10, proximalAngleDeg: 30, intermediateAngleDeg: 35, distalAngleDeg: 18 },
          wristRotationDeg: [0, 0, 0],
        };
    }
  }
}
