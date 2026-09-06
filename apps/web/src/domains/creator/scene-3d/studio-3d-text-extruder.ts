/**
 * Studio 3D Text & Webtoon SFX Onomatopoeia Extruder (Spline / Clip Studio 3D SFX Benchmark).
 * Extrudes 3D text with beveling, curved arc layout, and webtoon sound effect styling.
 */

export type SfxStyleKind =
  | "manga-impact" // 굵은 고딕 임팩트 (쾅!, 콰앙)
  | "action-slash" // 날카로운 베기 효과음 (슉!, 콰아악)
  | "magic-radiance" // 신비로운 마법 효과음 (샤라랑, 파아앗)
  | "comic-pop" // 동글동글 팝 코믹 (두근두근, 쿵!)
  | "electric-zap" // 지그재그 번개 효과음 (파지지직, 찌릿);

export interface SfxPreset {
  readonly id: string;
  readonly text: string;
  readonly label: string;
  readonly category: "impact" | "action" | "magic" | "emotion";
  readonly defaultStyle: SfxStyleKind;
  readonly defaultColor: string;
  readonly defaultEmissive: string;
}

export const SFX_ONOPATOPOEIA_PRESETS: readonly SfxPreset[] = Object.freeze([
  { id: "sfx-boom", text: "쾅!!", label: "강한 폭발/충돌", category: "impact", defaultStyle: "manga-impact", defaultColor: "#ef4444", defaultEmissive: "#f87171" },
  { id: "sfx-slash", text: "슉-!", label: "검격/바람 가르기", category: "action", defaultStyle: "action-slash", defaultColor: "#06b6d4", defaultEmissive: "#67e8f9" },
  { id: "sfx-spark", text: "파지지직", label: "전격/마력 방출", category: "magic", defaultStyle: "electric-zap", defaultColor: "#eab308", defaultEmissive: "#fde047" },
  { id: "sfx-glitter", text: "샤라랑✨", label: "광채/설렘 연출", category: "magic", defaultStyle: "magic-radiance", defaultColor: "#ec4899", defaultEmissive: "#f472b6" },
  { id: "sfx-heart", text: "두근…", label: "심장 박동/긴장", category: "emotion", defaultStyle: "comic-pop", defaultColor: "#f43f5e", defaultEmissive: "#fb7185" },
  { id: "sfx-heavy", text: "쿵-!!", label: "거대 발걸음/착지", category: "impact", defaultStyle: "manga-impact", defaultColor: "#8b5cf6", defaultEmissive: "#a78bfa" },
]);

export interface TextExtrudeConfig {
  readonly text: string;
  readonly fontStyle: SfxStyleKind;
  readonly extrudeDepth: number; // 0.1 to 2.0
  readonly bevelThickness: number; // 0.0 to 0.5
  readonly bevelSegments: number; // 1 to 5
  readonly arcAngleDegrees: number; // -90 to +90 (curving along XZ plane)
  readonly letterSpacing: number; // -0.2 to 1.0
  readonly size: number; // scale multiplier
}

export interface ExtrudedTextMeshSpec {
  readonly text: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly boundingBox: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly characterTransforms: ReadonlyArray<{
    readonly char: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number; // degrees
  }>;
}

/**
 * Calculates 3D layout and bounding metrics for extruded 3D text/SFX.
 */
export function plan3dTextExtrusion(config: TextExtrudeConfig): ExtrudedTextMeshSpec {
  const chars = Array.from(config.text);
  const count = chars.length;
  if (count === 0) {
    return {
      text: "",
      vertexCount: 0,
      triangleCount: 0,
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
      characterTransforms: [],
    };
  }

  const charWidth = 1.0 * config.size;
  const charHeight = 1.2 * config.size;
  const depth = Math.max(0.05, config.extrudeDepth);
  const spacing = (charWidth + config.letterSpacing * config.size);
  const totalWidth = count * spacing;

  const charTransforms = [];
  const arcRad = (config.arcAngleDegrees * Math.PI) / 180;

  for (let i = 0; i < count; i++) {
    const norm = count > 1 ? i / (count - 1) - 0.5 : 0; // -0.5 to 0.5
    const basePosX = norm * totalWidth;
    const angle = norm * arcRad;

    // Curved offset
    const curveZ = Math.abs(arcRad) > 0.001 ? (Math.cos(angle) - 1.0) * (totalWidth / Math.max(0.1, Math.abs(arcRad))) : 0;
    const rotY = (angle * 180) / Math.PI;

    charTransforms.push({
      char: chars[i],
      position: [basePosX, 0, curveZ] as const,
      rotationY: rotY,
    });
  }

  // Estimated triangle count per extruded glyph (approx. 40 triangles per face + bevel)
  const trianglesPerChar = 64 + config.bevelSegments * 32;
  const totalTriangles = count * trianglesPerChar;
  const totalVertices = totalTriangles * 3;

  const halfW = totalWidth / 2;
  const halfH = charHeight / 2;

  return {
    text: config.text,
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
    boundingBox: {
      min: [-halfW, -halfH, -depth / 2],
      max: [halfW, halfH, depth / 2],
    },
    characterTransforms: Object.freeze(charTransforms),
  };
}
