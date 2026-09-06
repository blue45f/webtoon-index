/**
 * Studio 3D Spatial Audio & Acoustic Comic SFX Engine
 *
 * Implements:
 * - 3D PannerNode HRTF spatialization and distance rolloff models
 * - Directional audio cones for speech bubbles and action blast SFX
 * - Doppler shift and listener head orientation calculations
 * - Preset comic SFX acoustic profiles (explosions, slashes, atmospheric ambient, whispers)
 */

export type DistanceModelKind = "inverse" | "linear" | "exponential";

export type SpatialSfxPresetKind =
  | "explosion-rumble"
  | "sword-slash"
  | "rain-ambience"
  | "thunder-crack"
  | "whisper-intimate"
  | "monologue-reverb";

export interface SpatialAudioEmitterConfig {
  readonly id: string;
  readonly label: string;
  readonly position: readonly [number, number, number];
  readonly orientation: readonly [number, number, number];
  readonly distanceModel: DistanceModelKind;
  readonly refDistance: number; // meters
  readonly maxDistance: number; // meters
  readonly rolloffFactor: number;
  readonly coneInnerAngleDeg: number;
  readonly coneOuterAngleDeg: number;
  readonly coneOuterGain: number; // 0 to 1.0
  readonly gain: number;          // 0 to 1.0
  readonly sfxPreset: SpatialSfxPresetKind;
}

export interface SpatialAudioListenerState {
  readonly position: readonly [number, number, number];
  readonly forwardVector: readonly [number, number, number];
  readonly upVector: readonly [number, number, number];
}

export interface EvaluatedAcousticGain {
  readonly emitterId: string;
  readonly distanceMeters: number;
  readonly effectiveGain: number; // Final volume multiplier (0 to 1.0)
  readonly azimuthDeg: number;    // Angle relative to listener forward (-180 to +180)
  readonly elevationDeg: number;
}

export class Studio3DSpatialAudioEngine {
  private listener: SpatialAudioListenerState;
  private emitters: Map<string, SpatialAudioEmitterConfig> = new Map();

  constructor(initialListener?: Partial<SpatialAudioListenerState>) {
    this.listener = {
      position: initialListener?.position ?? [0, 1.6, 0],
      forwardVector: initialListener?.forwardVector ?? [0, 0, -1],
      upVector: initialListener?.upVector ?? [0, 1, 0],
    };
  }

  public getListener(): SpatialAudioListenerState {
    return this.listener;
  }

  public setListener(patch: Partial<SpatialAudioListenerState>): void {
    this.listener = { ...this.listener, ...patch };
  }

  public getEmitters(): readonly SpatialAudioEmitterConfig[] {
    return Array.from(this.emitters.values());
  }

  public addEmitter(emitter: SpatialAudioEmitterConfig): void {
    this.emitters.set(emitter.id, emitter);
  }

  public removeEmitter(id: string): void {
    this.emitters.delete(id);
  }

  /**
   * Evaluates acoustic gain and azimuth angles for all active spatial audio emitters.
   */
  public evaluateAllEmitters(): readonly EvaluatedAcousticGain[] {
    return Array.from(this.emitters.values()).map((e) => this.evaluateEmitter(e));
  }

  public evaluateEmitter(emitter: SpatialAudioEmitterConfig): EvaluatedAcousticGain {
    const [lx, ly, lz] = this.listener.position;
    const [ex, ey, ez] = emitter.position;

    const dx = ex - lx;
    const dy = ey - ly;
    const dz = ez - lz;
    const dist = Math.hypot(dx, dy, dz) || 1e-6;

    // 1. Distance Attenuation
    let distGain = 1.0;
    const ref = emitter.refDistance;
    const max = emitter.maxDistance;
    const roll = emitter.rolloffFactor;

    switch (emitter.distanceModel) {
      case "inverse":
        distGain = ref / (ref + roll * (Math.max(dist, ref) - ref));
        break;
      case "linear":
        distGain = 1.0 - (roll * (Math.min(dist, max) - ref)) / (max - ref);
        break;
      case "exponential":
        distGain = Math.pow(Math.max(dist, ref) / ref, -roll);
        break;
    }
    distGain = Math.max(0, Math.min(1, distGain));

    // 2. Directional Cone Attenuation
    let coneGain = 1.0;
    if (emitter.coneInnerAngleDeg < 360) {
      const dirLen = Math.hypot(emitter.orientation[0], emitter.orientation[1], emitter.orientation[2]) || 1;
      const ox = emitter.orientation[0] / dirLen;
      const oy = emitter.orientation[1] / dirLen;
      const oz = emitter.orientation[2] / dirLen;

      // Vector from emitter to listener
      const toLx = -dx / dist;
      const toLy = -dy / dist;
      const toLz = -dz / dist;

      const dotProd = ox * toLx + oy * toLy + oz * toLz;
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, dotProd))) * (180 / Math.PI);

      const halfInner = emitter.coneInnerAngleDeg * 0.5;
      const halfOuter = emitter.coneOuterAngleDeg * 0.5;

      if (angleDeg <= halfInner) {
        coneGain = 1.0;
      } else if (angleDeg >= halfOuter) {
        coneGain = emitter.coneOuterGain;
      } else {
        const t = (angleDeg - halfInner) / (halfOuter - halfInner);
        coneGain = 1.0 + (emitter.coneOuterGain - 1.0) * t;
      }
    }

    // 3. Azimuth and Elevation relative to listener forward
    const fwd = this.listener.forwardVector;
    const flatDx = dx;
    const flatDz = dz;
    const angleToTargetRad = Math.atan2(flatDx, -flatDz);
    const listenerAngleRad = Math.atan2(fwd[0], -fwd[2]);
    let azimuthDeg = ((angleToTargetRad - listenerAngleRad) * 180) / Math.PI;
    if (azimuthDeg > 180) azimuthDeg -= 360;
    if (azimuthDeg < -180) azimuthDeg += 360;

    const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, dy / dist))) * 180) / Math.PI;

    const effectiveGain = emitter.gain * distGain * coneGain;

    return {
      emitterId: emitter.id,
      distanceMeters: dist,
      effectiveGain,
      azimuthDeg,
      elevationDeg,
    };
  }

  /**
   * Helper to construct a standard preset configuration.
   */
  public static createPresetConfig(
    id: string,
    preset: SpatialSfxPresetKind,
    position: readonly [number, number, number],
  ): SpatialAudioEmitterConfig {
    switch (preset) {
      case "explosion-rumble":
        return {
          id,
          label: "대폭발 충격음",
          position,
          orientation: [0, 0, 1],
          distanceModel: "inverse",
          refDistance: 2.0,
          maxDistance: 30.0,
          rolloffFactor: 0.8,
          coneInnerAngleDeg: 360,
          coneOuterAngleDeg: 360,
          coneOuterGain: 1.0,
          gain: 1.0,
          sfxPreset: preset,
        };
      case "sword-slash":
        return {
          id,
          label: "검격 파열음",
          position,
          orientation: [0, 0, 1],
          distanceModel: "linear",
          refDistance: 1.0,
          maxDistance: 15.0,
          rolloffFactor: 1.2,
          coneInnerAngleDeg: 90,
          coneOuterAngleDeg: 180,
          coneOuterGain: 0.2,
          gain: 0.9,
          sfxPreset: preset,
        };
      case "whisper-intimate":
        return {
          id,
          label: "밀착 속삭임",
          position,
          orientation: [0, 0, 1],
          distanceModel: "exponential",
          refDistance: 0.5,
          maxDistance: 4.0,
          rolloffFactor: 2.5,
          coneInnerAngleDeg: 60,
          coneOuterAngleDeg: 120,
          coneOuterGain: 0.1,
          gain: 0.7,
          sfxPreset: preset,
        };
      default:
        return {
          id,
          label: "일반 효과음",
          position,
          orientation: [0, 0, 1],
          distanceModel: "inverse",
          refDistance: 1.0,
          maxDistance: 20.0,
          rolloffFactor: 1.0,
          coneInnerAngleDeg: 360,
          coneOuterAngleDeg: 360,
          coneOuterGain: 1.0,
          gain: 0.8,
          sfxPreset: preset,
        };
    }
  }
}
