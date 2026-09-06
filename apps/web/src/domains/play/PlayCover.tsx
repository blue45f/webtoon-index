// 놀이터(/play) 공용 커버.
// 표지 썸네일(프록시·표지 정책 적용)을 우선 노출하되, 미노출/차단/실패 시
// 자체 타이포그래픽 커버(그라디언트 + 해시 패턴 + 글로우 + 제목 타이포)로 폴백한다.
// → 표지 정책 off(COVER_IMAGE_POLICY=off)면 프록시가 막혀 자동으로 타이포만 남는다.
//
// 게임마다 소재 타입이 달라(PlayTitle / Card·Minion / Tile) cover·coverImage·id·title
// 네 필드만 받는다. 호출부에서 매핑(예: titleId→id, name→title)한다.

import { useState } from "react";

import { cn } from "@/shared/lib/utils";

/** 결정적 32bit FNV-1a 해시 — 패턴/글로우 선택 시드. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 해시로 고르는 미세 패턴 오버레이(빛 결/도트). opacity는 컨테이너에서 낮춘다. */
const PATTERNS = [
  { image: "repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 13px)", size: "auto" },
  { image: "radial-gradient(rgba(255,255,255,0.7) 1.1px, transparent 1.4px)", size: "14px 14px" },
  { image: "repeating-linear-gradient(-30deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 16px)", size: "auto" },
  { image: "radial-gradient(rgba(255,255,255,0.6) 1.3px, transparent 1.5px)", size: "20px 20px" },
] as const;

/** 제목 길이 → 폰트 크기(px). big은 큰 무대(룰렛/퀴즈 힌트)용. */
function titleFont(len: number, big: boolean): number {
  if (len <= 3) return big ? 38 : 26;
  if (len <= 6) return big ? 30 : 20;
  if (len <= 10) return big ? 24 : 16;
  return big ? 19 : 13;
}

export interface PlayCoverProps {
  /** 해시 시드(작품 id 또는 titleId) — 패턴/글로우 결정에 사용. */
  id: string;
  /** 작품 제목(타이포 폴백에 굽고 alt/aria에 사용). */
  title: string;
  /** OKLCH 그라디언트 2색(커버 폴백/배경). */
  cover: readonly [string, string];
  /** 프록시된 실제 커버 이미지 URL(있으면 위에 덮음). */
  coverImage?: string;
  /**
   * title: 제목 타이포 폴백 노출(기본).
   * mystery: 제목/이미지를 흐리고 ? 마커만 — 퀴즈 정답 숨김용.
   */
  mode?: "title" | "mystery";
  /** 큰 무대용 큰 타이포. */
  big?: boolean;
  /** 컨테이너 종횡비(Tailwind aspect-* 또는 CSS 값). 기본 3/4. */
  aspectClassName?: string;
  /** 추가 클래스(테두리/그림자/크기 등 — 호출부 레이아웃에 맞춤). */
  className?: string;
  /** 미스터리에서 이미 공개(revealed)되어 블러를 풀지 여부. */
  revealed?: boolean;
}

/**
 * 표지 커버 — 이미지가 있으면 덮고, 없거나 실패하면 그라디언트+패턴+제목 타이포로 폴백한다.
 * 접근성: 단일 이미지 표현이므로 컨테이너에 role="img"+aria-label(제목)을 부여하고,
 * 내부 <img>의 alt는 비워 중복 낭독을 막는다.
 */
export function PlayCover({
  id,
  title,
  cover,
  coverImage,
  mode = "title",
  big = false,
  aspectClassName = "aspect-[3/4]",
  className,
  revealed = false,
}: PlayCoverProps) {
  const [broken, setBroken] = useState(false);
  const mystery = mode === "mystery";
  const gradient = `linear-gradient(150deg, ${cover[0]}, ${cover[1]})`;
  const h = hash(id);
  const pattern = PATTERNS[h % PATTERNS.length];
  const glowX = h % 2 === 0 ? "-12%" : "70%";
  const showImg = !!coverImage && !broken;
  // 미스터리는 공개 전까지만 블러/스케일. 공개되면 일반 커버처럼 또렷하게.
  const blurred = mystery && !revealed;

  return (
    <div
      role="img"
      aria-label={mystery && !revealed ? "숨겨진 표지" : title}
      className={cn("relative overflow-hidden", aspectClassName, className)}
      style={{ background: gradient }}
    >
      {/* 라디얼 글로우 — 해시로 좌/우 배치. */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: "-22%",
          left: glowX,
          width: "80%",
          height: "68%",
          background: "radial-gradient(circle, rgba(255,255,255,0.24), transparent 68%)",
        }}
      />
      {/* 미세 패턴 오버레이. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: pattern.image, backgroundSize: pattern.size }}
      />

      {/* 타이포 폴백 — 이미지가 없을 때 제목을 굽는다(미스터리는 제외). */}
      {!mystery && !showImg && (
        <div className="absolute inset-0 grid place-items-center p-3">
          <span
            className="text-center font-black [word-break:keep-all]"
            style={{
              fontSize: titleFont(title.length, big),
              color: "rgba(255,255,255,0.95)",
              textShadow: "0 3px 14px rgba(0,0,0,0.45)",
              lineHeight: 1.16,
              letterSpacing: "-0.5px",
            }}
          >
            {title}
          </span>
        </div>
      )}

      {/* 표지 썸네일 — 있으면 위에 덮는다. 미스터리(공개 전)는 블러+확대. */}
      {showImg && (
        <img
          src={coverImage}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-[filter,transform,opacity] duration-500",
            blurred ? "scale-[1.18] opacity-80 blur-md brightness-90" : "opacity-95",
          )}
        />
      )}

      {/* 미스터리 마커 — 공개 전 ? 표시. */}
      {mystery && !revealed && (
        <div
          aria-hidden
          className="absolute inset-0 grid place-items-center font-black text-white/90"
          style={{ fontSize: big ? 72 : 44, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}
        >
          ?
        </div>
      )}
    </div>
  );
}

export default PlayCover;
