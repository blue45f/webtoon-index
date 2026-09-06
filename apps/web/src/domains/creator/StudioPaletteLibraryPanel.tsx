// Palette library manager. The compact panel is mounted inside Studio's lazy style popover;
// binary/text interchange codecs remain in a second intent-loaded chunk.
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { downloadBlob } from "./export/studio-export";
import {
  createPalette,
  deletePaletteInMemory,
  paletteFileName,
  renamePaletteInMemory,
  upsertPaletteInMemory,
  type StudioNamedPalette,
} from "./studio-palette-library";
import {
  getProductStudioPaletteSqliteRepository,
  StudioPaletteSqliteRepositoryError,
} from "./studio-palette-sqlite-repository";

import { cx } from "@/shared/lib/cx";

type StudioPaletteInterchangeModule = typeof import("./studio-palette-interchange");
type StudioPaletteInterchangeFormat = Parameters<
  StudioPaletteInterchangeModule["exportStudioPalette"]
>[0];

let paletteInterchangeModulePromise: Promise<StudioPaletteInterchangeModule> | null = null;

function loadStudioPaletteInterchangeModule(): Promise<StudioPaletteInterchangeModule> {
  paletteInterchangeModulePromise ??= import("./studio-palette-interchange").catch((error: unknown) => {
    paletteInterchangeModulePromise = null;
    throw error;
  });
  return paletteInterchangeModulePromise;
}

function preloadStudioPaletteInterchangeModule(): void {
  void loadStudioPaletteInterchangeModule().catch(() => {
    // A failed deployment chunk is retried by the real click/change action.
  });
}

const SWATCH_PREVIEW_COUNT = 8;
const PALETTE_IMPORT_ACCEPT =
  ".gpl,.ase,.aco,.act,.pal,.css,.json,text/plain,text/css,application/json,application/octet-stream";
const PALETTE_FORMAT_HELP = "GPL, ASE, ACO, ACT, JASC-PAL, CSS 또는 JSON";

const FORMAT_OPTIONS: readonly {
  id: StudioPaletteInterchangeFormat;
  label: string;
  shortLabel: string;
  extension: string;
  mimeType: string;
  description: string;
}[] = [
  {
    id: "gpl",
    label: "GIMP Palette (.gpl)",
    shortLabel: "GPL",
    extension: ".gpl",
    mimeType: "text/plain;charset=utf-8",
    description: "GIMP·Krita 계열과 교환하기 좋은 텍스트 팔레트",
  },
  {
    id: "ase",
    label: "Adobe Swatch Exchange (.ase)",
    shortLabel: "ASE",
    extension: ".ase",
    mimeType: "application/octet-stream",
    description: "Adobe 앱 간 교환용 RGB 스와치",
  },
  {
    id: "aco",
    label: "Adobe Color Swatch (.aco)",
    shortLabel: "ACO",
    extension: ".aco",
    mimeType: "application/octet-stream",
    description: "Photoshop 호환 v1+v2 색상 스와치",
  },
  {
    id: "act",
    label: "Adobe Color Table (.act)",
    shortLabel: "ACT",
    extension: ".act",
    mimeType: "application/octet-stream",
    description: "인덱스 이미지용 256색 Adobe RGB 테이블",
  },
  {
    id: "pal",
    label: "JASC-PAL (.pal)",
    shortLabel: "PAL",
    extension: ".pal",
    mimeType: "text/plain;charset=utf-8",
    description: "Paint Shop Pro 계열 256색 텍스트 팔레트",
  },
  {
    id: "css",
    label: "CSS 변수 (.css)",
    shortLabel: "CSS",
    extension: ".css",
    mimeType: "text/css;charset=utf-8",
    description: "디자인 토큰용 --color-name 변수",
  },
  {
    id: "json",
    label: "ToonSpectrum JSON (.palette.json)",
    shortLabel: "JSON",
    extension: ".palette.json",
    mimeType: "application/json;charset=utf-8",
    description: "버전이 명시된 ToonSpectrum 팔레트 교환 형식",
  },
] as const;

const GENERIC_IMPORTED_NAMES = new Set([
  "Adobe ACO 팔레트",
  "Adobe ACT 팔레트",
  "Adobe ASE 팔레트",
  "CSS 변수 팔레트",
  "GIMP GPL 팔레트",
  "JSON 팔레트",
  "JASC-PAL 팔레트",
  "가져온 팔레트",
]);

interface OperationMessage {
  readonly tone: "error" | "success" | "warning";
  readonly title: string;
  readonly details: readonly string[];
}

interface BusyOperation {
  readonly kind: "export" | "import";
  readonly paletteId?: string;
}

export interface StudioPaletteLibraryPanelProps {
  /** Updates Studio's current brush/shape color. */
  onPickColor: (hex: string) => void;
  /** Candidate colors used by “최근 색으로 만들기”. */
  seedColors?: string[];
  /** Test/embed seam. Product code leaves this undefined and uses shared V12 SQLite/OPFS. */
  repository?: StudioPaletteLibraryRepository;
}

export interface StudioPaletteLibraryRepository {
  readonly authority?: "sqlite" | "injected";
  list(): Promise<StudioNamedPalette[]>;
  save(palette: StudioNamedPalette): Promise<StudioNamedPalette[]>;
  rename(id: string, name: string): Promise<StudioNamedPalette[]>;
  delete(id: string): Promise<StudioNamedPalette[]>;
  subscribe?(listener: () => void): () => void;
}

const PRODUCT_REPOSITORY: StudioPaletteLibraryRepository =
  getProductStudioPaletteSqliteRepository();

function formatOption(format: StudioPaletteInterchangeFormat) {
  return FORMAT_OPTIONS.find((option) => option.id === format) ?? FORMAT_OPTIONS[0];
}

function extensionFormat(fileName: string): StudioPaletteInterchangeFormat | null {
  const normalized = fileName.trim().toLocaleLowerCase("en-US");
  if (normalized.endsWith(".gpl")) return "gpl";
  if (normalized.endsWith(".ase")) return "ase";
  if (normalized.endsWith(".aco")) return "aco";
  if (normalized.endsWith(".act")) return "act";
  if (normalized.endsWith(".pal")) return "pal";
  if (normalized.endsWith(".css")) return "css";
  if (normalized.endsWith(".json")) return "json";
  return null;
}

function hasAdobeAcoHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4 || bytes[0] !== 0 || (bytes[1] !== 1 && bytes[1] !== 2)) return false;
  const count = (bytes[2]! << 8) | bytes[3]!;
  return count >= 1 && count <= 4_096 && bytes.byteLength >= 4 + count * 10;
}

function hasJascPalHeader(bytes: Uint8Array): boolean {
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const magic = [0x4a, 0x41, 0x53, 0x43, 0x2d, 0x50, 0x41, 0x4c];
  return magic.every((byte, index) => bytes[offset + index] === byte)
    && (bytes[offset + magic.length] === 0x0a || bytes[offset + magic.length] === 0x0d);
}

function detectPaletteFormat(fileName: string, bytes: Uint8Array): StudioPaletteInterchangeFormat {
  if (
    bytes.byteLength >= 4
    && bytes[0] === 0x41
    && bytes[1] === 0x53
    && bytes[2] === 0x45
    && bytes[3] === 0x46
  ) {
    return "ase";
  }
  if (hasJascPalHeader(bytes)) return "pal";
  const fromExtension = extensionFormat(fileName);
  if (fromExtension === "act" && (bytes.byteLength === 768 || bytes.byteLength === 772)) return "act";
  if (hasAdobeAcoHeader(bytes)) return "aco";
  if (fromExtension) return fromExtension;
  if (bytes.byteLength === 768 || bytes.byteLength === 772) return "act";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "").trimStart();
  } catch {
    throw new Error(`지원하는 팔레트 형식을 판별하지 못했어요. ${PALETTE_FORMAT_HELP} 파일을 선택해 주세요.`);
  }
  if (text.startsWith("GIMP Palette")) return "gpl";
  if (text.startsWith("{")) return "json";
  if (/--[\p{L}\p{N}_-]+\s*:/u.test(text)) return "css";
  throw new Error(`지원하는 팔레트 형식을 판별하지 못했어요. ${PALETTE_FORMAT_HELP} 파일을 선택해 주세요.`);
}

function safePaletteBaseName(name: string): string {
  return paletteFileName({ name }).replace(/\.gpl$/iu, "");
}

function importedPaletteName(sourceName: string, fileName: string): string {
  if (sourceName.trim() && !GENERIC_IMPORTED_NAMES.has(sourceName.trim())) return sourceName.trim();
  const withoutKnownExtension = fileName
    .replace(/\.palette\.json$/iu, "")
    .replace(/\.(?:aco|act|ase|css|gpl|json|pal)$/iu, "")
    .trim();
  return withoutKnownExtension || sourceName || "가져온 팔레트";
}

function exportFileName(palette: StudioNamedPalette, format: StudioPaletteInterchangeFormat): string {
  if (format === "gpl") return paletteFileName(palette);
  return `${safePaletteBaseName(palette.name)}${formatOption(format).extension}`;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function uniqueDetails(details: readonly string[]): string[] {
  return [...new Set(details.map((detail) => detail.trim()).filter(Boolean))];
}

function createImportedNamedPalette(name: string, colors: string[]): StudioNamedPalette {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    colors,
  };
}

const WEBTOON_PRESETS: readonly { name: string; tag: string; colors: string[] }[] = [
  {
    name: "웹툰 인물 피부톤",
    tag: "인물",
    colors: ["#fffbf5", "#ffedd5", "#fbcfe8", "#e0b0d5", "#fb7185"],
  },
  {
    name: "헤어 내추럴 & 흑발",
    tag: "헤어",
    colors: ["#1b1b22", "#2e2a2b", "#463733", "#5c4334", "#75543c", "#a8845c", "#dcbb85"],
  },
  {
    name: "헤어 비비드 판타지",
    tag: "헤어",
    colors: ["#ff5d73", "#ff8fb1", "#c377f2", "#7c52e0", "#5d8bf4", "#28c2a8", "#f0c22e"],
  },
  {
    name: "골든아워 노을 하늘",
    tag: "배경",
    colors: ["#fde047", "#fb923c", "#ffedd5", "#831843", "#fef08a", "#4a154b"],
  },
  {
    name: "청량한 여름 대낮",
    tag: "배경",
    colors: ["#38bdf8", "#bae6fd", "#ffffff", "#64748b", "#0284c7", "#e0f2fe"],
  },
  {
    name: "사이버펑크 네온야경",
    tag: "SF",
    colors: ["#09090b", "#3b0764", "#f43f5e", "#06b6d4", "#a855f7", "#22d3ee"],
  },
  {
    name: "자연 초목 & 포레스트",
    tag: "자연",
    colors: ["#eaf4d3", "#cde6a5", "#8cc084", "#538d58", "#2c5e3b", "#143a24"],
  },
];

export function StudioPaletteLibraryPanel({
  onPickColor,
  seedColors,
  repository = PRODUCT_REPOSITORY,
}: StudioPaletteLibraryPanelProps) {
  const [palettes, setPalettes] = useState<StudioNamedPalette[]>([]);
  const [message, setMessage] = useState<OperationMessage | null>(null);
  const [busyOperation, setBusyOperation] = useState<BusyOperation | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [storageState, setStorageState] = useState<
    "loading" | "sqlite" | "injected" | "memory" | "unavailable"
  >("loading");
  const busyRef = useRef(false);
  const mutationBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const memoryModeRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const palettesRef = useRef<StudioNamedPalette[]>([]);
  const [exportFormat, setExportFormat] = useState<StudioPaletteInterchangeFormat>("gpl");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColorsText, setNewColorsText] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "presets">("all");
  const [expandedPaletteIds, setExpandedPaletteIds] = useState<Set<string>>(new Set());

  const selectedFormat = formatOption(exportFormat);
  const busy = busyOperation !== null || mutationBusy;

  function replacePalettes(next: StudioNamedPalette[]): void {
    palettesRef.current = next;
    setPalettes(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    memoryModeRef.current = false;

    const hydrate = async () => {
      const generation = ++loadGenerationRef.current;
      setStorageState("loading");
      try {
        const loaded = await repository.list();
        if (
          !active
          || !mountedRef.current
          || generation !== loadGenerationRef.current
          || memoryModeRef.current
        ) {
          return;
        }
        replacePalettes(loaded);
        setMessage(null);
        setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      } catch (cause) {
        if (!active || !mountedRef.current || generation !== loadGenerationRef.current) return;
        setStorageState("unavailable");
        setMessage({
          tone: "error",
          title: `SQLite/OPFS 팔레트 라이브러리를 열지 못했습니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          details: ["기존 localStorage 팔레트는 자동으로 읽지 않습니다."],
        });
      }
    };

    void hydrate();
    const unsubscribe = repository.subscribe?.(() => void hydrate());
    return () => {
      active = false;
      loadGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [repository]);

  async function commitMutation(
    persisted: () => Promise<StudioNamedPalette[]>,
    memoryUpdate: (current: readonly StudioNamedPalette[]) => StudioNamedPalette[],
  ): Promise<"durable" | "memory" | "rejected"> {
    if (mutationBusyRef.current) return "rejected";
    mutationBusyRef.current = true;
    const generation = ++mutationGenerationRef.current;
    setMutationBusy(true);
    loadGenerationRef.current += 1;

    if (storageState === "memory") {
      try {
        replacePalettes(memoryUpdate(palettesRef.current));
        return "memory";
      } catch (cause) {
        setMessage({
          tone: "error",
          title: cause instanceof Error ? cause.message : "팔레트 변경을 적용하지 못했습니다.",
          details: [],
        });
        return "rejected";
      } finally {
        mutationBusyRef.current = false;
        setMutationBusy(false);
      }
    }

    try {
      const next = await persisted();
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return "rejected";
      loadGenerationRef.current += 1;
      replacePalettes(next);
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      return "durable";
    } catch (cause) {
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return "rejected";
      if (cause instanceof StudioPaletteSqliteRepositoryError && cause.code !== "unavailable") {
        setMessage({ tone: "error", title: cause.message, details: ["항목을 줄이거나 데이터를 고친 뒤 다시 시도해 주세요."] });
        return "rejected";
      }
      try {
        replacePalettes(memoryUpdate(palettesRef.current));
      } catch (validationError) {
        setMessage({
          tone: "error",
          title: validationError instanceof Error ? validationError.message : "팔레트 변경을 적용하지 못했습니다.",
          details: [],
        });
        return "rejected";
      }
      memoryModeRef.current = true;
      setStorageState("memory");
      setMessage({
        tone: "error",
        title: "SQLite/OPFS 저장에 실패해 변경을 현재 탭 메모리에만 유지합니다.",
        details: [
          "새로고침하면 이 변경은 사라집니다.",
          cause instanceof Error ? cause.message : String(cause),
        ],
      });
      return "memory";
    } finally {
      if (mountedRef.current && generation === mutationGenerationRef.current) {
        mutationBusyRef.current = false;
        setMutationBusy(false);
      }
    }
  }

  function handleDelete(id: string): void {
    if (busyRef.current || mutationBusyRef.current) return;
    void commitMutation(
      () => repository.delete(id),
      (current) => deletePaletteInMemory(current, id),
    ).then((outcome) => {
      if (outcome === "durable" && mountedRef.current) setMessage(null);
    });
  }

  function handleDuplicate(palette: StudioNamedPalette): void {
    if (busyRef.current || mutationBusyRef.current) return;
    const duplicated = createPalette(`${palette.name} (사본)`, [...palette.colors]);
    void commitMutation(
      () => repository.save(duplicated),
      (current) => upsertPaletteInMemory(current, duplicated),
    ).then((outcome) => {
      if (outcome === "durable" && mountedRef.current) {
        setMessage({
          tone: "success",
          title: `“${duplicated.name}”을(를) 복제했어요.`,
          details: [`${duplicated.colors.length}색`],
        });
      }
    });
  }

  function handleAddColor(palette: StudioNamedPalette, color: string): void {
    if (busyRef.current || mutationBusyRef.current) return;
    const clean = color.trim().toLowerCase();
    if (!clean || palette.colors.includes(clean)) return;
    const updated: StudioNamedPalette = {
      ...palette,
      colors: [...palette.colors, clean],
    };
    void commitMutation(
      () => repository.save(updated),
      (current) => upsertPaletteInMemory(current, updated),
    );
  }

  function handleSavePreset(presetName: string, colors: string[]): void {
    if (busyRef.current || mutationBusyRef.current) return;
    const p = createPalette(presetName, colors);
    void commitMutation(
      () => repository.save(p),
      (current) => upsertPaletteInMemory(current, p),
    ).then((outcome) => {
      if (outcome === "durable" && mountedRef.current) {
        setMessage({
          tone: "success",
          title: `웹툰 프리셋 “${p.name}”을(를) 저장했어요.`,
          details: [`${p.colors.length}색`],
        });
      }
    });
  }

  function startRename(palette: StudioNamedPalette) {
    if (busyRef.current || mutationBusyRef.current) return;
    setRenamingId(palette.id);
    setRenamingName(palette.name);
  }

  function commitRename(): void {
    if (!renamingId || busyRef.current || mutationBusyRef.current) return;
    const id = renamingId;
    const name = renamingName;
    setRenamingId(null);
    void commitMutation(
      () => repository.rename(id, name),
      (current) => renamePaletteInMemory(current, id, name),
    );
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") commitRename();
    else if (event.key === "Escape") setRenamingId(null);
  }

  function handleCreateFromRecent(): void {
    if (busyRef.current || mutationBusyRef.current || !seedColors || seedColors.length === 0) return;
    try {
      const palette = createPalette("최근 사용 색", seedColors);
      void commitMutation(
        () => repository.save(palette),
        (current) => upsertPaletteInMemory(current, palette),
      ).then((outcome) => {
        if (!mountedRef.current || outcome === "rejected") return;
        setMessage(outcome === "durable"
          ? { tone: "success", title: `“${palette.name}” 팔레트를 만들었어요.`, details: [`${palette.colors.length}색`] }
          : { tone: "warning", title: `“${palette.name}” 팔레트는 현재 탭 메모리에만 있습니다.`, details: ["새로고침하면 사라집니다."] });
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: error instanceof Error ? error.message : "팔레트를 만들지 못했어요.",
        details: [],
      });
    }
  }

  function handleCreateFromPaste(): void {
    if (busyRef.current || mutationBusyRef.current) return;
    const colors = newColorsText.split(/[\s,]+/u).map((value) => value.trim()).filter(Boolean);
    try {
      const palette = createPalette(newName, colors);
      void commitMutation(
        () => repository.save(palette),
        (current) => upsertPaletteInMemory(current, palette),
      ).then((outcome) => {
        if (!mountedRef.current || outcome === "rejected") return;
        setMessage(outcome === "durable"
          ? { tone: "success", title: `“${palette.name}” 팔레트를 만들었어요.`, details: [`${palette.colors.length}색`] }
          : { tone: "warning", title: `“${palette.name}” 팔레트는 현재 탭 메모리에만 있습니다.`, details: ["새로고침하면 사라집니다."] });
        setNewName("");
        setNewColorsText("");
        setCreatorOpen(false);
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: error instanceof Error ? error.message : "팔레트를 만들지 못했어요.",
        details: [],
      });
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusyOperation({ kind: "import" });
    setMessage(null);
    try {
      const interchange = await loadStudioPaletteInterchangeModule();
      if (file.size > interchange.STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBytes) {
        throw new Error("팔레트 파일이 4MB 안전 처리 한도를 초과했습니다.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = detectPaletteFormat(file.name, bytes);
      const imported = interchange.importStudioPalette(format, bytes);
      const palette: StudioNamedPalette = createImportedNamedPalette(
        importedPaletteName(imported.palette.name, file.name),
        imported.palette.colors.map((color) => color.hex),
      );
      const outcome = await commitMutation(
        () => repository.save(palette),
        (current) => upsertPaletteInMemory(current, palette),
      );
      if (!mountedRef.current || outcome === "rejected") return;
      const namedColorCount = imported.palette.colors.filter((color) => Boolean(color.name)).length;
      const details = uniqueDetails([
        ...imported.warnings.map((item) => item.message),
        ...(imported.skippedColors > 0 ? [`해석하지 못한 색 ${imported.skippedColors}개를 건너뛰었습니다.`] : []),
        ...(imported.truncated ? [`앞쪽 ${interchange.STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors}색만 저장했습니다.`] : []),
        ...(namedColorCount > 0 ? [`색 이름 ${namedColorCount}개는 현재 라이브러리에서 색값만 저장됩니다.`] : []),
      ]);
      setMessage(outcome === "durable" ? {
        tone: details.length > 0 ? "warning" : "success",
        title: `${formatOption(format).shortLabel}에서 “${palette.name}” ${palette.colors.length}색을 가져왔어요.`,
        details,
      } : {
        tone: "warning",
        title: `“${palette.name}” 팔레트는 현재 탭 메모리에만 있습니다.`,
        details: ["SQLite/OPFS 저장에 실패했습니다. 새로고침하면 사라집니다.", ...details],
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: error instanceof Error ? error.message : "팔레트 파일을 가져오지 못했어요.",
        details: [],
      });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }

  async function handleExport(palette: StudioNamedPalette) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOperation({ kind: "export", paletteId: palette.id });
    setMessage(null);
    try {
      const interchange = await loadStudioPaletteInterchangeModule();
      const result = interchange.exportStudioPalette(exportFormat, {
        name: palette.name,
        colors: palette.colors.map((hex) => ({ hex })),
      });
      const option = formatOption(exportFormat);
      const part = typeof result.data === "string" ? result.data : ownedArrayBuffer(result.data);
      const fileName = exportFileName(palette, exportFormat);
      downloadBlob(new Blob([part], { type: option.mimeType }), fileName);
      const details = uniqueDetails([
        ...result.warnings.map((item) => item.message),
        ...(result.skippedColors > 0 ? [`해석하지 못한 색 ${result.skippedColors}개를 제외했습니다.`] : []),
        ...(result.truncated ? [
          `앞쪽 ${exportFormat === "act" || exportFormat === "pal"
            ? interchange.STUDIO_INDEXED_PALETTE_MAX_COLORS
            : interchange.STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors}색만 내보냈습니다.`,
        ] : []),
      ]);
      setMessage({
        tone: details.length > 0 ? "warning" : "success",
        title: `${option.shortLabel} 파일 “${fileName}” 다운로드를 시작했어요.`,
        details,
      });
    } catch (error) {
      setMessage({
        tone: error instanceof Error ? "error" : "error",
        title: error instanceof Error ? error.message : "팔레트를 내보내지 못했어요.",
        details: [],
      });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusyOperation(null);
    }
  }

  const filteredPalettes = palettes.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return p.name.toLowerCase().includes(q) || p.colors.some((c) => c.toLowerCase().includes(q));
  });

  return (
    <section
      aria-label="내 팔레트 라이브러리"
      aria-busy={busy}
      data-studio-palette-authority={storageState}
    >
      <div className="mb-2">
        <p className="text-xs font-semibold text-fg">내 팔레트</p>
        <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
          GPL·Adobe·JASC·CSS·JSON을 한 곳에서 교환합니다.
        </p>
      </div>

      <p className="mb-2 text-[0.6rem] font-semibold text-fg-3" aria-live="polite">
        {storageState === "loading"
          ? "SQLite/OPFS 팔레트 확인 중"
          : storageState === "sqlite"
            ? "이 기기 SQLite/OPFS 저장"
            : storageState === "memory"
              ? "현재 탭 메모리 임시 · 새로고침 시 사라짐"
              : storageState === "unavailable"
                ? "SQLite/OPFS 사용 불가 · 저장되지 않음"
                : "주입 저장소"}
      </p>

      {message && (
        <div
          className={cx(
            "mb-2 rounded-lg border px-2.5 py-2 text-[0.66rem] leading-relaxed",
            message.tone === "error" && "border-bad/40 bg-bad/10 text-bad",
            message.tone === "warning" && "border-warn/40 bg-warn/10 text-fg",
            message.tone === "success" && "border-good/35 bg-good/10 text-fg"
          )}
          role={message.tone === "error" ? "alert" : "status"}
          aria-live={message.tone === "error" ? "assertive" : "polite"}
        >
          <div className="flex items-start gap-1.5 font-semibold">
            {message.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 shrink-0 text-good" size={13} aria-hidden />
            ) : message.tone === "warning" ? (
              <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={13} aria-hidden />
            ) : null}
            <span>{message.title}</span>
          </div>
          {message.details.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-2">
              {message.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
          )}
        </div>
      )}

      {busyOperation && (
        <p className="sr-only" role="status" aria-live="polite">
          {busyOperation.kind === "import" ? "팔레트 파일을 확인하고 있어요." : "팔레트 파일을 만들고 있어요."}
        </p>
      )}

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <label
          className={cx(
            "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors duration-150 hover:bg-raised focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
            busy && "pointer-events-none cursor-wait opacity-55"
          )}
          onPointerEnter={preloadStudioPaletteInterchangeModule}
        >
          <Upload size={14} aria-hidden /> {busyOperation?.kind === "import" ? "확인 중…" : "파일 가져오기"}
          <input
            type="file"
            accept={PALETTE_IMPORT_ACCEPT}
            aria-label="팔레트 파일 가져오기"
            className="sr-only"
            disabled={busy}
            onFocus={preloadStudioPaletteInterchangeModule}
            onChange={(event) => void handleImportFile(event)}
          />
        </label>
        <button
          type="button"
          onClick={handleCreateFromRecent}
          disabled={busy || !seedColors || seedColors.length === 0}
          title={seedColors && seedColors.length > 0 ? "최근 사용한 색으로 새 팔레트 만들기" : "최근 사용한 색이 없어요"}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors duration-150 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} aria-hidden /> 최근 색으로 만들기
        </button>
      </div>

      <label className="mb-2 block" onPointerEnter={preloadStudioPaletteInterchangeModule}>
        <span className="mb-1 block text-[0.66rem] font-semibold text-fg-2">내보내기 형식</span>
        <select
          value={exportFormat}
          disabled={busy}
          aria-label="내보내기 형식"
          aria-describedby="palette-export-format-description"
          onFocus={preloadStudioPaletteInterchangeModule}
          onChange={(event) => setExportFormat(event.target.value as StudioPaletteInterchangeFormat)}
          className="min-h-11 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-55"
        >
          {FORMAT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <span id="palette-export-format-description" className="mt-1 block text-[0.62rem] leading-relaxed text-fg-3">
          {selectedFormat.description}
        </span>
      </label>

      <button
        type="button"
        onClick={() => setCreatorOpen((open) => !open)}
        aria-expanded={creatorOpen}
        disabled={busy}
        className={cx(
          "mb-2 min-h-11 w-full rounded-lg px-2 text-[0.68rem] font-semibold transition-colors duration-150 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-55",
          creatorOpen ? "bg-raised text-fg-2" : "text-fg-3 hover:text-fg-2"
        )}
      >
        직접 입력
      </button>

      {creatorOpen && (
        <div className="mb-2 flex flex-col gap-1.5 border-y border-line bg-card/50 py-2">
          <input
            type="text"
            value={newName}
            disabled={busy}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="팔레트 이름"
            aria-label="새 팔레트 이름"
            className="min-h-11 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg outline-none placeholder:text-fg-2 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <textarea
            value={newColorsText}
            disabled={busy}
            onChange={(event) => setNewColorsText(event.target.value)}
            placeholder="#ff0000 #00ff00 #0000ff — 공백이나 쉼표로 구분"
            aria-label="새 팔레트 색상 코드"
            rows={3}
            className="min-h-[4.5rem] resize-none rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg outline-none placeholder:text-fg-2 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            onClick={handleCreateFromPaste}
            disabled={busy || !newColorsText.trim()}
            className="min-h-11 rounded-lg bg-accent px-3 text-[0.68rem] font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            팔레트 만들기
          </button>
        </div>
      )}

      {/* Tabs: 내 팔레트 vs 웹툰 추천 프리셋 */}
      <div className="mb-2 flex rounded-lg border border-line bg-raised/50 p-0.5" role="tablist" aria-label="팔레트 보기 방식">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all"}
          aria-label="내 팔레트 목록"
          onClick={() => setActiveTab("all")}
          className={`flex-1 rounded py-1 text-[0.65rem] font-medium transition-colors ${
            activeTab === "all" ? "bg-card text-accent shadow-sm" : "text-fg-3 hover:text-fg-2"
          }`}
        >
          내 팔레트 ({palettes.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "presets"}
          aria-label="웹툰 추천 프리셋 보기"
          onClick={() => setActiveTab("presets")}
          className={`flex-1 rounded py-1 text-[0.65rem] font-medium transition-colors ${
            activeTab === "presets" ? "bg-card text-accent shadow-sm" : "text-fg-3 hover:text-fg-2"
          }`}
        >
          웹툰 추천 ({WEBTOON_PRESETS.length})
        </button>
      </div>

      {activeTab === "presets" ? (
        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {WEBTOON_PRESETS.map((preset) => (
            <article key={preset.name} className="rounded-lg border border-line bg-card p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-1">{preset.name}</span>
                <button
                  type="button"
                  aria-label={`${preset.name} 내 팔레트로 저장`}
                  onClick={() => handleSavePreset(preset.name, preset.colors)}
                  className="flex items-center gap-1 rounded border border-line bg-raised px-1.5 py-0.5 text-[0.58rem] font-medium text-fg-2 hover:border-accent hover:text-accent"
                >
                  <Sparkles className="size-2.5" aria-hidden /> 내 저장소에 복사
                </button>
              </div>
              <div
                className="my-1.5 h-1.5 w-full rounded-full shadow-inner opacity-90"
                style={{ background: `linear-gradient(to right, ${preset.colors.join(", ")})` }}
              />
              <div className="flex flex-wrap gap-1">
                {preset.colors.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`${preset.name} 색상 ${hex} 선택`}
                    onClick={() => onPickColor(hex)}
                    className="size-7 rounded border border-line transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <>
          {palettes.length > 2 && (
            <div className="mb-2 relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-fg-3" aria-hidden />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="팔레트 검색..."
                aria-label="팔레트 검색"
                className="h-8 w-full rounded-lg border border-line bg-panel pl-8 pr-2.5 text-xs text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {palettes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[0.68rem] leading-relaxed text-fg-3">
              아직 저장된 팔레트가 없어요.<br />GPL·Adobe·JASC·CSS·JSON 파일을 가져오거나 최근 색으로 시작하세요.
            </p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1" aria-label={`저장된 팔레트 ${palettes.length}개`}>
              {filteredPalettes.map((palette) => {
                const isExpanded = expandedPaletteIds.has(palette.id);
                const colorsToShow = isExpanded ? palette.colors : palette.colors.slice(0, SWATCH_PREVIEW_COUNT);
                return (
                  <article key={palette.id} className="rounded-lg border border-line bg-card px-2 py-1.5 transition-all hover:border-line-strong">
                    {/* Gradient bar preview */}
                    {palette.colors.length > 1 && (
                      <div
                        className="mb-1 h-1.5 w-full rounded-full shadow-inner opacity-80"
                        style={{ background: `linear-gradient(to right, ${palette.colors.join(", ")})` }}
                      />
                    )}

                    <div className="flex items-center gap-0.5">
                      {renamingId === palette.id ? (
                        <input
                          type="text"
                          value={renamingName}
                          disabled={busy}
                          aria-label={`${palette.name} 새 이름`}
                          onChange={(event) => setRenamingName(event.target.value)}
                          onBlur={commitRename}
                          onKeyDown={handleRenameKeyDown}
                          // eslint-disable-next-line jsx-a11y/no-autofocus -- edit-on-demand action should focus its field.
                          autoFocus
                          className="min-h-11 min-w-0 flex-1 rounded-lg border border-accent bg-panel px-2 text-xs text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={palette.name}>
                          {palette.name}
                          <span className="ml-1 text-[0.62rem] text-fg-3">{palette.colors.length}색</span>
                        </span>
                      )}

                      {/* Duplicate button */}
                      <button
                        type="button"
                        onClick={() => handleDuplicate(palette)}
                        disabled={busy}
                        aria-label={`${palette.name} 팔레트 복제`}
                        title="복제"
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-45"
                      >
                        <Copy size={14} aria-hidden />
                      </button>

                      {/* Add Seed Color button */}
                      {seedColors && seedColors.length > 0 && seedColors[0] && (
                        <button
                          type="button"
                          onClick={() => handleAddColor(palette, seedColors[0]!)}
                          disabled={busy || palette.colors.includes(seedColors[0]!.toLowerCase())}
                          aria-label={`${palette.name}에 현재 색 ${seedColors[0]} 추가`}
                          title="현재 색 추가"
                          className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-good focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Plus size={14} aria-hidden />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => startRename(palette)}
                        disabled={busy}
                        aria-label={`${palette.name} 이름 변경`}
                        title="이름 변경"
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-45"
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExport(palette)}
                        disabled={busy}
                        aria-label={`${palette.name} ${selectedFormat.shortLabel}로 내보내기`}
                        title={`${selectedFormat.label}로 내보내기`}
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-45"
                      >
                        <Download size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(palette.id)}
                        disabled={busy}
                        aria-label={`${palette.name} 팔레트 삭제`}
                        title="삭제"
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-bad disabled:cursor-wait disabled:opacity-45"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-1">
                      {colorsToShow.map((hex, index) => (
                        <button
                          key={`${hex}-${index}`}
                          type="button"
                          onClick={() => onPickColor(hex)}
                          disabled={busy}
                          aria-label={`${palette.name} 색상 ${hex} 선택`}
                          title={hex}
                          className="size-11 rounded-lg border border-line-strong shadow-[0_0_0_1px_oklch(0.15_0.008_70/0.35)_inset] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-55"
                          style={{ background: hex }}
                        />
                      ))}
                      {palette.colors.length > SWATCH_PREVIEW_COUNT && !isExpanded && (
                        <button
                          type="button"
                          onClick={() => setExpandedPaletteIds((prev) => new Set([...prev, palette.id]))}
                          aria-label={`${palette.name} 모든 ${palette.colors.length}색 펼치기`}
                          className="flex size-11 items-center justify-center rounded-lg border border-line px-1 text-[0.62rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg-1"
                        >
                          +{palette.colors.length - SWATCH_PREVIEW_COUNT}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
