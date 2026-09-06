/**
 * Studio PDF conformance profiles and deterministic preflight receipts.
 *
 * This module deliberately separates three claims:
 *
 * 1. `scanStudioPdfConformanceEvidence` reads the bounded, classic-xref PDF subset produced by
 *    ToonSpectrum's deterministic writer.
 * 2. `preflightStudioPdfConformance` applies a conservative, machine-checkable candidate profile.
 * 3. `importStudioVeraPdfResult` accepts a strictly normalized veraPDF result for PDF/A-2b.
 *
 * Neither a local candidate nor an imported validator result is a certification. The receipt
 * always records `thirdPartyCertification: "not-claimed"`. Unknown profiles, unknown rules,
 * incomplete scans, malformed external reports, and receipt tampering all fail closed.
 */

import {
  dictName,
  dictNumber,
  dictNumberArray,
  dictRef,
  dictRefArray,
  readPdf,
  type StudioPdfReadDocument,
} from "./render/studio-canvaskit-pdf-reader";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_PDF_CONFORMANCE_SCANNER_ID =
  "toonspectrum.studio.pdf-classic-xref-scanner" as const;
export const STUDIO_PDF_CONFORMANCE_SCANNER_VERSION = 1 as const;
export const STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA =
  "toonspectrum.studio.pdf-conformance-receipt" as const;
export const STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION = 1 as const;

export const STUDIO_PDF_CONFORMANCE_PROFILE_IDS = [
  "pdf-1.7",
  "pdf-a-2b",
  "pdf-x-4",
] as const;

export type StudioPdfConformanceProfileId =
  (typeof STUDIO_PDF_CONFORMANCE_PROFILE_IDS)[number];
export type StudioPdfSha256 = `sha256:${string}`;

export const STUDIO_PDF_CONFORMANCE_LOCAL_RULE_IDS = [
  "scanner.inspection-complete",
  "pdf.structure-valid",
  "pdf.pages-present",
  "pdf.media-boxes",
  "pdf.version-1.7",
  "pdf.version-1.6",
  "pdf.file-identifier",
  "pdf-a.xmp-identification",
  "pdf-a.output-intent",
  "pdf-a.fonts-embedded",
  "pdf-a.no-encryption",
  "pdf-a.no-active-content",
  "pdf-a.no-external-content",
  "pdf-a.no-multimedia-or-3d",
  "pdf-a.no-unverified-embedded-files",
  "pdf-a.no-unverified-annotations",
  "pdf-x.xmp-identification",
  "pdf-x.info-identification",
  "pdf-x.trapped-declared",
  "pdf-x.output-intent",
  "pdf-x.fonts-embedded",
  "pdf-x.page-boundaries",
  "pdf-x.device-color-consistency",
  "pdf-x.no-encryption",
  "pdf-x.no-active-content",
  "pdf-x.no-external-content",
  "pdf-x.no-multimedia-or-3d",
  "pdf-x.no-embedded-files",
  "pdf-x.no-annotations",
] as const;

export type StudioPdfConformanceLocalRuleId =
  (typeof STUDIO_PDF_CONFORMANCE_LOCAL_RULE_IDS)[number];

const RECEIPT_BOUNDARY_RULE_IDS = [
  "request.valid",
  "request.profile-known",
  "external.verapdf-import",
  "external.verapdf-compliance",
] as const;

type StudioPdfConformanceBoundaryRuleId =
  (typeof RECEIPT_BOUNDARY_RULE_IDS)[number];

export type StudioPdfConformanceRuleId =
  | StudioPdfConformanceBoundaryRuleId
  | StudioPdfConformanceLocalRuleId;

export interface StudioPdfConformanceProfile {
  readonly id: StudioPdfConformanceProfileId;
  readonly label: string;
  readonly standard: "ISO 15930-7:2010" | "ISO 19005-2:2011" | "ISO 32000-1:2008";
  readonly requiredPdfVersion: "1.6" | "1.7";
  /**
   * These checks define ToonSpectrum's conservative generated-file subset. Passing them does not
   * claim that every requirement in the referenced ISO standard has been independently checked.
   */
  readonly claim: "local-candidate-only";
  readonly thirdPartyCertification: "not-claimed";
  readonly requiredRules: readonly StudioPdfConformanceLocalRuleId[];
  readonly forbiddenFeatureRules: readonly StudioPdfConformanceLocalRuleId[];
  readonly allowedFeatures: readonly ("optional-content" | "transparency")[];
  /** veraPDF currently supplies the external boundary only for PDF/A-2b. */
  readonly veraPdfFlavour: "2b" | null;
}

const COMMON_PDF_17_RULES = [
  "scanner.inspection-complete",
  "pdf.structure-valid",
  "pdf.pages-present",
  "pdf.media-boxes",
  "pdf.version-1.7",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

const COMMON_PDF_16_RULES = [
  "scanner.inspection-complete",
  "pdf.structure-valid",
  "pdf.pages-present",
  "pdf.media-boxes",
  "pdf.version-1.6",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

const PDF_A_REQUIRED_RULES = [
  ...COMMON_PDF_17_RULES,
  "pdf.file-identifier",
  "pdf-a.xmp-identification",
  "pdf-a.output-intent",
  "pdf-a.fonts-embedded",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

const PDF_A_FORBIDDEN_RULES = [
  "pdf-a.no-encryption",
  "pdf-a.no-active-content",
  "pdf-a.no-external-content",
  "pdf-a.no-multimedia-or-3d",
  "pdf-a.no-unverified-embedded-files",
  "pdf-a.no-unverified-annotations",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

const PDF_X_REQUIRED_RULES = [
  ...COMMON_PDF_16_RULES,
  "pdf.file-identifier",
  "pdf-x.xmp-identification",
  "pdf-x.info-identification",
  "pdf-x.trapped-declared",
  "pdf-x.output-intent",
  "pdf-x.fonts-embedded",
  "pdf-x.page-boundaries",
  "pdf-x.device-color-consistency",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

const PDF_X_FORBIDDEN_RULES = [
  "pdf-x.no-encryption",
  "pdf-x.no-active-content",
  "pdf-x.no-external-content",
  "pdf-x.no-multimedia-or-3d",
  "pdf-x.no-embedded-files",
  "pdf-x.no-annotations",
] as const satisfies readonly StudioPdfConformanceLocalRuleId[];

export const STUDIO_PDF_CONFORMANCE_PROFILES: Readonly<
  Record<StudioPdfConformanceProfileId, StudioPdfConformanceProfile>
> = deepFreeze({
  "pdf-1.7": {
    id: "pdf-1.7",
    label: "PDF 1.7",
    standard: "ISO 32000-1:2008",
    requiredPdfVersion: "1.7",
    claim: "local-candidate-only",
    thirdPartyCertification: "not-claimed",
    requiredRules: COMMON_PDF_17_RULES,
    forbiddenFeatureRules: [],
    allowedFeatures: ["transparency", "optional-content"],
    veraPdfFlavour: null,
  },
  "pdf-a-2b": {
    id: "pdf-a-2b",
    label: "PDF/A-2b",
    standard: "ISO 19005-2:2011",
    requiredPdfVersion: "1.7",
    claim: "local-candidate-only",
    thirdPartyCertification: "not-claimed",
    requiredRules: PDF_A_REQUIRED_RULES,
    forbiddenFeatureRules: PDF_A_FORBIDDEN_RULES,
    // PDF/A-2, unlike PDF/A-1, can preserve live transparency and optional content.
    allowedFeatures: ["transparency", "optional-content"],
    veraPdfFlavour: "2b",
  },
  "pdf-x-4": {
    id: "pdf-x-4",
    label: "PDF/X-4",
    standard: "ISO 15930-7:2010",
    requiredPdfVersion: "1.6",
    claim: "local-candidate-only",
    thirdPartyCertification: "not-claimed",
    requiredRules: PDF_X_REQUIRED_RULES,
    forbiddenFeatureRules: PDF_X_FORBIDDEN_RULES,
    // Live transparency and limited optional content are defining PDF/X-4 capabilities.
    allowedFeatures: ["transparency", "optional-content"],
    veraPdfFlavour: null,
  },
});

export function resolveStudioPdfConformanceProfile(
  value: unknown,
): StudioPdfConformanceProfile | null {
  if (
    typeof value !== "string"
    || !(STUDIO_PDF_CONFORMANCE_PROFILE_IDS as readonly string[]).includes(value)
  ) {
    return null;
  }
  return STUDIO_PDF_CONFORMANCE_PROFILES[value as StudioPdfConformanceProfileId];
}

export type StudioPdfOutputIntentKind =
  | "GTS_PDFA1"
  | "GTS_PDFX"
  | "none"
  | "unknown";

export interface StudioPdfConformanceEvidence {
  readonly scanner: Readonly<{
    id: typeof STUDIO_PDF_CONFORMANCE_SCANNER_ID;
    version: typeof STUDIO_PDF_CONFORMANCE_SCANNER_VERSION;
    inspectionComplete: boolean;
  }>;
  readonly sourceDigest: StudioPdfSha256;
  readonly structureValid: boolean;
  readonly pdfVersion: string;
  readonly pageCount: number;
  readonly fileIdentifier: Readonly<{
    present: boolean;
    valid: boolean;
    permanentId: string | null;
    revisionId: string | null;
  }>;
  readonly pages: Readonly<{
    allHaveMediaBox: boolean;
    allHaveTrimOrArtBox: boolean;
    hasTrimArtConflict: boolean;
    pageBoundariesValid: boolean;
  }>;
  readonly metadata: Readonly<{
    xmpPresent: boolean;
    pdfaPart: number | null;
    pdfaConformance: string | null;
    pdfxVersion: string | null;
    infoPdfxVersion: string | null;
    trapped: "False" | "True" | "Unknown" | null;
  }>;
  readonly fonts: Readonly<{
    used: number;
    embedded: number;
    resourceResolutionComplete: boolean;
    allUsedEmbedded: boolean;
  }>;
  readonly color: Readonly<{
    usesDeviceRgb: boolean;
    usesDeviceCmyk: boolean;
    usesDeviceGray: boolean;
    outputIntentCount: number;
    outputIntent: StudioPdfOutputIntentKind;
    outputIntentIccEmbedded: boolean;
    outputIntentComponents: 3 | 4 | null;
    outputIntentIdentifierPresent: boolean;
    outputIntentRegistryName: string | null;
    deviceColorMatchesOutputIntent: boolean;
  }>;
  readonly features: Readonly<{
    encrypted: boolean;
    javascript: boolean;
    launchActions: boolean;
    externalReferences: boolean;
    multimedia: boolean;
    threeD: boolean;
    embeddedFiles: boolean;
    annotations: number;
    nonPrintingAnnotations: boolean;
    transparency: boolean;
    optionalContent: boolean;
  }>;
}

export type StudioPdfConformanceScanResult =
  | Readonly<{
      ok: true;
      evidence: StudioPdfConformanceEvidence;
    }>
  | Readonly<{
      ok: false;
      sourceDigest: StudioPdfSha256;
      error: Readonly<{
        code: "pdf-parse-failed" | "scanner-failed";
        message: string;
      }>;
    }>;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const PDF_ID_PATTERN = /^[0-9a-f]{32,128}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function hashBytes(bytes: Uint8Array): StudioPdfSha256 {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function dictionaryPart(body: string): string {
  const streamIndex = body.indexOf("stream");
  return streamIndex < 0 ? body : body.slice(0, streamIndex);
}

function xmpProperty(xml: string, qualifiedName: string): string | null {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const attribute = new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "u").exec(xml);
  if (attribute) return attribute[1]!.trim();
  const element = new RegExp(
    `<${escaped}\\b[^>]*>\\s*([^<]+?)\\s*</${escaped}\\s*>`,
    "u",
  ).exec(xml);
  return element ? element[1]!.trim() : null;
}

function dictLiteral(dict: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*\\(([^()]*)\\)`, "u").exec(dict);
  return match ? match[1]!.replace(/\\\\([\\()])/gu, "$1") : null;
}

function streamHasUnsupportedFilter(
  document: StudioPdfReadDocument,
  objectNumber: number | null,
): boolean {
  if (objectNumber === null) return false;
  const body = document.objectBodies.get(objectNumber);
  return body !== undefined && /\/Filter\b/u.test(dictionaryPart(body));
}

function pageContentInspectionComplete(document: StudioPdfReadDocument): boolean {
  for (const page of document.pages) {
    const contents = dictRef(page.dict, "Contents");
    if (/\/Contents\b/u.test(page.dict) && contents === null) return false;
    if (streamHasUnsupportedFilter(document, contents)) return false;
  }
  return true;
}

function scanPageBoxes(document: StudioPdfReadDocument): StudioPdfConformanceEvidence["pages"] {
  let allHaveTrimOrArtBox = document.pages.length > 0;
  let hasTrimArtConflict = false;
  let pageBoundariesValid = document.pages.length > 0;
  for (const page of document.pages) {
    const trim = page.trimBox;
    const art = dictNumberArray(page.dict, "ArtBox");
    const bleed = page.bleedBox;
    const mediaBox =
      validPageBox(page.mediaBox) ? page.mediaBox : null;
    const trimBox = validPageBox(trim) ? trim : null;
    const artBox = validPageBox(art) ? art : null;
    const bleedBox = validPageBox(bleed) ? bleed : null;
    if (!trimBox && !artBox) allHaveTrimOrArtBox = false;
    if (trimBox && artBox) hasTrimArtConflict = true;
    const finalBox = trimBox ?? artBox;
    if (
      mediaBox === null
      || (trim !== null && trimBox === null)
      || (art !== null && artBox === null)
      || (bleed !== null && bleedBox === null)
      || (finalBox !== null && !boxContains(mediaBox, finalBox))
      || (
        bleedBox !== null
        && (
          !boxContains(mediaBox, bleedBox)
          || (finalBox !== null && !boxContains(bleedBox, finalBox))
        )
      )
    ) {
      pageBoundariesValid = false;
    }
  }
  return {
    allHaveMediaBox:
      document.pages.length > 0
      && document.pages.every((page) => validPageBox(page.mediaBox)),
    allHaveTrimOrArtBox,
    hasTrimArtConflict,
    pageBoundariesValid,
  };
}

function validPageBox(
  value: readonly number[] | null,
): value is readonly [number, number, number, number] {
  return (
    value !== null
    && value.length === 4
    && value.every(Number.isFinite)
    && value[2]! > value[0]!
    && value[3]! > value[1]!
  );
}

function boxContains(
  outer: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
): boolean {
  return (
    outer[0] <= inner[0]
    && outer[1] <= inner[1]
    && outer[2] >= inner[2]
    && outer[3] >= inner[3]
  );
}

function scanFileIdentifier(
  trailer: string,
): StudioPdfConformanceEvidence["fileIdentifier"] {
  const match =
    /\/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/u.exec(trailer);
  if (!match) {
    return {
      present: false,
      valid: false,
      permanentId: null,
      revisionId: null,
    };
  }
  const permanentId = match[1]!.toLowerCase();
  const revisionId = match[2]!.toLowerCase();
  return {
    present: true,
    valid:
      PDF_ID_PATTERN.test(permanentId)
      && PDF_ID_PATTERN.test(revisionId)
      && permanentId.length % 2 === 0
      && revisionId.length % 2 === 0,
    permanentId,
    revisionId,
  };
}

function scanMetadata(
  document: StudioPdfReadDocument,
): {
  metadata: StudioPdfConformanceEvidence["metadata"];
  metadataComplete: boolean;
} {
  const metadataRef = dictRef(document.catalog, "Metadata");
  const metadataBody =
    metadataRef === null ? undefined : document.objectBodies.get(metadataRef);
  const metadataBytes =
    metadataRef === null ? undefined : document.streams.get(metadataRef);
  const hasXmlSubtype =
    metadataBody !== undefined
    && dictName(dictionaryPart(metadataBody), "Subtype") === "XML";
  const hasUnsupportedFilter = streamHasUnsupportedFilter(document, metadataRef);
  let xml = "";
  let metadataComplete = !hasUnsupportedFilter;
  if (metadataBytes && hasXmlSubtype && !hasUnsupportedFilter) {
    try {
      xml = utf8Decoder.decode(metadataBytes);
    } catch {
      metadataComplete = false;
    }
  } else if (metadataRef !== null) {
    metadataComplete = false;
  }

  const pdfaPartText = xml ? xmpProperty(xml, "pdfaid:part") : null;
  const parsedPart =
    pdfaPartText !== null && /^\d+$/u.test(pdfaPartText)
      ? Number(pdfaPartText)
      : null;
  const trapped = dictName(document.info, "Trapped");
  return {
    metadata: {
      xmpPresent: xml.length > 0,
      pdfaPart: parsedPart,
      pdfaConformance: xml ? xmpProperty(xml, "pdfaid:conformance") : null,
      pdfxVersion: xml ? xmpProperty(xml, "pdfxid:GTS_PDFXVersion") : null,
      infoPdfxVersion: dictLiteral(document.info, "GTS_PDFXVersion"),
      trapped:
        trapped === "False" || trapped === "True" || trapped === "Unknown"
          ? trapped
          : null,
    },
    metadataComplete,
  };
}

interface FontResourceEntry {
  readonly name: string;
  readonly objectNumber: number;
}

function pageFontResources(dict: string): readonly FontResourceEntry[] {
  const fontDictionary = /\/Font\s*<<([\s\S]*?)>>/u.exec(dict);
  if (!fontDictionary) return [];
  const resources: FontResourceEntry[] = [];
  const entryPattern = /\/([A-Za-z0-9#_.-]+)\s+(\d+)\s+0\s+R/gu;
  let match: RegExpExecArray | null = entryPattern.exec(fontDictionary[1]!);
  while (match) {
    resources.push({
      name: match[1]!,
      objectNumber: Number(match[2]),
    });
    match = entryPattern.exec(fontDictionary[1]!);
  }
  return resources;
}

function fontObjectIsEmbedded(
  document: StudioPdfReadDocument,
  fontObjectNumber: number,
): boolean {
  const fontBody = document.objectBodies.get(fontObjectNumber);
  if (!fontBody) return false;
  let descriptorOwner = dictionaryPart(fontBody);
  const descendants = dictRefArray(descriptorOwner, "DescendantFonts");
  if (descendants.length > 0) {
    const descendantBody = document.objectBodies.get(descendants[0]!);
    if (!descendantBody) return false;
    descriptorOwner = dictionaryPart(descendantBody);
  }
  const descriptorRef = dictRef(descriptorOwner, "FontDescriptor");
  if (descriptorRef === null) return false;
  const descriptorBody = document.objectBodies.get(descriptorRef);
  if (!descriptorBody) return false;
  const descriptor = dictionaryPart(descriptorBody);
  const fileRef =
    dictRef(descriptor, "FontFile")
    ?? dictRef(descriptor, "FontFile2")
    ?? dictRef(descriptor, "FontFile3");
  return fileRef !== null && document.streams.has(fileRef);
}

function scanFonts(
  document: StudioPdfReadDocument,
): StudioPdfConformanceEvidence["fonts"] {
  const usedObjects = new Set<number>();
  let resourceResolutionComplete = true;
  for (const page of document.pages) {
    const resources = new Map(
      pageFontResources(page.dict).map((entry) => [
        entry.name,
        entry.objectNumber,
      ]),
    );
    const usedNames = new Set<string>();
    const usePattern =
      /\/([A-Za-z0-9#_.-]+)\s+-?(?:\d+(?:\.\d*)?|\.\d+)\s+Tf(?=[\s]|$)/gu;
    let match: RegExpExecArray | null = usePattern.exec(page.content);
    while (match) {
      usedNames.add(match[1]!);
      match = usePattern.exec(page.content);
    }
    for (const name of usedNames) {
      const objectNumber = resources.get(name);
      if (objectNumber === undefined) {
        resourceResolutionComplete = false;
      } else {
        usedObjects.add(objectNumber);
      }
    }
  }
  let embedded = 0;
  for (const objectNumber of usedObjects) {
    if (fontObjectIsEmbedded(document, objectNumber)) embedded += 1;
  }
  return {
    used: usedObjects.size,
    embedded,
    resourceResolutionComplete,
    allUsedEmbedded:
      resourceResolutionComplete && embedded === usedObjects.size,
  };
}

function outputIntentKind(value: string | null): StudioPdfOutputIntentKind {
  if (value === null) return "unknown";
  if (value === "GTS_PDFA1" || value === "GTS_PDFX") return value;
  return "unknown";
}

function embeddedIccIsValid(
  bytes: Uint8Array | undefined,
  components: 3 | 4 | null,
): boolean {
  if (!bytes || bytes.byteLength < 132 || components === null) return false;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  if (view.getUint32(0, false) !== bytes.byteLength) return false;
  const signature = String.fromCharCode(
    bytes[36]!,
    bytes[37]!,
    bytes[38]!,
    bytes[39]!,
  );
  const colorSpace = String.fromCharCode(
    bytes[16]!,
    bytes[17]!,
    bytes[18]!,
    bytes[19]!,
  );
  return (
    signature === "acsp"
    && colorSpace === (components === 4 ? "CMYK" : "RGB ")
  );
}

function scanColor(
  document: StudioPdfReadDocument,
): StudioPdfConformanceEvidence["color"] {
  const cmykPattern = /(?:^|[\s])(?:-?[\d.]+\s+){4}[kK](?=[\s]|$)/mu;
  const rgbPattern = /(?:^|[\s])(?:-?[\d.]+\s+){3}(?:rg|RG)(?=[\s]|$)/mu;
  const grayPattern = /(?:^|[\s])-?[\d.]+\s+[gG](?=[\s]|$)/mu;
  let usesDeviceCmyk = false;
  let usesDeviceRgb = false;
  let usesDeviceGray = false;
  for (const page of document.pages) {
    usesDeviceCmyk ||= cmykPattern.test(page.content);
    usesDeviceRgb ||= rgbPattern.test(page.content);
    usesDeviceGray ||= grayPattern.test(page.content);
  }

  const dictionaries = [...document.objectBodies.values()].map(dictionaryPart);
  for (const dictionary of dictionaries) {
    if (!/\/Subtype\s*\/Image\b/u.test(dictionary)) continue;
    usesDeviceCmyk ||= /\/ColorSpace\s*\/DeviceCMYK\b/u.test(dictionary);
    usesDeviceRgb ||= /\/ColorSpace\s*\/DeviceRGB\b/u.test(dictionary);
    usesDeviceGray ||= /\/ColorSpace\s*\/DeviceGray\b/u.test(dictionary);
  }

  const outputIntentRefs = dictRefArray(document.catalog, "OutputIntents");
  const intentBody =
    outputIntentRefs.length === 1
      ? document.objectBodies.get(outputIntentRefs[0]!)
      : undefined;
  const intentDictionary =
    intentBody === undefined ? "" : dictionaryPart(intentBody);
  const destinationRef =
    intentDictionary ? dictRef(intentDictionary, "DestOutputProfile") : null;
  const profileBody =
    destinationRef === null
      ? undefined
      : document.objectBodies.get(destinationRef);
  const components =
    profileBody === undefined
      ? null
      : dictNumber(dictionaryPart(profileBody), "N");
  const outputIntentComponents =
    components === 3 || components === 4 ? components : null;
  const outputIntent =
    outputIntentRefs.length === 0
      ? "none"
      : outputIntentKind(dictName(intentDictionary, "S"));
  const outputIntentIccEmbedded =
    destinationRef !== null
    && embeddedIccIsValid(
      document.streams.get(destinationRef),
      outputIntentComponents,
    );
  const outputIntentIdentifierPresent =
    /\/OutputConditionIdentifier\s*(?:\(|<)/u.test(intentDictionary);
  const outputIntentRegistryName =
    dictLiteral(intentDictionary, "RegistryName");
  const hasDeviceColor =
    usesDeviceCmyk || usesDeviceRgb || usesDeviceGray;
  const deviceColorMatchesOutputIntent =
    !hasDeviceColor
    || (
      outputIntentIccEmbedded
      && !(
        usesDeviceCmyk
        && usesDeviceRgb
      )
      && (!usesDeviceCmyk || outputIntentComponents === 4)
      && (!usesDeviceRgb || outputIntentComponents === 3)
    );

  return {
    usesDeviceRgb,
    usesDeviceCmyk,
    usesDeviceGray,
    outputIntentCount: outputIntentRefs.length,
    outputIntent,
    outputIntentIccEmbedded,
    outputIntentComponents,
    outputIntentIdentifierPresent,
    outputIntentRegistryName,
    deviceColorMatchesOutputIntent,
  };
}

function scanFeatures(
  document: StudioPdfReadDocument,
): StudioPdfConformanceEvidence["features"] {
  const dictionaries = [...document.objectBodies.values()].map(dictionaryPart);
  const text = dictionaries.join("\n");
  let annotations = 0;
  let nonPrintingAnnotations = false;
  for (const dictionary of dictionaries) {
    if (!/\/Type\s*\/Annot\b/u.test(dictionary)) continue;
    annotations += 1;
    const flags = dictNumber(dictionary, "F");
    if (
      flags === null
      || !Number.isSafeInteger(flags)
      || (flags & 4) === 0
    ) {
      nonPrintingAnnotations = true;
    }
  }
  const transparency =
    /\/SMask\b/u.test(text)
    || /\/BM\s*\/(?!Normal\b)[A-Za-z0-9#_.-]+/u.test(text)
    || dictionaries.some((dictionary) => {
      const fillAlpha = dictNumber(dictionary, "ca");
      const strokeAlpha = dictNumber(dictionary, "CA");
      return (
        (fillAlpha !== null && fillAlpha < 1)
        || (strokeAlpha !== null && strokeAlpha < 1)
      );
    });
  return {
    encrypted: /\/Encrypt\b/u.test(document.trailer),
    javascript:
      /\/S\s*\/JavaScript\b/u.test(text)
      || /\/JavaScript\b/u.test(text)
      || /\/JS\b/u.test(text),
    launchActions: /\/S\s*\/Launch\b/u.test(text),
    externalReferences:
      /\/S\s*\/GoToR\b/u.test(text)
      || /\/FS\s*\/URL\b/u.test(text)
      || /\/Type\s*\/Filespec\b/u.test(text),
    multimedia:
      /\/Subtype\s*\/(?:Movie|RichMedia|Screen|Sound)\b/u.test(text)
      || /\/RichMedia\b/u.test(text),
    threeD:
      /\/Subtype\s*\/3D\b/u.test(text)
      || /\/Type\s*\/3D\b/u.test(text),
    embeddedFiles:
      /\/Type\s*\/EmbeddedFile\b/u.test(text)
      || /\/EmbeddedFiles\b/u.test(text),
    annotations,
    nonPrintingAnnotations,
    transparency,
    optionalContent:
      /\/OCProperties\b/u.test(document.catalog)
      || /\/Type\s*\/OCG\b/u.test(text),
  };
}

function scannerCanInspectCompletely(
  document: StudioPdfReadDocument,
  metadataComplete: boolean,
): boolean {
  return (
    metadataComplete
    && pageContentInspectionComplete(document)
    && !/\/Prev\b/u.test(document.trailer)
    && ![...document.objectBodies.values()].some((body) =>
      /\/Type\s*\/ObjStm\b/u.test(dictionaryPart(body)),
    )
  );
}

/**
 * Scans the deterministic classic-xref subset used by ToonSpectrum's PDF writer.
 *
 * Unsupported PDF mechanisms do not silently disappear from evidence. A parser failure returns
 * `ok:false`; a mechanism the reader can parse but cannot inspect completely produces
 * `inspectionComplete:false`, which every profile rejects.
 */
export function scanStudioPdfConformanceEvidence(
  input: Uint8Array | ArrayBuffer,
): StudioPdfConformanceScanResult {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  const sourceDigest = hashBytes(bytes);
  const parsed = readPdf(bytes);
  if (!parsed.ok) {
    return deepFreeze({
      ok: false,
      sourceDigest,
      error: {
        code: "pdf-parse-failed",
        message: parsed.error,
      },
    });
  }

  try {
    const document = parsed.document;
    const { metadata, metadataComplete } = scanMetadata(document);
    const evidence: StudioPdfConformanceEvidence = {
      scanner: {
        id: STUDIO_PDF_CONFORMANCE_SCANNER_ID,
        version: STUDIO_PDF_CONFORMANCE_SCANNER_VERSION,
        inspectionComplete: scannerCanInspectCompletely(
          document,
          metadataComplete,
        ),
      },
      sourceDigest,
      structureValid: true,
      pdfVersion: document.version,
      pageCount: document.pages.length,
      fileIdentifier: scanFileIdentifier(document.trailer),
      pages: scanPageBoxes(document),
      metadata,
      fonts: scanFonts(document),
      color: scanColor(document),
      features: scanFeatures(document),
    };
    return deepFreeze({ ok: true, evidence });
  } catch {
    return deepFreeze({
      ok: false,
      sourceDigest,
      error: {
        code: "scanner-failed",
        message: "PDF conformance evidence를 끝까지 수집하지 못했습니다.",
      },
    });
  }
}

export const STUDIO_VERAPDF_RESULT_SCHEMA =
  "toonspectrum.external.verapdf-result" as const;
export const STUDIO_VERAPDF_RESULT_VERSION = 1 as const;
export const STUDIO_VERAPDF_RULE_IDS = [
  "verapdf.parser",
  "verapdf.profile-selection",
  "verapdf.pdf-a-2b-validation",
] as const;

export type StudioVeraPdfRuleId =
  (typeof STUDIO_VERAPDF_RULE_IDS)[number];

export interface StudioVeraPdfResultEnvelope {
  readonly schema: typeof STUDIO_VERAPDF_RESULT_SCHEMA;
  readonly version: typeof STUDIO_VERAPDF_RESULT_VERSION;
  readonly provider: "veraPDF";
  readonly providerVersion: string;
  readonly profile: "PDF/A-2b";
  readonly sourceDigest: StudioPdfSha256;
  readonly validationComplete: true;
  readonly isCompliant: boolean;
  readonly rules: readonly Readonly<{
    id: StudioVeraPdfRuleId;
    status: "failed" | "passed";
    failedChecks: number;
  }>[];
}

export interface StudioVeraPdfImportExpectation {
  readonly profile: StudioPdfConformanceProfileId;
  readonly sourceDigest: StudioPdfSha256;
}

export type StudioVeraPdfImportFailureCode =
  | "digest-mismatch"
  | "incomplete-validation"
  | "inconsistent-summary"
  | "invalid-shape"
  | "profile-mismatch"
  | "unknown-profile"
  | "unknown-rule"
  | "unsupported-profile";

export type StudioVeraPdfImportResult =
  | Readonly<{
      accepted: true;
      result: StudioVeraPdfResultEnvelope;
    }>
  | Readonly<{
      accepted: false;
      code: StudioVeraPdfImportFailureCode;
    }>;

function importFailure(
  code: StudioVeraPdfImportFailureCode,
): StudioVeraPdfImportResult {
  return Object.freeze({ accepted: false, code });
}

/**
 * Imports a normalized veraPDF adapter result.
 *
 * veraPDF validates PDF/A, not PDF/X. The only supported external flavour here is therefore
 * PDF/A-2b. A raw CLI JSON/XML report must first be mapped by a trusted adapter to this exact,
 * bounded envelope. Unknown summary rules and extra fields are rejected instead of ignored.
 */
export function importStudioVeraPdfResult(
  value: unknown,
  expected: StudioVeraPdfImportExpectation,
): StudioVeraPdfImportResult {
  if (
    !isExactRecord(expected, ["profile", "sourceDigest"])
    || typeof expected.profile !== "string"
    || typeof expected.sourceDigest !== "string"
  ) {
    return importFailure("invalid-shape");
  }
  if (!resolveStudioPdfConformanceProfile(expected.profile)) {
    return importFailure("unknown-profile");
  }
  if (expected.profile !== "pdf-a-2b") {
    return importFailure("unsupported-profile");
  }
  if (!SHA256_PATTERN.test(expected.sourceDigest)) {
    return importFailure("invalid-shape");
  }
  if (
    !isExactRecord(value, [
      "isCompliant",
      "profile",
      "provider",
      "providerVersion",
      "rules",
      "schema",
      "sourceDigest",
      "validationComplete",
      "version",
    ])
  ) {
    return importFailure("invalid-shape");
  }
  if (
    value.schema !== STUDIO_VERAPDF_RESULT_SCHEMA
    || value.version !== STUDIO_VERAPDF_RESULT_VERSION
    || value.provider !== "veraPDF"
    || typeof value.providerVersion !== "string"
    || !/^[0-9A-Za-z.+_-]{1,64}$/u.test(value.providerVersion)
    || typeof value.isCompliant !== "boolean"
    || !Array.isArray(value.rules)
  ) {
    return importFailure("invalid-shape");
  }
  if (value.profile !== "PDF/A-2b") {
    return importFailure("profile-mismatch");
  }
  if (
    typeof value.sourceDigest !== "string"
    || !SHA256_PATTERN.test(value.sourceDigest)
  ) {
    return importFailure("invalid-shape");
  }
  if (value.sourceDigest !== expected.sourceDigest) {
    return importFailure("digest-mismatch");
  }
  if (value.validationComplete !== true) {
    return importFailure("incomplete-validation");
  }

  const knownRules = new Set<string>(STUDIO_VERAPDF_RULE_IDS);
  const ruleMap = new Map<
    StudioVeraPdfRuleId,
    StudioVeraPdfResultEnvelope["rules"][number]
  >();
  for (const candidate of value.rules) {
    if (
      !isExactRecord(candidate, ["failedChecks", "id", "status"])
      || typeof candidate.id !== "string"
    ) {
      return importFailure("invalid-shape");
    }
    if (!knownRules.has(candidate.id)) {
      return importFailure("unknown-rule");
    }
    if (
      candidate.status !== "passed"
      && candidate.status !== "failed"
    ) {
      return importFailure("invalid-shape");
    }
    if (
      typeof candidate.failedChecks !== "number"
      || !Number.isSafeInteger(candidate.failedChecks)
      || candidate.failedChecks < 0
    ) {
      return importFailure("invalid-shape");
    }
    const id = candidate.id as StudioVeraPdfRuleId;
    if (ruleMap.has(id)) return importFailure("invalid-shape");
    ruleMap.set(id, {
      id,
      status: candidate.status,
      failedChecks: candidate.failedChecks,
    });
  }
  if (ruleMap.size !== STUDIO_VERAPDF_RULE_IDS.length) {
    return importFailure("incomplete-validation");
  }
  const rules = STUDIO_VERAPDF_RULE_IDS.map((id) => ruleMap.get(id)!);
  const computedCompliant = rules.every(
    (rule) => rule.status === "passed" && rule.failedChecks === 0,
  );
  if (computedCompliant !== value.isCompliant) {
    return importFailure("inconsistent-summary");
  }
  for (const rule of rules) {
    if (
      (rule.status === "passed" && rule.failedChecks !== 0)
      || (rule.status === "failed" && rule.failedChecks === 0)
    ) {
      return importFailure("inconsistent-summary");
    }
  }

  return deepFreeze({
    accepted: true,
    result: {
      schema: STUDIO_VERAPDF_RESULT_SCHEMA,
      version: STUDIO_VERAPDF_RESULT_VERSION,
      provider: "veraPDF",
      providerVersion: value.providerVersion,
      profile: "PDF/A-2b",
      sourceDigest: value.sourceDigest as StudioPdfSha256,
      validationComplete: true,
      isCompliant: value.isCompliant,
      rules,
    },
  });
}

export interface StudioPdfConformanceRuleResult {
  readonly id: StudioPdfConformanceRuleId;
  readonly source: "local-preflight" | "external-validator";
  readonly requirement: "boundary" | "forbidden" | "required";
  readonly status: "failed" | "passed";
  readonly message: string;
}

export interface StudioPdfConformanceReceipt {
  readonly schema: typeof STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA;
  readonly version: typeof STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION;
  readonly profile: StudioPdfConformanceProfileId | null;
  readonly sourceDigest: StudioPdfSha256 | null;
  /** SHA-256 of the strict canonical evidence object used for this decision. */
  readonly evidenceHash: StudioPdfSha256 | null;
  readonly result: Readonly<{
    decision:
      | "external-validator-confirmed"
      | "local-candidate"
      | "rejected";
    localPreflight: "failed" | "not-run" | "passed";
    externalValidation: "failed" | "not-run" | "passed";
    thirdPartyCertification: "not-claimed";
  }>;
  readonly rules: readonly StudioPdfConformanceRuleResult[];
  readonly externalValidation: StudioVeraPdfResultEnvelope | null;
  readonly limitations: readonly string[];
  readonly receiptHash: StudioPdfSha256;
}

export interface StudioPdfConformancePreflightInput {
  readonly profile: StudioPdfConformanceProfileId;
  readonly evidence: StudioPdfConformanceEvidence;
  readonly veraPdf?: unknown;
}

const RECEIPT_LIMITATIONS = deepFreeze([
  "The local scanner covers ToonSpectrum's classic-xref, non-object-stream writer subset; it is not a complete ISO validator.",
  "A local pass is a generated-file candidate result, not PDF Association, ISO, print-provider, or archival certification.",
  "An imported veraPDF pass records an external validator result for the exact SHA-256 source only; third-party certification remains not claimed.",
] as const);

interface RuleEvaluation {
  readonly passed: boolean;
  readonly message: string;
}

function required(
  passed: boolean,
  message: string,
): RuleEvaluation {
  return { passed, message };
}

function evaluateLocalRule(
  id: StudioPdfConformanceLocalRuleId,
  evidence: StudioPdfConformanceEvidence,
): RuleEvaluation {
  switch (id) {
    case "scanner.inspection-complete":
      return required(
        evidence.scanner.inspectionComplete,
        "The scanner must inspect every conformance-relevant structure.",
      );
    case "pdf.structure-valid":
      return required(
        evidence.structureValid,
        "The PDF header, xref, trailer, object offsets, and page tree must parse.",
      );
    case "pdf.pages-present":
      return required(
        evidence.pageCount > 0,
        "The document must contain at least one page.",
      );
    case "pdf.media-boxes":
      return required(
        evidence.pages.allHaveMediaBox,
        "Every page must have a valid MediaBox.",
      );
    case "pdf.version-1.7":
      return required(
        evidence.pdfVersion === "1.7",
        "This profile requires PDF version 1.7.",
      );
    case "pdf.version-1.6":
      return required(
        evidence.pdfVersion === "1.6",
        "PDF/X-4 is based on PDF version 1.6.",
      );
    case "pdf.file-identifier":
      return required(
        evidence.fileIdentifier.present && evidence.fileIdentifier.valid,
        "A valid trailer file identifier pair must be present.",
      );
    case "pdf-a.xmp-identification":
      return required(
        evidence.metadata.xmpPresent
        && evidence.metadata.pdfaPart === 2
        && evidence.metadata.pdfaConformance?.toUpperCase() === "B",
        "XMP must identify the document as PDF/A part 2, conformance level B.",
      );
    case "pdf-a.output-intent":
      return required(
        evidence.color.outputIntentCount === 1
        && evidence.color.outputIntent === "GTS_PDFA1"
        && evidence.color.outputIntentIccEmbedded
        && evidence.color.outputIntentComponents !== null
        && evidence.color.outputIntentIdentifierPresent,
        "PDF/A-2b candidate output requires one embedded GTS_PDFA1 ICC output intent.",
      );
    case "pdf-a.fonts-embedded":
      return required(
        evidence.fonts.resourceResolutionComplete
        && evidence.fonts.allUsedEmbedded,
        "Every used font resource must resolve to an embedded font program.",
      );
    case "pdf-a.no-encryption":
      return required(
        !evidence.features.encrypted,
        "PDF/A forbids encryption.",
      );
    case "pdf-a.no-active-content":
      return required(
        !evidence.features.javascript && !evidence.features.launchActions,
        "PDF/A candidate output forbids JavaScript and launch actions.",
      );
    case "pdf-a.no-external-content":
      return required(
        !evidence.features.externalReferences,
        "PDF/A candidate output must be self-contained.",
      );
    case "pdf-a.no-multimedia-or-3d":
      return required(
        !evidence.features.multimedia && !evidence.features.threeD,
        "PDF/A candidate output forbids multimedia and 3D content.",
      );
    case "pdf-a.no-unverified-embedded-files":
      return required(
        !evidence.features.embeddedFiles,
        "This conservative PDF/A-2b subset rejects embedded files it cannot recursively validate.",
      );
    case "pdf-a.no-unverified-annotations":
      return required(
        evidence.features.annotations === 0
        && !evidence.features.nonPrintingAnnotations,
        "This conservative PDF/A-2b subset rejects annotations it cannot fully validate.",
      );
    case "pdf-x.xmp-identification":
      return required(
        evidence.metadata.xmpPresent
        && evidence.metadata.pdfxVersion === "PDF/X-4",
        "XMP must identify the document as PDF/X-4.",
      );
    case "pdf-x.info-identification":
      return required(
        evidence.metadata.infoPdfxVersion === "PDF/X-4",
        "The document information dictionary must declare GTS_PDFXVersion as PDF/X-4.",
      );
    case "pdf-x.trapped-declared":
      return required(
        evidence.metadata.trapped !== null,
        "The document information dictionary must declare Trapped.",
      );
    case "pdf-x.output-intent":
      return required(
        evidence.color.outputIntentCount === 1
        && evidence.color.outputIntent === "GTS_PDFX"
        && evidence.color.outputIntentIccEmbedded
        && evidence.color.outputIntentComponents !== null
        && evidence.color.outputIntentIdentifierPresent
        && evidence.color.outputIntentRegistryName === "http://www.color.org",
        "PDF/X-4 requires one embedded GTS_PDFX ICC output intent.",
      );
    case "pdf-x.fonts-embedded":
      return required(
        evidence.fonts.resourceResolutionComplete
        && evidence.fonts.allUsedEmbedded,
        "Every used font resource must resolve to an embedded font program.",
      );
    case "pdf-x.page-boundaries":
      return required(
        evidence.pages.allHaveTrimOrArtBox
        && !evidence.pages.hasTrimArtConflict
        && evidence.pages.pageBoundariesValid,
        "Every PDF/X-4 page must have exactly one TrimBox or ArtBox.",
      );
    case "pdf-x.device-color-consistency":
      return required(
        evidence.color.deviceColorMatchesOutputIntent,
        "Device color spaces must agree with the embedded output intent.",
      );
    case "pdf-x.no-encryption":
      return required(
        !evidence.features.encrypted,
        "PDF/X forbids encryption.",
      );
    case "pdf-x.no-active-content":
      return required(
        !evidence.features.javascript && !evidence.features.launchActions,
        "PDF/X candidate output forbids JavaScript and launch actions.",
      );
    case "pdf-x.no-external-content":
      return required(
        !evidence.features.externalReferences,
        "PDF/X-4 complete exchange must not depend on external content.",
      );
    case "pdf-x.no-multimedia-or-3d":
      return required(
        !evidence.features.multimedia && !evidence.features.threeD,
        "PDF/X output forbids non-printable multimedia and 3D content.",
      );
    case "pdf-x.no-embedded-files":
      return required(
        !evidence.features.embeddedFiles,
        "PDF/X-4 complete exchange forbids embedded non-print resources.",
      );
    case "pdf-x.no-annotations":
      return required(
        evidence.features.annotations === 0
        && !evidence.features.nonPrintingAnnotations,
        "This generated PDF/X-4 subset does not permit annotations.",
      );
  }
}

function profileRuleIds(
  profile: StudioPdfConformanceProfile,
): readonly StudioPdfConformanceLocalRuleId[] {
  return [
    ...profile.requiredRules,
    ...profile.forbiddenFeatureRules,
  ];
}

function localRuleResults(
  profile: StudioPdfConformanceProfile,
  evidence: StudioPdfConformanceEvidence,
): readonly StudioPdfConformanceRuleResult[] {
  const forbidden = new Set<StudioPdfConformanceLocalRuleId>(
    profile.forbiddenFeatureRules,
  );
  return profileRuleIds(profile).map((id) => {
    const evaluation = evaluateLocalRule(id, evidence);
    return {
      id,
      source: "local-preflight",
      requirement: forbidden.has(id) ? "forbidden" : "required",
      status: evaluation.passed ? "passed" : "failed",
      message: evaluation.message,
    };
  });
}

function boundaryRule(
  id: StudioPdfConformanceBoundaryRuleId,
  passed: boolean,
  message: string,
  source: "external-validator" | "local-preflight" = "local-preflight",
): StudioPdfConformanceRuleResult {
  return {
    id,
    source,
    requirement: "boundary",
    status: passed ? "passed" : "failed",
    message,
  };
}

function receiptCore(
  value: Omit<StudioPdfConformanceReceipt, "receiptHash">,
): Omit<StudioPdfConformanceReceipt, "receiptHash"> {
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Receipt canonical JSON contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!isDataRecord(value)) {
    throw new TypeError("Receipt canonical JSON contains an unsupported value.");
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function hashCanonical(value: unknown): StudioPdfSha256 {
  return hashBytes(utf8Encoder.encode(canonicalJson(value)));
}

function createReceipt(
  core: Omit<StudioPdfConformanceReceipt, "receiptHash">,
): StudioPdfConformanceReceipt {
  return deepFreeze({
    ...core,
    receiptHash: hashCanonical(core),
  });
}

function rejectedBoundaryReceipt(
  rule: StudioPdfConformanceRuleResult,
  profile: StudioPdfConformanceProfileId | null = null,
  sourceDigest: StudioPdfSha256 | null = null,
): StudioPdfConformanceReceipt {
  return createReceipt({
    schema: STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA,
    version: STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION,
    profile,
    sourceDigest,
    evidenceHash: null,
    result: {
      decision: "rejected",
      localPreflight: "not-run",
      externalValidation: "not-run",
      thirdPartyCertification: "not-claimed",
    },
    rules: [rule],
    externalValidation: null,
    limitations: RECEIPT_LIMITATIONS,
  });
}

/**
 * Runs a deterministic, non-throwing candidate preflight.
 *
 * The profile and evidence are runtime-validated even though TypeScript callers receive a typed
 * API. This protects persisted manifests, worker messages, and future plugin integrations from
 * silently falling back to a weaker profile.
 */
export function preflightStudioPdfConformance(
  input: unknown,
): StudioPdfConformanceReceipt {
  if (
    !isDataRecord(input)
    || !hasExactKeys(input, ["evidence", "profile"], ["veraPdf"])
  ) {
    return rejectedBoundaryReceipt(
      boundaryRule(
        "request.valid",
        false,
        "The conformance request must use the exact supported schema.",
      ),
    );
  }

  const profile = resolveStudioPdfConformanceProfile(input.profile);
  if (!profile) {
    return rejectedBoundaryReceipt(
      boundaryRule(
        "request.profile-known",
        false,
        "Unknown PDF conformance profiles are rejected without fallback.",
      ),
    );
  }

  const evidence = normalizeEvidence(input.evidence);
  if (!evidence) {
    return rejectedBoundaryReceipt(
      boundaryRule(
        "request.valid",
        false,
        "The conformance evidence is malformed, contradictory, or contains unknown fields.",
      ),
      profile.id,
    );
  }

  const rules = [...localRuleResults(profile, evidence)];
  let externalValidation: StudioVeraPdfResultEnvelope | null = null;
  let externalStatus: "failed" | "not-run" | "passed" = "not-run";
  if (Object.hasOwn(input, "veraPdf")) {
    const imported = importStudioVeraPdfResult(input.veraPdf, {
      profile: profile.id,
      sourceDigest: evidence.sourceDigest,
    });
    if (!imported.accepted) {
      rules.push(
        boundaryRule(
          "external.verapdf-import",
          false,
          `The veraPDF result was rejected: ${imported.code}.`,
          "external-validator",
        ),
      );
      externalStatus = "failed";
    } else {
      externalValidation = imported.result;
      rules.push(
        boundaryRule(
          "external.verapdf-import",
          true,
          "The exact-source PDF/A-2b veraPDF result envelope was imported.",
          "external-validator",
        ),
      );
      rules.push(
        boundaryRule(
          "external.verapdf-compliance",
          imported.result.isCompliant,
          "veraPDF must report the complete PDF/A-2b ruleset as compliant.",
          "external-validator",
        ),
      );
      externalStatus =
        imported.result.isCompliant ? "passed" : "failed";
    }
  }

  const localPassed = rules
    .filter((rule) => rule.source === "local-preflight")
    .every((rule) => rule.status === "passed");
  const allPassed = localPassed && externalStatus !== "failed";
  const decision =
    !allPassed
      ? "rejected"
      : externalStatus === "passed"
        ? "external-validator-confirmed"
        : "local-candidate";

  return createReceipt({
    schema: STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA,
    version: STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION,
    profile: profile.id,
    sourceDigest: evidence.sourceDigest,
    evidenceHash: hashCanonical(evidence),
    result: {
      decision,
      localPreflight: localPassed ? "passed" : "failed",
      externalValidation: externalStatus,
      thirdPartyCertification: "not-claimed",
    },
    rules,
    externalValidation,
    limitations: RECEIPT_LIMITATIONS,
  });
}

export type StudioPdfReceiptVerificationFailureCode =
  | "fingerprint-mismatch"
  | "invalid-shape"
  | "unknown-profile"
  | "unknown-rule";

export type StudioPdfReceiptVerificationResult =
  | Readonly<{
      valid: true;
      receipt: StudioPdfConformanceReceipt;
    }>
  | Readonly<{
      valid: false;
      code: StudioPdfReceiptVerificationFailureCode;
    }>;

function receiptVerificationFailure(
  code: StudioPdfReceiptVerificationFailureCode,
): StudioPdfReceiptVerificationResult {
  return Object.freeze({ valid: false, code });
}

/**
 * Verifies the strict receipt schema and its canonical SHA-256 fingerprint.
 *
 * This is an integrity check for ToonSpectrum's deterministic receipt, not a digital signature.
 * Trust in an imported external result still belongs to the adapter/process that produced it.
 */
export function verifyStudioPdfConformanceReceipt(
  value: unknown,
): StudioPdfReceiptVerificationResult {
  if (
    !isExactRecord(value, [
      "externalValidation",
      "evidenceHash",
      "limitations",
      "profile",
      "receiptHash",
      "result",
      "rules",
      "schema",
      "sourceDigest",
      "version",
    ])
    || value.schema !== STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA
    || value.version !== STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION
    || (
      value.sourceDigest !== null
      && (
        typeof value.sourceDigest !== "string"
        || !SHA256_PATTERN.test(value.sourceDigest)
      )
    )
    || (
      value.evidenceHash !== null
      && (
        typeof value.evidenceHash !== "string"
        || !SHA256_PATTERN.test(value.evidenceHash)
      )
    )
    || typeof value.receiptHash !== "string"
    || !SHA256_PATTERN.test(value.receiptHash)
    || !Array.isArray(value.rules)
    || !Array.isArray(value.limitations)
  ) {
    return receiptVerificationFailure("invalid-shape");
  }

  let profile: StudioPdfConformanceProfile | null = null;
  if (value.profile !== null) {
    profile = resolveStudioPdfConformanceProfile(value.profile);
    if (!profile) return receiptVerificationFailure("unknown-profile");
  }
  if (
    value.limitations.length !== RECEIPT_LIMITATIONS.length
    || value.limitations.some(
      (limitation, index) =>
        limitation !== RECEIPT_LIMITATIONS[index],
    )
  ) {
    return receiptVerificationFailure("invalid-shape");
  }
  if (
    !isExactRecord(value.result, [
      "decision",
      "externalValidation",
      "localPreflight",
      "thirdPartyCertification",
    ])
    || ![
      "external-validator-confirmed",
      "local-candidate",
      "rejected",
    ].includes(value.result.decision as string)
    || !["failed", "not-run", "passed"].includes(
      value.result.localPreflight as string,
    )
    || !["failed", "not-run", "passed"].includes(
      value.result.externalValidation as string,
    )
    || value.result.thirdPartyCertification !== "not-claimed"
  ) {
    return receiptVerificationFailure("invalid-shape");
  }
  if (
    (
      value.result.localPreflight === "not-run"
      && value.evidenceHash !== null
    )
    || (
      value.result.localPreflight !== "not-run"
      && value.evidenceHash === null
    )
  ) {
    return receiptVerificationFailure("invalid-shape");
  }

  const knownRuleIds = new Set<string>([
    ...STUDIO_PDF_CONFORMANCE_LOCAL_RULE_IDS,
    ...RECEIPT_BOUNDARY_RULE_IDS,
  ]);
  const seenRules = new Set<string>();
  for (const rule of value.rules) {
    if (
      !isExactRecord(rule, [
        "id",
        "message",
        "requirement",
        "source",
        "status",
      ])
      || typeof rule.id !== "string"
    ) {
      return receiptVerificationFailure("invalid-shape");
    }
    if (!knownRuleIds.has(rule.id)) {
      return receiptVerificationFailure("unknown-rule");
    }
    if (
      seenRules.has(rule.id)
      || typeof rule.message !== "string"
      || rule.message.length === 0
      || !["boundary", "forbidden", "required"].includes(
        rule.requirement as string,
      )
      || !["external-validator", "local-preflight"].includes(
        rule.source as string,
      )
      || !["failed", "passed"].includes(rule.status as string)
    ) {
      return receiptVerificationFailure("invalid-shape");
    }
    seenRules.add(rule.id);
  }

  if (profile) {
    const localIds = value.rules
      .filter(
        (rule) =>
          isDataRecord(rule)
          && rule.source === "local-preflight"
          && typeof rule.id === "string"
          && STUDIO_PDF_CONFORMANCE_LOCAL_RULE_IDS.includes(
            rule.id as StudioPdfConformanceLocalRuleId,
          ),
      )
      .map((rule) => rule.id);
    const expectedLocalIds =
      value.result.localPreflight === "not-run"
        ? []
        : profileRuleIds(profile);
    if (
      JSON.stringify(localIds)
      !== JSON.stringify(expectedLocalIds)
      || (
        value.result.localPreflight === "not-run"
        && value.result.decision !== "rejected"
      )
    ) {
      return receiptVerificationFailure("invalid-shape");
    }
  } else if (value.result.decision !== "rejected") {
    return receiptVerificationFailure("invalid-shape");
  }

  if (value.externalValidation !== null) {
    if (
      profile?.id !== "pdf-a-2b"
      || typeof value.sourceDigest !== "string"
    ) {
      return receiptVerificationFailure("invalid-shape");
    }
    const external = importStudioVeraPdfResult(
      value.externalValidation,
      {
        profile: profile.id,
        sourceDigest: value.sourceDigest as StudioPdfSha256,
      },
    );
    if (!external.accepted) {
      return receiptVerificationFailure("invalid-shape");
    }
  }

  const core = receiptCore({
    schema: value.schema,
    version: value.version,
    profile: value.profile as StudioPdfConformanceProfileId | null,
    sourceDigest: value.sourceDigest as StudioPdfSha256 | null,
    evidenceHash: value.evidenceHash as StudioPdfSha256 | null,
    result: value.result as StudioPdfConformanceReceipt["result"],
    rules: value.rules as unknown as readonly StudioPdfConformanceRuleResult[],
    externalValidation:
      value.externalValidation as StudioVeraPdfResultEnvelope | null,
    limitations: value.limitations as readonly string[],
  });
  if (hashCanonical(core) !== value.receiptHash) {
    return receiptVerificationFailure("fingerprint-mismatch");
  }
  return deepFreeze({
    valid: true,
    receipt: value as unknown as StudioPdfConformanceReceipt,
  });
}

function normalizeEvidence(
  value: unknown,
): StudioPdfConformanceEvidence | null {
  if (
    !isExactRecord(value, [
      "color",
      "features",
      "fileIdentifier",
      "fonts",
      "metadata",
      "pageCount",
      "pages",
      "pdfVersion",
      "scanner",
      "sourceDigest",
      "structureValid",
    ])
    || !isExactRecord(value.scanner, [
      "id",
      "inspectionComplete",
      "version",
    ])
    || value.scanner.id !== STUDIO_PDF_CONFORMANCE_SCANNER_ID
    || value.scanner.version !== STUDIO_PDF_CONFORMANCE_SCANNER_VERSION
    || typeof value.scanner.inspectionComplete !== "boolean"
    || typeof value.sourceDigest !== "string"
    || !SHA256_PATTERN.test(value.sourceDigest)
    || typeof value.structureValid !== "boolean"
    || typeof value.pdfVersion !== "string"
    || !/^\d+\.\d+$/u.test(value.pdfVersion)
    || typeof value.pageCount !== "number"
    || !Number.isSafeInteger(value.pageCount)
    || value.pageCount < 0
    || value.pageCount > 1_000_000
  ) {
    return null;
  }
  if (
    !isExactRecord(value.fileIdentifier, [
      "permanentId",
      "present",
      "revisionId",
      "valid",
    ])
    || typeof value.fileIdentifier.present !== "boolean"
    || typeof value.fileIdentifier.valid !== "boolean"
    || !nullableString(value.fileIdentifier.permanentId)
    || !nullableString(value.fileIdentifier.revisionId)
  ) {
    return null;
  }
  const permanentId = value.fileIdentifier.permanentId;
  const revisionId = value.fileIdentifier.revisionId;
  const hasBothIds =
    typeof permanentId === "string"
    && typeof revisionId === "string";
  let idsAreValid = false;
  if (hasBothIds) {
    idsAreValid =
      PDF_ID_PATTERN.test(permanentId)
      && PDF_ID_PATTERN.test(revisionId)
      && permanentId.length % 2 === 0
      && revisionId.length % 2 === 0;
  }
  if (
    value.fileIdentifier.present !== hasBothIds
    || value.fileIdentifier.valid !== idsAreValid
  ) {
    return null;
  }
  if (
    !isBooleanRecord(value.pages, [
      "allHaveMediaBox",
      "allHaveTrimOrArtBox",
      "hasTrimArtConflict",
      "pageBoundariesValid",
    ])
  ) {
    return null;
  }
  if (
    !isExactRecord(value.metadata, [
      "infoPdfxVersion",
      "pdfaConformance",
      "pdfaPart",
      "pdfxVersion",
      "trapped",
      "xmpPresent",
    ])
    || typeof value.metadata.xmpPresent !== "boolean"
    || (
      value.metadata.pdfaPart !== null
      && (
        typeof value.metadata.pdfaPart !== "number"
        || !Number.isSafeInteger(value.metadata.pdfaPart)
        || value.metadata.pdfaPart < 1
      )
    )
    || !nullableString(value.metadata.pdfaConformance)
    || !nullableString(value.metadata.pdfxVersion)
    || !nullableString(value.metadata.infoPdfxVersion)
    || ![null, "False", "True", "Unknown"].includes(
      value.metadata.trapped as null | string,
    )
  ) {
    return null;
  }
  if (
    !isExactRecord(value.fonts, [
      "allUsedEmbedded",
      "embedded",
      "resourceResolutionComplete",
      "used",
    ])
    || !boundedCount(value.fonts.used)
    || !boundedCount(value.fonts.embedded)
    || value.fonts.embedded > value.fonts.used
    || typeof value.fonts.resourceResolutionComplete !== "boolean"
    || typeof value.fonts.allUsedEmbedded !== "boolean"
    || (
      value.fonts.allUsedEmbedded
      !== (
        value.fonts.resourceResolutionComplete
        && value.fonts.embedded === value.fonts.used
      )
    )
  ) {
    return null;
  }
  if (
    !isExactRecord(value.color, [
      "deviceColorMatchesOutputIntent",
      "outputIntent",
      "outputIntentComponents",
      "outputIntentCount",
      "outputIntentIccEmbedded",
      "outputIntentIdentifierPresent",
      "outputIntentRegistryName",
      "usesDeviceCmyk",
      "usesDeviceGray",
      "usesDeviceRgb",
    ])
    || typeof value.color.usesDeviceRgb !== "boolean"
    || typeof value.color.usesDeviceCmyk !== "boolean"
    || typeof value.color.usesDeviceGray !== "boolean"
    || !boundedCount(value.color.outputIntentCount)
    || !["GTS_PDFA1", "GTS_PDFX", "none", "unknown"].includes(
      value.color.outputIntent as string,
    )
    || typeof value.color.outputIntentIccEmbedded !== "boolean"
    || typeof value.color.outputIntentIdentifierPresent !== "boolean"
    || !nullableString(value.color.outputIntentRegistryName)
    || ![null, 3, 4].includes(
      value.color.outputIntentComponents as null | number,
    )
    || typeof value.color.deviceColorMatchesOutputIntent !== "boolean"
  ) {
    return null;
  }
  if (
    !isExactRecord(value.features, [
      "annotations",
      "embeddedFiles",
      "encrypted",
      "externalReferences",
      "javascript",
      "launchActions",
      "multimedia",
      "nonPrintingAnnotations",
      "optionalContent",
      "threeD",
      "transparency",
    ])
  ) {
    return null;
  }
  const featureBooleanKeys = [
    "embeddedFiles",
    "encrypted",
    "externalReferences",
    "javascript",
    "launchActions",
    "multimedia",
    "nonPrintingAnnotations",
    "optionalContent",
    "threeD",
    "transparency",
  ] as const;
  if (
    !boundedCount(value.features.annotations)
    || !hasBooleanFields(value.features, featureBooleanKeys)
    || (
      value.features.annotations === 0
      && value.features.nonPrintingAnnotations
    )
  ) {
    return null;
  }

  return deepFreeze({
    scanner: {
      id: STUDIO_PDF_CONFORMANCE_SCANNER_ID,
      version: STUDIO_PDF_CONFORMANCE_SCANNER_VERSION,
      inspectionComplete: value.scanner.inspectionComplete,
    },
    sourceDigest: value.sourceDigest as StudioPdfSha256,
    structureValid: value.structureValid,
    pdfVersion: value.pdfVersion,
    pageCount: value.pageCount,
    fileIdentifier: {
      present: value.fileIdentifier.present,
      valid: value.fileIdentifier.valid,
      permanentId: value.fileIdentifier.permanentId,
      revisionId: value.fileIdentifier.revisionId,
    },
    pages: {
      allHaveMediaBox: value.pages.allHaveMediaBox,
      allHaveTrimOrArtBox: value.pages.allHaveTrimOrArtBox,
      hasTrimArtConflict: value.pages.hasTrimArtConflict,
      pageBoundariesValid: value.pages.pageBoundariesValid,
    },
    metadata: {
      xmpPresent: value.metadata.xmpPresent,
      pdfaPart: value.metadata.pdfaPart,
      pdfaConformance: value.metadata.pdfaConformance,
      pdfxVersion: value.metadata.pdfxVersion,
      infoPdfxVersion: value.metadata.infoPdfxVersion,
      trapped: value.metadata.trapped as
        | "False"
        | "True"
        | "Unknown"
        | null,
    },
    fonts: {
      used: value.fonts.used,
      embedded: value.fonts.embedded,
      resourceResolutionComplete:
        value.fonts.resourceResolutionComplete,
      allUsedEmbedded: value.fonts.allUsedEmbedded,
    },
    color: {
      usesDeviceRgb: value.color.usesDeviceRgb,
      usesDeviceCmyk: value.color.usesDeviceCmyk,
      usesDeviceGray: value.color.usesDeviceGray,
      outputIntentCount: value.color.outputIntentCount,
      outputIntent:
        value.color.outputIntent as StudioPdfOutputIntentKind,
      outputIntentIccEmbedded:
        value.color.outputIntentIccEmbedded,
      outputIntentComponents:
        value.color.outputIntentComponents as 3 | 4 | null,
      outputIntentIdentifierPresent:
        value.color.outputIntentIdentifierPresent,
      outputIntentRegistryName:
        value.color.outputIntentRegistryName,
      deviceColorMatchesOutputIntent:
        value.color.deviceColorMatchesOutputIntent,
    },
    features: {
      encrypted: value.features.encrypted,
      javascript: value.features.javascript,
      launchActions: value.features.launchActions,
      externalReferences: value.features.externalReferences,
      multimedia: value.features.multimedia,
      threeD: value.features.threeD,
      embeddedFiles: value.features.embeddedFiles,
      annotations: value.features.annotations,
      nonPrintingAnnotations:
        value.features.nonPrintingAnnotations,
      transparency: value.features.transparency,
      optionalContent: value.features.optionalContent,
    },
  });
}

function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 256);
}

function boundedCount(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1_000_000
  );
}

function isBooleanRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, boolean> {
  return (
    isExactRecord(value, keys)
    && keys.every((key) => typeof value[key] === "boolean")
  );
}

function hasBooleanFields<const Key extends string>(
  value: Record<string, unknown>,
  keys: readonly Key[],
): value is Record<string, unknown> & Record<Key, boolean> {
  return keys.every((key) => typeof value[key] === "boolean");
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor,
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key))
  );
}

function isExactRecord(
  value: unknown,
  required: readonly string[],
): value is Record<string, unknown> {
  return isDataRecord(value) && hasExactKeys(value, required);
}

function deepFreeze<T>(value: T): T {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
