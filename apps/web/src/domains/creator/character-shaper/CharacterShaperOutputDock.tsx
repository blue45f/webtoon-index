/**
 * Character Shaper — output dock.
 *
 * Left: the three reference tools (each button owns the drawer it opens). Middle: 표면 드로잉.
 * Right: transparent background, "캔버스에 추가" (the host's own insert path), a transparent PNG
 * download and the semantic PSD export. The PSD run reports progress while it renders and then a
 * receipt that names the layer count and every skipped pass — nothing is ever silently dropped.
 *
 * On mobile the dock collapses to icon buttons (labels move into `aria-label`) plus a "더 보기"
 * sheet that carries the background and the two file exports.
 */
import { Camera, Ellipsis, FileImage, ImageDown, Images, Layers, Paintbrush, Video } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { roundExportSize } from "../vrm/studio-vrm-poser-helpers";
import { encodeStudioVrmCapturePngBlob, captureStudioVrmRgba } from "../vrm/studio-vrm-raster-capture";

import { boundCharacterSemanticCaptureSize, exportCharacterSemanticPsd } from "./character-shaper-semantic-psd";
import { pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";

import type { CharacterShaperDrawerMode, CharacterShaperOutputDockProps } from "./character-shaper-ui-contract";
import type { VrmLibraryEntry } from "../vrm/vrm-library";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

type DrawerMode = Exclude<CharacterShaperDrawerMode, null>;
type ExportKind = "png" | "psd";

interface DockNotice {
  readonly tone: "info" | "good" | "bad";
  readonly text: string;
  readonly detail?: string;
}

const DRAWER_BUTTONS: readonly { readonly id: DrawerMode; readonly label: string; readonly icon: typeof Images }[] = [
  { id: "reference", label: "참고 이미지 AI 추천", icon: Images },
  { id: "photo", label: "사진 포즈", icon: Camera },
  { id: "webcam", label: "웹캠", icon: Video },
];

const NOTICE_MS = 9000;

const BUTTON = cn(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.74rem] font-semibold text-fg-2",
  "transition-colors duration-150 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const ICON_BUTTON = cn(
  "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2",
  "transition-colors duration-150 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const ACTIVE_BUTTON = "border-accent/60 bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent";

const PRIMARY_BUTTON = cn(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent/60 bg-accent px-3 text-[0.74rem] font-semibold text-on-accent",
  "transition-colors duration-150 hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

function safeFileStem(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[\\/:*?"<>|\s]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return cleaned.length > 0 ? cleaned.slice(0, 48) : "character";
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Anchor click download; blocked or unsupported environments report instead of failing silently. */
function downloadBlob(blob: Blob, fileName: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof document === "undefined") {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function CharacterShaperOutputDock({
  h,
  binding,
  drawer,
  onOpenDrawer,
  paintActive,
  onTogglePaint,
  compact,
}: CharacterShaperOutputDockProps) {
  const sheetId = useId();
  const aliveRef = useRef(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const [running, setRunning] = useState<ExportKind | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<DockNotice | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!sheetOpen) return;
    const panel = sheetRef.current;
    panel?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || sheetTriggerRef.current?.contains(target)) return;
      setSheetOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    const release = pushCharacterShaperKeyLayer((event) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSheetOpen(false);
      sheetTriggerRef.current?.focus({ preventScroll: true });
      return true;
    }, window);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      release();
    };
  }, [sheetOpen]);

  const capturing = Boolean(h.isCapturing || h.isSharingPose || h.isThumbnailCapturing);
  const modelReady = h.status === "ready";
  const transparent = Boolean(h.transparentBackground);
  const insertBackgroundColor: string =
    typeof h.insertBackgroundColor === "string" ? h.insertBackgroundColor : "#ffffff";
  const paintDisabledReason: string =
    typeof h.texturePaintDisabledReason === "string" ? h.texturePaintDisabledReason : "";
  const paintBlocked = paintDisabledReason.length > 0;
  const entries: readonly VrmLibraryEntry[] = Array.isArray(h.libraryEntries) ? h.libraryEntries : [];
  const modelName = entries.find((entry) => entry.id === h.activeModelId)?.name ?? "character";
  const exportBusy = running !== null;
  const exportBlocked = capturing || !modelReady || exportBusy || binding.busyReason !== null;

  const fail = (text: string, detail?: string) => {
    if (!aliveRef.current) return;
    setNotice({ tone: "bad", text, detail });
  };

  const readCapture = (): { gl: unknown; scene: unknown; camera: unknown } | null => {
    const capture = h.captureRef?.current ?? null;
    if (!capture || !capture.gl || !capture.scene || !capture.camera) return null;
    return capture;
  };

  const savePng = () => {
    const capture = readCapture();
    if (!capture) {
      fail("캡처할 3D 장면이 아직 준비되지 않았습니다.");
      return;
    }
    setRunning("png");
    setProgress("PNG로 굽는 중");
    void (async () => {
      try {
        const gl = capture.gl as { domElement: HTMLCanvasElement };
        const size = roundExportSize(gl.domElement);
        const rgba = captureStudioVrmRgba(
          capture.gl as never,
          capture.scene as never,
          capture.camera as never,
          size,
          transparent ? { alpha: 0 } : { color: insertBackgroundColor, alpha: 1 },
        );
        const blob = await encodeStudioVrmCapturePngBlob(rgba, size);
        const saved = downloadBlob(blob, `${safeFileStem(modelName)}-${timestamp()}.png`);
        if (!aliveRef.current) return;
        if (!saved) {
          fail("이 브라우저에서는 파일을 내려받을 수 없습니다.");
          return;
        }
        setNotice({
          tone: "good",
          text: `PNG를 저장했습니다 · ${size.width}×${size.height}${transparent ? " · 투명 배경" : ""}`,
        });
      } catch (error) {
        fail("PNG를 저장하지 못했습니다.", error instanceof Error ? error.message : undefined);
      } finally {
        if (aliveRef.current) {
          setRunning(null);
          setProgress(null);
        }
      }
    })();
  };

  const exportPsd = () => {
    const capture = readCapture();
    if (!capture) {
      fail("캡처할 3D 장면이 아직 준비되지 않았습니다.");
      return;
    }
    if (!h.vrm) {
      fail("PSD로 나눌 캐릭터가 없습니다.");
      return;
    }
    setRunning("psd");
    setProgress("레이어를 나누는 중 · 밑색 · 음영 · 하이라이트 · 주선");
    void (async () => {
      try {
        const gl = capture.gl as { domElement: HTMLCanvasElement };
        const display = roundExportSize(gl.domElement);
        const size = boundCharacterSemanticCaptureSize(display.width, display.height);
        const result = await exportCharacterSemanticPsd({
          capture: {
            gl: capture.gl as never,
            scene: capture.scene as never,
            camera: capture.camera as never,
          },
          vrm: h.vrm,
          width: size.width,
          height: size.height,
          title: modelName,
        });
        const saved = downloadBlob(result.blob, `${safeFileStem(modelName)}-${timestamp()}.psd`);
        if (!aliveRef.current) return;
        if (!saved) {
          fail("이 브라우저에서는 파일을 내려받을 수 없습니다.");
          return;
        }
        const skipped = result.receipt.skipped;
        setNotice({
          tone: skipped.length > 0 ? "info" : "good",
          text:
            skipped.length > 0
              ? `PSD 레이어 ${result.receipt.layerNames.length}개 저장 · 건너뛴 패스 ${skipped.length}개`
              : `PSD 레이어 ${result.receipt.layerNames.length}개를 저장했습니다`,
          detail:
            skipped.length > 0
              ? skipped.map((entry) => `${entry.pass}: ${entry.reason}`).join(" · ")
              : undefined,
        });
      } catch (error) {
        fail("PSD를 내보내지 못했습니다.", error instanceof Error ? error.message : undefined);
      } finally {
        if (aliveRef.current) {
          setRunning(null);
          setProgress(null);
        }
      }
    })();
  };

  const insert = () => {
    if (capturing) return;
    h.handleInsert();
  };

  const transparentSwitch = (
    <button
      type="button"
      role="switch"
      aria-checked={transparent}
      disabled={capturing}
      title={
        transparent
          ? "투명 배경 · 캔버스와 PNG에 캐릭터만 남습니다"
          : `배경색 ${insertBackgroundColor.toUpperCase()}로 채웁니다`
      }
      onClick={() => h.setTransparentBackground(!transparent)}
      className={cn(BUTTON, transparent && ACTIVE_BUTTON)}
    >
      <span
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 rounded-sm border border-line-strong/70",
          transparent &&
            "[background-image:linear-gradient(45deg,oklch(0.75_0.01_80/0.5)_25%,transparent_25%),linear-gradient(-45deg,oklch(0.75_0.01_80/0.5)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,oklch(0.75_0.01_80/0.5)_75%),linear-gradient(-45deg,transparent_75%,oklch(0.75_0.01_80/0.5)_75%)] [background-position:0_0,0_3px,3px_-3px,-3px_0] [background-size:6px_6px]",
        )}
        style={transparent ? undefined : { backgroundColor: insertBackgroundColor }}
      />
      투명 배경
    </button>
  );

  const backgroundColorField = transparent ? null : (
    <label className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-2 text-[0.7rem] font-semibold text-fg-2">
      배경색
      <input
        type="color"
        value={insertBackgroundColor}
        disabled={capturing}
        aria-label="삽입 배경색"
        className="size-8 cursor-pointer rounded-md border border-line bg-panel p-0.5 disabled:cursor-not-allowed disabled:opacity-45"
        onChange={(event) => h.setInsertBackgroundColor(event.currentTarget.value)}
      />
    </label>
  );

  const pngButton = (icon: boolean): ReactNode => (
    <button
      type="button"
      disabled={exportBlocked}
      aria-label="PNG 저장"
      title={transparent ? "투명 배경 PNG로 저장" : "배경색을 포함한 PNG로 저장"}
      onClick={savePng}
      className={icon ? ICON_BUTTON : BUTTON}
    >
      <ImageDown size={16} aria-hidden />
      {icon ? null : "PNG 저장"}
    </button>
  );

  const psdButton = (icon: boolean): ReactNode => (
    <button
      type="button"
      disabled={exportBlocked}
      aria-label="PSD 내보내기"
      title="밑색 · 음영 · 하이라이트 · 주선을 레이어로 나눠 저장합니다"
      onClick={exportPsd}
      className={icon ? ICON_BUTTON : BUTTON}
    >
      <Layers size={16} aria-hidden />
      {icon ? null : "PSD 내보내기"}
    </button>
  );

  const statusLine = progress ?? notice?.text ?? null;

  return (
    <div
      data-character-shaper-dock={compact ? "compact" : "wide"}
      className="relative flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line bg-panel px-2 py-2"
    >
      <div role="group" aria-label="참고 도구" className="flex shrink-0 items-center gap-1">
        {DRAWER_BUTTONS.map((item) => {
          const Icon = item.icon;
          const open = drawer === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={open}
              aria-label={item.label}
              title={item.label}
              onClick={() => onOpenDrawer(item.id)}
              className={cn(compact ? ICON_BUTTON : BUTTON, open && ACTIVE_BUTTON)}
            >
              <Icon size={16} aria-hidden />
              {compact ? null : item.label}
            </button>
          );
        })}
      </div>

      <span aria-hidden className="mx-0.5 hidden h-6 w-px shrink-0 bg-line sm:block" />

      <button
        type="button"
        aria-pressed={paintActive}
        aria-keyshortcuts="B"
        aria-label="표면 드로잉"
        disabled={paintBlocked || (!paintActive && !modelReady)}
        title={paintBlocked ? paintDisabledReason : "모델 표면에 직접 그립니다 (B)"}
        onClick={onTogglePaint}
        className={cn(compact ? ICON_BUTTON : BUTTON, paintActive && ACTIVE_BUTTON)}
      >
        <Paintbrush size={16} aria-hidden />
        {compact ? null : "표면 드로잉"}
      </button>

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
        {compact ? null : (
          <>
            {transparentSwitch}
            {backgroundColorField}
          </>
        )}
        <button
          type="button"
          disabled={capturing || !modelReady}
          aria-label="캔버스에 추가"
          title="지금 화면 그대로 현재 페이지에 넣습니다"
          onClick={insert}
          className={compact ? cn(ICON_BUTTON, "border-accent/60 bg-accent text-on-accent hover:bg-accent-2") : PRIMARY_BUTTON}
        >
          <FileImage size={16} aria-hidden />
          {compact ? null : "캔버스에 추가"}
        </button>
        {compact ? (
          <button
            ref={sheetTriggerRef}
            type="button"
            aria-expanded={sheetOpen}
            aria-controls={sheetId}
            aria-label="내보내기 더 보기"
            title="내보내기 더 보기"
            onClick={() => setSheetOpen((open) => !open)}
            className={cn(ICON_BUTTON, sheetOpen && ACTIVE_BUTTON)}
          >
            <Ellipsis size={16} aria-hidden />
          </button>
        ) : (
          <>
            {pngButton(false)}
            {psdButton(false)}
          </>
        )}
      </div>

      {statusLine ? (
        <p
          role="status"
          aria-live="polite"
          title={notice?.detail}
          className={cn(
            "w-full min-w-0 truncate text-[0.68rem] font-semibold leading-relaxed",
            notice?.tone === "bad" ? "text-bad" : notice?.tone === "good" ? "text-good" : "text-fg-3",
          )}
        >
          {statusLine}
          {notice?.detail ? <span className="ml-1 font-normal text-fg-3">{notice.detail}</span> : null}
        </p>
      ) : null}

      {compact && sheetOpen ? (
        <div
          ref={sheetRef}
          id={sheetId}
          role="group"
          aria-label="내보내기"
          className="absolute bottom-full right-2 z-40 mb-1.5 w-[min(20rem,calc(100vw-1rem))] rounded-2xl border border-line bg-panel p-2 shadow-[0_-12px_40px_oklch(0.05_0.01_70/0.45)]"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {transparentSwitch}
            {backgroundColorField}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={exportBlocked}
              onClick={savePng}
              className={BUTTON}
            >
              <ImageDown size={16} aria-hidden />
              PNG 저장
            </button>
            <button
              type="button"
              disabled={exportBlocked}
              onClick={exportPsd}
              className={BUTTON}
            >
              <Layers size={16} aria-hidden />
              PSD 내보내기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
