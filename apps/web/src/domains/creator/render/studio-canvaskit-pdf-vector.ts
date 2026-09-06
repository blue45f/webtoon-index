/**
 * Studio Vector PDF — **벡터** PDF 1.7 라이터(순수·DOM 무의존·결정적).
 *
 * 기존 `studio-pdf-export.ts` 와의 관계(중복 아님, 다른 층):
 *   - `studio-pdf-export.ts` = 페이지를 **JPEG 한 장으로 눌러 담는** 래스터 PDF. 백업·회람용.
 *     콘텐츠 스트림은 `cm` + `/Im0 Do` 두 줄이 전부고, 색공간은 DeviceRGB 고정, 글꼴은 없다.
 *   - 이 모듈 = **패스·텍스트·클립·투명도·DeviceCMYK 를 실제 PDF 연산자로** 쓰는 벡터 라이터.
 *     인쇄소가 요구하는 것(벡터 선화, 임베드 글꼴, CMYK 색, 재단선/도련 박스, OutputIntent)이
 *     여기 있다. 확대해도 안 깨지고, 인쇄소가 RIP 에서 색을 다시 만질 수 있다.
 *
 * ── 좌표계 규약(통합에서 가장 자주 틀리는 지점) ────────────────────────────
 * PDF 원점은 **좌하단, y 위쪽 증가**다. 스튜디오(Konva/Canvas/SVG)는 **좌상단, y 아래쪽 증가**다.
 * 매번 변환식을 손으로 쓰면 반드시 어긋나므로, `originTopLeft: true`(기본값)이면 페이지 콘텐츠
 * 맨 앞에 `1 0 0 -1 0 H cm` 을 깔아 **스튜디오 좌표를 그대로 넘길 수 있게** 한다. 텍스트는 그
 * 뒤집힌 CTM 안에서 다시 뒤집어야 바로 서므로 `Tm` 을 `1 0 0 -1 x y` 로 쓴다(아래 emitText).
 *
 * ── 단위 ────────────────────────────────────────────────────────────────────
 * 페이지 크기와 좌표는 **pt(1/72인치)** 다. 스튜디오 px(CSS 96dpi)에서 오려면
 * `studio-pdf-export.ts` 와 같은 계수 `PDF_PX_TO_PT = 0.75` 를 쓴다(여기서도 재수출한다 —
 * 두 라이터가 다른 계수를 쓰면 같은 원고가 다른 물리 크기로 나온다).
 *
 * ── 압축 ────────────────────────────────────────────────────────────────────
 * 콘텐츠 스트림을 압축하지 **않는다**. FlateDecode 를 쓰려면 pako 의존이나 비동기
 * `CompressionStream` 이 필요한데, 전자는 의존성 추가고 후자는 (a) 이 모듈을 async 로 오염시키고
 * (b) 구현별 출력 바이트가 달라 **결정성 계약이 깨진다**. 대신 연산자 문자열을 짧게 유지한다.
 * 압축이 필요해지면 CanvasKit 채택 시점에 함께 다룬다(Skia 의 PDF 백엔드가 이미 압축을 한다) —
 * 그때는 이 모듈이 아니라 어댑터 경로가 담당해야 결정성 계약을 이 모듈에 남길 수 있다.
 *
 * ── 결정성 ──────────────────────────────────────────────────────────────────
 * 같은 입력 → 같은 바이트. `CreationDate` 는 **기본적으로 넣지 않고**, 필요하면 호출부가
 * `creationDate` 로 고정 문자열을 주입한다(테스트가 이 두 경로를 모두 잠근다).
 */

import {
  buildCidWidthArray,
  encodeIdentityHText,
  evaluatePdfFontEmbedding,
  fontDescriptorFlags,
  glyphWidthToPdf,
  textNeedsEmbeddedFont,
} from "./studio-canvaskit-pdf-font";

import type { StudioPdfFontDocumentIntent, StudioPdfFontResource } from "./studio-canvaskit-pdf-font";

/** px→pt — `studio-pdf-export.ts` 의 PDF_PX_TO_PT 와 반드시 같은 값이어야 한다. */
export const STUDIO_PDF_PX_TO_PT = 0.75;

// ---------------------------------------------------------------------------
// 색
// ---------------------------------------------------------------------------

export type StudioPdfColor =
  | { space: "cmyk"; c: number; m: number; y: number; k: number }
  | { space: "rgb"; r: number; g: number; b: number }
  | { space: "gray"; gray: number };

// ---------------------------------------------------------------------------
// 그리기 명령
// ---------------------------------------------------------------------------

export type StudioPdfPathCommand =
  | { op: "move"; x: number; y: number }
  | { op: "line"; x: number; y: number }
  | { op: "cubic"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "close" };

export type StudioPdfFillRule = "nonzero" | "evenodd";

export interface StudioPdfStrokeStyle {
  color: StudioPdfColor;
  width: number;
  /** 0=butt, 1=round, 2=square (PDF `J`). */
  cap?: 0 | 1 | 2;
  /** 0=miter, 1=round, 2=bevel (PDF `j`). */
  join?: 0 | 1 | 2;
  miterLimit?: number;
  dash?: { pattern: readonly number[]; phase: number };
  alpha?: number;
}

export type StudioPdfOp =
  | {
      op: "path";
      commands: readonly StudioPdfPathCommand[];
      fill?: { color: StudioPdfColor; rule?: StudioPdfFillRule; alpha?: number };
      stroke?: StudioPdfStrokeStyle;
    }
  | {
      /** 이후 그리기를 이 패스로 자른다. `save`/`restore` 로 감싸 범위를 관리한다. */
      op: "clip";
      commands: readonly StudioPdfPathCommand[];
      rule?: StudioPdfFillRule;
    }
  | {
      op: "text";
      text: string;
      /** `StudioPdfDocument.fonts` 의 resourceName. */
      font: string;
      size: number;
      x: number;
      y: number;
      color: StudioPdfColor;
      charSpacing?: number;
      /**
       * Upright Studio-coordinate linear transform `[a,b,c,d]`. The writer composes the PDF text
       * baseline flip automatically, so callers can express rotation and tate-chu-yoko scale
       * without converting to PDF's bottom-left coordinate system.
       */
      matrix?: readonly [number, number, number, number];
      /** Unicode extraction/accessibility replacement. Defaults to `text`. */
      actualText?: string;
      /** 0=채움, 1=선, 2=채움+선, 3=보이지 않음(OCR 레이어). */
      renderMode?: 0 | 1 | 2 | 3;
      alpha?: number;
    }
  | {
      op: "image";
      /** `StudioPdfDocument.images` 의 name. */
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
      alpha?: number;
    }
  | { op: "save" }
  | { op: "restore" }
  | { op: "transform"; a: number; b: number; c: number; d: number; e: number; f: number };

// ---------------------------------------------------------------------------
// 문서 모델
// ---------------------------------------------------------------------------

export interface StudioPdfPage {
  /** pt. */
  widthPt: number;
  heightPt: number;
  ops: readonly StudioPdfOp[];
  /**
   * 재단 박스(pt, [x0 y0 x1 y1] — **PDF 좌표계**). 인쇄소가 "도련 3mm 주세요" 라고 할 때
   * MediaBox 는 도련 포함 크기, TrimBox 는 최종 재단 크기다.
   */
  trimBox?: readonly [number, number, number, number];
  bleedBox?: readonly [number, number, number, number];
}

export interface StudioPdfImage {
  name: string;
  /** JPEG(DCTDecode) 바이트. SOI(FFD8)로 시작해야 한다. */
  jpegBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** JPEG 자체의 색공간. CMYK JPEG 는 Adobe APP14 변환 때문에 `/Decode` 반전이 필요할 수 있다. */
  colorSpace: "rgb" | "cmyk" | "gray";
  /** CMYK JPEG 가 Adobe 인버티드일 때 true — `/Decode [1 0 1 0 1 0 1 0]` 을 붙인다. */
  adobeInverted?: boolean;
}

export interface StudioPdfOutputIntent {
  /** ICC 프로파일 바이트(`studio-canvaskit-icc-profile.ts` 의 빌더 또는 인쇄소 제공 파일). */
  profileBytes: Uint8Array;
  /** 예: "FOGRA39" — 인쇄 조건 식별자. */
  identifier: string;
  /** 예: "Coated FOGRA39 (ISO 12647-2:2004)". */
  condition: string;
  /** 프로파일 출처 설명. */
  info: string;
  /** 프로파일 색성분 수 — CMYK 4, RGB 3. */
  components: 3 | 4;
}

export type StudioPdfConformanceTarget = "pdf-a-2b" | "pdf-x-4";

/**
 * Writer가 규격 후보 파일에 넣는 결정적 식별·XMP 선언.
 *
 * 이 값만 있다고 적합성이 성립하는 것은 아니다. 출력 바이트를 독립 scanner와 외부 validator로
 * 다시 검사해야 하며, writer는 그 검사가 가능하도록 필요한 선언과 fail-closed 제약만 책임진다.
 */
export interface StudioPdfConformanceDeclaration {
  target: StudioPdfConformanceTarget;
  /** PDF trailer `/ID`에 넣을 16바이트 식별자(대문자/소문자 32자리 hex). */
  fileIdentifierHex: string;
  /** 결정적 XMP/Info 날짜. 현재 writer는 명확한 UTC `YYYY-MM-DDTHH:mm:ssZ`만 허용한다. */
  createdAt: string;
  modifiedAt: string;
}

export interface StudioPdfDocument {
  pages: readonly StudioPdfPage[];
  title?: string;
  author?: string;
  /** 기본 "ToonSpectrum Studio". */
  producer?: string;
  /**
   * PDF 날짜 문자열(`D:YYYYMMDDHHmmSS+09'00'`). **넣지 않으면 출력에 날짜가 없다** — 결정적
   * 바이트가 기본값이라는 뜻이다. 인쇄소 워크플로가 날짜를 요구하면 호출부가 명시적으로 준다.
   */
  creationDate?: string;
  fonts?: readonly StudioPdfFontResource[];
  /**
   * 임베드 글꼴이 들어간 문서의 사용 범위. OS/2.fsType의 Preview & Print와 Editable 권한을
   * 혼동하지 않도록 CID 글꼴 출고 때는 반드시 명시한다. 표준 14 폰트만 쓰면 필요 없다.
   */
  fontEmbeddingIntent?: StudioPdfFontDocumentIntent;
  images?: readonly StudioPdfImage[];
  outputIntent?: StudioPdfOutputIntent;
  /**
   * PDF/A-2b 또는 PDF/X-4 후보 선언. writer는 필수 XMP·OutputIntent·파일 ID·폰트 조건을
   * fail-closed로 검사하지만, 제3자 인증을 주장하지 않는다.
   */
  conformance?: StudioPdfConformanceDeclaration;
  /** 기본 true — 스튜디오(좌상단 원점) 좌표를 그대로 받는다. */
  originTopLeft?: boolean;
}

// ---------------------------------------------------------------------------
// 저수준 유틸
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** %PDF 다음 줄 바이너리 마커 — 고비트 4바이트(전송 도구용 관례). */
const BINARY_MARKER = Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/**
 * PDF 실수 표기. 소수 4자리로 반올림하고 꼬리 0 을 없앤다.
 *  - 지수 표기(`1e-7`)는 PDF 가 파싱하지 못하므로 절대 만들지 않는다.
 *  - `-0` 은 `0` 으로 정규화한다(결정성 — 같은 도형이 부호만 다른 바이트를 내지 않게).
 */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("PDF에 넣을 수 없는 숫자가 있어요(NaN/무한대).");
  const rounded = Math.round(value * 10000) / 10000;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

/** UTF-16BE(BOM) hex 문자열 — 한글 제목/작성자를 이스케이프 없이 ASCII 로 담는다. */
export function pdfHexText(value: string): string {
  let hex = "FEFF";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

/**
 * PDF 이름(`/Name`) 안전화 — 공백·구분자·비ASCII 를 `#xx` 로 이스케이프한다.
 * `#xx` 는 **바이트 하나**를 나타내므로 비ASCII 는 UTF-16 코드 유닛이 아니라 **UTF-8 바이트마다**
 * 이스케이프해야 한다(PDF 2.0 부터 이름은 UTF-8 로 해석된다). `#AC00` 같은 4자리 표기는 잘못된
 * 이름이 되어 뷰어가 리소스를 찾지 못한다.
 */
export function pdfName(value: string): string {
  let out = "/";
  for (const byte of encoder.encode(value)) {
    const isSafe = byte > 0x20 && byte < 0x7f && !"()<>[]{}/%#".includes(String.fromCharCode(byte));
    out += isSafe ? String.fromCharCode(byte) : `#${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** 색 → 비획(fill) 연산자. DeviceCMYK 는 `k`, DeviceRGB 는 `rg`, DeviceGray 는 `g`. */
export function fillColorOperator(color: StudioPdfColor): string {
  switch (color.space) {
    case "cmyk":
      return `${pdfNumber(color.c)} ${pdfNumber(color.m)} ${pdfNumber(color.y)} ${pdfNumber(color.k)} k`;
    case "rgb":
      return `${pdfNumber(color.r)} ${pdfNumber(color.g)} ${pdfNumber(color.b)} rg`;
    default:
      return `${pdfNumber(color.gray)} g`;
  }
}

/** 색 → 획(stroke) 연산자. PDF 는 대문자가 stroking 색이다. */
export function strokeColorOperator(color: StudioPdfColor): string {
  switch (color.space) {
    case "cmyk":
      return `${pdfNumber(color.c)} ${pdfNumber(color.m)} ${pdfNumber(color.y)} ${pdfNumber(color.k)} K`;
    case "rgb":
      return `${pdfNumber(color.r)} ${pdfNumber(color.g)} ${pdfNumber(color.b)} RG`;
    default:
      return `${pdfNumber(color.gray)} G`;
  }
}

// ---------------------------------------------------------------------------
// 오브젝트 라이터 — 번호 할당과 바이트 오프셋을 한 곳에서만 다룬다.
// ---------------------------------------------------------------------------

class PdfWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly offsets = new Map<number, number>();
  private offset = 0;
  private next = 1;

  allocate(): number {
    return this.next++;
  }

  private push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.offset += bytes.length;
  }

  text(value: string): void {
    this.push(encoder.encode(value));
  }

  raw(bytes: Uint8Array): void {
    this.push(bytes);
  }

  begin(version: "1.6" | "1.7" = "1.7"): void {
    this.text(`%PDF-${version}\n`);
    this.push(BINARY_MARKER);
  }

  object(num: number, body: string): void {
    this.offsets.set(num, this.offset);
    this.text(`${num} 0 obj\n${body}\nendobj\n`);
  }

  stream(num: number, dict: string, data: Uint8Array): void {
    this.offsets.set(num, this.offset);
    const entries = dict.trim().length > 0 ? `${dict.trim()} /Length ${data.length}` : `/Length ${data.length}`;
    this.text(`${num} 0 obj\n<< ${entries} >>\nstream\n`);
    this.push(data);
    // stream 데이터 뒤 EOL 은 /Length 에 포함되지 않는다(PDF 스펙 7.3.8.1).
    this.text("\nendstream\nendobj\n");
  }

  /** xref + trailer 를 붙이고 최종 바이트를 낸다. 빠진 오브젝트가 있으면 조립을 중단한다. */
  finish(rootNum: number, infoNum: number, fileIdentifierHex?: string): Uint8Array {
    const size = this.next;
    const xrefOffset = this.offset;
    this.text(`xref\n0 ${size}\n`);
    this.text("0000000000 65535 f \n");
    for (let num = 1; num < size; num++) {
      const objOffset = this.offsets.get(num);
      if (objOffset === undefined) {
        throw new Error(`PDF 조립에 실패했어요(오브젝트 ${num} 누락). 다시 시도해주세요.`);
      }
      // 항목은 정확히 20바이트: 오프셋 10 + 공백 + 세대 5 + 공백 + 타입 1 + 공백 + 개행.
      this.text(`${String(objOffset).padStart(10, "0")} 00000 n \n`);
    }
    const fileIdentifier = fileIdentifierHex
      ? ` /ID [<${fileIdentifierHex}><${fileIdentifierHex}>]`
      : "";
    this.text(
      `trailer\n<< /Size ${size} /Root ${rootNum} 0 R /Info ${infoNum} 0 R${fileIdentifier} >>\n`
      + `startxref\n${xrefOffset}\n%%EOF`,
    );

    const out = new Uint8Array(this.offset);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 콘텐츠 스트림 생성
// ---------------------------------------------------------------------------

interface ExtGStateEntry {
  name: string;
  fillAlpha: number;
  strokeAlpha: number;
}

/** 투명도 조합을 모아 ExtGState 리소스로 만든다(같은 조합은 하나로 합친다 — 결정적 이름). */
class ExtGStateTable {
  private readonly byKey = new Map<string, ExtGStateEntry>();

  use(fillAlpha: number, strokeAlpha: number): string | null {
    const ca = clamp01(fillAlpha);
    const CA = clamp01(strokeAlpha);
    if (ca === 1 && CA === 1) return null;
    const key = `${pdfNumber(ca)}|${pdfNumber(CA)}`;
    const existing = this.byKey.get(key);
    if (existing) return existing.name;
    const entry: ExtGStateEntry = { name: `GS${this.byKey.size}`, fillAlpha: ca, strokeAlpha: CA };
    this.byKey.set(key, entry);
    return entry.name;
  }

  entries(): ExtGStateEntry[] {
    return [...this.byKey.values()];
  }
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function emitPath(commands: readonly StudioPdfPathCommand[], lines: string[]): void {
  for (const command of commands) {
    switch (command.op) {
      case "move":
        lines.push(`${pdfNumber(command.x)} ${pdfNumber(command.y)} m`);
        break;
      case "line":
        lines.push(`${pdfNumber(command.x)} ${pdfNumber(command.y)} l`);
        break;
      case "cubic":
        lines.push(
          `${pdfNumber(command.x1)} ${pdfNumber(command.y1)} ${pdfNumber(command.x2)} ${pdfNumber(command.y2)} ${pdfNumber(command.x)} ${pdfNumber(command.y)} c`,
        );
        break;
      default:
        lines.push("h");
        break;
    }
  }
}

/** WinAnsi 로 낼 수 없는 문자는 '?' — 표준 14 폴백의 정직한 손실(호출부가 사전에 경고해야 한다). */
function winAnsiHex(text: string): string {
  let hex = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    hex += (code <= 0xff ? code : 0x3f).toString(16).toUpperCase().padStart(2, "0");
  }
  return `<${hex}>`;
}

function unicodeCodePointHex(codePoint: number): string {
  if (codePoint <= 0xffff) return codePoint.toString(16).toUpperCase().padStart(4, "0");
  const shifted = codePoint - 0x10000;
  const high = 0xd800 + (shifted >> 10);
  const low = 0xdc00 + (shifted & 0x3ff);
  return `${high.toString(16).toUpperCase().padStart(4, "0")}${low.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** CID glyph id -> Unicode scalar map for copy/search and downstream text extraction. */
function buildToUnicodeCMap(font: Extract<StudioPdfFontResource, { kind: "truetype-cid" }>): Uint8Array {
  const used = new Set(font.usedGlyphIds);
  const byGlyph = new Map<number, number>();
  for (const [codePoint, glyphId] of [...font.metrics.cmap.entries()].sort((left, right) => left[0] - right[0])) {
    if (!used.has(glyphId) || byGlyph.has(glyphId)) continue;
    byGlyph.set(glyphId, codePoint);
  }
  const mappings = [...byGlyph.entries()].sort((left, right) => left[0] - right[0]);
  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    `/CMapName ${pdfName(`TS-${font.resourceName}-Unicode`)} def`,
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];
  for (let offset = 0; offset < mappings.length; offset += 100) {
    const chunk = mappings.slice(offset, offset + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [glyphId, codePoint] of chunk) {
      lines.push(`<${glyphId.toString(16).toUpperCase().padStart(4, "0")}> <${unicodeCodePointHex(codePoint)}>`);
    }
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return encoder.encode(lines.join("\n"));
}

function buildContentStream(
  page: StudioPdfPage,
  fonts: ReadonlyMap<string, StudioPdfFontResource>,
  gs: ExtGStateTable,
  originTopLeft: boolean,
): string {
  const lines: string[] = [];
  // 전체를 q/Q 로 감싸 페이지 간 그래픽 상태가 새지 않게 한다.
  lines.push("q");
  if (originTopLeft) {
    // 좌상단 원점으로 뒤집기 — 이 뒤의 모든 좌표는 스튜디오 좌표계 그대로다.
    lines.push(`1 0 0 -1 0 ${pdfNumber(page.heightPt)} cm`);
  }

  for (const item of page.ops) {
    switch (item.op) {
      case "save":
        lines.push("q");
        break;
      case "restore":
        lines.push("Q");
        break;
      case "transform":
        lines.push(
          `${pdfNumber(item.a)} ${pdfNumber(item.b)} ${pdfNumber(item.c)} ${pdfNumber(item.d)} ${pdfNumber(item.e)} ${pdfNumber(item.f)} cm`,
        );
        break;
      case "clip": {
        emitPath(item.commands, lines);
        lines.push(item.rule === "evenodd" ? "W* n" : "W n");
        break;
      }
      case "path": {
        if (!item.fill && !item.stroke) break;
        const gsName = gs.use(clamp01(item.fill?.alpha), clamp01(item.stroke?.alpha));
        if (gsName) lines.push(`${pdfName(gsName)} gs`);
        if (item.fill) lines.push(fillColorOperator(item.fill.color));
        if (item.stroke) {
          lines.push(strokeColorOperator(item.stroke.color));
          lines.push(`${pdfNumber(item.stroke.width)} w`);
          if (item.stroke.cap !== undefined) lines.push(`${item.stroke.cap} J`);
          if (item.stroke.join !== undefined) lines.push(`${item.stroke.join} j`);
          if (item.stroke.miterLimit !== undefined) lines.push(`${pdfNumber(item.stroke.miterLimit)} M`);
          if (item.stroke.dash) {
            const pattern = item.stroke.dash.pattern.map(pdfNumber).join(" ");
            lines.push(`[${pattern}] ${pdfNumber(item.stroke.dash.phase)} d`);
          }
        }
        emitPath(item.commands, lines);
        const evenOdd = item.fill?.rule === "evenodd";
        if (item.fill && item.stroke) lines.push(evenOdd ? "B*" : "B");
        else if (item.fill) lines.push(evenOdd ? "f*" : "f");
        else lines.push("S");
        break;
      }
      case "image": {
        const gsName = gs.use(clamp01(item.alpha), 1);
        lines.push("q");
        if (gsName) lines.push(`${pdfName(gsName)} gs`);
        // 이미지 XObject 는 단위 정사각형에 그려진다. 좌상단 원점에서는 y 를 한 번 더 뒤집어야
        // 이미지가 거꾸로 서지 않는다(뒤집힌 CTM 안이므로 d 부호가 반대).
        const dy = originTopLeft ? -item.height : item.height;
        const oy = originTopLeft ? item.y + item.height : item.y;
        lines.push(`${pdfNumber(item.width)} 0 0 ${pdfNumber(dy)} ${pdfNumber(item.x)} ${pdfNumber(oy)} cm`);
        lines.push(`${pdfName(item.name)} Do`);
        lines.push("Q");
        break;
      }
      case "text": {
        const resource = fonts.get(item.font);
        if (!resource) throw new Error(`PDF에 없는 글꼴(${item.font})을 텍스트가 참조하고 있어요.`);
        if (resource.kind === "standard-14" && textNeedsEmbeddedFont(item.text)) {
          throw new Error(
            `PDF 표준 글꼴(${resource.baseFont})로 유니코드 텍스트를 표시할 수 없어요. CID TrueType 글꼴을 임베드해 주세요.`,
          );
        }
        if (resource.kind === "truetype-cid") {
          const missing = [...new Set([...item.text].filter(
            (char) => !resource.metrics.cmap.has(char.codePointAt(0) ?? 0),
          ))];
          if (missing.length > 0) {
            throw new Error(
              `PDF 글꼴(${resource.baseFont})에 필요한 글리프가 없어요: ${missing.join(" ")}`,
            );
          }
        }
        const gsName = gs.use(clamp01(item.alpha), 1);
        lines.push(`/Span << /ActualText ${pdfHexText(item.actualText ?? item.text)} >> BDC`);
        lines.push("BT");
        if (gsName) lines.push(`${pdfName(gsName)} gs`);
        lines.push(fillColorOperator(item.color));
        lines.push(`${pdfName(resource.resourceName)} ${pdfNumber(item.size)} Tf`);
        if (item.charSpacing) lines.push(`${pdfNumber(item.charSpacing)} Tc`);
        if (item.renderMode !== undefined && item.renderMode !== 0) lines.push(`${item.renderMode} Tr`);
        // 뒤집힌 CTM 안에서 글자를 바로 세우려면 텍스트 행렬의 d 를 -1 로 둔다.
        const [a, b, c, d] = item.matrix ?? [1, 0, 0, 1];
        const textMatrix = originTopLeft ? [a, b, -c, -d] : [a, b, c, d];
        lines.push(
          `${textMatrix.map(pdfNumber).join(" ")} ${pdfNumber(item.x)} ${pdfNumber(item.y)} Tm`,
        );
        const encoded =
          resource.kind === "truetype-cid"
            ? `<${encodeIdentityHText(resource.metrics, item.text)}>`
            : winAnsiHex(item.text);
        lines.push(`${encoded} Tj`);
        lines.push("ET");
        lines.push("EMC");
        break;
      }
      default:
        break;
    }
  }
  lines.push("Q");
  return lines.join("\n");
}

const PDF_CONFORMANCE_UTC_PATTERN =
  /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/u;
const PDF_FILE_IDENTIFIER_PATTERN = /^[0-9A-Fa-f]{32}$/u;

interface ResolvedPdfConformanceDeclaration {
  target: StudioPdfConformanceTarget;
  fileIdentifierHex: string;
  createdAt: string;
  modifiedAt: string;
}

function resolvePdfConformanceDeclaration(
  declaration: StudioPdfConformanceDeclaration | undefined,
): ResolvedPdfConformanceDeclaration | null {
  if (!declaration) return null;
  if (declaration.target !== "pdf-a-2b" && declaration.target !== "pdf-x-4") {
    throw new Error("알 수 없는 PDF 적합성 프로필이에요.");
  }
  const fileIdentifierHex = declaration.fileIdentifierHex.trim().toUpperCase();
  if (!PDF_FILE_IDENTIFIER_PATTERN.test(fileIdentifierHex)) {
    throw new Error("PDF 적합성 파일 식별자는 16바이트(32자리 hex)여야 해요.");
  }
  for (const [label, value] of [
    ["생성", declaration.createdAt],
    ["수정", declaration.modifiedAt],
  ] as const) {
    if (
      !PDF_CONFORMANCE_UTC_PATTERN.test(value)
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().replace(".000Z", "Z") !== value
    ) {
      throw new Error(`PDF ${label} 날짜는 초 단위 UTC ISO-8601 형식이어야 해요.`);
    }
  }
  if (Date.parse(declaration.modifiedAt) < Date.parse(declaration.createdAt)) {
    throw new Error("PDF 수정 날짜는 생성 날짜보다 빠를 수 없어요.");
  }
  return {
    target: declaration.target,
    fileIdentifierHex,
    createdAt: declaration.createdAt,
    modifiedAt: declaration.modifiedAt,
  };
}

function pdfDateFromUtc(value: string): string {
  return `D:${value.slice(0, 4)}${value.slice(5, 7)}${value.slice(8, 10)}`
    + `${value.slice(11, 13)}${value.slice(14, 16)}${value.slice(17, 19)}Z`;
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function buildPdfConformanceXmp(
  document: StudioPdfDocument,
  declaration: ResolvedPdfConformanceDeclaration,
): Uint8Array {
  const title = document.title?.trim();
  const author = document.author?.trim();
  const producer = (document.producer ?? "ToonSpectrum Studio").trim() || "ToonSpectrum Studio";
  const profileDeclaration = declaration.target === "pdf-a-2b"
    ? `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" `
      + `pdfaid:part="2" pdfaid:conformance="B"/>`
    : `<rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" `
      + `pdfxid:GTS_PDFXVersion="PDF/X-4"/>`;
  const titleDeclaration = title
    ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(title)}</rdf:li></rdf:Alt></dc:title>`
    : "";
  const authorDeclaration = author
    ? `<dc:creator><rdf:Seq><rdf:li>${xmlText(author)}</rdf:li></rdf:Seq></dc:creator>`
    : "";
  const xmp = [
    "<?xpacket begin=\"\uFEFF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
    "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
    "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
    profileDeclaration,
    "<rdf:Description rdf:about=\"\"",
    " xmlns:dc=\"http://purl.org/dc/elements/1.1/\"",
    " xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"",
    " xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\">",
    titleDeclaration,
    authorDeclaration,
    `<xmp:CreateDate>${declaration.createdAt}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${declaration.modifiedAt}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${declaration.modifiedAt}</xmp:MetadataDate>`,
    `<xmp:CreatorTool>${xmlText(producer)}</xmp:CreatorTool>`,
    `<pdf:Producer>${xmlText(producer)}</pdf:Producer>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    "<?xpacket end=\"w\"?>",
  ].join("");
  const bytes = encoder.encode(xmp);
  if (bytes.byteLength > 1024 * 1024) {
    throw new Error("PDF XMP 메타데이터가 1MiB 안전 예산을 초과했어요.");
  }
  return bytes;
}

function assertPdfConformanceIcc(intent: StudioPdfOutputIntent | undefined): asserts intent is StudioPdfOutputIntent {
  if (!intent) {
    throw new Error("PDF/A·PDF/X 후보에는 권리가 확인된 ICC OutputIntent가 필요해요.");
  }
  const bytes = intent.profileBytes;
  if (bytes.byteLength < 132) {
    throw new Error("PDF OutputIntent ICC 프로파일이 너무 짧아요.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== bytes.byteLength) {
    throw new Error("PDF OutputIntent ICC 프로파일의 선언 크기와 실제 크기가 다릅니다.");
  }
  const signature = String.fromCharCode(bytes[36]!, bytes[37]!, bytes[38]!, bytes[39]!);
  if (signature !== "acsp") {
    throw new Error("PDF OutputIntent에 유효한 ICC 프로파일 서명이 없습니다.");
  }
  const colorSpace = String.fromCharCode(bytes[16]!, bytes[17]!, bytes[18]!, bytes[19]!);
  const expected = intent.components === 4 ? "CMYK" : "RGB ";
  if (colorSpace !== expected) {
    throw new Error("PDF OutputIntent의 ICC 색공간과 성분 수가 일치하지 않아요.");
  }
}

function boxContains(
  outer: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function assertPdfConformancePageBoxes(
  document: StudioPdfDocument,
  declaration: ResolvedPdfConformanceDeclaration,
): void {
  if (declaration.target !== "pdf-x-4") return;
  document.pages.forEach((page, index) => {
    if (!page.trimBox) {
      throw new Error(`PDF/X-4 페이지 ${index + 1}에는 TrimBox가 필요해요.`);
    }
    const mediaBox: readonly [number, number, number, number] = [0, 0, page.widthPt, page.heightPt];
    if (!boxContains(mediaBox, page.trimBox)) {
      throw new Error(`PDF/X-4 페이지 ${index + 1}의 TrimBox가 MediaBox를 벗어났어요.`);
    }
    if (page.bleedBox && (!boxContains(mediaBox, page.bleedBox) || !boxContains(page.bleedBox, page.trimBox))) {
      throw new Error(`PDF/X-4 페이지 ${index + 1}의 BleedBox가 TrimBox와 MediaBox를 올바르게 감싸지 않아요.`);
    }
  });
}

// ---------------------------------------------------------------------------
// 문서 조립
// ---------------------------------------------------------------------------

/**
 * 벡터 PDF 바이트를 만든다. 순수·결정적(입력이 같으면 바이트가 같다).
 * 페이지가 없거나 크기가 잘못됐거나 참조가 어긋나면 한국어 메시지로 throw.
 */
export function buildVectorPdf(document: StudioPdfDocument): Uint8Array {
  if (document.pages.length === 0) throw new Error("PDF로 내보낼 페이지가 없어요.");
  document.pages.forEach((page, index) => {
    if (!Number.isFinite(page.widthPt) || !Number.isFinite(page.heightPt) || page.widthPt <= 0 || page.heightPt <= 0) {
      throw new Error(`페이지 ${index + 1}의 크기가 올바르지 않아요.`);
    }
  });
  const conformance = resolvePdfConformanceDeclaration(document.conformance);
  if (conformance) {
    assertPdfConformanceIcc(document.outputIntent);
    assertPdfConformancePageBoxes(document, conformance);
  }

  const fontList = document.fonts ?? [];
  const fontMap = new Map<string, StudioPdfFontResource>();
  for (const font of fontList) {
    if (fontMap.has(font.resourceName)) {
      throw new Error(`PDF 글꼴 이름이 겹쳐요(${font.resourceName}).`);
    }
    if (font.kind === "truetype-cid") {
      if (font.metrics.hasCffOutlines) {
        throw new Error(
          `PDF 글꼴 '${font.baseFont}'을 임베드할 수 없어요: `
          + "CFF 윤곽선은 CIDFontType0/FontFile3 writer가 필요하며 현재 TrueType FontFile2 경로로는 안전하게 출력할 수 없어요.",
        );
      }
      // 이 writer는 현재 sfnt 원본 전체를 FontFile2에 넣는다. 따라서 subset은 false이고,
      // bitmap-only 폰트가 요구하는 비트맵 스트림 경로는 제공하지 않는다.
      const embedding = evaluatePdfFontEmbedding(font.metrics.embeddingPolicy, {
        documentIntent: document.fontEmbeddingIntent,
        embeddingMode: "full",
        payloadKind: "outline",
      });
      if (!embedding.allowed) {
        throw new Error(`PDF 글꼴 '${font.baseFont}'을 임베드할 수 없어요: ${embedding.message}`);
      }
    }
    fontMap.set(font.resourceName, font);
  }
  if (conformance) {
    const usedFontNames = new Set(
      document.pages.flatMap((page) =>
        page.ops.flatMap((op) => op.op === "text" && op.renderMode !== 3 ? [op.font] : []),
      ),
    );
    for (const fontName of usedFontNames) {
      const font = fontMap.get(fontName);
      if (!font) {
        throw new Error(`PDF에 없는 글꼴(${fontName})을 텍스트가 참조하고 있어요.`);
      }
      if (font.kind !== "truetype-cid") {
        throw new Error("PDF/A·PDF/X 후보의 표시 텍스트는 모든 글꼴 프로그램을 임베드해야 해요.");
      }
    }
  }
  const imageList = document.images ?? [];
  for (const image of imageList) {
    if (image.jpegBytes.length < 4 || image.jpegBytes[0] !== 0xff || image.jpegBytes[1] !== 0xd8) {
      throw new Error(`이미지 ${image.name}이 JPEG 형식이 아니에요.`);
    }
  }

  const originTopLeft = document.originTopLeft ?? true;
  const gs = new ExtGStateTable();
  // 콘텐츠를 먼저 만들어야 ExtGState 목록이 확정된다(리소스 딕셔너리에 넣어야 하므로).
  const contents = document.pages.map((page) => buildContentStream(page, fontMap, gs, originTopLeft));
  const gsEntries = gs.entries();

  const writer = new PdfWriter();
  writer.begin(conformance?.target === "pdf-x-4" ? "1.6" : "1.7");

  const catalogNum = writer.allocate();
  const pagesNum = writer.allocate();

  // ── 글꼴 오브젝트 ────────────────────────────────────────────────────────
  const fontRefs = new Map<string, number>();
  const deferred: (() => void)[] = [];
  for (const font of fontList) {
    const fontNum = writer.allocate();
    fontRefs.set(font.resourceName, fontNum);
    if (font.kind === "standard-14") {
      deferred.push(() =>
        writer.object(
          fontNum,
          `<< /Type /Font /Subtype /Type1 /BaseFont ${pdfName(font.baseFont)} /Encoding /WinAnsiEncoding >>`,
        ),
      );
      continue;
    }
    const descendantNum = writer.allocate();
    const descriptorNum = writer.allocate();
    const fileNum = writer.allocate();
    const toUnicodeNum = writer.allocate();
    const scale = 1000 / font.metrics.unitsPerEm;
    const bbox = font.metrics.bbox.map((v) => Math.round(v * scale));
    const missingWidth = glyphWidthToPdf(font.metrics, 0);
    deferred.push(() => {
      writer.object(
        fontNum,
        `<< /Type /Font /Subtype /Type0 /BaseFont ${pdfName(font.baseFont)} /Encoding /Identity-H ` +
          `/DescendantFonts [${descendantNum} 0 R] /ToUnicode ${toUnicodeNum} 0 R >>`,
      );
      writer.object(
        descendantNum,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${pdfName(font.baseFont)} ` +
          `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${descriptorNum} 0 R /DW ${missingWidth} /W ${buildCidWidthArray(font)} ` +
          `/CIDToGIDMap /Identity >>`,
      );
      writer.object(
        descriptorNum,
        `<< /Type /FontDescriptor /FontName ${pdfName(font.baseFont)} ` +
          `/Flags ${fontDescriptorFlags({ symbolic: false })} ` +
          `/FontBBox [${bbox.join(" ")}] /ItalicAngle 0 ` +
          `/Ascent ${Math.round(font.metrics.ascender * scale)} /Descent ${Math.round(font.metrics.descender * scale)} ` +
          `/CapHeight ${Math.round((font.metrics.capHeight ?? font.metrics.ascender) * scale)} /StemV 80 ` +
          `/FontFile2 ${fileNum} 0 R >>`,
      );
      writer.stream(fileNum, `/Length1 ${font.fontBytes.length}`, font.fontBytes);
      writer.stream(toUnicodeNum, "", buildToUnicodeCMap(font));
    });
  }

  // ── 이미지 XObject ──────────────────────────────────────────────────────
  const imageRefs = new Map<string, number>();
  for (const image of imageList) {
    const num = writer.allocate();
    imageRefs.set(image.name, num);
    const colorSpace =
      image.colorSpace === "cmyk" ? "/DeviceCMYK" : image.colorSpace === "gray" ? "/DeviceGray" : "/DeviceRGB";
    const decode = image.colorSpace === "cmyk" && image.adobeInverted ? " /Decode [1 0 1 0 1 0 1 0]" : "";
    deferred.push(() =>
      writer.stream(
        num,
        `/Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} ` +
          `/ColorSpace ${colorSpace} /BitsPerComponent 8${decode} /Filter /DCTDecode`,
        image.jpegBytes,
      ),
    );
  }

  // ── OutputIntent(PDF/X 색 조건) ─────────────────────────────────────────
  let outputIntentNum: number | null = null;
  if (document.outputIntent) {
    const intent = document.outputIntent;
    const profileNum = writer.allocate();
    outputIntentNum = writer.allocate();
    const subtype = conformance?.target === "pdf-a-2b" ? "/GTS_PDFA1" : "/GTS_PDFX";
    const registry = conformance?.target === "pdf-x-4"
      ? " /RegistryName (http://www.color.org)"
      : "";
    deferred.push(() => {
      writer.stream(profileNum, `/N ${intent.components}`, intent.profileBytes);
      writer.object(
        outputIntentNum!,
        `<< /Type /OutputIntent /S ${subtype} /OutputConditionIdentifier (${escapeLiteral(intent.identifier)}) ` +
          `/OutputCondition (${escapeLiteral(intent.condition)}) /Info (${escapeLiteral(intent.info)}) ` +
          `/DestOutputProfile ${profileNum} 0 R${registry} >>`,
      );
    });
  }

  // ── XMP 적합성 선언 ────────────────────────────────────────────────────
  let metadataNum: number | null = null;
  if (conformance) {
    metadataNum = writer.allocate();
    const xmp = buildPdfConformanceXmp(document, conformance);
    deferred.push(() => writer.stream(metadataNum!, "/Type /Metadata /Subtype /XML", xmp));
  }

  // ── ExtGState ───────────────────────────────────────────────────────────
  const gsRefs = new Map<string, number>();
  for (const entry of gsEntries) {
    const num = writer.allocate();
    gsRefs.set(entry.name, num);
    deferred.push(() =>
      writer.object(num, `<< /Type /ExtGState /ca ${pdfNumber(entry.fillAlpha)} /CA ${pdfNumber(entry.strokeAlpha)} >>`),
    );
  }

  // ── 페이지 ──────────────────────────────────────────────────────────────
  const pageNums = document.pages.map(() => writer.allocate());
  const contentNums = document.pages.map(() => writer.allocate());
  const infoNum = writer.allocate();

  const fontResource =
    fontList.length === 0
      ? ""
      : `/Font << ${fontList.map((font) => `${pdfName(font.resourceName)} ${fontRefs.get(font.resourceName)!} 0 R`).join(" ")} >> `;
  const xobjectResource =
    imageList.length === 0
      ? ""
      : `/XObject << ${imageList.map((image) => `${pdfName(image.name)} ${imageRefs.get(image.name)!} 0 R`).join(" ")} >> `;
  const gsResource =
    gsEntries.length === 0
      ? ""
      : `/ExtGState << ${gsEntries.map((entry) => `${pdfName(entry.name)} ${gsRefs.get(entry.name)!} 0 R`).join(" ")} >> `;
  const procSet = imageList.length === 0 ? "/ProcSet [/PDF /Text]" : "/ProcSet [/PDF /Text /ImageC]";

  // 오브젝트는 번호 순서대로 파일에 쓴다 — xref 오프셋 검증이 사람 눈에도 읽히도록.
  for (const write of deferred) write();

  writer.object(
    catalogNum,
    `<< /Type /Catalog /Pages ${pagesNum} 0 R`
      + `${outputIntentNum ? ` /OutputIntents [${outputIntentNum} 0 R]` : ""}`
      + `${metadataNum ? ` /Metadata ${metadataNum} 0 R` : ""} >>`,
  );
  writer.object(
    pagesNum,
    `<< /Type /Pages /Kids [${pageNums.map((num) => `${num} 0 R`).join(" ")}] /Count ${pageNums.length} >>`,
  );

  document.pages.forEach((page, index) => {
    const boxes =
      (page.trimBox ? ` /TrimBox [${page.trimBox.map(pdfNumber).join(" ")}]` : "") +
      (page.bleedBox ? ` /BleedBox [${page.bleedBox.map(pdfNumber).join(" ")}]` : "");
    writer.object(
      pageNums[index]!,
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pdfNumber(page.widthPt)} ${pdfNumber(page.heightPt)}]${boxes} ` +
        `/Resources << ${fontResource}${xobjectResource}${gsResource}${procSet} >> /Contents ${contentNums[index]!} 0 R >>`,
    );
    writer.stream(contentNums[index]!, "", encoder.encode(contents[index]!));
  });

  const info: string[] = [];
  if (document.title?.trim()) info.push(`/Title ${pdfHexText(document.title.trim())}`);
  if (document.author?.trim()) info.push(`/Author ${pdfHexText(document.author.trim())}`);
  if (conformance) {
    info.push(`/CreationDate (${pdfDateFromUtc(conformance.createdAt)})`);
    info.push(`/ModDate (${pdfDateFromUtc(conformance.modifiedAt)})`);
    if (conformance.target === "pdf-x-4") {
      info.push("/GTS_PDFXVersion (PDF/X-4)");
      info.push("/Trapped /False");
    }
  } else if (document.creationDate) {
    info.push(`/CreationDate (${escapeLiteral(document.creationDate)})`);
  }
  info.push(`/Producer (${escapeLiteral(document.producer ?? "ToonSpectrum Studio")})`);
  writer.object(infoNum, `<< ${info.join(" ")} >>`);

  return writer.finish(catalogNum, infoNum, conformance?.fileIdentifierHex);
}

/** PDF 리터럴 문자열 이스케이프 — `\`, `(`, `)` 와 개행. */
function escapeLiteral(value: string): string {
  // 개행/캐리지리턴은 리터럴 문자열 안에서 그대로 살아 있으면 파서가 줄을 잘못 센다 — 공백으로.
  return value.replace(/[\\()]/gu, (match) => `\\${match}`).replace(/[\r\n]+/gu, " ");
}

// ---------------------------------------------------------------------------
// 편의 — 인쇄 규격 페이지 만들기
// ---------------------------------------------------------------------------

/** mm → pt(1인치 = 25.4mm = 72pt). */
export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/** px(CSS 96dpi) → pt. `studio-pdf-export.ts` 와 같은 계수. */
export function pxToPt(px: number): number {
  return px * STUDIO_PDF_PX_TO_PT;
}

export interface StudioPrintPageSpec {
  /** 재단 후 최종 크기(mm). */
  trimWidthMm: number;
  trimHeightMm: number;
  /** 도련(mm) — 보통 3mm. */
  bleedMm: number;
}

/**
 * 재단·도련이 들어간 페이지 박스를 계산한다.
 * MediaBox 는 도련 포함 전체, TrimBox 는 가운데 재단 영역이다(PDF 좌표계 = 좌하단 원점).
 */
export function printPageBoxes(spec: StudioPrintPageSpec): {
  widthPt: number;
  heightPt: number;
  trimBox: [number, number, number, number];
  bleedBox: [number, number, number, number];
} {
  const bleed = mmToPt(spec.bleedMm);
  const trimW = mmToPt(spec.trimWidthMm);
  const trimH = mmToPt(spec.trimHeightMm);
  return {
    widthPt: trimW + bleed * 2,
    heightPt: trimH + bleed * 2,
    trimBox: [bleed, bleed, bleed + trimW, bleed + trimH],
    bleedBox: [0, 0, trimW + bleed * 2, trimH + bleed * 2],
  };
}
