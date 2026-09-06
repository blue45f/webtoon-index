import { describe, expect, it } from "vitest";

import {
  buildStudioPitchPptx,
  createStudioPitchPptxBlob,
  studioPitchPptxFileName,
} from "./studio-pptx-export";

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("studio PPTX export", () => {
  it("creates a deterministic OOXML ZIP with editable text slides", () => {
    const input = {
      title: "달빛 탐정",
      slides: [
        { title: "작품 한 문장", body: "도시의 기억을 추적하는 탐정 이야기" },
        { title: "출시 계획", body: "검수 완료 후 공개" },
      ],
    };
    const first = buildStudioPitchPptx(input);
    const second = buildStudioPitchPptx(input);
    expect(first).toEqual(second);
    expect(first.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const contents = text(first);
    expect(contents).toContain("[Content_Types].xml");
    expect(contents).toContain("ppt/presentation.xml");
    expect(contents).toContain("ppt/slides/slide1.xml");
    expect(contents).toContain("ppt/slides/slide2.xml");
    expect(contents).toContain("달빛 탐정");
    expect(contents).toContain("작품 한 문장");
    expect(contents).toContain("출시 계획");
    expect(contents).toContain('txBox="1"');
  });

  it("escapes user text instead of producing malformed slide XML", () => {
    const contents = text(buildStudioPitchPptx({
      title: "A&B <Pitch>",
      slides: [{ title: '"Title" & more', body: "<script>alert('x')</script>" }],
    }));
    expect(contents).toContain("A&amp;B &lt;Pitch&gt;");
    expect(contents).toContain("&quot;Title&quot; &amp; more");
    expect(contents).toContain("&lt;script&gt;alert(&apos;x&apos;)&lt;/script&gt;");
    expect(contents).not.toContain("<script>");
  });

  it("rejects empty presentations and caps slide count", () => {
    expect(() => buildStudioPitchPptx({ title: " ", slides: [{ title: "A", body: "B" }] })).toThrow();
    expect(() => buildStudioPitchPptx({ title: "Pitch", slides: [] })).toThrow();
    const contents = text(buildStudioPitchPptx({
      title: "Pitch",
      slides: Array.from({ length: 120 }, (_, index) => ({ title: `S${index + 1}`, body: "B" })),
    }));
    expect(contents).toContain("ppt/slides/slide100.xml");
    expect(contents).not.toContain("ppt/slides/slide101.xml");
  });

  it("creates the correct blob type and a filesystem-safe filename", () => {
    const blob = createStudioPitchPptxBlob({ title: "Pitch", slides: [{ title: "A", body: "B" }] });
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(blob.size).toBeGreaterThan(1_000);
    expect(studioPitchPptxFileName('  나의:작품/피치?  ')).toBe("나의-작품-피치-.pptx");
  });
});
