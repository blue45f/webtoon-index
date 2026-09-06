import { getCollectionIconOption } from "./visual-marks-utils";

import type { Platform } from "@/shared/lib/types";
import type { CSSProperties } from "react";

import { cx } from "@/shared/lib/cx";
import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

type MarkSize = "dot" | "xs" | "sm" | "md" | "lg";

const platformSizes: Record<MarkSize, string> = {
  dot: "size-3 rounded-[0.25rem]",
  xs: "size-4 rounded-[0.3rem]",
  sm: "size-5 rounded-md",
  md: "size-8 rounded-lg",
  lg: "size-9 rounded-xl",
};

const platformText: Record<MarkSize, string> = {
  dot: "text-[0]",
  xs: "text-[0.48rem]",
  sm: "text-[0.58rem]",
  md: "text-[0.72rem]",
  lg: "text-[0.82rem]",
};

type PlatformPattern =
  | "webtoon"
  | "series"
  | "page"
  | "k-webtoon"
  | "book"
  | "munpia"
  | "joara"
  | "novelpia"
  | "lezhin"
  | "bomtoon"
  | "toptoon"
  | "postype"
  | "mrblue"
  | "comico"
  | "toomics"
  | "bookcube"
  | "onestory"
  | "kyobo"
  | "yes24"
  | "kmas";

const PLATFORM_MARKS: Record<
  Platform["id"],
  {
    glyph: string;
    pattern: PlatformPattern;
    bg?: string;
    fg?: string;
    plate?: string;
    plateText?: string;
  }
> = {
  "naver-webtoon": {
    glyph: "W",
    pattern: "webtoon",
    bg: "#00DC64",
    fg: "#10130F",
    plate: "#10130F",
    plateText: "#00DC64",
  },
  "naver-series": {
    glyph: "S",
    pattern: "series",
    bg: "#00DC64",
    fg: "#10130F",
    plate: "#10130F",
    plateText: "#00DC64",
  },
  "kakao-page": {
    glyph: "P",
    pattern: "page",
    bg: "#FFCD00",
    fg: "#191600",
    plate: "#191600",
    plateText: "#FFCD00",
  },
  "kakao-webtoon": {
    glyph: "K",
    pattern: "k-webtoon",
    bg: "#18140F",
    fg: "#FFCD00",
    plate: "#FFCD00",
    plateText: "#18140F",
  },
  ridi: { glyph: "R", pattern: "book", bg: "#1F8CE6", fg: "#F4FBFF" },
  munpia: { glyph: "M", pattern: "munpia", bg: "#2B59C3", fg: "#F3F6FF" },
  joara: { glyph: "J", pattern: "joara", bg: "#22B8A6", fg: "#071C19" },
  novelpia: { glyph: "N", pattern: "novelpia", bg: "#7C5CFC", fg: "#FBFAFF" },
  lezhin: { glyph: "L", pattern: "lezhin", bg: "#E11D2E", fg: "#FFF5F6" },
  bomtoon: { glyph: "B", pattern: "bomtoon", bg: "#FF6B9D", fg: "#261018" },
  toptoon: { glyph: "T", pattern: "toptoon", bg: "#FF5A36", fg: "#251009" },
  postype: { glyph: "P", pattern: "postype", bg: "#1A1A1A", fg: "#F7F2EA" },
  mrblue: { glyph: "B", pattern: "mrblue", bg: "#2F6BFF", fg: "#F4F7FF" },
  comico: { glyph: "C", pattern: "comico", bg: "#E93423", fg: "#FFF5F2" },
  toomics: { glyph: "T", pattern: "toomics", bg: "#E60012", fg: "#FFF5F6" },
  bookcube: { glyph: "B", pattern: "bookcube", bg: "#2E7DD7", fg: "#F4FAFF" },
  onestory: { glyph: "1", pattern: "onestory", bg: "#F04E45", fg: "#FFF7F6" },
  kyobo: { glyph: "K", pattern: "kyobo", bg: "#4F7C2F", fg: "#F8FFF1" },
  yes24: { glyph: "24", pattern: "yes24", bg: "#2B56A3", fg: "#F5F8FF" },
  kmas: { glyph: "규", pattern: "kmas", bg: "#6B5B95", fg: "#FBFAFF" },
};

function luminance(hex: string) {
  const value = hex.replace("#", "");
  if (value.length < 6) return 0.5;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function markStyle(extra?: CSSProperties): CSSProperties {
  return { ...extra };
}

function PlatformSymbol({
  platform,
  size,
}: {
  platform: Pick<Platform, "id" | "short">;
  size: MarkSize;
}) {
  const mark = PLATFORM_MARKS[platform.id] ?? { glyph: platform.short.slice(0, 1), pattern: "book" as const };
  const detailed = size === "sm" || size === "md" || size === "lg";

  if (size === "dot") {
    return (
      <span
        className="relative size-1.5 rounded-[0.2rem]"
        style={markStyle({ backgroundColor: "var(--mark-fg)" })}
      />
    );
  }

  if (size === "xs") {
    return (
      <span className="relative font-display font-bold leading-none" style={markStyle({ color: "var(--mark-fg)" })}>
        {mark.glyph}
      </span>
    );
  }

  switch (mark.pattern) {
    case "webtoon":
      return (
        <span className="relative grid h-[58%] w-[74%] place-items-center rounded-[0.28rem] bg-[var(--mark-plate)]">
          <span className="absolute -bottom-[18%] left-[18%] h-[28%] w-[24%] rotate-[-28deg] rounded-[0.08rem] bg-[var(--mark-plate)]" />
          <span
            className="relative font-display font-black leading-none"
            style={markStyle({ color: "var(--mark-plate-text)", fontSize: detailed ? "0.38em" : "0.68em" })}
          >
            {detailed ? "WEBTOON" : "W"}
          </span>
        </span>
      );
    case "series":
      return (
        <span className="relative grid h-[58%] w-[76%] place-items-center rounded-[0.22rem] bg-[var(--mark-plate)]">
          <span
            className="relative font-display font-black leading-none"
            style={markStyle({ color: "var(--mark-plate-text)", fontSize: detailed ? "0.42em" : "0.72em" })}
          >
            {detailed ? "series" : "S"}
          </span>
        </span>
      );
    case "page":
      return (
        <span className="relative grid h-[70%] w-[64%] place-items-center rounded-[0.26rem] bg-[var(--mark-plate)]">
          <span className="font-display text-[0.9em] font-black leading-none text-[var(--mark-plate-text)]">P</span>
          <span className="absolute right-0 top-0 h-[30%] w-[34%] rounded-bl-[0.18rem] bg-[var(--mark-fold)]" />
        </span>
      );
    case "k-webtoon":
      return (
        <span className="relative grid h-[70%] w-[76%] place-items-center rounded-[0.2rem]">
          <span
            className="font-display font-black leading-none"
            style={markStyle({ color: "var(--mark-fg)", fontSize: detailed ? "0.44em" : "0.82em" })}
          >
            {detailed ? "KAKAO" : "K"}
          </span>
          {detailed ? (
            <span className="absolute bottom-[12%] font-display text-[0.22em] font-bold tracking-[0.08em] text-[var(--mark-fg)]">
              WEBTOON
            </span>
          ) : null}
          <span className="absolute right-[4%] top-[16%] h-[64%] w-[16%] rotate-45 rounded-full bg-[var(--mark-fg)] opacity-75" />
        </span>
      );
    case "book":
      return (
        <span className="relative flex h-[62%] w-[68%] items-stretch justify-center gap-[2px]">
          <span className="w-[42%] rounded-l-md border-2 border-[var(--mark-fg)] border-r-0" />
          <span className="w-[42%] rounded-r-md border-2 border-[var(--mark-fg)] border-l-0" />
          <span className="absolute bottom-[18%] h-px w-[62%] bg-[var(--mark-fg)] opacity-65" />
        </span>
      );
    case "munpia":
      return (
        <span className="relative h-[66%] w-[70%]">
          <span className="absolute bottom-0 left-0 h-full w-[18%] rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute bottom-0 right-0 h-full w-[18%] rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute left-[20%] top-[5%] h-[72%] w-[18%] rotate-[-24deg] rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute right-[20%] top-[5%] h-[72%] w-[18%] rotate-[24deg] rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "joara":
      return (
        <span className="relative h-[68%] w-[60%] rounded-[50%_50%_48%_18%] bg-[var(--mark-fg)]">
          <span className="absolute bottom-[16%] left-[35%] h-[58%] w-[18%] rounded-full bg-[var(--mark-bg-text)] opacity-72" />
          <span className="absolute -right-[16%] bottom-[8%] size-[28%] rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "novelpia":
      return (
        <span className="relative font-display text-[0.98em] font-black leading-none text-[var(--mark-fg)]">
          N
          <span className="absolute -right-[34%] -top-[24%] size-1.5 rotate-45 rounded-[1px] bg-[var(--mark-fg)]" />
        </span>
      );
    case "lezhin":
      return (
        <span className="relative h-[66%] w-[56%]">
          <span className="absolute bottom-0 left-0 h-full w-[24%] rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute bottom-0 left-0 h-[24%] w-full rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute right-0 top-0 h-[24%] w-[58%] rounded-full bg-[var(--mark-fg)] opacity-[0.6]" />
        </span>
      );
    case "bomtoon":
      return (
        <span className="relative grid h-[68%] w-[68%] place-items-center rounded-full border-2 border-[var(--mark-fg)] font-display text-[0.68em] font-black leading-none text-[var(--mark-fg)]">
          B
          <span className="absolute -right-[8%] top-[8%] size-[26%] rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "toptoon":
      return (
        <span className="relative h-[66%] w-[70%]">
          <span className="absolute left-0 top-0 h-[22%] w-full rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute left-[39%] top-0 h-full w-[22%] rounded-full bg-[var(--mark-fg)]" />
          <span className="absolute bottom-0 right-0 h-[22%] w-[44%] rounded-full bg-[var(--mark-fg)] opacity-75" />
        </span>
      );
    case "postype":
      return (
        <span className="relative grid h-[68%] w-[64%] place-items-center rounded-md border-2 border-[var(--mark-fg)] font-display text-[0.72em] font-black leading-none text-[var(--mark-fg)]">
          P
          <span className="absolute bottom-[12%] right-[8%] h-[14%] w-[48%] -rotate-45 rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "mrblue":
      return (
        <span className="relative grid h-[68%] w-[68%] place-items-center rounded-full border-2 border-[var(--mark-fg)] font-display text-[0.68em] font-black leading-none text-[var(--mark-fg)]">
          B
          <span className="absolute bottom-[12%] h-[18%] w-[70%] rounded-full bg-[var(--mark-fg)] opacity-65" />
        </span>
      );
    case "comico":
      return (
        <span className="relative h-[68%] w-[68%] rounded-full border-[3px] border-[var(--mark-fg)] border-r-transparent">
          <span className="absolute right-[4%] top-[38%] h-[22%] w-[34%] rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "toomics":
      return (
        <span className="relative grid h-[70%] w-[68%] place-items-center font-display text-[0.9em] font-black leading-none text-[var(--mark-fg)]">
          T
          <span className="absolute bottom-[2%] h-[18%] w-[76%] rounded-full bg-[var(--mark-fg)] opacity-72" />
        </span>
      );
    case "bookcube":
      return (
        <span className="grid h-[62%] w-[62%] grid-cols-2 gap-[2px]">
          <span className="rounded-[0.18rem] bg-[var(--mark-fg)]" />
          <span className="rounded-[0.18rem] bg-[var(--mark-fg)] opacity-75" />
          <span className="rounded-[0.18rem] bg-[var(--mark-fg)] opacity-75" />
          <span className="rounded-[0.18rem] border-2 border-[var(--mark-fg)]" />
        </span>
      );
    case "onestory":
      return (
        <span className="relative grid h-[68%] w-[68%] place-items-center rounded-full border-2 border-[var(--mark-fg)] font-display text-[0.62em] font-black text-[var(--mark-fg)]">
          1
          <span className="absolute -right-[8%] bottom-[8%] h-[30%] w-[28%] rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    case "kyobo":
      return (
        <span className="relative grid h-[68%] w-[68%] place-items-center font-display text-[0.86em] font-black leading-none text-[var(--mark-fg)]">
          K
          <span className="absolute right-0 top-[8%] h-[34%] w-[44%] rounded-full bg-[var(--mark-fg)] opacity-65" />
        </span>
      );
    case "yes24":
      return (
        <span className="relative font-display text-[0.72em] font-black leading-none text-[var(--mark-fg)]">
          24
          <span className="absolute -left-[18%] -top-[18%] size-1 rounded-full bg-[var(--mark-fg)]" />
        </span>
      );
    default:
      return <span className="relative font-display font-bold text-[var(--mark-fg)]">{mark.glyph}</span>;
  }
}

export function PlatformMark({
  platform,
  size = "md",
  className,
  title,
}: {
  platform: Pick<Platform, "id" | "name" | "short" | "color">;
  size?: MarkSize;
  className?: string;
  title?: string;
}) {
  const mark = PLATFORM_MARKS[platform.id];
  const baseColor = mark?.bg ?? platform.color;
  const textColor = mark?.fg ?? (luminance(baseColor) > 0.63 ? "oklch(0.18 0.018 66)" : "oklch(0.96 0.01 85)");
  const bgTextColor = luminance(baseColor) > 0.63 ? "oklch(0.96 0.01 85)" : "oklch(0.18 0.018 66)";
  const plateColor = mark?.plate ?? textColor;
  const plateTextColor = mark?.plateText ?? bgTextColor;

  return (
    <span
      className={cx(
        "relative inline-grid shrink-0 place-items-center overflow-hidden border border-[oklch(0.95_0.01_85/0.16)] font-display font-bold leading-none shadow-[inset_0_1px_0_oklch(1_0_0/0.14)]",
        platformSizes[size],
        platformText[size],
        className
      )}
      style={{
        background: `linear-gradient(145deg, color-mix(in oklch, ${baseColor} 96%, oklch(0.95 0.01 85)), color-mix(in oklch, ${baseColor} 78%, oklch(0.14 0.01 70)))`,
        color: textColor,
        "--mark-fg": textColor,
        "--mark-bg-text": bgTextColor,
        "--mark-plate": plateColor,
        "--mark-plate-text": plateTextColor,
        "--mark-fold": `color-mix(in oklch, ${baseColor} 52%, oklch(0.95 0.01 85))`,
      } as CSSProperties}
      title={title ?? platform.name}
      aria-hidden
    >
      <span
        className="absolute inset-x-0 top-0 h-1/2 opacity-45"
        style={{ background: "linear-gradient(to bottom, oklch(0.98 0.01 85 / 0.32), transparent)" }}
      />
      <PlatformSymbol platform={platform} size={size} />
    </span>
  );
}

export function ToonSpectrumMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[0.65rem] border border-line/70 bg-canvas shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]",
        className
      )}
      aria-hidden
    >
      <img src={resolveAssetUrl("/icon-192.png")} alt="" className="size-full object-cover" decoding="async" />
    </span>
  );
}

export function CollectionIcon({
  value,
  size = "md",
  active,
  className,
}: {
  value: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  className?: string;
}) {
  const option = getCollectionIconOption(value);
  const Icon = option.icon;
  const sizeClass = size === "sm" ? "size-7 rounded-lg" : size === "lg" ? "size-11 rounded-2xl" : "size-9 rounded-xl";
  const iconSize = size === "sm" ? 14 : size === "lg" ? 21 : 17;

  return (
    <span
      className={cx(
        "relative inline-grid shrink-0 place-items-center overflow-hidden border border-[oklch(0.95_0.01_85/0.14)] text-fg shadow-[inset_0_1px_0_oklch(1_0_0/0.13)]",
        sizeClass,
        active && "ring-2 ring-accent/50",
        className
      )}
      style={{ background: option.gradient }}
      title={option.label}
      aria-hidden
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,oklch(1_0_0/0.24),transparent_54%)]" />
      <Icon size={iconSize} strokeWidth={2} className="relative drop-shadow-[0_1px_4px_oklch(0.1_0.02_70/0.45)]" />
    </span>
  );
}
