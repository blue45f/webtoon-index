import { Camera, Trash2, UserRound } from "lucide-react";
import { useRef, useState } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { resolveSignupAvatarImage } from "@/shared/lib/avatar";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// 클라이언트에서 이미지를 정사각 webp dataURL 로 다운스케일. (서버 PATCH 부하/한도 보호)
const MAX_DIMENSION = 256; // px (정사각 한 변)
const TARGET_BYTES = 200 * 1024; // ≈200KB 이하가 되도록 품질을 낮춰 재인코딩

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length / 4) * 3 - padding);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
  img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image file."));
    };
    img.src = url;
  });
}

// 정사각 크롭(가운데) + 다운스케일 → webp dataURL. 품질을 단계적으로 낮춰 용량 한도를 맞춘다.
async function fileToSquareWebp(file: File): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const size = Math.min(MAX_DIMENSION, side);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to render image.");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  let quality = 0.85;
  let out = canvas.toDataURL("image/webp", quality);
  // webp 미지원 브라우저는 png 로 폴백되므로 형식 확인 후 처리.
  if (!out.startsWith("data:image/webp")) {
    out = canvas.toDataURL("image/jpeg", quality);
  }
  while (dataUrlBytes(out) > TARGET_BYTES && quality > 0.4) {
    quality -= 0.15;
    out = out.startsWith("data:image/webp")
      ? canvas.toDataURL("image/webp", quality)
      : canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export function AvatarUploader({
  value,
  fallbackText,
  onChange,
  onError,
  disabled,
}: {
  value: string | null; // 현재 아바타 dataURL/URL (없으면 폴백)
  fallbackText?: string; // 이미지 없을 때 이니셜
  onChange: (next: string | null) => void; // dataURL 또는 null(제거)
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const preview = resolveSignupAvatarImage(value) ?? (value && /^https?:\/\//.test(value) ? value : null);

  const pick = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError?.(t("avatar.error.invalidType"));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToSquareWebp(file);
      onChange(dataUrl);
    } catch (err) {
      onError?.(err instanceof Error ? t("avatar.error.processFailed") : t("avatar.error.processFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={pick}
        disabled={disabled || busy}
        aria-label={t("avatar.changeAria")}
        className={cn(
          "group relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-accent text-2xl font-bold text-on-accent transition-transform active:scale-95",
          (disabled || busy) && "opacity-60"
        )}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : fallbackText ? (
          fallbackText
        ) : (
          <UserRound size={28} />
        )}
        <span className="absolute inset-0 grid place-items-center bg-[oklch(0.12_0.02_70/0.55)] opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? (
            <span className="size-5 animate-spin rounded-full border-2 border-on-accent/40 border-t-on-accent" />
          ) : (
            <Camera size={20} className="text-on-accent" />
          )}
        </span>
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={pick}
            disabled={disabled || busy}
            className={buttonClass({ size: "sm", variant: "outline", className: "gap-1.5" })}
          >
            <Camera size={14} />
            {busy ? t("avatar.processing") : t("avatar.select")}
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || busy}
              className={buttonClass({ size: "sm", variant: "ghost", className: "gap-1.5 text-fg-3 hover:text-bad" })}
            >
              <Trash2 size={14} />
              {t("avatar.remove")}
            </button>
          )}
        </div>
        <p className="text-[0.72rem] leading-relaxed text-fg-3">
          {t("avatar.uploadHint")}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
