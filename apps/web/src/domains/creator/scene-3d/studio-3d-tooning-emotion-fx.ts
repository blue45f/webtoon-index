/**
 * Studio 3D Tooning Emotion & World-Space Speech Bubble Engine
 *
 * Inspired by Tooning 3D Studio (plus.tooning.io/3d-studio):
 * - 16 emotional facial blendshape combination presets
 * - 3D world-space speech bubbles with dynamic tail vectors tracking character mouth joints
 * - 3D comic emote stickers (sweat drop, anger cross, sparkle star, gloom lines)
 */

export type TooningEmotionPreset =
  | "joy-radiant"
  | "smirk-villain"
  | "cry-grief"
  | "rage-furious"
  | "blush-embarrassed"
  | "shock-aghast"
  | "despair-shadow"
  | "determination-heroic"
  | "winking-playful"
  | "sleepy-drowsy"
  | "arrogant-haughty"
  | "flustered-panic"
  | "scheming-crafty"
  | "innocent-pleading"
  | "disgusted-grimace"
  | "neutral-calm";

export type BubbleShapeStyle = "speech" | "shout-spiky" | "thought-cloud" | "whisper-dotted";

export type EmoteSfxKind =
  | "sweat-drop"
  | "anger-cross"
  | "sparkle-star"
  | "question-exclamation"
  | "dark-aura"
  | "gloom-lines";

export interface FacialBlendshapeWeights {
  readonly eyeBlinkLeft: number;
  readonly eyeBlinkRight: number;
  readonly eyeSquint: number;
  readonly eyeWide: number;
  readonly jawOpen: number;
  readonly mouthSmile: number;
  readonly mouthFrown: number;
  readonly mouthPucker: number;
  readonly browInnerUp: number;
  readonly browDown: number;
  readonly cheekPuff: number;
  readonly blushIntensity: number;
}

export interface WorldSpace3DBubble {
  readonly id: string;
  readonly targetCharacterId: string;
  readonly text: string;
  readonly style: BubbleShapeStyle;
  readonly positionOffset: readonly [number, number, number]; // relative to head
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface WorldSpaceEmoteSfx {
  readonly id: string;
  readonly targetCharacterId: string;
  readonly kind: EmoteSfxKind;
  readonly positionOffset: readonly [number, number, number];
  readonly scale: number;
}

export class Studio3DTooningEmotionFxEngine {
  private activeEmotion: TooningEmotionPreset = "neutral-calm";
  private bubbles: Map<string, WorldSpace3DBubble> = new Map();
  private emotes: Map<string, WorldSpaceEmoteSfx> = new Map();

  constructor(initialEmotion: TooningEmotionPreset = "neutral-calm") {
    this.activeEmotion = initialEmotion;
  }

  public getActiveEmotion(): TooningEmotionPreset {
    return this.activeEmotion;
  }

  public setEmotion(preset: TooningEmotionPreset): void {
    this.activeEmotion = preset;
  }

  public getBubbles(): readonly WorldSpace3DBubble[] {
    return Array.from(this.bubbles.values());
  }

  public addBubble(bubble: WorldSpace3DBubble): void {
    this.bubbles.set(bubble.id, bubble);
  }

  public removeBubble(id: string): void {
    this.bubbles.delete(id);
  }

  public getEmotes(): readonly WorldSpaceEmoteSfx[] {
    return Array.from(this.emotes.values());
  }

  public addEmote(emote: WorldSpaceEmoteSfx): void {
    this.emotes.set(emote.id, emote);
  }

  public removeEmote(id: string): void {
    this.emotes.delete(id);
  }

  /**
   * Resolves exact facial blendshape weights for the active emotion preset.
   */
  public evaluateBlendshapeWeights(preset: TooningEmotionPreset = this.activeEmotion): FacialBlendshapeWeights {
    const base: FacialBlendshapeWeights = {
      eyeBlinkLeft: 0,
      eyeBlinkRight: 0,
      eyeSquint: 0,
      eyeWide: 0,
      jawOpen: 0,
      mouthSmile: 0,
      mouthFrown: 0,
      mouthPucker: 0,
      browInnerUp: 0,
      browDown: 0,
      cheekPuff: 0,
      blushIntensity: 0,
    };

    switch (preset) {
      case "joy-radiant":
        return { ...base, mouthSmile: 0.95, eyeSquint: 0.7, cheekPuff: 0.4, blushIntensity: 0.3 };
      case "smirk-villain":
        return { ...base, mouthSmile: 0.5, browDown: 0.6, eyeSquint: 0.4, eyeBlinkRight: 0.15 };
      case "cry-grief":
        return { ...base, jawOpen: 0.4, mouthFrown: 0.8, browInnerUp: 0.95, eyeBlinkLeft: 0.3, eyeBlinkRight: 0.3 };
      case "rage-furious":
        return { ...base, mouthFrown: 0.9, jawOpen: 0.5, browDown: 1.0, eyeWide: 0.8 };
      case "blush-embarrassed":
        return { ...base, mouthSmile: 0.4, eyeSquint: 0.5, browInnerUp: 0.4, blushIntensity: 0.9 };
      case "shock-aghast":
        return { ...base, jawOpen: 0.95, eyeWide: 1.0, browInnerUp: 0.8 };
      case "despair-shadow":
        return { ...base, mouthFrown: 0.6, browDown: 0.4, eyeSquint: 0.2, blushIntensity: 0 };
      case "determination-heroic":
        return { ...base, mouthFrown: 0.2, browDown: 0.75, eyeWide: 0.3 };
      case "winking-playful":
        return { ...base, eyeBlinkRight: 1.0, mouthSmile: 0.8, blushIntensity: 0.35 };
      case "sleepy-drowsy":
        return { ...base, eyeBlinkLeft: 0.7, eyeBlinkRight: 0.7, jawOpen: 0.3 };
      case "arrogant-haughty":
        return { ...base, eyeBlinkLeft: 0.4, eyeBlinkRight: 0.4, mouthSmile: 0.3, browDown: 0.3 };
      case "flustered-panic":
        return { ...base, jawOpen: 0.6, eyeWide: 0.8, browInnerUp: 0.9, blushIntensity: 0.7 };
      case "scheming-crafty":
        return { ...base, eyeSquint: 0.8, mouthSmile: 0.6, browDown: 0.5 };
      case "innocent-pleading":
        return { ...base, eyeWide: 0.7, browInnerUp: 0.9, mouthPucker: 0.5, blushIntensity: 0.4 };
      case "disgusted-grimace":
        return { ...base, mouthFrown: 0.8, browDown: 0.9, eyeSquint: 0.6 };
      case "neutral-calm":
      default:
        return base;
    }
  }

  /**
   * Calculates world-space speech bubble tail vector targeting the character's mouth.
   */
  public evaluateBubbleTail(
    bubble: WorldSpace3DBubble,
    characterHeadPos: readonly [number, number, number],
  ): {
    readonly bubbleCenter: [number, number, number];
    readonly targetMouthPos: [number, number, number];
    readonly tailDirectionVector: [number, number, number];
  } {
    const [hx, hy, hz] = characterHeadPos;
    const [ox, oy, oz] = bubble.positionOffset;

    const bubbleCenter: [number, number, number] = [hx + ox, hy + oy, hz + oz];
    // Mouth is positioned slightly below and in front of head origin
    const targetMouthPos: [number, number, number] = [hx, hy - 0.08, hz + 0.12];

    const dx = targetMouthPos[0] - bubbleCenter[0];
    const dy = targetMouthPos[1] - bubbleCenter[1];
    const dz = targetMouthPos[2] - bubbleCenter[2];
    const len = Math.hypot(dx, dy, dz) || 1e-4;

    const tailDirectionVector: [number, number, number] = [dx / len, dy / len, dz / len];

    return {
      bubbleCenter,
      targetMouthPos,
      tailDirectionVector,
    };
  }
}
