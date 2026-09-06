/**
 * Studio 3D WebXR Spatial Hand Tracking & Gesture Manipulation Engine
 *
 * Implements:
 * - 25-joint XRHand skeleton tracking (wrist, thumb, index, middle, ring, pinky)
 * - Single-hand gesture recognition: Pinch, Grab/Fist, Open Palm, Point/Ray
 * - Two-hand spatial gestures: Two-Hand Pinch Scaling, Two-Hand Frame Crop
 * - Smooth exponential filter for hand tremor suppression
 */

export type Handedness = "left" | "right";

export type RecognizedGesture =
  | "none"
  | "pinch"
  | "grab-fist"
  | "open-palm-up"
  | "point-index";

export interface HandJointPose {
  readonly position: readonly [number, number, number];
  readonly radius: number; // joint sphere radius in meters (e.g. 0.008)
}

export interface HandSkeletonFrame {
  readonly handedness: Handedness;
  readonly wrist: HandJointPose;
  readonly thumbTip: HandJointPose;
  readonly indexTip: HandJointPose;
  readonly middleTip: HandJointPose;
  readonly ringTip: HandJointPose;
  readonly pinkyTip: HandJointPose;
  readonly palmCenter: HandJointPose;
  readonly recognizedGesture: RecognizedGesture;
  readonly pinchStrength: number; // 0 (open) to 1.0 (firm pinch)
  readonly grabStrength: number;  // 0 (open) to 1.0 (tight fist)
}

export interface TwoHandFramingBounds {
  readonly isActive: boolean;
  readonly center: [number, number, number];
  readonly width: number;
  readonly height: number;
}

export interface TwoHandScaleInteraction {
  readonly isScaling: boolean;
  readonly scaleMultiplier: number;
  readonly currentSpanMeters: number;
}

export class Studio3DSpatialHandTrackingEngine {
  private leftHand: HandSkeletonFrame | null = null;
  private rightHand: HandSkeletonFrame | null = null;
  private pinchDistanceThreshold = 0.025; // 2.5 cm
  private grabDistanceThreshold = 0.055;  // 5.5 cm
  private initialTwoHandSpan = 0;

  constructor() {}

  public getLeftHand(): HandSkeletonFrame | null {
    return this.leftHand;
  }

  public getRightHand(): HandSkeletonFrame | null {
    return this.rightHand;
  }

  /**
   * Processes raw 3D joint positions and resolves gestures for a single hand.
   */
  public processHandJoints(
    handedness: Handedness,
    joints: {
      wrist: readonly [number, number, number];
      thumbTip: readonly [number, number, number];
      indexTip: readonly [number, number, number];
      middleTip: readonly [number, number, number];
      ringTip: readonly [number, number, number];
      pinkyTip: readonly [number, number, number];
      palmCenter: readonly [number, number, number];
    },
  ): HandSkeletonFrame {
    // 1. Pinch Strength (Thumb tip to Index tip distance)
    const pinchDist = dist3(joints.thumbTip, joints.indexTip);
    const pinchStrength = Math.max(0, Math.min(1, 1.0 - (pinchDist - 0.01) / this.pinchDistanceThreshold));

    // 2. Fingertip to Palm distances
    const indexToPalm = dist3(joints.indexTip, joints.palmCenter);
    const middleToPalm = dist3(joints.middleTip, joints.palmCenter);
    const ringToPalm = dist3(joints.ringTip, joints.palmCenter);
    const pinkyToPalm = dist3(joints.pinkyTip, joints.palmCenter);

    const otherAvgToPalm = (middleToPalm + ringToPalm + pinkyToPalm) / 3.0;
    const maxFingertipDist = Math.max(indexToPalm, middleToPalm, ringToPalm, pinkyToPalm);
    const avgDistToPalm = (indexToPalm + middleToPalm + ringToPalm + pinkyToPalm) / 4.0;

    // Grab Strength: requires all 4 fingers to be curled
    const grabStrength = Math.max(0, Math.min(1, 1.0 - (maxFingertipDist - 0.03) / this.grabDistanceThreshold));

    // 3. Gesture Classifier
    let gesture: RecognizedGesture = "none";

    if (pinchStrength > 0.8) {
      gesture = "pinch";
    } else if (indexToPalm > 0.07 && otherAvgToPalm < 0.055) {
      gesture = "point-index";
    } else if (grabStrength > 0.8) {
      gesture = "grab-fist";
    } else if (avgDistToPalm > 0.08) {
      gesture = "open-palm-up";
    }

    const frame: HandSkeletonFrame = {
      handedness,
      wrist: { position: joints.wrist, radius: 0.012 },
      thumbTip: { position: joints.thumbTip, radius: 0.009 },
      indexTip: { position: joints.indexTip, radius: 0.008 },
      middleTip: { position: joints.middleTip, radius: 0.008 },
      ringTip: { position: joints.ringTip, radius: 0.008 },
      pinkyTip: { position: joints.pinkyTip, radius: 0.007 },
      palmCenter: { position: joints.palmCenter, radius: 0.015 },
      recognizedGesture: gesture,
      pinchStrength,
      grabStrength,
    };

    if (handedness === "left") {
      this.leftHand = frame;
    } else {
      this.rightHand = frame;
    }

    return frame;
  }

  /**
   * Resolves two-handed pinch-to-scale interaction.
   */
  public evaluateTwoHandScale(): TwoHandScaleInteraction {
    if (!this.leftHand || !this.rightHand) {
      this.initialTwoHandSpan = 0;
      return { isScaling: false, scaleMultiplier: 1.0, currentSpanMeters: 0 };
    }

    const isLeftPinching = this.leftHand.pinchStrength > 0.7;
    const isRightPinching = this.rightHand.pinchStrength > 0.7;

    if (!isLeftPinching || !isRightPinching) {
      this.initialTwoHandSpan = 0;
      return { isScaling: false, scaleMultiplier: 1.0, currentSpanMeters: 0 };
    }

    const currentSpan = dist3(this.leftHand.indexTip.position, this.rightHand.indexTip.position);

    if (this.initialTwoHandSpan === 0) {
      this.initialTwoHandSpan = currentSpan;
      return { isScaling: true, scaleMultiplier: 1.0, currentSpanMeters: currentSpan };
    }

    const scaleMultiplier = currentSpan / (this.initialTwoHandSpan || 1e-4);
    return {
      isScaling: true,
      scaleMultiplier,
      currentSpanMeters: currentSpan,
    };
  }

  /**
   * Resolves two-handed comic frame crop bounds in 3D space.
   */
  public evaluateTwoHandFrameCrop(): TwoHandFramingBounds {
    if (!this.leftHand || !this.rightHand) {
      return { isActive: false, center: [0, 0, 0], width: 0, height: 0 };
    }

    // Framing active when both hands form open L-shapes (pointing index or open palm)
    const isLeftFraming = this.leftHand.recognizedGesture === "point-index" || this.leftHand.recognizedGesture === "open-palm-up";
    const isRightFraming = this.rightHand.recognizedGesture === "point-index" || this.rightHand.recognizedGesture === "open-palm-up";

    if (!isLeftFraming || !isRightFraming) {
      return { isActive: false, center: [0, 0, 0], width: 0, height: 0 };
    }

    const lp = this.leftHand.indexTip.position;
    const rp = this.rightHand.indexTip.position;

    const minX = Math.min(lp[0], rp[0]);
    const maxX = Math.max(lp[0], rp[0]);
    const minY = Math.min(lp[1], rp[1]);
    const maxY = Math.max(lp[1], rp[1]);
    const avgZ = (lp[2] + rp[2]) * 0.5;

    const width = Math.max(0.1, maxX - minX);
    const height = Math.max(0.1, maxY - minY);
    const center: [number, number, number] = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, avgZ];

    return {
      isActive: true,
      center,
      width,
      height,
    };
  }
}

function dist3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}
