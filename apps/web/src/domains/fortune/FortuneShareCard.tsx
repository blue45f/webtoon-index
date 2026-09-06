import { forwardRef } from "react";

import { charHue } from "./fortune-theme";
import { getTarotVisual, tarotAccent } from "./tarot-visuals";

import type { FortuneResult, FortuneTab } from "./FortunePage";

import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";



// 공유/저장용 포스터 카드 — html-to-image로 PNG 캡처되는 고정폭 세로 카드.
// 운세 타입별 핵심 결과 + 하이라이트 대사 + 추천작 + 브랜딩을 한 장에 담는다.

const TAB_LABEL: Record<FortuneTab, string> = {
  today: "오늘의 운세",
  zodiac: "별자리 운세",
  saju: "사주팔자",
  compatibility: "인연 궁합",
  tarot: "오늘의 타로",
  prescription: "독서 처방",
};
const ELEMENT_KO: Record<string, string> = { wood: "목", fire: "화", earth: "토", metal: "금", water: "수" };

interface ShareCharacter {
  id: string;
  name: string;
  origin: string;
  avatarUrl: string;
}

interface FortuneShareCardProps {
  result: FortuneResult;
  character: ShareCharacter;
  tab: FortuneTab;
  dateLabel: string;
}

function highlightLine(result: FortuneResult): string {
  const lines = result.panels?.flatMap((p) => p.lines) ?? [];
  const spoken = lines.find((l) => l.text && l.speaker) ?? lines.find((l) => l.text);
  return spoken?.text ?? "";
}

export const FortuneShareCard = forwardRef<HTMLDivElement, FortuneShareCardProps>(
  function FortuneShareCard({ result, character, tab, dateLabel }, ref) {
    const hue = charHue(character.id);
    const accent = `oklch(0.84 0.13 ${hue})`;
    const ink = "oklch(0.96 0.01 90)";
    const sub = "oklch(0.74 0.012 78)";
    const quote = highlightLine(result);

    return (
      <div
        ref={ref}
        style={{
          width: 380,
          fontFamily: "Pretendard, system-ui, sans-serif",
          color: ink,
          background: `linear-gradient(165deg, oklch(0.26 0.05 ${hue}) 0%, oklch(0.16 0.03 ${hue}) 55%, oklch(0.12 0.015 ${hue}) 100%)`,
          border: `2px solid ${accent}`,
          borderRadius: 24,
          padding: 22,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* 망점 텍스처 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(oklch(1 0 0 / 0.05) 1px, transparent 1.4px)",
            backgroundSize: "7px 7px",
            opacity: 0.5,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative" }}>
          {/* 브랜드 + 타입 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontWeight: 800, letterSpacing: "0.16em", fontSize: 12, color: accent }}>✦ TOONSPECTRUM</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 999,
                background: "oklch(0.12 0.01 60 / 0.6)",
                border: `1px solid ${accent}55`,
                color: accent,
              }}
            >
              {TAB_LABEL[tab]}
            </span>
          </div>

          {/* 캐릭터 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 999,
                overflow: "hidden",
                border: `2px solid ${accent}`,
                flexShrink: 0,
                background: "oklch(0.2 0.02 60)",
              }}
            >
              {character.avatarUrl ? (
                <img src={resolveAssetUrl(character.avatarUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{character.name}</div>
              <div style={{ fontSize: 11, color: sub }}>《{character.origin}》가 전하는 운세</div>
            </div>
          </div>

          {/* 타입별 핵심 결과 */}
          <ShareHero result={result} tab={tab} accent={accent} ink={ink} sub={sub} />

          {/* 하이라이트 대사 */}
          {quote && (
            <div
              style={{
                marginTop: 14,
                background: "oklch(0.94 0.018 85)",
                color: "oklch(0.24 0.02 60)",
                borderRadius: 14,
                padding: "11px 14px",
                fontWeight: 600,
                fontSize: 13.5,
                lineHeight: 1.5,
                border: "2px solid oklch(0.2 0.02 60)",
              }}
            >
              “{quote.length > 70 ? quote.slice(0, 70) + "…" : quote}”
            </div>
          )}

          {/* 추천작 */}
          {result.recommendations.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 6 }}>
                행운의 작품
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {result.recommendations.slice(0, 3).map((t, i) => (
                  <div key={t.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 }}>
                    <span style={{ color: accent, fontWeight: 800, width: 14 }}>{i + 1}</span>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 푸터 */}
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: "1px solid oklch(0.5 0.02 70 / 0.4)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 10.5,
              color: sub,
            }}
          >
            <span>{dateLabel}</span>
            <span style={{ fontWeight: 700, color: accent }}>www.toonstudio.cloud/fortune</span>
          </div>
        </div>
      </div>
    );
  }
);

function Chip({ label, value, accent, sub }: { label: string; value: string | number; accent: string; sub: string }) {
  return (
    <div style={{ background: "oklch(0.14 0.01 60 / 0.55)", borderRadius: 11, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: accent, letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{value}</div>
      <div style={{ display: "none" }}>{sub}</div>
    </div>
  );
}

function ShareHero({
  result,
  tab,
  accent,
  ink,
  sub,
}: {
  result: FortuneResult;
  tab: FortuneTab;
  accent: string;
  ink: string;
  sub: string;
}) {
  if (tab === "today" && result.today) {
    const t = result.today;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: accent }}>{t.score}</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>점</span>
          {result.iljin?.themeName && (
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: sub }}>{result.iljin.themeName}</span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 }}>
          <Chip label="행운 컬러" value={t.color} accent={accent} sub="" />
          <Chip label="행운 방향" value={t.direction} accent={accent} sub="" />
          <Chip label="행운 시간" value={t.time} accent={accent} sub="" />
          <Chip label="행운 숫자" value={t.luckyNumber} accent={accent} sub="" />
        </div>
      </div>
    );
  }

  if (tab === "saju" && result.saju) {
    const dp = result.saju.dayPillar;
    const a = result.analysis;
    const r = result.saju.elementsRatio;
    const bars: Array<[string, number, number]> = [
      ["목", r.wood, 150], ["화", r.fire, 25], ["토", r.earth, 70], ["금", r.metal, 250], ["수", r.water, 230],
    ];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: accent }}>{dp.kanKorean}{dp.jiKorean}</span>
          <span style={{ fontSize: 12, color: sub }}>일주</span>
          {a && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: sub }}>{a.strength} · 용신 {ELEMENT_KO[a.usefulElementEn] ?? a.usefulElement}</span>}
        </div>
        {a?.personality && (
          <div style={{ fontSize: 12.5, color: ink, marginTop: 6, lineHeight: 1.5 }}>{a.personality}</div>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
          {bars.map(([name, val, h]) => (
            <div key={name} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 44, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div style={{ width: 14, height: `${Math.max(8, val)}%`, background: `oklch(0.7 0.15 ${h})`, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>{name} {val}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === "tarot" && result.cards && result.cards.length === 3) {
    return (
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        {result.cards.map((card, idx) => {
          const v = getTarotVisual(card.id);
          const cardAccent = tarotAccent(v.hue);
          return (
            <div key={idx} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: accent, marginBottom: 4 }}>{card.position}</div>
              <div
                style={{
                  height: 132,
                  borderRadius: 11,
                  border: `2px solid ${cardAccent}`,
                  background: `linear-gradient(160deg, oklch(0.42 0.13 ${v.hue}), oklch(0.18 0.05 ${v.hue}))`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, color: cardAccent }}>{v.roman}</span>
                <span style={{ fontSize: 28, transform: card.type === "reversed" ? "rotate(180deg)" : undefined }}>{v.glyph}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>{card.name}</span>
                <span style={{ fontSize: 9, color: sub }}>{card.type === "reversed" ? "역" : "정"}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (tab === "tarot" && result.card) {
    const v = getTarotVisual(result.card.id);
    const cardAccent = tarotAccent(v.hue);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 84,
            height: 126,
            borderRadius: 12,
            border: `2px solid ${cardAccent}`,
            background: `linear-gradient(160deg, oklch(0.42 0.13 ${v.hue}), oklch(0.18 0.05 ${v.hue}))`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: cardAccent }}>{v.roman}</span>
          <span style={{ fontSize: 34, transform: result.card.type === "reversed" ? "rotate(180deg)" : undefined }}>{v.glyph}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{result.card.name}</span>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: cardAccent }}>
            {result.card.type === "reversed" ? "역방향" : "정방향"} · {result.card.nameEn}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            {result.card.keywords.slice(0, 3).map((k, i) => (
              <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "oklch(0.14 0.01 60 / 0.6)", color: ink }}>
                #{k}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (tab === "compatibility" && result.compat) {
    const c = result.compat;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color: accent }}>{c.score}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>%</span>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700 }}>{c.grade}</span>
        </div>
        {result.mySaju && result.partnerSaju && (
          <div style={{ fontSize: 12, color: sub, marginTop: 8 }}>
            나 {result.mySaju.dayPillar.kanKorean}{result.mySaju.dayPillar.jiKorean} · 상대 {result.partnerSaju.dayPillar.kanKorean}{result.partnerSaju.dayPillar.jiKorean}
          </div>
        )}
        {c.factors[0] && <div style={{ fontSize: 12, color: ink, marginTop: 6, lineHeight: 1.5 }}>{c.factors[0]}</div>}
      </div>
    );
  }

  if (tab === "zodiac" && result.zodiac) {
    const z = result.zodiac;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 52, filter: `drop-shadow(0 2px 10px ${accent})` }}>{z.glyph}</span>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 38, fontWeight: 900, color: accent }}>{z.score}</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>점</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{z.ko} · {z.element}의 별자리</div>
          <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>#{z.traits.join(" #")}</div>
        </div>
      </div>
    );
  }

  if (tab === "prescription") {
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.08em" }}>진단된 고민</div>
        <div style={{ fontSize: 13.5, color: ink, marginTop: 4, lineHeight: 1.5 }}>
          “{(result.query ?? "").length > 60 ? result.query!.slice(0, 60) + "…" : result.query}”
        </div>
        <div style={{ fontSize: 12, color: sub, marginTop: 8 }}>마음을 어루만질 {result.recommendations.length}권을 처방했어요.</div>
      </div>
    );
  }

  return null;
}
