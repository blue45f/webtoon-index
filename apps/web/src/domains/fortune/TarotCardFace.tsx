import { motion } from "motion/react";

import { getTarotVisual, tarotAccent, tarotFaceGradient } from "./tarot-visuals";

import { Card3D } from "@/shared/components/ui/card-3d";

interface TarotCardFaceProps {
  card: {
    id: number;
    name: string;
    nameEn: string;
    type: "upright" | "reversed";
    keywords: string[];
  };
  className?: string;
}

// 메이저 아르카나 카드 한 장 — 카드별 고유 색상(hue)·모티프 글리프로 그려지는
// 생성형 타로 카드 페이스. 정/역방향을 글리프 회전과 배지로 구분한다.
export function TarotCardFace({ card, className }: TarotCardFaceProps) {
  const visual = getTarotVisual(card.id);
  const accent = tarotAccent(visual.hue);
  const reversed = card.type === "reversed";

  return (
    <Card3D maxTilt={14} scale={1.04} className={className}>
      <div
        className="relative flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-2xl p-3 text-center"
      style={{
        backgroundImage: tarotFaceGradient(visual.hue),
        border: `2px solid ${accent}`,
        boxShadow: `0 14px 36px -10px oklch(0.3 0.12 ${visual.hue} / 0.5)`,
      }}
    >
      {/* 코너 글로 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 80% at 50% 0%, oklch(0.85 0.12 ${visual.hue} / 0.22), transparent 60%)` }}
      />
      {/* 빛 스윕 — 카드 위를 반복해 지나는 광택 */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(115deg, transparent 38%, oklch(0.98 0.02 90 / 0.35) 50%, transparent 62%)",
          backgroundSize: "260% 100%",
        }}
        animate={{ backgroundPositionX: ["140%", "-40%"] }}
        transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.8 }}
      />

      {/* 상단: 로마 숫자 + 영문명 */}
      <div className="relative z-10 border-b pb-2" style={{ borderColor: `${accent}40` }}>
        <span className="font-display text-sm font-extrabold tracking-widest" style={{ color: accent }}>
          {visual.roman}
        </span>
        <span className="mt-0.5 block font-display text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">
          {card.nameEn}
        </span>
      </div>

      {/* 중앙: 모티프 글리프 (은은한 떠오름 + 글로우) */}
      <div className="relative z-10 flex flex-1 items-center justify-center">
        <motion.span
          className="text-[3.25rem] leading-none sm:text-6xl"
          style={{ transform: reversed ? "rotate(180deg)" : undefined, filter: `drop-shadow(0 3px 14px ${accent})` }}
          animate={{ y: [0, -5, 0], scale: [1, 1.06, 1] }}
          transition={{ duration: 3.4, ease: "easeInOut", repeat: Infinity }}
        >
          {visual.glyph}
        </motion.span>
      </div>

      {/* 하단: 한글명 + 정/역 배지 + 키워드 */}
      <div className="relative z-10 border-t pt-2" style={{ borderColor: `${accent}40` }}>
        <span className="block font-serif text-lg font-extrabold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          {card.name}
        </span>
        <span
          className="mx-auto mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{ background: "rgba(0,0,0,0.45)", color: accent }}
        >
          {reversed ? "역방향 · Reversed" : "정방향 · Upright"}
        </span>
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {card.keywords.slice(0, 3).map((kw, i) => (
            <span
              key={i}
              className="rounded px-1.5 py-0.5 text-[9px] text-white/85"
              style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${accent}30` }}
            >
              #{kw}
            </span>
          ))}
        </div>
      </div>
    </div>
  </Card3D>
  );
}
