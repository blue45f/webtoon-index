import { describe, it, expect } from "vitest";

import {
  STUDIO_STANDARD_FONT_NAMES,
  buildCidWidthArray,
  encodeIdentityHText,
  estimateSubsetSaving,
  evaluatePdfFontEmbedding,
  fontDescriptorFlags,
  glyphWidthToPdf,
  parseSfntEmbeddingPolicy,
  planFontSubset,
  readSfntMetrics,
  resolveStandardFontFallback,
  textNeedsEmbeddedFont,
  type StudioSfntMetrics,
} from "./studio-canvaskit-pdf-font";

// ---------------------------------------------------------------------------
// 합성 sfnt 픽스처 — head/hhea/maxp/hmtx/cmap(format 4)만 가진 최소 TrueType.
// 글리프 아웃라인(glyf/loca)은 넣지 않는다. 이 모듈이 읽지 않기 때문이다.
// ---------------------------------------------------------------------------

interface SyntheticFontOptions {
  unitsPerEm?: number;
  numGlyphs?: number;
  numberOfHMetrics?: number;
  advances?: number[];
  /** [startCode, endCode, startGlyph] 세그먼트. */
  segments?: [number, number, number][];
  version?: number;
  tag?: string;
  /** null/undefined면 OS/2 테이블 자체를 넣지 않는다. */
  fsType?: number | null;
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function buildCmapFormat4(segments: [number, number, number][]): number[] {
  // 종결 세그먼트(0xFFFF)는 스펙 필수다.
  const all: [number, number, number][] = [...segments, [0xffff, 0xffff, 1]];
  const segCount = all.length;
  const body: number[] = [];
  body.push(...be16(4)); // format
  const lengthIndex = body.length;
  body.push(...be16(0)); // length placeholder
  body.push(...be16(0)); // language
  body.push(...be16(segCount * 2));
  body.push(...be16(0), ...be16(0), ...be16(0)); // searchRange/entrySelector/rangeShift (파서가 안 쓴다)
  for (const [, end] of all) body.push(...be16(end));
  body.push(...be16(0)); // reservedPad
  for (const [start] of all) body.push(...be16(start));
  for (const [start, , startGlyph] of all) body.push(...be16((startGlyph - start) & 0xffff)); // idDelta
  for (let i = 0; i < segCount; i++) body.push(...be16(0)); // idRangeOffset
  const length = body.length;
  body[lengthIndex] = (length >> 8) & 0xff;
  body[lengthIndex + 1] = length & 0xff;

  const table: number[] = [];
  table.push(...be16(0)); // version
  table.push(...be16(1)); // numTables
  table.push(...be16(3), ...be16(1), ...be32(12)); // (3,1) BMP, offset 12
  table.push(...body);
  return table;
}

function buildSyntheticFont(options: SyntheticFontOptions = {}): Uint8Array {
  const unitsPerEm = options.unitsPerEm ?? 1000;
  const numGlyphs = options.numGlyphs ?? 7;
  const advances = options.advances ?? [500, 600, 650, 700, 1000, 1000, 1000];
  const numberOfHMetrics = options.numberOfHMetrics ?? 5;
  const segments = options.segments ?? [
    [0x41, 0x43, 1], // A B C → 1 2 3
    [0xac00, 0xac02, 4], // 가 각 갂 → 4 5 6
  ];

  const head: number[] = new Array<number>(54).fill(0);
  head.splice(18, 2, ...be16(unitsPerEm));
  head.splice(36, 2, ...be16(0)); // xMin 0
  head.splice(38, 2, ...be16(0xff38)); // yMin -200
  head.splice(40, 2, ...be16(1000)); // xMax
  head.splice(42, 2, ...be16(800)); // yMax

  const hhea: number[] = new Array<number>(36).fill(0);
  hhea.splice(4, 2, ...be16(800)); // ascender
  hhea.splice(6, 2, ...be16(0xff38)); // descender -200
  hhea.splice(34, 2, ...be16(numberOfHMetrics));

  const maxp: number[] = new Array<number>(6).fill(0);
  maxp.splice(4, 2, ...be16(numGlyphs));

  const hmtx: number[] = [];
  for (let i = 0; i < numberOfHMetrics; i++) hmtx.push(...be16(advances[i] ?? 0), ...be16(0));
  for (let i = numberOfHMetrics; i < numGlyphs; i++) hmtx.push(...be16(0));

  const os2: number[] | null =
    options.fsType === null || options.fsType === undefined ? null : new Array<number>(10).fill(0);
  if (os2) os2.splice(8, 2, ...be16(options.fsType!));

  const tables: { tag: string; data: number[] }[] = [
    { tag: "cmap", data: buildCmapFormat4(segments) },
    { tag: "head", data: head },
    { tag: "hhea", data: hhea },
    { tag: "hmtx", data: hmtx },
    { tag: "maxp", data: maxp },
  ];
  if (os2) tables.push({ tag: "OS/2", data: os2 });

  const out: number[] = [];
  out.push(...be32(options.version ?? 0x00010000));
  if (options.tag) {
    out.length = 0;
    for (const char of options.tag) out.push(char.charCodeAt(0));
  }
  out.push(...be16(tables.length), ...be16(0), ...be16(0), ...be16(0));
  let dataOffset = 12 + tables.length * 16;
  const records: number[] = [];
  const payload: number[] = [];
  for (const table of tables) {
    for (const char of table.tag) records.push(char.charCodeAt(0));
    records.push(...be32(0)); // checksum(파서가 검증하지 않는다)
    records.push(...be32(dataOffset));
    records.push(...be32(table.data.length));
    payload.push(...table.data);
    dataOffset += table.data.length;
  }
  return Uint8Array.from([...out, ...records, ...payload]);
}

function metricsOf(bytes: Uint8Array): StudioSfntMetrics {
  const result = readSfntMetrics(bytes);
  if (!result.ok) throw new Error(`예상과 달리 글꼴 읽기 실패: ${result.error}`);
  return result.metrics;
}

// ---------------------------------------------------------------------------

describe("sfnt 메트릭 읽기", () => {
  it("합성 글꼴의 head/hhea/maxp 값을 그대로 읽는다", () => {
    const metrics = metricsOf(buildSyntheticFont());
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.numGlyphs).toBe(7);
    expect(metrics.ascender).toBe(800);
    expect(metrics.descender).toBe(-200);
    expect(metrics.bbox).toEqual([0, -200, 1000, 800]);
    expect(metrics.hasCffOutlines).toBe(false);
  });

  it("hmtx의 마지막 전진폭이 남은 글리프에 반복 적용된다(스펙 규정)", () => {
    const metrics = metricsOf(buildSyntheticFont());
    expect(metrics.advanceWidths).toEqual([500, 600, 650, 700, 1000, 1000, 1000]);
  });

  it("cmap format 4를 idDelta 방식으로 해석한다(라틴·한글 양쪽)", () => {
    const metrics = metricsOf(buildSyntheticFont());
    expect(metrics.cmap.get(0x41)).toBe(1);
    expect(metrics.cmap.get(0x43)).toBe(3);
    expect(metrics.cmap.get(0xac00)).toBe(4);
    expect(metrics.cmap.get(0xac02)).toBe(6);
    expect(metrics.cmap.get(0x5a)).toBeUndefined();
  });

  it("unitsPerEm이 2048인 글꼴도 1000 단위 PDF 폭으로 정규화된다", () => {
    const metrics = metricsOf(buildSyntheticFont({ unitsPerEm: 2048, advances: [1024, 2048, 512, 0, 0] }));
    expect(glyphWidthToPdf(metrics, 0)).toBe(500);
    expect(glyphWidthToPdf(metrics, 1)).toBe(1000);
    expect(glyphWidthToPdf(metrics, 2)).toBe(250);
  });

  it("WOFF/WOFF2/TTC는 명확한 사유로 거절한다(조용한 오작동 금지)", () => {
    for (const [tag, expected] of [
      ["wOFF", "WOFF"],
      ["wOF2", "WOFF"],
      ["ttcf", "TTC"],
    ] as const) {
      const result = readSfntMetrics(buildSyntheticFont({ tag }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(expected);
    }
  });

  it("잘린 파일·위조된 테이블 개수는 예외 없이 실패를 돌려준다", () => {
    expect(readSfntMetrics(new Uint8Array(6)).ok).toBe(false);
    const font = buildSyntheticFont();
    expect(readSfntMetrics(font.subarray(0, 40)).ok).toBe(false);
    const forged = font.slice();
    forged[4] = 0xff;
    forged[5] = 0xff;
    const result = readSfntMetrics(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("테이블 목록");
  });

  it("테이블 오프셋이 파일 밖을 가리키면 거절한다", () => {
    const font = buildSyntheticFont();
    // 첫 테이블 레코드의 offset(12+8)을 파일 끝 너머로 위조.
    new DataView(font.buffer).setUint32(12 + 8, font.byteLength + 100);
    const result = readSfntMetrics(font);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("파일 끝을 넘어갑니다");
  });

  it("unitsPerEm 0은 거절한다(0으로 나누기 방지)", () => {
    const result = readSfntMetrics(buildSyntheticFont({ unitsPerEm: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unitsPerEm");
  });

  it("hmtx 메트릭 개수가 글리프 수보다 크면 거절한다", () => {
    const result = readSfntMetrics(buildSyntheticFont({ numGlyphs: 3, numberOfHMetrics: 9 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("hmtx");
  });

  it("OS/2.fsType의 기본 권한과 독립 제한 비트를 읽는다", () => {
    const installable = metricsOf(buildSyntheticFont({ fsType: 0 })).embeddingPolicy;
    expect(installable).toMatchObject({
      fsType: 0,
      permission: "installable",
      noSubsetting: false,
      bitmapOnly: false,
      valid: true,
    });

    const previewNoSubset = metricsOf(buildSyntheticFont({ fsType: 0x0104 })).embeddingPolicy;
    expect(previewNoSubset).toMatchObject({
      fsType: 0x0104,
      permission: "preview-print",
      noSubsetting: true,
      bitmapOnly: false,
      valid: true,
    });

    const editableBitmap = metricsOf(buildSyntheticFont({ fsType: 0x0208 })).embeddingPolicy;
    expect(editableBitmap).toMatchObject({
      fsType: 0x0208,
      permission: "editable",
      noSubsetting: false,
      bitmapOnly: true,
      valid: true,
    });
  });

  it("OS/2 테이블이 없거나 fsType 권한 비트가 모순되면 정책을 fail-closed로 표시한다", () => {
    expect(metricsOf(buildSyntheticFont()).embeddingPolicy).toMatchObject({
      fsType: null,
      permission: "unknown",
      valid: false,
    });
    expect(metricsOf(buildSyntheticFont({ fsType: 0x000c })).embeddingPolicy).toMatchObject({
      fsType: 0x000c,
      permission: "invalid",
      valid: false,
    });
    expect(metricsOf(buildSyntheticFont({ fsType: 0x0010 })).embeddingPolicy).toMatchObject({
      fsType: 0x0010,
      permission: "invalid",
      valid: false,
    });
  });
});

describe("OS/2.fsType PDF 임베딩 정책", () => {
  const request = {
    documentIntent: "editable" as const,
    embeddingMode: "full" as const,
    payloadKind: "outline" as const,
  };

  it("Installable은 읽기 전용·편집 문서 모두, Editable은 편집 문서를 허용한다", () => {
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(0), request).allowed).toBe(true);
    expect(
      evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(8), {
        ...request,
        documentIntent: "preview-print",
      }).allowed,
    ).toBe(true);
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(8), request).allowed).toBe(true);
  });

  it("Restricted는 모든 임베딩을 거절하고 Preview & Print는 편집 문서를 거절한다", () => {
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(2), request)).toMatchObject({
      allowed: false,
      code: "restricted-license",
    });
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(4), request)).toMatchObject({
      allowed: false,
      code: "preview-print-only",
    });
    expect(
      evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(4), {
        ...request,
        documentIntent: "preview-print",
      }).allowed,
    ).toBe(true);
  });

  it("No Subsetting은 전체 임베드는 허용하고 서브셋만 거절한다", () => {
    const policy = parseSfntEmbeddingPolicy(0x0108);
    expect(evaluatePdfFontEmbedding(policy, request).allowed).toBe(true);
    expect(
      evaluatePdfFontEmbedding(policy, {
        ...request,
        embeddingMode: "subset",
      }),
    ).toMatchObject({ allowed: false, code: "no-subsetting" });
  });

  it("Bitmap-only는 비트맵 페이로드만 허용하고 아웃라인 임베딩을 거절한다", () => {
    const policy = parseSfntEmbeddingPolicy(0x0208);
    expect(evaluatePdfFontEmbedding(policy, request)).toMatchObject({
      allowed: false,
      code: "bitmap-only",
    });
    expect(
      evaluatePdfFontEmbedding(policy, {
        ...request,
        payloadKind: "bitmap",
      }).allowed,
    ).toBe(true);
  });

  it("문서 의도 누락·fsType 누락·예약 비트는 추측하지 않고 거절한다", () => {
    expect(
      evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(0), {
        embeddingMode: "full",
        payloadKind: "outline",
      }),
    ).toMatchObject({ allowed: false, code: "missing-document-intent" });
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(null), request)).toMatchObject({
      allowed: false,
      code: "unknown-license",
    });
    expect(evaluatePdfFontEmbedding(parseSfntEmbeddingPolicy(0x0010), request)).toMatchObject({
      allowed: false,
      code: "invalid-fstype",
    });
  });
});

describe("서브셋 계획", () => {
  const metrics = metricsOf(buildSyntheticFont());

  it("쓰인 코드포인트와 글리프를 정렬해 집계한다(결정적)", () => {
    const plan = planFontSubset(metrics, ["가각", "AB", "가"]);
    expect(plan.codepoints).toEqual([0x41, 0x42, 0xac00, 0xac01]);
    expect(plan.glyphIds).toEqual([0, 1, 2, 4, 5]);
    expect(plan.missing).toEqual([]);
    expect(plan.coverage).toBeCloseTo(5 / 7, 10);
    expect(plan.summary).toContain("글자 4종");
  });

  it("글꼴에 없는 글자를 숨기지 않고 보고한다", () => {
    const plan = planFontSubset(metrics, ["A한글Z"]);
    // 코드포인트 오름차순: Z(0x5A) < 글(0xAE00) < 한(0xD55C).
    expect(plan.missing).toEqual([0x5a, 0xae00, 0xd55c]);
    expect(plan.summary).toContain("빈 글자로 나옵니다");
  });

  it("서로게이트 쌍을 하나의 코드포인트로 센다", () => {
    const plan = planFontSubset(metrics, ["\u{1F600}"]);
    expect(plan.codepoints).toEqual([0x1f600]);
    expect(plan.missing).toEqual([0x1f600]);
  });

  it(".notdef(0)은 항상 포함된다", () => {
    expect(planFontSubset(metrics, [""]).glyphIds).toEqual([0]);
  });

  it("절감 추정치는 커버리지에 단조 증가하고 항상 추정임을 밝힌다", () => {
    const small = estimateSubsetSaving(planFontSubset(metrics, ["A"]), 1_000_000);
    const large = estimateSubsetSaving(planFontSubset(metrics, ["ABC가각갂"]), 1_000_000);
    expect(small.estimatedBytes).toBeLessThan(large.estimatedBytes);
    expect(small.savedRatio).toBeGreaterThan(0);
    expect(small.note).toContain("추정치");
  });
});

describe("표준 14 폴백", () => {
  it("family 문자열에서 굵기·기울임·세리프·고정폭을 읽어 매핑한다", () => {
    expect(resolveStandardFontFallback("Helvetica Neue")).toBe("Helvetica");
    expect(resolveStandardFontFallback("Arial", true)).toBe("Helvetica-Bold");
    expect(resolveStandardFontFallback("Georgia, serif", false, true)).toBe("Times-Italic");
    expect(resolveStandardFontFallback("ui-monospace, SFMono", true)).toBe("Courier-Bold");
    // "sans-serif"는 세리프가 아니다 — 문자열 포함 검사의 흔한 함정.
    expect(resolveStandardFontFallback("sans-serif")).toBe("Helvetica");
  });

  it("모든 표준 14 이름이 목록에 있다", () => {
    expect(new Set(STUDIO_STANDARD_FONT_NAMES).size).toBe(STUDIO_STANDARD_FONT_NAMES.length);
    expect(STUDIO_STANDARD_FONT_NAMES).toContain("Helvetica");
    expect(STUDIO_STANDARD_FONT_NAMES).toContain("ZapfDingbats");
  });

  it("한글이 섞이면 임베드가 필요하다고 알린다", () => {
    expect(textNeedsEmbeddedFont("Hello")).toBe(false);
    expect(textNeedsEmbeddedFont("café")).toBe(false);
    expect(textNeedsEmbeddedFont("안녕")).toBe(true);
    expect(textNeedsEmbeddedFont("mix 섞임")).toBe(true);
    expect(textNeedsEmbeddedFont("\u{1F600}")).toBe(true);
  });
});

describe("CID 임베드 보조", () => {
  const metrics = metricsOf(buildSyntheticFont());

  it("Identity-H 인코딩은 글리프 인덱스를 4자리 hex로 낸다", () => {
    expect(encodeIdentityHText(metrics, "AB")).toBe("00010002");
    expect(encodeIdentityHText(metrics, "가")).toBe("0004");
    // 글꼴에 없는 글자는 .notdef(0).
    expect(encodeIdentityHText(metrics, "Z")).toBe("0000");
  });

  it("/W 배열은 연속 글리프를 한 묶음으로 합친다", () => {
    const resource = {
      kind: "truetype-cid" as const,
      resourceName: "F0",
      baseFont: "Test",
      fontBytes: new Uint8Array(0),
      metrics,
      usedGlyphIds: [1, 2, 3, 6],
    };
    expect(buildCidWidthArray(resource)).toBe("[1 [600 650 700] 6 [1000]]");
  });

  it("/W 배열은 정렬되지 않은 중복 입력에도 결정적이다", () => {
    const base = {
      kind: "truetype-cid" as const,
      resourceName: "F0",
      baseFont: "Test",
      fontBytes: new Uint8Array(0),
      metrics,
    };
    expect(buildCidWidthArray({ ...base, usedGlyphIds: [3, 1, 2, 1] })).toBe(
      buildCidWidthArray({ ...base, usedGlyphIds: [1, 2, 3] }),
    );
    expect(buildCidWidthArray({ ...base, usedGlyphIds: [] })).toBe("[]");
  });

  it("FontDescriptor 플래그 비트가 규격대로 조합된다", () => {
    expect(fontDescriptorFlags({})).toBe(32);
    expect(fontDescriptorFlags({ symbolic: true })).toBe(4);
    expect(fontDescriptorFlags({ serif: true, italic: true })).toBe(2 | 32 | 64);
    expect(fontDescriptorFlags({ fixedPitch: true })).toBe(1 | 32);
  });
});
