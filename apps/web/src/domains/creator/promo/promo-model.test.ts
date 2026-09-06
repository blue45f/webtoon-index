import { describe, expect, it } from "vitest";

import { emptyPromoProject, localPromoPlan, parsePromoAiPlan, parsePromoProject, PROMO_FPS, PROMO_MOTIONS, promoAiPrompt, promoAudioGain, promoDataUrl, promoFrameCount, promoMotionAt, promoSize, promoSrt, promoTimeline } from "./promo-model";
import { PROMO_REMOTION_VERSION, promoRemotionFiles } from "./promo-remotion";
import { promoCrc32, promoZip } from "./promo-zip";

import type { PromoProject } from "./promo-model";

const image = "data:image/png;base64,aGVsbG8=";
function fixture(count = 3): PromoProject {
  return { ...emptyPromoProject(), panels: Array.from({ length: count }, (_, index) => ({ id: `cut-${index}`, src: image, description: `장면 ${index}`, caption: `자막 ${index}`, motion: "push-in", fit: "contain", weight: index % 2 ? 3 : 0.5 })) };
}
describe("promo timeline and motion", () => {
  for (const seconds of [15, 30, 60] as const) {
    for (const count of [1, 3, 6, 12]) {
      it(`${seconds}s / ${count} cuts includes a two-second ending without gaps`, () => {
        const project = { ...fixture(count), seconds };
        const timeline = promoTimeline(project);
        expect(timeline[0]?.from).toBe(0);
        timeline.forEach((scene, index) => {
          expect(Number.isInteger(scene.duration)).toBe(true);
          expect(scene.duration).toBeGreaterThanOrEqual(15);
          if (index) expect(scene.from).toBe((timeline[index - 1]?.from ?? 0) + (timeline[index - 1]?.duration ?? 0));
        });
        expect(timeline.reduce((sum, scene) => sum + scene.duration, 0) + 2 * PROMO_FPS).toBe(promoFrameCount(project));
      });
    }
  }
  it("uses even H.264-compatible frame sizes", () => {
    expect(promoSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(promoSize("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(promoSize("1:1")).toEqual({ width: 1080, height: 1080 });
  });
  for (const motion of PROMO_MOTIONS) it(`clamps ${motion} deterministically`, () => {
    expect(promoMotionAt(motion, -1)).toEqual(promoMotionAt(motion, 0));
    expect(promoMotionAt(motion, 2)).toEqual(promoMotionAt(motion, 1));
    expect(promoMotionAt(motion, 0.5)).toEqual(promoMotionAt(motion, 0.5));
  });
  it("fades audio to silence at both boundaries", () => {
    expect(promoAudioGain(0, 450, 0.3)).toBe(0);
    expect(promoAudioGain(200, 450, 0.3)).toBe(0.3);
    expect(promoAudioGain(449, 450, 0.3)).toBe(0);
  });
  it("writes actual timeline timestamps and flattens caption line injection", () => {
    const project = fixture(1);
    project.panels[0]!.caption = "안녕\n\n2\r\n세계";
    expect(promoSrt(project)).toContain("00:00:00,000 --> 00:00:13,000\n안녕 2 세계");
    expect(promoSrt(project)).toContain("00:00:13,000 --> 00:00:15,000");
  });
});
describe("untrusted project and AI input", () => {
  it("round-trips a local project without mutation", () => {
    const project = fixture();
    expect(parsePromoProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
  for (const src of ["https://example.com/a.png", "http://127.0.0.1/a.png", "javascript:alert(1)", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,%%%", "blob:secret"]) it(`rejects external or unsafe source ${src.slice(0, 30)}`, () => {
    expect(() => promoDataUrl(src, "image")).toThrow();
  });
  it("rejects repeated identities, oversized text, unknown duration and nonfinite weights", () => {
    expect(() => parsePromoProject({ ...fixture(), seconds: 20 })).toThrow();
    expect(() => parsePromoProject({ ...fixture(), title: "a".repeat(81) })).toThrow();
    expect(() => parsePromoProject(fixture(13))).toThrow();
    const project = fixture();
    project.panels[1]!.id = project.panels[0]!.id;
    expect(() => parsePromoProject(project)).toThrow();
    project.panels[1]!.id = "cut-other";
    project.panels[0]!.weight = Number.NaN;
    expect(() => parsePromoProject(project)).toThrow();
  });
  it("never transmits media to text AI", () => {
    const project = { ...fixture(), audio: { src: "data:audio/wav;base64,aGVsbG8=", volume: 0.2 } };
    const prompt = promoAiPrompt(project);
    expect(prompt.user).not.toContain("base64");
    expect(prompt.user).not.toContain("src");
    expect(prompt.user).toContain("장면 0");
  });
  it("preserves original media and fit while accepting reordering", () => {
    const project = fixture();
    const scenes = [...project.panels].reverse().map((panel) => ({ id: panel.id, caption: "새 자막", motion: "still", weight: 2, src: "https://attacker.invalid" }));
    const output = parsePromoAiPlan(JSON.stringify({ scenes }), project);
    expect(output.map((panel) => panel.id)).toEqual(["cut-2", "cut-1", "cut-0"]);
    expect(output.every((panel) => panel.src === image && panel.fit === "contain")).toBe(true);
    expect(project.panels[0]?.caption).toBe("자막 0");
  });
  it("rejects partial, duplicated, invented and malformed AI plans atomically", () => {
    const project = fixture();
    const scene = { id: "cut-0", caption: "x", motion: "still", weight: 1 };
    for (const scenes of [[], [scene], [scene, scene, scene], [scene, { ...scene, id: "cut-1" }, { ...scene, id: "invented" }], project.panels.map((panel) => ({ ...panel, motion: "javascript" }))]) {
      expect(() => parsePromoAiPlan(JSON.stringify({ scenes }), project)).toThrow();
      expect(project.panels[0]?.caption).toBe("자막 0");
    }
    expect(() => parsePromoAiPlan("not json", project)).toThrow();
  });
  it("local templates are deterministic and leave originals untouched", () => {
    const project = fixture();
    expect(localPromoPlan(project)).toEqual(localPromoPlan(project));
    expect(project.panels[0]?.weight).toBe(0.5);
  });
});
describe("portable Remotion kit", () => {
  it("contains local media, real composition, captions and pinned renderer dependencies", () => {
    const files = promoRemotionFiles(fixture(1), { model: "model source", canvas: "canvas source" });
    const pkg = JSON.parse(String(files["package.json"]));
    expect(pkg.dependencies.remotion).toBe(PROMO_REMOTION_VERSION);
    expect(pkg.dependencies["@remotion/cli"]).toBe(PROMO_REMOTION_VERSION);
    expect(pkg.scripts.render).toContain("--codec=h264");
    expect(files["src/index.ts"]).toContain("registerRoot(Root)");
    expect(files["src/Promo.tsx"]).toContain("drawPromoFrame");
    expect(files["src/Promo.tsx"]).toContain('loopVolumeCurveBehavior="extend"');
    expect(files["src/promo-model.ts"]).toBe("model source");
    expect(files["public/panel-1.png"]).toEqual(new TextEncoder().encode("hello"));
    expect(files["project.json"]).not.toContain("base64");
    expect(files["captions.srt"]).toContain("00:00:15,000");
  });
  it("produces standard CRC32 and a deterministic ZIP central directory", () => {
    expect(promoCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const files = { "src/a.ts": "한글", "public/a.png": new Uint8Array([1, 2, 3]) };
    const zip = promoZip(files);
    expect(zip).toEqual(promoZip(files));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(2);
  });
  it("rejects path traversal and empty render jobs", () => {
    expect(() => promoZip({ "../secret": "x" })).toThrow();
    expect(() => promoZip({ "/absolute": "x" })).toThrow();
    expect(() => promoRemotionFiles(emptyPromoProject(), { model: "", canvas: "" })).toThrow();
  });
});
