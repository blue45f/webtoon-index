// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { CHARACTER_HAND_GLYPH_POSE_TYPES } from "./character-shaper-hand-glyph";
import { CharacterSlotPreview } from "./character-shaper-preview";

import type { CharacterGarmentGlyph, CharacterSlotPreviewSpec } from "./character-shaper-contract";

afterEach(cleanup);

const BALANCED_FACE = { headWidth: 1, headHeight: 1, headDepth: 1, cheekVolume: 0.35, chinLength: 1 } as const;

const ONE_OF_EACH: readonly CharacterSlotPreviewSpec[] = [
  { kind: "face-shape", face: BALANCED_FACE },
  { kind: "eyes", size: 0.55, spacing: 0.05, tilt: 0.1, lid: "round" },
  { kind: "irises", irisSize: 0.5, color: "#3b6fb6", highlight: "basic", pupil: "round" },
  { kind: "nose", height: 0.6, width: -0.15, glyph: "bridge" },
  { kind: "mouth", width: 0.15, fullness: 0, open: 0, smile: 0.2 },
  { kind: "ears", size: 0.5, glyph: "human" },
  { kind: "hair", style: "bob", bangStyle: "blunt", baseColor: "#352a28", tipColor: "#6b5148", length: 1, volume: 1 },
  { kind: "hair-original" },
  { kind: "body", headUnits: 7, shoulderWidth: 1, legLength: 1, torsoLength: 1 },
  { kind: "garment", slot: "top", glyph: "shirt", color: "#f4f1ea" },
  { kind: "prop", propId: "glasses", category: "head", color: "#2b2b30" },
  { kind: "expression", emoji: "😊", weights: { happy: 1 } },
  { kind: "pose", presetId: "xp_sprint", tone: "역동적인 대시" },
  { kind: "hand-pose", poseType: "peace" },
  { kind: "glyph", icon: "Eye", caption: "준비 중" },
];

function markup(spec: CharacterSlotPreviewSpec, extra: { readonly selected?: boolean; readonly title?: string; readonly size?: number } = {}): string {
  return renderToStaticMarkup(<CharacterSlotPreview spec={spec} {...extra} />);
}

describe("CharacterSlotPreview", () => {
  it("renders every spec kind as one labelled inline svg in the 4:5 frame", () => {
    for (const spec of ONE_OF_EACH) {
      const html = markup(spec, { title: `${spec.kind} 카드` });
      expect(html.startsWith("<svg"), spec.kind).toBe(true);
      expect(html, spec.kind).toContain('role="img"');
      expect(html, spec.kind).toContain(`aria-label="${spec.kind} 카드"`);
      expect(html, spec.kind).toContain('viewBox="0 0 80 100"');
      expect(html, spec.kind).toContain(`data-character-preview="${spec.kind}"`);
      expect(html, spec.kind).not.toContain("NaN");
      expect(html, spec.kind).not.toContain("undefined");
      expect((html.match(/<svg/g) ?? []).length, spec.kind).toBe(1);
    }
  });

  it("derives a Korean accessible name when no title is given", () => {
    expect(markup({ kind: "eyes", size: 0, spacing: 0, tilt: 0, lid: "round" })).toContain('aria-label="눈 미리보기"');
    expect(markup({ kind: "body", headUnits: 5, shoulderWidth: 1, legLength: 1, torsoLength: 1 })).toContain('aria-label="5두신 체형 미리보기"');
    expect(markup({ kind: "glyph", icon: "Eye", caption: "" })).toContain('aria-label="미리보기"');
    expect(markup({ kind: "glyph", icon: "Eye", caption: "임시" })).toContain('aria-label="임시"');
  });

  it("sizes the frame from `size` and forwards className", () => {
    const html = markup(ONE_OF_EACH[0]!, { size: 36, title: "얼굴" });
    expect(html).toContain('width="36"');
    expect(html).toContain('height="45"');
    const custom = renderToStaticMarkup(<CharacterSlotPreview spec={ONE_OF_EACH[0]!} className="h-full w-full" title="얼굴" />);
    expect(custom).toContain('class="block shrink-0 select-none overflow-hidden h-full w-full"');
  });

  it("is exposed to assistive tech as an image with the given name", () => {
    render(<CharacterSlotPreview spec={{ kind: "hand-pose", poseType: "fist" }} title="주먹" />);
    expect(screen.getByRole("img", { name: "주먹" })).toBeTruthy();
  });

  it("is deterministic: the same spec renders identical markup twice", () => {
    for (const spec of ONE_OF_EACH) {
      expect(markup(spec), spec.kind).toBe(markup(spec));
      expect(markup(spec, { selected: true }), spec.kind).toBe(markup(spec, { selected: true }));
    }
  });

  it("uses spec colours as literal fills and derives lighter/darker companions from them", () => {
    const hair = markup({ kind: "hair", style: "long", bangStyle: "curtain", baseColor: "#9d174d", tipColor: "#fbcfe8", length: 1.3, volume: 1 });
    expect(hair).toContain('stop-color="#9d174d"');
    expect(hair).toContain('stop-color="#fbcfe8"');
    expect(hair).toContain("<linearGradient");

    const garment = markup({ kind: "garment", slot: "top", glyph: "hoodie", color: "#2f4f7a" });
    expect(garment).toContain('fill="#2f4f7a"');

    const prop = markup({ kind: "prop", propId: "headphones", category: "head", color: "#c0392b" });
    expect(prop).toContain("#c0392b");

    const iris = markup({ kind: "irises", irisSize: 0, color: "#7b4fb0", highlight: "star", pupil: "vertical" });
    expect(iris).toContain('fill="#7b4fb0"');
    expect(iris).toContain("<ellipse");
    // Highlight is a lightened tint of the iris colour, never a chrome hex.
    expect(iris).not.toMatch(/#fff\b|#ffffff|#000\b|#000000/i);
  });

  it("falls back to tokens for malformed spec colours instead of throwing", () => {
    const html = markup({ kind: "garment", slot: "bottom", glyph: "jeans", color: "not-a-colour" });
    expect(html).toContain("var(--color-raised)");
    expect(html).not.toContain("not-a-colour");
    expect(markup({ kind: "hair", style: "short", bangStyle: "full", baseColor: "", tipColor: "", length: 1, volume: 1 })).toContain("var(--color-fg-3)");
  });

  it("draws only with currentColor, tokens and spec colours (no raw chrome hex)", () => {
    const chromeOnly: readonly CharacterSlotPreviewSpec[] = ONE_OF_EACH.filter(
      (spec) => spec.kind !== "hair" && spec.kind !== "garment" && spec.kind !== "prop" && spec.kind !== "irises",
    );
    for (const spec of chromeOnly) {
      const html = markup(spec, { selected: true });
      expect(html, spec.kind).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(html, spec.kind).toContain("currentColor");
      expect(html, spec.kind).toContain("var(--color-");
    }
  });

  it("changes shape with the numeric deltas", () => {
    const smallEyes = markup({ kind: "eyes", size: -0.6, spacing: 0, tilt: 0, lid: "sharp" });
    const bigEyes = markup({ kind: "eyes", size: 0.7, spacing: 0.4, tilt: 0.6, lid: "cat" });
    expect(smallEyes).not.toBe(bigEyes);

    const narrow = markup({ kind: "face-shape", face: { ...BALANCED_FACE, headWidth: 0.94, chinLength: 1.08 } });
    const round = markup({ kind: "face-shape", face: { ...BALANCED_FACE, headWidth: 1.1, cheekVolume: 0.8, chinLength: 0.9 } });
    expect(narrow).not.toBe(round);
    // The balanced reference outline is dashed under every face so the delta reads.
    expect(narrow).toContain("stroke-dasharray");

    const closed = markup({ kind: "mouth", width: 0, fullness: 0, open: 0, smile: 0 });
    const open = markup({ kind: "mouth", width: 0.05, fullness: 0.1, open: 0.25, smile: 0 });
    expect(closed).not.toBe(open);

    const chibi = markup({ kind: "body", headUnits: 3, shoulderWidth: 0.88, legLength: 0.62, torsoLength: 0.88 });
    const runway = markup({ kind: "body", headUnits: 9, shoulderWidth: 1, legLength: 1.06, torsoLength: 1 });
    expect((chibi.match(/<line/g) ?? []).length).toBe(1 + 4);
    expect((runway.match(/<line/g) ?? []).length).toBe(1 + 10);
  });

  it("renders pose figures from the preset id and falls back for unknown ids", () => {
    const sprint = markup({ kind: "pose", presetId: "xp_sprint", tone: "역동적인 대시" }, { title: "전력 질주" });
    const standing = markup({ kind: "pose", presetId: "ni_calm_front", tone: "정면 차분" }, { title: "자연 대기" });
    const unknown = markup({ kind: "pose", presetId: "nope", tone: "" }, { title: "알 수 없음" });
    expect(sprint).not.toBe(standing);
    expect(sprint).toContain("<title>전력 질주 · 역동적인 대시</title>");
    expect(unknown).toContain("<title>알 수 없음</title>");
    expect(unknown).toContain('data-character-preview="pose"');
  });

  it("draws every hand pose with five fingers and the grip props", () => {
    for (const poseType of CHARACTER_HAND_GLYPH_POSE_TYPES) {
      const html = markup({ kind: "hand-pose", poseType });
      expect(html, poseType).toContain('data-character-preview="hand-pose"');
      expect((html.match(/stroke-width="6.4"/g) ?? []).length, poseType).toBe(5);
    }
    expect(markup({ kind: "hand-pose", poseType: "fist" })).not.toBe(markup({ kind: "hand-pose", poseType: "open" }));
    expect(markup({ kind: "hand-pose", poseType: "fingerHeart" })).toContain("var(--color-accent)");
    expect(markup({ kind: "hand-pose", poseType: "phoneGrip" })).toContain("<rect");
  });

  it("keeps expression emoji inside <title> only and shapes the face from weights", () => {
    const joy = markup({ kind: "expression", emoji: "😊", weights: { happy: 1 } }, { title: "기쁨" });
    expect(joy).toContain("<title>기쁨 😊</title>");
    expect(joy.replace(/<title>.*?<\/title>/u, "")).not.toContain("😊");
    const surprised = markup({ kind: "expression", emoji: "😲", weights: { surprised: 1, oh: 0.55 } });
    const angry = markup({ kind: "expression", emoji: "😠", weights: { angry: 1 } });
    const blink = markup({ kind: "expression", emoji: "😌", weights: { blink: 1 } });
    expect(surprised).toContain("<ellipse");
    expect(new Set([joy, surprised, angry, blink]).size).toBe(4);
  });

  it("covers every garment glyph and prop category without throwing", () => {
    const glyphs: readonly CharacterGarmentGlyph[] = [
      "tshirt", "shirt", "sweater", "sailor", "tank", "dress", "scrubs", "blazer", "hoodie", "coat", "cardigan", "armor",
      "robe", "labcoat", "pleated", "longskirt", "shorts", "pants", "wide", "jeans", "scrubpants", "sneakers", "boots",
      "longboots", "heels", "loafers", "sandals", "clogs", "original",
    ];
    const seen = new Set<string>();
    for (const glyph of glyphs) {
      const html = markup({ kind: "garment", slot: "top", glyph, color: "#8a6a3c" });
      expect(html, glyph).toContain('data-character-preview="garment"');
      seen.add(html);
    }
    expect(seen.size).toBe(glyphs.length);

    const propIds = ["cap", "beret", "beanie", "surgicalCap", "glasses", "sunglasses", "goggles", "eyepatch", "headphones", "earmuffs",
      "catEars", "elfEars", "horns", "halo", "crown", "flowerCrown", "ribbon", "hairpin", "headband", "faceMask", "choker", "mystery"];
    const headSeen = new Set(propIds.map((propId) => markup({ kind: "prop", propId, category: "head", color: "#d8a657" })));
    expect(headSeen.size).toBe(propIds.length);
    const bodyIds = ["cape", "backpack", "shoulderbag", "wings", "backwing", "apron", "belt", "holster", "stethoscope", "idBadge", "nameTag",
      "scarf", "gloves", "guitar", "quiver", "tail", "mystery"];
    const bodySeen = new Set(bodyIds.map((propId) => markup({ kind: "prop", propId, category: "body", color: "#5b6ee1" })));
    expect(bodySeen.size).toBe(bodyIds.length);
    expect(markup({ kind: "prop", propId: "sword", category: "hand", color: "#c8ccd4" })).not.toBe(
      markup({ kind: "prop", propId: "mug", category: "hand", color: "#c8ccd4" }),
    );
  });

  it("marks the selected state with the accent token and a data attribute", () => {
    const plain = markup(ONE_OF_EACH[1]!);
    const selected = markup(ONE_OF_EACH[1]!, { selected: true });
    expect(selected).toContain('data-character-preview-selected="true"');
    expect(selected).toContain("var(--color-accent-soft)");
    expect(plain).not.toContain("data-character-preview-selected");
    expect(plain).not.toContain("var(--color-accent-soft)");
  });
});
