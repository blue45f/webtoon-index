/**
 * studio-3d-billboard-bubble-anchor.ts
 *
 * Toonsquare Tooning-inspired 3D Billboard Speech Bubble & Comic Emote Anchor Engine.
 * Manages 3D camera-facing billboard text balloons (speech, shout, thought, whisper)
 * and manga emotion symbols (sweat, anger, question, exclamation, sparkle, dark-lines, heart)
 * with dynamic tail anchoring to character head/mouth coordinates.
 */

export type BubbleKind = "speech" | "shout" | "thought" | "whisper";

export type EmoteKind =
  | "sweat"
  | "anger"
  | "question"
  | "exclamation"
  | "sparkle"
  | "dark-lines"
  | "heart";

export type CharacterAnchorSocket =
  | "head-top"
  | "head-right"
  | "head-left"
  | "mouth"
  | "shoulder-right"
  | "shoulder-left";

export interface Vector3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpeechBubbleItem {
  readonly id: string;
  readonly text: string;
  readonly kind: BubbleKind;
  readonly socket: CharacterAnchorSocket;
  readonly offset: Vector3D;
  readonly scale: number;
  readonly billboardFacing: boolean;
  readonly tailTargetOffset: Vector3D;
  readonly bubbleBgColor: string; // #ffffff, #181824, etc.
  readonly textColor: string;
}

export interface EmoteStickerItem {
  readonly id: string;
  readonly kind: EmoteKind;
  readonly socket: CharacterAnchorSocket;
  readonly offset: Vector3D;
  readonly scale: number;
  readonly floatAnimation: boolean;
  readonly tintColor: string;
}

export interface BillboardTransform {
  readonly worldPosition: Vector3D;
  readonly rotationEulerYDeg: number;
  readonly rotationEulerXDeg: number;
  readonly scale: number;
}

export interface ScreenProjectionResult {
  readonly screenX: number;
  readonly screenY: number;
  readonly isInFrontOfCamera: boolean;
  readonly distanceToCamera: number;
}

export const SOCKET_LOCAL_OFFSETS: Record<CharacterAnchorSocket, Vector3D> = {
  "head-top": { x: 0, y: 0.35, z: 0 },
  "head-right": { x: 0.28, y: 0.2, z: 0 },
  "head-left": { x: -0.28, y: 0.2, z: 0 },
  mouth: { x: 0, y: -0.05, z: 0.12 },
  "shoulder-right": { x: 0.45, y: -0.15, z: 0 },
  "shoulder-left": { x: -0.45, y: -0.15, z: 0 },
};

export class Studio3DBillboardBubbleEngine {
  private bubbles: SpeechBubbleItem[] = [];
  private emotes: EmoteStickerItem[] = [];

  constructor() {
    // Initial sample bubble and emote
    this.bubbles = [
      {
        id: "bubble-1",
        text: "너… 정말 그럴 생각이야?",
        kind: "speech",
        socket: "head-top",
        offset: { x: 0.2, y: 0.25, z: 0 },
        scale: 1.0,
        billboardFacing: true,
        tailTargetOffset: { x: -0.2, y: -0.3, z: 0 },
        bubbleBgColor: "#ffffff",
        textColor: "#111115",
      },
    ];
    this.emotes = [
      {
        id: "emote-1",
        kind: "sweat",
        socket: "head-right",
        offset: { x: 0.05, y: 0.05, z: 0.05 },
        scale: 1.2,
        floatAnimation: true,
        tintColor: "#38bdf8",
      },
    ];
  }

  public getBubbles(): readonly SpeechBubbleItem[] {
    return this.bubbles;
  }

  public getEmotes(): readonly EmoteStickerItem[] {
    return this.emotes;
  }

  public addBubble(bubble: Omit<SpeechBubbleItem, "id">): SpeechBubbleItem {
    const item: SpeechBubbleItem = {
      ...bubble,
      id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };
    this.bubbles = [...this.bubbles, item];
    return item;
  }

  public removeBubble(id: string): void {
    this.bubbles = this.bubbles.filter((b) => b.id !== id);
  }

  public addEmote(emote: Omit<EmoteStickerItem, "id">): EmoteStickerItem {
    const item: EmoteStickerItem = {
      ...emote,
      id: `emote-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    };
    this.emotes = [...this.emotes, item];
    return item;
  }

  public removeEmote(id: string): void {
    this.emotes = this.emotes.filter((e) => e.id !== id);
  }

  /**
   * Calculates world coordinates for an anchored item on a character head.
   */
  public computeAnchorWorldPosition(
    headPosition: Vector3D,
    socket: CharacterAnchorSocket,
    itemOffset: Vector3D,
  ): Vector3D {
    const baseOffset = SOCKET_LOCAL_OFFSETS[socket];
    return {
      x: headPosition.x + baseOffset.x + itemOffset.x,
      y: headPosition.y + baseOffset.y + itemOffset.y,
      z: headPosition.z + baseOffset.z + itemOffset.z,
    };
  }

  /**
   * Computes billboard rotation angles so the bubble plane faces directly towards the camera.
   */
  public computeBillboardRotation(
    itemWorldPos: Vector3D,
    cameraWorldPos: Vector3D,
  ): { rotationEulerYDeg: number; rotationEulerXDeg: number } {
    const dx = cameraWorldPos.x - itemWorldPos.x;
    const dy = cameraWorldPos.y - itemWorldPos.y;
    const dz = cameraWorldPos.z - itemWorldPos.z;

    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const angleYRad = Math.atan2(dx, dz);
    const angleXRad = Math.atan2(-dy, horizontalDist);

    return {
      rotationEulerYDeg: Number(((angleYRad * 180) / Math.PI).toFixed(1)),
      rotationEulerXDeg: Number(((angleXRad * 180) / Math.PI).toFixed(1)),
    };
  }

  /**
   * Generates SVG path string for speech bubble outlines based on cartoon style.
   */
  public generateBubbleSvgPath(
    kind: BubbleKind,
    width: number,
    height: number,
    tailX: number,
    tailY: number,
  ): string {
    const w = width;
    const h = height;
    const r = Math.min(16, Math.min(w, h) * 0.2);

    if (kind === "speech") {
      // Rounded rectangle with triangular tail
      return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${Math.max(
        r + 20,
        tailX + 15,
      )} ${h} L ${tailX} ${tailY} L ${Math.max(r, tailX - 10)} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
    }

    if (kind === "shout") {
      // Jagged spike star / action shout balloon
      return `M 0 ${h * 0.5} L ${w * 0.15} ${h * 0.15} L ${w * 0.5} 0 L ${w * 0.85} ${h * 0.15} L ${w} ${h * 0.5} L ${w * 0.85} ${h * 0.85} L ${tailX} ${tailY} L ${w * 0.4} ${h * 0.9} L ${w * 0.15} ${h * 0.85} Z`;
    }

    if (kind === "thought") {
      // Cloud thought balloon
      return `M ${r * 2} ${h * 0.5} Q 0 ${h * 0.2} ${w * 0.25} 0 Q ${w * 0.5} 0 ${w * 0.75} ${h * 0.1} Q ${w} ${h * 0.3} ${w * 0.9} ${h * 0.7} Q ${w * 0.7} ${h} ${w * 0.4} ${h * 0.95} L ${tailX} ${tailY} Q ${w * 0.1} ${h} ${r * 2} ${h * 0.5} Z`;
    }

    // "whisper": dashed regular rounded rect
    return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
  }
}
