/**
 * Studio PDF Reader — 우리가 쓴 PDF 를 **되읽어 검증**하는 최소 파서(순수·DOM 무의존).
 *
 * 왜 만드는가: "PDF 를 만들었다" 는 주장은 바이트를 다시 파싱해 구조가 성립할 때만 참이다.
 * 이 리더는 `studio-canvaskit-pdf-vector.ts` 의 출력을 xref 오프셋부터 페이지 트리까지 실제로
 * 따라가 확인한다 — 테스트의 왕복 검증이 1차 용도고, 2차로는 사용자가 올린 PDF 의 페이지 수·
 * 페이지 크기·색공간 사용 여부를 미리 알려주는 사전검사에 쓴다.
 *
 * ── 범위(정직하게 좁다) ─────────────────────────────────────────────────────
 *  ✅ 클래식 xref **테이블**(`xref` … `trailer`), 다중 서브섹션
 *  ✅ 오브젝트 오프셋 검증(`N 0 obj` 가 실제로 그 자리에 있는가)
 *  ✅ 딕셔너리 중첩·리터럴/hex 문자열을 건너뛰는 균형 스캐너
 *  ✅ 페이지 트리 순회(중첩 /Pages 노드 포함, 순환 방지)
 *  ✅ 스트림 바이트 추출(/Length 기준)
 *  ❌ **xref 스트림**(PDF 1.5+ 압축 xref)·오브젝트 스트림·암호화·증분 갱신(`/Prev` 체인)
 *     → 우리 라이터는 이들을 만들지 않는다. 외부 PDF 를 먹이면 `ok:false` 로 정직하게 거절한다.
 *  ❌ FlateDecode 해제 — 우리 라이터가 압축하지 않으므로 필요 없다. 압축된 스트림을 만나면
 *     바이트를 그대로 돌려주고 `filters` 에 필터 이름을 남긴다(호출부가 판단).
 *
 * 전부 순수·결정적. 손상 입력은 예외 대신 `{ ok:false, error }`(한국어).
 */

export interface StudioPdfReadPage {
  objectNumber: number;
  /** [x0 y0 x1 y1] pt. */
  mediaBox: readonly number[];
  trimBox: readonly number[] | null;
  bleedBox: readonly number[] | null;
  /** 페이지 딕셔너리 원문(리소스 확인용). */
  dict: string;
  /** 콘텐츠 스트림을 latin1 문자열로 디코드한 것(연산자 검사용). */
  content: string;
}

export interface StudioPdfReadDocument {
  version: string;
  /** trailer 의 /Size. */
  size: number;
  /** startxref 가 가리킨 바이트 오프셋. */
  xrefOffset: number;
  trailer: string;
  catalog: string;
  info: string;
  pages: readonly StudioPdfReadPage[];
  /** 오브젝트 번호 → 파일 내 바이트 오프셋. */
  objectOffsets: ReadonlyMap<number, number>;
  /** 오브젝트 번호 → 본문(딕셔너리/값 원문). 스트림 데이터는 포함하지 않는다. */
  objectBodies: ReadonlyMap<number, string>;
  /** 오브젝트 번호 → 스트림 원시 바이트. */
  streams: ReadonlyMap<number, Uint8Array>;
}

export type StudioPdfReadResult = { ok: true; document: StudioPdfReadDocument } | { ok: false; error: string };

class PdfReadError extends Error {}

function readFail(message: string): never {
  throw new PdfReadError(message);
}

/** 바이트↔문자 1:1 — 문자열 인덱스가 곧 바이트 오프셋이 된다. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return out;
}

export function readPdf(input: Uint8Array | ArrayBuffer): StudioPdfReadResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    return { ok: true, document: parse(bytes) };
  } catch (error) {
    if (error instanceof PdfReadError) return { ok: false, error: error.message };
    return { ok: false, error: "PDF를 읽지 못했어요. 파일이 손상됐을 수 있습니다." };
  }
}

function parse(bytes: Uint8Array): StudioPdfReadDocument {
  const text = latin1(bytes);
  const versionMatch = /^%PDF-(\d+\.\d+)/u.exec(text);
  if (!versionMatch) readFail("PDF 파일이 아니에요(%PDF 헤더가 없습니다).");
  const version = versionMatch[1]!;

  const startIndex = text.lastIndexOf("startxref");
  if (startIndex < 0) readFail("PDF에 startxref가 없어요.");
  const startMatch = /startxref\s+(\d+)/u.exec(text.slice(startIndex));
  if (!startMatch) readFail("PDF의 startxref 값을 읽지 못했어요.");
  const xrefOffset = Number(startMatch[1]);
  if (xrefOffset <= 0 || xrefOffset >= text.length) readFail("PDF의 startxref가 파일 범위를 벗어나요.");
  if (!text.startsWith("xref", xrefOffset)) {
    readFail("이 PDF는 xref 스트림(PDF 1.5+)을 써서 이 리더가 다루지 않아요.");
  }

  const objectOffsets = new Map<number, number>();
  let cursor = xrefOffset + 4;
  // 서브섹션: "<start> <count>" 다음에 20바이트 항목이 count 개.
  for (;;) {
    const header = /^\s*(\d+)\s+(\d+)\s*/u.exec(text.slice(cursor, cursor + 64));
    if (!header) break;
    const start = Number(header[1]);
    const count = Number(header[2]);
    cursor += header[0].length;
    if (count < 0 || cursor + count * 20 > text.length) readFail("PDF xref 표가 파일 끝을 넘어갑니다.");
    for (let i = 0; i < count; i++) {
      const entry = text.slice(cursor, cursor + 20);
      cursor += 20;
      const entryMatch = /^(\d{10}) (\d{5}) ([nf])/u.exec(entry);
      if (!entryMatch) readFail(`PDF xref 항목 형식이 잘못됐어요(오브젝트 ${start + i}).`);
      if (entryMatch[3] === "n") objectOffsets.set(start + i, Number(entryMatch[1]));
    }
    if (/^\s*trailer/u.test(text.slice(cursor, cursor + 32))) break;
  }

  const trailerIndex = text.indexOf("trailer", cursor - 1);
  if (trailerIndex < 0) readFail("PDF에 trailer가 없어요.");
  const trailer = readDictAt(text, text.indexOf("<<", trailerIndex));
  const size = dictNumber(trailer, "Size");
  if (size === null) readFail("PDF trailer에 /Size가 없어요.");

  // 오브젝트 본문 수집 — 오프셋이 실제로 `N 0 obj` 를 가리키는지 여기서 검증한다.
  const objectBodies = new Map<number, string>();
  const streams = new Map<number, Uint8Array>();
  for (const [num, offset] of objectOffsets) {
    if (offset < 0 || offset >= text.length) readFail(`PDF 오브젝트 ${num}의 오프셋이 파일 범위를 벗어나요.`);
    const head = new RegExp(`^${num}\\s+0\\s+obj`, "u").exec(text.slice(offset, offset + 40));
    if (!head) readFail(`PDF xref가 가리킨 위치에 오브젝트 ${num}이 없어요.`);
    const bodyStart = offset + head[0].length;
    const endIndex = text.indexOf("endobj", bodyStart);
    if (endIndex < 0) readFail(`PDF 오브젝트 ${num}에 endobj가 없어요.`);
    const body = text.slice(bodyStart, endIndex);
    objectBodies.set(num, body.trim());

    const streamIndex = body.indexOf("stream");
    if (streamIndex >= 0) {
      const dict = readDictAt(body, body.indexOf("<<"));
      const length = dictNumber(dict, "Length");
      if (length === null) readFail(`PDF 스트림 오브젝트 ${num}에 /Length가 없어요.`);
      // `stream` 다음은 CRLF 또는 LF 하나.
      let dataStart = bodyStart + streamIndex + "stream".length;
      if (text[dataStart] === "\r") dataStart++;
      if (text[dataStart] === "\n") dataStart++;
      if (dataStart + length > text.length) readFail(`PDF 스트림 오브젝트 ${num}의 /Length가 파일을 넘어갑니다.`);
      if (!text.startsWith("endstream", skipEol(text, dataStart + length))) {
        readFail(`PDF 스트림 오브젝트 ${num}의 /Length가 실제 데이터 길이와 맞지 않아요.`);
      }
      streams.set(num, bytes.subarray(dataStart, dataStart + length));
    }
  }

  const rootRef = dictRef(trailer, "Root");
  if (rootRef === null) readFail("PDF trailer에 /Root가 없어요.");
  const catalog = objectBodies.get(rootRef);
  if (catalog === undefined) readFail("PDF 카탈로그 오브젝트를 찾지 못했어요.");
  const infoRef = dictRef(trailer, "Info");
  const info = infoRef === null ? "" : (objectBodies.get(infoRef) ?? "");

  const pagesRef = dictRef(catalog, "Pages");
  if (pagesRef === null) readFail("PDF 카탈로그에 /Pages가 없어요.");
  const pages: StudioPdfReadPage[] = [];
  collectPages(pagesRef, objectBodies, streams, pages, new Set<number>());

  return { version, size, xrefOffset, trailer, catalog, info, pages, objectOffsets, objectBodies, streams };
}

function skipEol(text: string, index: number): number {
  let i = index;
  if (text[i] === "\r") i++;
  if (text[i] === "\n") i++;
  return i;
}

/** 페이지 트리 순회 — /Pages 노드는 재귀, /Page 는 수집. 순환 참조는 seen 으로 끊는다. */
function collectPages(
  num: number,
  bodies: ReadonlyMap<number, string>,
  streams: ReadonlyMap<number, Uint8Array>,
  out: StudioPdfReadPage[],
  seen: Set<number>,
): void {
  if (seen.has(num)) readFail("PDF 페이지 트리에 순환 참조가 있어요.");
  seen.add(num);
  const body = bodies.get(num);
  if (body === undefined) readFail(`PDF 페이지 오브젝트 ${num}을 찾지 못했어요.`);
  const dict = readDictAt(body, body.indexOf("<<"));
  const type = dictName(dict, "Type");
  if (type === "Pages") {
    for (const kid of dictRefArray(dict, "Kids")) {
      collectPages(kid, bodies, streams, out, seen);
    }
    return;
  }
  const mediaBox = dictNumberArray(dict, "MediaBox");
  if (!mediaBox || mediaBox.length !== 4) readFail(`PDF 페이지 ${num}에 올바른 /MediaBox가 없어요.`);
  const contentsRef = dictRef(dict, "Contents");
  const contentBytes = contentsRef === null ? null : (streams.get(contentsRef) ?? null);
  out.push({
    objectNumber: num,
    mediaBox,
    trimBox: dictNumberArray(dict, "TrimBox"),
    bleedBox: dictNumberArray(dict, "BleedBox"),
    dict,
    content: contentBytes ? latin1(contentBytes) : "",
  });
}

// ---------------------------------------------------------------------------
// 딕셔너리 스캐너 — 중첩 `<<>>`, hex 문자열 `<...>`, 리터럴 `(...)` 를 구분한다.
// ---------------------------------------------------------------------------

/** `<<` 위치에서 시작해 짝이 맞는 `>>` 까지의 **내용**(양끝 `<<`/`>>` 제외)을 돌려준다. */
export function readDictAt(text: string, start: number): string {
  if (start < 0 || !text.startsWith("<<", start)) readFail("PDF 딕셔너리를 찾지 못했어요.");
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "<<") {
      depth++;
      i += 2;
      continue;
    }
    if (two === ">>") {
      depth--;
      i += 2;
      if (depth === 0) return text.slice(start + 2, i - 2);
      continue;
    }
    const char = text[i]!;
    if (char === "(") {
      i = skipLiteralString(text, i);
      continue;
    }
    if (char === "<") {
      const close = text.indexOf(">", i);
      if (close < 0) readFail("PDF hex 문자열이 닫히지 않았어요.");
      i = close + 1;
      continue;
    }
    i++;
  }
  readFail("PDF 딕셔너리가 닫히지 않았어요.");
}

function skipLiteralString(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  readFail("PDF 리터럴 문자열이 닫히지 않았어요.");
}

/** `/Key 123` 또는 `/Key 1.5` → 숫자. 없으면 null. */
export function dictNumber(dict: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(-?[\\d.]+)`, "u").exec(dict);
  return match ? Number(match[1]) : null;
}

/** `/Key 12 0 R` → 12. 없으면 null. */
export function dictRef(dict: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`, "u").exec(dict);
  return match ? Number(match[1]) : null;
}

/** `/Key /Name` → "Name". 없으면 null. */
export function dictName(dict: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9#.\\-_]+)`, "u").exec(dict);
  return match ? match[1]! : null;
}

/** `/Key [1 2 3]` → [1,2,3]. 없으면 null. */
export function dictNumberArray(dict: string, key: string): number[] | null {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`, "u").exec(dict);
  if (!match) return null;
  const parts = match[1]!.trim().split(/\s+/u).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.some((value) => !Number.isFinite(value)) ? null : numbers;
}

/** `/Key [3 0 R 5 0 R]` → [3,5]. */
export function dictRefArray(dict: string, key: string): number[] {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`, "u").exec(dict);
  if (!match) return [];
  const refs: number[] = [];
  const pattern = /(\d+)\s+0\s+R/gu;
  let found: RegExpExecArray | null = pattern.exec(match[1]!);
  while (found) {
    refs.push(Number(found[1]));
    found = pattern.exec(match[1]!);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// 사전검사 리포트
// ---------------------------------------------------------------------------

export interface StudioPdfInspection {
  pageCount: number;
  /** 어떤 페이지든 DeviceCMYK 연산자(`k`/`K`)를 쓰는가. */
  usesCmyk: boolean;
  /** 어떤 페이지든 DeviceRGB 연산자(`rg`/`RG`)를 쓰는가. */
  usesRgb: boolean;
  /** TrimBox 가 모든 페이지에 있는가(인쇄소 요구사항). */
  hasTrimBoxes: boolean;
  hasOutputIntent: boolean;
  /** 임베드된 글꼴 파일(FontFile/FontFile2/FontFile3) 개수. */
  embeddedFontCount: number;
  /** 한국어 요약. */
  summary: string;
}

/** 인쇄 출고 전 사전검사 — "CMYK 인가, 재단선이 있는가, 글꼴이 임베드됐는가". */
export function inspectPdf(document: StudioPdfReadDocument): StudioPdfInspection {
  // 연산자 검사는 토큰 경계를 지켜야 한다. `k`/`K` 는 앞에 숫자 4개가 오는 자리에서만 색 연산자다.
  const cmykPattern = /(?:^|[\s])(?:-?[\d.]+\s+){4}[kK](?=[\s]|$)/mu;
  const rgbPattern = /(?:^|[\s])(?:-?[\d.]+\s+){3}(?:rg|RG)(?=[\s]|$)/mu;
  let usesCmyk = false;
  let usesRgb = false;
  for (const page of document.pages) {
    if (cmykPattern.test(page.content)) usesCmyk = true;
    if (rgbPattern.test(page.content)) usesRgb = true;
  }
  const hasTrimBoxes = document.pages.length > 0 && document.pages.every((page) => page.trimBox !== null);
  const hasOutputIntent = /\/OutputIntents\s*\[/u.test(document.catalog);
  let embeddedFontCount = 0;
  for (const body of document.objectBodies.values()) {
    if (/\/FontFile[23]?\s+\d+\s+0\s+R/u.test(body)) embeddedFontCount++;
  }
  const notes: string[] = [];
  notes.push(`${document.pages.length}페이지`);
  notes.push(usesCmyk ? "CMYK 색 사용" : usesRgb ? "RGB 색만 사용" : "색 연산자 없음");
  notes.push(hasTrimBoxes ? "재단선(TrimBox) 있음" : "재단선(TrimBox) 없음");
  notes.push(hasOutputIntent ? "출력 인텐트 있음" : "출력 인텐트 없음");
  notes.push(embeddedFontCount > 0 ? `글꼴 ${embeddedFontCount}개 임베드` : "임베드된 글꼴 없음");
  return {
    pageCount: document.pages.length,
    usesCmyk,
    usesRgb,
    hasTrimBoxes,
    hasOutputIntent,
    embeddedFontCount,
    summary: notes.join(" · "),
  };
}
