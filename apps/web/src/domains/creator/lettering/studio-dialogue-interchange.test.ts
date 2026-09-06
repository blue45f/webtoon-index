import { describe, expect, it } from "vitest";

import {
  applyStudioDialogueInterchangeToPages,
  decodeStudioDialogueInterchangeText,
  parseStudioDialogueInterchange,
  serializeStudioDialogueInterchange,
  StudioDialogueInterchangeError,
  studioDialogueItemsToInterchange,
} from "./studio-dialogue-interchange";

const document = {
  title: "첫 화",
  language: "ko-KR",
  cues: [
    { id: "a", page: 1, panel: 1, speaker: "하나", text: "안녕,\n세계", note: "작게", startMs: 100, endMs: 2200 },
    { id: "b", page: 2, panel: 3, speaker: "둘", text: "=위험한 수식", startMs: 2500, endMs: 5000 },
  ],
} as const;

describe("studio dialogue interchange", () => {
  it("JSON은 메타데이터와 대사를 손실 없이 왕복한다", () => {
    const file = serializeStudioDialogueInterchange("json", document);
    expect(file.extension).toBe(".json");
    expect(file.lossy).toBe(false);
    expect(parseStudioDialogueInterchange("json", file.text).document).toEqual(document);
  });

  it.each(["csv", "tsv"] as const)("%s는 인용부호·개행·수식 시작 문자를 안전하게 직렬화한다", (format) => {
    const file = serializeStudioDialogueInterchange(format, document);
    expect(file.text).toContain("안녕");
    expect(file.text).toContain("'=위험한 수식");
    const parsed = parseStudioDialogueInterchange(format, file.text);
    expect(parsed.document.cues).toHaveLength(2);
    expect(parsed.document.cues[0]?.text).toBe("안녕,\n세계");
    // Spreadsheet formula hardening is intentionally visible and reversible by a user.
    expect(parsed.document.cues[1]?.text).toBe("'=위험한 수식");
  });

  it("한국어 CSV 헤더도 가져온다", () => {
    const parsed = parseStudioDialogueInterchange("csv", "페이지,컷,화자,대사\r\n1,2,주인공,도착했어\r\n");
    expect(parsed.document.cues).toEqual([{ page: 1, panel: 2, speaker: "주인공", text: "도착했어" }]);
  });

  it("TXT와 Markdown의 페이지·컷·화자 문법을 가져온다", () => {
    const source = "@페이지 2\n@컷 4\n하나: 첫 줄\n둘: 둘째 줄\n";
    expect(parseStudioDialogueInterchange("txt", source).document.cues).toEqual([
      { page: 2, panel: 4, speaker: "하나", text: "첫 줄" },
      { page: 2, panel: 4, speaker: "둘", text: "둘째 줄" },
    ]);
    const md = serializeStudioDialogueInterchange("markdown", document);
    expect(md.extension).toBe(".md");
    expect(parseStudioDialogueInterchange("markdown", md.text).document.cues).toHaveLength(2);
  });

  it("Fountain 페이지·패널 주석과 강제 character cue를 왕복한다", () => {
    const file = serializeStudioDialogueInterchange("fountain", document);
    expect(file.text).toContain("# PAGE 1");
    expect(file.text).toContain("[[PANEL 3]]");
    const parsed = parseStudioDialogueInterchange("fountain", file.text);
    expect(parsed.lossy).toBe(true);
    expect(parsed.document.cues.map(({ page, panel, speaker, text }) => ({ page, panel, speaker, text }))).toEqual([
      { page: 1, panel: 1, speaker: "하나", text: "안녕,\n세계" },
      { page: 2, panel: 3, speaker: "둘", text: "=위험한 수식" },
    ]);
  });

  it("FDX 핵심 Paragraph를 장면=페이지, Action=컷, 화자·괄호·대사 cue로 결정 매핑한다", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. 교실 - 낮</Text></Paragraph>
    <Paragraph Type="Action"><Text>비가 창문을 두드린다.</Text></Paragraph>
    <Paragraph Type="Character"><Text>하나</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(작게)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text Style="Bold">안녕 &amp; </Text><Text>세계</Text></Paragraph>
    <Paragraph Type="Action"><Text>문이 열린다.</Text></Paragraph>
    <Paragraph Type="Character"><Text>둘</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text><![CDATA[늦어서 미안해.]]></Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>EXT. 운동장 - 밤</Text></Paragraph>
    <Paragraph Type="Character"><Text>하나</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>기다렸어.</Text></Paragraph>
  </Content>
</FinalDraft>`;
    const parsed = parseStudioDialogueInterchange("fdx", source);
    expect(parsed.document.cues).toEqual([
      {
        page: 1,
        panel: 1,
        speaker: "하나",
        text: "안녕 & 세계",
        note: "(작게)",
      },
      {
        page: 1,
        panel: 2,
        speaker: "둘",
        text: "늦어서 미안해.",
      },
      {
        page: 2,
        panel: 1,
        speaker: "하나",
        text: "기다렸어.",
      },
    ]);
    expect(parsed).toMatchObject({
      lossy: true,
      lossPreview: {
        sourceFormat: "fdx",
        sourceParagraphs: 12,
        emittedCues: 3,
        mappedElements: 7,
        contextOnlyElements: 4,
        droppedElements: 1,
        truncated: false,
      },
    });
    expect(parsed.lossPreview?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "Scene Heading",
        disposition: "context-only",
        page: 1,
      }),
      expect.objectContaining({
        sourceType: "Parenthetical",
        disposition: "mapped",
        cueIndex: 0,
      }),
      expect.objectContaining({
        sourceType: "Transition",
        disposition: "dropped",
      }),
    ]));
  });

  it("FDX 안전 부분집합은 페이지·컷 marker와 XML 문자를 결정적으로 왕복한다", () => {
    const file = serializeStudioDialogueInterchange("fdx", document);
    expect(file).toMatchObject({
      extension: ".fdx",
      mimeType: "application/xml;charset=utf-8",
      lossy: true,
    });
    expect(file.text).toContain('<Paragraph Type="Scene Heading"><Text>TOONSPECTRUM PAGE 1</Text>');
    expect(file.text).toContain('<Paragraph Type="Action"><Text>TOONSPECTRUM PANEL 3</Text>');
    expect(file.text).toContain("안녕,\n세계");
    const escaped = serializeStudioDialogueInterchange("fdx", {
      cues: [{ page: 1, panel: 1, speaker: "A&B", text: '<위험> "확인"' }],
    });
    expect(escaped.text).toContain("A&amp;B");
    expect(escaped.text).toContain("&lt;위험&gt; &quot;확인&quot;");

    const parsed = parseStudioDialogueInterchange("fdx", file.text);
    expect(parsed.document.cues).toEqual([
      { page: 1, panel: 1, speaker: "하나", text: "안녕,\n세계", note: "작게" },
      { page: 2, panel: 3, speaker: "둘", text: "=위험한 수식" },
    ]);
    expect(file.warnings.join(" ")).toContain("cue ID");
  });

  it("FDX는 알 수 없는 확장 subtree 안의 지원 모양 Paragraph를 해석하지 않는다", () => {
    const source = `<FinalDraft DocumentType="Script"><Content>
      <Extension><Paragraph Type="Character"><Text>가짜</Text></Paragraph><Paragraph Type="Dialogue"><Text>무시</Text></Paragraph></Extension>
      <Paragraph Type="Character"><Text>진짜</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>대사</Text></Paragraph>
    </Content></FinalDraft>`;
    expect(parseStudioDialogueInterchange("fdx", source).document.cues).toEqual([
      { page: 1, panel: 1, speaker: "진짜", text: "대사" },
    ]);
  });

  it("FDX는 DTD/entity, 잘못된 구조와 XML DoS 예산 초과를 fail-closed한다", () => {
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      '<!DOCTYPE FinalDraft [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><FinalDraft><Content><Paragraph Type="Character"><Text>&xxe;</Text></Paragraph></Content></FinalDraft>'
    )).toThrow(/DTD/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      '<FinalDraft><Content><Paragraph Type="Character"><Text>A</Paragraph></Text></Content></FinalDraft>'
    )).toThrow(/닫는 순서/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      `<FinalDraft><Content><Extension>${"<x>".repeat(31)}${"</x>".repeat(31)}</Extension><Paragraph Type="Character"><Text>A</Text></Paragraph><Paragraph Type="Dialogue"><Text>B</Text></Paragraph></Content></FinalDraft>`
    )).toThrow(/중첩 깊이/u);
    const attributes = Array.from({ length: 32 }, (_, index) => ` a${index}="${index}"`).join("");
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      `<FinalDraft><Content><Paragraph Type="Character"${attributes}><Text>A</Text></Paragraph><Paragraph Type="Dialogue"><Text>B</Text></Paragraph></Content></FinalDraft>`
    )).toThrow(/attribute 수/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      '<FinalDraft bad="raw<value"><Content><Paragraph Type="Character"><Text>A</Text></Paragraph><Paragraph Type="Dialogue"><Text>B</Text></Paragraph></Content></FinalDraft>'
    )).toThrow(/raw '<'/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      "<FinalDraft><Content><Paragraph Type=\"Character\"><Text>A]]>B</Text></Paragraph><Paragraph Type=\"Dialogue\"><Text>C</Text></Paragraph></Content></FinalDraft>"
    )).toThrow(/CDATA 종료/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      'prefix<FinalDraft><Content><Paragraph Type="Character"><Text>A</Text></Paragraph><Paragraph Type="Dialogue"><Text>B</Text></Paragraph></Content></FinalDraft>'
    )).toThrow(/루트 앞/u);
  });

  it("FDX는 Parenthetical/Dialogue 순서와 화자·메모 길이를 엄격하게 검증한다", () => {
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      '<FinalDraft><Content><Paragraph Type="Parenthetical"><Text>(혼잣말)</Text></Paragraph><Paragraph Type="Dialogue"><Text>안녕</Text></Paragraph></Content></FinalDraft>'
    )).toThrow(/Character/u);
    expect(() => parseStudioDialogueInterchange(
      "fdx",
      `<FinalDraft><Content><Paragraph Type="Character"><Text>${"가".repeat(201)}</Text></Paragraph><Paragraph Type="Dialogue"><Text>안녕</Text></Paragraph></Content></FinalDraft>`
    )).toThrow(/화자 길이/u);
  });

  it.each(["srt", "vtt"] as const)("%s는 타임코드와 화자를 왕복한다", (format) => {
    const file = serializeStudioDialogueInterchange(format, document);
    const parsed = parseStudioDialogueInterchange(format, file.text);
    expect(parsed.document.cues[0]).toMatchObject({
      page: 1,
      speaker: "하나",
      text: "안녕,\n세계",
      startMs: 100,
      endMs: 2200,
    });
    expect(parsed.lossy).toBe(true);
  });

  it("시간이 없으면 자막에 결정적인 3초 구간을 배정하고 경고한다", () => {
    const file = serializeStudioDialogueInterchange("vtt", { cues: [{ page: 1, text: "안녕" }] });
    expect(file.text).toContain("00:00:00.000 --> 00:00:03.000");
    expect(file.warnings.join(" ")).toContain("자동 배정");
  });

  it("UTF-8 BOM을 제거하고 잘못된 UTF-8은 거부한다", () => {
    expect(decodeStudioDialogueInterchangeText(new TextEncoder().encode("\uFEFF안녕"))).toBe("안녕");
    expect(() => decodeStudioDialogueInterchangeText(new Uint8Array([0xc3, 0x28]))).toThrowError(
      StudioDialogueInterchangeError
    );
  });

  it("CSV 미닫힌 quote, JSON 알 수 없는 cue 필드와 뒤집힌 시간은 fail-closed한다", () => {
    expect(() => parseStudioDialogueInterchange("csv", 'page,text\n1,"열림')).toThrow(/따옴표/u);
    expect(() => parseStudioDialogueInterchange("json", JSON.stringify({
      schema: "toonspectrum.dialogue-script",
      version: 1,
      cues: [{ page: 1, text: "x", javascript: "alert(1)" }],
    }))).toThrow(/알 수 없는 필드/u);
    expect(() => serializeStudioDialogueInterchange("json", {
      cues: [{ page: 1, text: "x", startMs: 20, endMs: 10 }],
    })).toThrow(/시간 범위/u);
  });

  it("기존 dialogue batch items를 1-based 페이지/컷 cue로 바꾼다", () => {
    expect(studioDialogueItemsToInterchange([
      { id: "a", pageId: "p1", pageIndex: 0, elType: "bubble", text: "A", hidden: false, locked: false },
      { id: "b", pageId: "p1", pageIndex: 0, elType: "text", text: "B", hidden: true, locked: false },
      { id: "c", pageId: "p2", pageIndex: 1, elType: "bubble", text: "C", hidden: false, locked: true },
    ], { title: "작품" })).toEqual({
      title: "작품",
      cues: [
        { id: "a", page: 1, panel: 1, text: "A" },
        { id: "b", page: 1, panel: 2, text: "B", note: "hidden" },
        { id: "c", page: 2, panel: 1, text: "C", note: "locked" },
      ],
    });
  });

  it("가져온 번역은 id → 페이지 순서 → 문서 순서로 기존 대사에만 비파괴 적용한다", () => {
    const pages = [
      {
        id: "p1",
        elements: [
          { id: "a", type: "bubble", text: "A", x: 0, y: 0 },
          { id: "b", type: "text", text: "B", x: 0, y: 100, locked: true },
        ],
      },
      { id: "p2", elements: [{ id: "c", type: "bubble", text: "C", x: 0, y: 0 }] },
    ];
    const result = applyStudioDialogueInterchangeToPages(pages, {
      cues: [
        { id: "c", page: 99, text: "C-id", speaker: "화자" },
        { page: 1, panel: 2, text: "B-locked" },
        { page: 9, text: "missing" },
      ],
    });
    expect(result).toMatchObject({ matched: 2, changed: 1, locked: 1, missing: 1, droppedMetadata: 1 });
    expect(result.pages[1]?.elements[0]?.text).toBe("C-id");
    expect(result.pages[0]?.elements[1]?.text).toBe("B");
    expect(pages[1]?.elements[0]?.text).toBe("C");
  });

  it("id-only 모드는 id 없는 cue를 추측 적용하지 않고 무변경 참조를 보존한다", () => {
    const pages = [{ id: "p", elements: [{ id: "a", type: "bubble", text: "A" }] }];
    const result = applyStudioDialogueInterchangeToPages(pages, {
      cues: [{ page: 1, panel: 1, text: "B" }],
    }, "id");
    expect(result.pages).toBe(pages);
    expect(result).toMatchObject({ matched: 0, changed: 0, missing: 1 });
  });
});
