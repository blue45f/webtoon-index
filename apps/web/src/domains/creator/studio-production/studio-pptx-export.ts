const encoder = new TextEncoder();

export interface StudioPitchSlideExport {
  readonly title: string;
  readonly body: string;
}

export interface StudioPitchPptxInput {
  readonly title: string;
  readonly slides: readonly StudioPitchSlideExport[];
  readonly author?: string;
  readonly subject?: string;
}

interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const FIXED_DOS_DATE = 33;
const FIXED_DOS_TIME = 0;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0x0800);
    u16(localView, 8, 0);
    u16(localView, 10, FIXED_DOS_TIME);
    u16(localView, 12, FIXED_DOS_DATE);
    u32(localView, 14, crc);
    u32(localView, 18, entry.bytes.byteLength);
    u32(localView, 22, entry.bytes.byteLength);
    u16(localView, 26, name.byteLength);
    u16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, entry.bytes);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0x0800);
    u16(centralView, 10, 0);
    u16(centralView, 12, FIXED_DOS_TIME);
    u16(centralView, 14, FIXED_DOS_DATE);
    u32(centralView, 16, crc);
    u32(centralView, 20, entry.bytes.byteLength);
    u32(centralView, 24, entry.bytes.byteLength);
    u16(centralView, 28, name.byteLength);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.byteLength + entry.bytes.byteLength;
  }

  const central = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, entries.length);
  u16(endView, 10, entries.length);
  u32(endView, 12, central.byteLength);
  u32(endView, 16, localOffset);
  u16(endView, 20, 0);
  return concat([...localParts, central, end]);
}

function textBox(id: number, name: string, text: string, x: number, y: number, w: number, h: number, size: number, bold: boolean): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" sz="${size}"${bold ? ' b="1"' : ""}/><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="ko-KR" sz="${size}"/></a:p></p:txBody></p:sp>`;
}

function slideXml(projectTitle: string, slide: StudioPitchSlideExport, index: number): string {
  return `${XML_HEADER}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${textBox(2, "Project", projectTitle, 640080, 274320, 10972800, 457200, 1200, true)}${textBox(3, `Slide ${index} Title`, slide.title, 640080, 1188720, 10972800, 1371600, 3000, true)}${textBox(4, `Slide ${index} Body`, slide.body, 640080, 2834640, 10972800, 2743200, 1800, false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRels(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
}

function contentTypes(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slides}</Types>`;
}

function rootRels(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function presentationXml(slideCount: number): string {
  const ids = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return `${XML_HEADER}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function presentationRels(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`;
}

function slideMasterXml(): string {
  return `${XML_HEADER}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Toon Studio"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function slideMasterRels(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
}

function slideLayoutXml(): string {
  return `${XML_HEADER}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideLayoutRels(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
}

function themeXml(): string {
  return `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Toon Studio"><a:themeElements><a:clrScheme name="Toon Studio"><a:dk1><a:srgbClr val="191512"/></a:dk1><a:lt1><a:srgbClr val="FFF9F3"/></a:lt1><a:dk2><a:srgbClr val="3B332D"/></a:dk2><a:lt2><a:srgbClr val="F1E8DF"/></a:lt2><a:accent1><a:srgbClr val="E85D2A"/></a:accent1><a:accent2><a:srgbClr val="D79A63"/></a:accent2><a:accent3><a:srgbClr val="8B6F5C"/></a:accent3><a:accent4><a:srgbClr val="75665C"/></a:accent4><a:accent5><a:srgbClr val="A79A90"/></a:accent5><a:accent6><a:srgbClr val="CBB9AA"/></a:accent6><a:hlink><a:srgbClr val="356FD3"/></a:hlink><a:folHlink><a:srgbClr val="7C4D9E"/></a:folHlink></a:clrScheme><a:fontScheme name="Toon Studio"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="맑은 고딕"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="맑은 고딕"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Toon Studio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function coreXml(input: StudioPitchPptxInput): string {
  return `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.title)}</dc:title><dc:subject>${xml(input.subject ?? "Toon Studio pitch")}</dc:subject><dc:creator>${xml(input.author ?? "Toon Studio")}</dc:creator><cp:lastModifiedBy>${xml(input.author ?? "Toon Studio")}</cp:lastModifiedBy><cp:revision>1</cp:revision></cp:coreProperties>`;
}

function appXml(slideCount: number): string {
  return `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Toon Studio</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop></Properties>`;
}

function asEntry(name: string, contents: string): ZipEntry {
  return { name, bytes: encoder.encode(contents) };
}

export function buildStudioPitchPptx(input: StudioPitchPptxInput): Uint8Array {
  const title = input.title.trim();
  const slides = input.slides
    .map((slide) => ({ title: slide.title.trim(), body: slide.body.trim() }))
    .filter((slide) => slide.title.length > 0 || slide.body.length > 0)
    .slice(0, 100);
  if (!title) throw new Error("PPTX 제목이 필요합니다.");
  if (slides.length === 0) throw new Error("PPTX에 포함할 슬라이드가 필요합니다.");

  const entries: ZipEntry[] = [
    asEntry("[Content_Types].xml", contentTypes(slides.length)),
    asEntry("_rels/.rels", rootRels()),
    asEntry("docProps/core.xml", coreXml({ ...input, title })),
    asEntry("docProps/app.xml", appXml(slides.length)),
    asEntry("ppt/presentation.xml", presentationXml(slides.length)),
    asEntry("ppt/_rels/presentation.xml.rels", presentationRels(slides.length)),
    asEntry("ppt/slideMasters/slideMaster1.xml", slideMasterXml()),
    asEntry("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels()),
    asEntry("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml()),
    asEntry("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels()),
    asEntry("ppt/theme/theme1.xml", themeXml()),
  ];
  slides.forEach((slide, index) => {
    entries.push(
      asEntry(`ppt/slides/slide${index + 1}.xml`, slideXml(title, slide, index + 1)),
      asEntry(`ppt/slides/_rels/slide${index + 1}.xml.rels`, slideRels()),
    );
  });
  return storedZip(entries);
}

export function createStudioPitchPptxBlob(input: StudioPitchPptxInput): Blob {
  const bytes = buildStudioPitchPptx(input);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: PPTX_MIME });
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? "-" : character;
  }).join("");
}

export function studioPitchPptxFileName(title: string): string {
  const safe = replaceControlCharacters(title.trim())
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .slice(0, 80);
  return `${safe || "toon-studio-pitch"}.pptx`;
}
