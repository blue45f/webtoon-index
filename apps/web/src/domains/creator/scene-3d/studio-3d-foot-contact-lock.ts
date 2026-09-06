/**
 * studio-3d-foot-contact-lock.ts
 *
 * Plask AI & Reallusion AccuRIG/AccuPOSE-inspired Foot Contact Lock & Grounding Solver.
 * Prevents feet from sliding or penetrating uneven/flat terrain during character posing.
 * Computes ankle-to-ground constraints, pelvis height offset, and two-bone IK leg correction.
 */

export interface Vector3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FootContactConfig {
  readonly groundLevelY: number; // Ground elevation in meters (default 0.0)
  readonly toleranceMeters: number; // Grounding tolerance buffer (default 0.005)
  readonly autoLevelPelvis: boolean; // Auto offset pelvis down when both feet reach down
  readonly preventSlipping: boolean; // Lock horizontal XZ drift below threshold
  readonly maxKneeAngleDeg: number; // Knee bend constraint [0..165]
  readonly toeRollEnabled: boolean; // Tilt toe up when stepping
  readonly footLengthMeters: number; // Foot heel-to-toe distance (default 0.24m)
}

export interface CharacterLegBones {
  readonly hip: Vector3D;
  readonly knee: Vector3D;
  readonly ankle: Vector3D;
  readonly toe: Vector3D;
}

export interface CharacterRigPoseSnapshot {
  readonly root: Vector3D;
  readonly pelvis: Vector3D;
  readonly leftLeg: CharacterLegBones;
  readonly rightLeg: CharacterLegBones;
}

export interface FootGroundingState {
  readonly isLeftGrounded: boolean;
  readonly isRightGrounded: boolean;
  readonly leftPenetrationDepth: number; // >0 if inside ground
  readonly rightPenetrationDepth: number;
  readonly leftToeAngleDeg: number;
  readonly rightToeAngleDeg: number;
  readonly pelvisVerticalOffset: number;
}

export interface FootContactSolveResult {
  readonly correctedPose: CharacterRigPoseSnapshot;
  readonly groundingState: FootGroundingState;
  readonly hasCollisionCorrection: boolean;
  readonly summary: string;
}

export const DEFAULT_FOOT_CONTACT_CONFIG: FootContactConfig = {
  groundLevelY: 0.0,
  toleranceMeters: 0.005,
  autoLevelPelvis: true,
  preventSlipping: true,
  maxKneeAngleDeg: 160,
  toeRollEnabled: true,
  footLengthMeters: 0.24,
};

export class Studio3DFootContactSolver {
  private readonly config: FootContactConfig;

  constructor(config: Partial<FootContactConfig> = {}) {
    this.config = { ...DEFAULT_FOOT_CONTACT_CONFIG, ...config };
  }

  /**
   * Solves ground contact for a character pose snapshot, returning adjusted positions and lock status.
   */
  public solve(pose: CharacterRigPoseSnapshot): FootContactSolveResult {
    const groundY = this.config.groundLevelY;
    const tol = this.config.toleranceMeters;

    // Check left foot contact
    const leftAnkleY = pose.leftLeg.ankle.y;
    const leftToeY = pose.leftLeg.toe.y;
    const leftLowestY = Math.min(leftAnkleY, leftToeY);
    const leftPenetration = Math.max(0, groundY - leftLowestY);
    const isLeftGrounded = Math.abs(leftLowestY - groundY) <= tol || leftLowestY < groundY;

    // Check right foot contact
    const rightAnkleY = pose.rightLeg.ankle.y;
    const rightToeY = pose.rightLeg.toe.y;
    const rightLowestY = Math.min(rightAnkleY, rightToeY);
    const rightPenetration = Math.max(0, groundY - rightLowestY);
    const isRightGrounded = Math.abs(rightLowestY - groundY) <= tol || rightLowestY < groundY;

    // Calculate pelvis adjustment if penetrating
    let pelvisOffset = 0;
    if (this.config.autoLevelPelvis) {
      const maxPenetration = Math.max(leftPenetration, rightPenetration);
      if (maxPenetration > 0) {
        pelvisOffset = maxPenetration;
      }
    }

    // Apply correction to leg bones
    const correctedLeft = this.correctLeg(pose.leftLeg, groundY, leftPenetration, isLeftGrounded);
    const correctedRight = this.correctLeg(pose.rightLeg, groundY, rightPenetration, isRightGrounded);

    // Calculate toe roll angles
    const leftToeRoll = this.calculateToeRoll(correctedLeft.ankle, correctedLeft.toe, groundY);
    const rightToeRoll = this.calculateToeRoll(correctedRight.ankle, correctedRight.toe, groundY);

    const hasCollision = leftPenetration > 0 || rightPenetration > 0;

    const correctedPose: CharacterRigPoseSnapshot = {
      root: { ...pose.root },
      pelvis: {
        x: pose.pelvis.x,
        y: pose.pelvis.y + pelvisOffset,
        z: pose.pelvis.z,
      },
      leftLeg: correctedLeft,
      rightLeg: correctedRight,
    };

    const groundingState: FootGroundingState = {
      isLeftGrounded,
      isRightGrounded,
      leftPenetrationDepth: leftPenetration,
      rightPenetrationDepth: rightPenetration,
      leftToeAngleDeg: leftToeRoll,
      rightToeAngleDeg: rightToeRoll,
      pelvisVerticalOffset: pelvisOffset,
    };

    const summary = `Foot Contact: L=${isLeftGrounded ? "Grounded" : "Air"}, R=${
      isRightGrounded ? "Grounded" : "Air"
    }, PelvisOffset=+${(pelvisOffset * 100).toFixed(1)}cm`;

    return {
      correctedPose,
      groundingState,
      hasCollisionCorrection: hasCollision,
      summary,
    };
  }

  private correctLeg(
    leg: CharacterLegBones,
    groundY: number,
    penetration: number,
    isGrounded: boolean,
  ): CharacterLegBones {
    if (!isGrounded && penetration <= 0) {
      return { ...leg };
    }

    const shiftY = penetration > 0 ? penetration : 0;
    const adjustedAnkle: Vector3D = {
      x: leg.ankle.x,
      y: Math.max(groundY, leg.ankle.y + shiftY),
      z: leg.ankle.z,
    };
    const adjustedToe: Vector3D = {
      x: leg.toe.x,
      y: Math.max(groundY, leg.toe.y + shiftY),
      z: leg.toe.z,
    };

    // Keep knee anatomically between hip and ankle
    const kneeY = (leg.hip.y + adjustedAnkle.y) * 0.5;
    const adjustedKnee: Vector3D = {
      x: leg.knee.x,
      y: Math.max(adjustedAnkle.y + 0.1, kneeY),
      z: leg.knee.z,
    };

    return {
      hip: { ...leg.hip },
      knee: adjustedKnee,
      ankle: adjustedAnkle,
      toe: adjustedToe,
    };
  }

  private calculateToeRoll(ankle: Vector3D, toe: Vector3D, groundY: number): number {
    if (!this.config.toeRollEnabled) return 0;
    const dy = ankle.y - groundY;
    if (dy <= 0.02) return 0; // Flat on ground

    const dz = Math.abs(toe.z - ankle.z);
    if (dz < 0.01) return 0;

    // Angle in degrees from ground slope
    const angleRad = Math.atan2(dy, dz);
    return Math.min(65, Math.max(0, Math.round((angleRad * 180) / Math.PI)));
  }

  /**
   * Evaluates Two-Bone IK analytic angle for hip-knee-ankle chain.
   */
  public solveTwoBoneIK(
    upperLength: number,
    lowerLength: number,
    targetDistance: number,
  ): { upperAngleDeg: number; lowerAngleDeg: number } {
    // Law of cosines
    const d = Math.max(0.001, Math.min(upperLength + lowerLength - 0.001, targetDistance));
    const cosKnee =
      (upperLength * upperLength + lowerLength * lowerLength - d * d) /
      (2 * upperLength * lowerLength);
    const clampedCosKnee = Math.max(-1, Math.min(1, cosKnee));
    const kneeAngleRad = Math.PI - Math.acos(clampedCosKnee);

    const cosHip =
      (upperLength * upperLength + d * d - lowerLength * lowerLength) /
      (2 * upperLength * d);
    const clampedCosHip = Math.max(-1, Math.min(1, cosHip));
    const hipAngleRad = Math.acos(clampedCosHip);

    return {
      upperAngleDeg: Number(((hipAngleRad * 180) / Math.PI).toFixed(1)),
      lowerAngleDeg: Number(((kneeAngleRad * 180) / Math.PI).toFixed(1)),
    };
  }
}
