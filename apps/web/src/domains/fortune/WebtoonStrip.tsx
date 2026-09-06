import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";

import { CHAR_HUE } from "./fortune-theme";

import type { FortuneCharacterInfo, FortunePanel, FortunePanelLine, PlaybackStep } from "./fortune-types";

import { cn } from "@/shared/lib/utils";
import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

// 캐릭터별 무드 색상환(hue)은 fortune-theme 단일 출처. 나레이션 기본은 따뜻한 잉크.
const NARRATION_HUE = 70;

function hueFor(id: string | null): number {
  return (id ? CHAR_HUE[id] : undefined) ?? NARRATION_HUE;
}
function panelBg(hue: number): string {
  return `linear-gradient(155deg, oklch(0.27 0.055 ${hue}) 0%, oklch(0.18 0.03 ${hue}) 58%, oklch(0.14 0.018 ${hue}) 100%)`;
}
const frameColor = (hue: number) => `oklch(0.66 0.13 ${hue})`;
const nameColor = (hue: number) => `oklch(0.84 0.13 ${hue})`;

const HALFTONE: React.CSSProperties = {
  backgroundImage: "radial-gradient(oklch(1 0 0 / 0.05) 1px, transparent 1.4px)",
  backgroundSize: "7px 7px",
};
const BUBBLE_BG = "oklch(0.94 0.018 85)";
const BUBBLE_INK = "oklch(0.24 0.02 60)";

export interface PlaybackView {
  active: boolean; // 재생 모드(idle 아님)
  steps: PlaybackStep[];
  activeStep: number;
  activePanel: number;
  typed: number;
}

interface WebtoonStripProps {
  panels: FortunePanel[];
  characters: FortuneCharacterInfo[];
  selectedCharacterId: string;
  playback: PlaybackView;
}

export function WebtoonStrip({ panels, characters, selectedCharacterId, playback }: WebtoonStripProps) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const byShortName = new Map(characters.map((c) => [c.name.split(" ").pop() ?? c.name, c]));

  const resolveCharacter = (line: FortunePanelLine): FortuneCharacterInfo | null => {
    if (line.characterId && byId.has(line.characterId)) return byId.get(line.characterId)!;
    const spk = line.speaker.trim();
    if (spk && byShortName.has(spk)) return byShortName.get(spk)!;
    for (const c of characters) {
      const short = c.name.split(" ").pop() ?? c.name;
      if (spk.includes(short)) return c;
    }
    return byId.get(selectedCharacterId) ?? null;
  };

  // (panel,line) → step 인덱스
  const stepIndex = new Map<string, number>();
  playback.steps.forEach((s, i) => stepIndex.set(`${s.panel}:${s.line}`, i));

  // 재생 중 활성 컷을 화면 중앙으로
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!playback.active || playback.activePanel < 0) return;
    const el = panelRefs.current[playback.activePanel];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [playback.active, playback.activePanel]);

  let dialogueCounter = 0;

  return (
    <div className="space-y-5">
      {panels.map((panel, panelIndex) => {
        const sfxList = panel.lines.filter((l) => l.sfx).map((l) => l.sfx!);

        // 컷의 무드 = 첫 대사 화자(없으면 선택 캐릭터)
        const firstSpeaker = panel.lines.find((l) => l.text && l.speaker);
        const moodChar = firstSpeaker ? resolveCharacter(firstSpeaker) : byId.get(selectedCharacterId) ?? null;
        const hue = hueFor(moodChar?.id ?? null);

        // 재생 모드에서의 컷 상태
        const phase = !playback.active
          ? "static"
          : panelIndex === playback.activePanel
            ? "active"
            : panelIndex < playback.activePanel
              ? "past"
              : "future";

        const panelOpacity = phase === "future" ? 0.16 : phase === "past" ? 0.5 : 1;
        const isActiveCut = phase === "active";

        return (
          <motion.article
            key={panelIndex}
            ref={(el) => {
              panelRefs.current[panelIndex] = el;
            }}
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{
              opacity: panelOpacity,
              y: 0,
              scale: isActiveCut ? 1.015 : 1,
              filter: phase === "future" ? "blur(2px)" : "blur(0px)",
            }}
            transition={{ duration: 0.45, delay: playback.active ? 0 : Math.min(panelIndex * 0.12, 0.7), ease: "easeOut" }}
            className={cn(
              "relative overflow-hidden rounded-[20px]",
              isActiveCut ? "shadow-[0_0_0_3px_var(--color-accent),0_22px_60px_-12px_rgba(0,0,0,0.7)]" : ""
            )}
            style={{ backgroundImage: panelBg(hue), border: `2.5px solid ${frameColor(hue)}`, minHeight: 120 }}
          >
            {/* 스크린톤 + 켄번스(활성 컷만 천천히 줌) */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={HALFTONE}
              animate={isActiveCut ? { scale: [1, 1.06] } : { scale: 1 }}
              transition={isActiveCut ? { duration: 6, ease: "linear" } : { duration: 0 }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(120% 70% at 50% -10%, oklch(0.8 0.12 ${hue} / 0.18), transparent 55%)` }}
            />

            {/* ✨ 화려 이펙트 레이어 ✨ */}
            {/* 빛줄기 시닌 스윕 — 모든 컷에 은은하게, 활성 컷은 빠르게 반복 */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(115deg, transparent 32%, oklch(0.96 0.05 ${hue} / 0.16) 48%, transparent 62%)`,
                backgroundSize: "250% 100%",
              }}
              animate={{ backgroundPositionX: ["130%", "-30%"] }}
              transition={{ duration: isActiveCut ? 2.1 : 6.5, ease: "easeInOut", repeat: Infinity, repeatDelay: isActiveCut ? 0.5 : 3 }}
            />
            {isActiveCut && (
              <>
                {/* 집중선(스피드라인) — 방사형 회전 */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `repeating-conic-gradient(from 0deg at 50% 44%, transparent 0deg, transparent 6deg, oklch(0.92 0.06 ${hue} / 0.12) 6.4deg, transparent 8deg)`,
                    maskImage: "radial-gradient(circle at 50% 44%, transparent 38%, black 80%)",
                    WebkitMaskImage: "radial-gradient(circle at 50% 44%, transparent 38%, black 80%)",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5, rotate: [0, 7] }}
                  transition={{ rotate: { duration: 7, ease: "linear", repeat: Infinity, repeatType: "reverse" }, opacity: { duration: 0.5 } }}
                />
                {/* 컷 진입 플래시 */}
                <motion.div
                  key={`flash-${playback.activeStep}`}
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{ background: `radial-gradient(circle at 50% 42%, oklch(0.96 0.06 ${hue} / 0.4), transparent 62%)` }}
                  initial={{ opacity: 0.85 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.65, ease: "easeOut" }}
                />
                {/* 스파클 파티클 */}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.span
                    key={`spark-${playback.activeStep}-${i}`}
                    aria-hidden
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      left: `${12 + i * 14}%`,
                      top: `${18 + (i % 3) * 24}%`,
                      width: 6,
                      height: 6,
                      background: nameColor(hue),
                      boxShadow: `0 0 10px ${nameColor(hue)}`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: [0, 1.5, 0], opacity: [0, 1, 0], y: [0, -16] }}
                    transition={{ duration: 1.3, delay: i * 0.12, repeat: Infinity, repeatDelay: 1.5, ease: "easeOut" }}
                  />
                ))}
              </>
            )}

            {/* 컷 번호 */}
            <span
              className="absolute right-3 top-3 z-20 select-none rounded-md px-2 py-0.5 font-display text-[10px] font-extrabold tracking-widest"
              style={{ background: "oklch(0.12 0.01 60 / 0.7)", color: nameColor(hue), border: `1px solid ${frameColor(hue)}66` }}
            >
              CUT {panelIndex + 1}
            </span>

            {/* 효과음 — 재생 중 활성 컷이면 버스트(팝+셰이크) */}
            <AnimatePresence>
              {sfxList.map((sfx, i) =>
                phase === "future" ? null : (
                  <motion.span
                    key={`${playback.active ? playback.activePanel : "s"}-${i}-${sfx}`}
                    aria-hidden
                    className="pointer-events-none absolute z-20 select-none font-display text-3xl font-black uppercase italic tracking-tight sm:text-4xl"
                    style={{
                      top: `${20 + i * 34}%`,
                      [i % 2 === 0 ? "right" : "left"]: "5%",
                      color: nameColor(hue),
                      WebkitTextStroke: "1.5px oklch(0.12 0.01 60)",
                      filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.55))",
                    }}
                    initial={isActiveCut ? { scale: 0, rotate: i % 2 === 0 ? -28 : 22, opacity: 0 } : false}
                    animate={
                      isActiveCut
                        ? { scale: [0, 1.25, 1], rotate: [i % 2 === 0 ? -28 : 22, i % 2 === 0 ? -6 : 5], opacity: 1 }
                        : { scale: 1, rotate: i % 2 === 0 ? -8 : 7, opacity: 1 }
                    }
                    transition={{ duration: 0.5, ease: "backOut" }}
                  >
                    {sfx}
                  </motion.span>
                )
              )}
            </AnimatePresence>

            <div className="relative z-10 p-4 sm:p-5">
              {/* 장면 묘사 캡션 */}
              {panel.scene && phase !== "future" && (
                <motion.div
                  className="mb-3 inline-block max-w-full rounded-md px-3 py-1.5 shadow-[2px_2px_0_oklch(0.12_0.01_60)]"
                  style={{ background: "oklch(0.92 0.04 88)", border: "1.5px solid oklch(0.2 0.02 60)" }}
                  initial={isActiveCut ? { opacity: 0, x: -12 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <p className="font-serif text-[12.5px] font-semibold italic leading-snug" style={{ color: BUBBLE_INK }}>
                    {panel.scene}
                  </p>
                </motion.div>
              )}

              {/* 대사·나레이션 */}
              <div className="space-y-3">
                {panel.lines.map((line, lineIndex) => {
                  if (!line.text) return null; // 효과음 전용 줄은 위에서 처리
                  const sIdx = stepIndex.get(`${panelIndex}:${lineIndex}`);
                  const isStep = sIdx !== undefined;

                  // 재생 모드 가시성/타이핑
                  let visible = true;
                  let shownText = line.text;
                  let isSpeaking = false;
                  if (playback.active && isStep) {
                    if (sIdx! > playback.activeStep) {
                      visible = false; // 아직 안 나온 줄
                    } else if (sIdx === playback.activeStep) {
                      isSpeaking = true;
                      shownText = line.text.slice(0, Math.max(0, playback.typed));
                    }
                  }
                  if (!visible) return null;

                  // 화자 없는 줄 = 나레이션
                  if (!line.speaker) {
                    return (
                      <motion.div
                        key={lineIndex}
                        layout
                        initial={isSpeaking ? { opacity: 0, y: 8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        className="mx-auto max-w-[92%] rounded-lg px-4 py-2 text-center"
                        style={{ background: "oklch(0.13 0.01 60 / 0.78)", border: "1px dashed oklch(0.55 0.02 70 / 0.6)" }}
                      >
                        <p className="font-serif text-sm leading-relaxed text-fg-2">
                          {shownText}
                          {isSpeaking && shownText.length < line.text.length && <Caret />}
                        </p>
                      </motion.div>
                    );
                  }

                  const character = resolveCharacter(line);
                  const lineHue = hueFor(character?.id ?? line.characterId);
                  const onLeft = dialogueCounter++ % 2 === 0;
                  const tilt = onLeft ? -2 : 2;
                  // 재생 중 비활성 화자(이미 지난 줄)는 살짝 디밍
                  const dim = playback.active && isStep && sIdx! < playback.activeStep;

                  return (
                    <motion.div
                      key={lineIndex}
                      layout
                      initial={isSpeaking ? { opacity: 0, y: 10 } : false}
                      animate={{ opacity: dim ? 0.62 : 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className={cn("flex items-end gap-2.5 sm:gap-3.5", onLeft ? "flex-row" : "flex-row-reverse")}
                    >
                      {/* 캐릭터 컷(흉상) — 말할 때 살짝 바운스 */}
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <motion.div
                          className="relative h-[68px] w-[58px] overflow-hidden rounded-xl sm:h-[84px] sm:w-[70px]"
                          style={{
                            border: `2.5px solid ${frameColor(lineHue)}`,
                            boxShadow: `0 6px 16px -6px oklch(0.1 0.02 ${lineHue} / 0.7)`,
                          }}
                          animate={
                            isSpeaking
                              ? { rotate: [tilt, tilt - 1.5, tilt], y: [0, -3, 0], scale: 1.05 }
                              : { rotate: tilt, y: 0, scale: 1 }
                          }
                          transition={isSpeaking ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                        >
                          {character?.avatarUrl ? (
                            <img src={resolveAssetUrl(character.avatarUrl)} alt={line.speaker} className="h-full w-full object-cover" />
                          ) : (
                            <span
                              className="flex h-full w-full items-center justify-center font-display text-xl font-black"
                              style={{ background: panelBg(lineHue), color: nameColor(lineHue) }}
                            >
                              {line.speaker[0]}
                            </span>
                          )}
                        </motion.div>
                        <span
                          className="max-w-[70px] truncate rounded-full px-2 py-0.5 text-center text-[10px] font-extrabold"
                          style={{ background: "oklch(0.12 0.01 60 / 0.75)", color: nameColor(lineHue) }}
                        >
                          {line.speaker}
                        </span>
                      </div>

                      {/* 말풍선 */}
                      <div className={cn("relative max-w-[80%] pb-1", onLeft ? "" : "flex justify-end")}>
                        <motion.div
                          className="relative inline-block rounded-2xl px-4 py-2.5"
                          style={{
                            background: BUBBLE_BG,
                            border: "2px solid oklch(0.2 0.02 60)",
                            boxShadow: isSpeaking
                              ? `0 0 0 3px ${frameColor(lineHue)}, 2px 3px 0 oklch(0.12 0.01 60 / 0.55)`
                              : "2px 3px 0 oklch(0.12 0.01 60 / 0.55)",
                          }}
                          initial={isSpeaking ? { scale: 0.85, opacity: 0 } : false}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.28, ease: "backOut" }}
                        >
                          <span
                            aria-hidden
                            className={cn("absolute bottom-2.5 h-3.5 w-3.5 rotate-45", onLeft ? "-left-[7px]" : "-right-[7px]")}
                            style={{
                              background: BUBBLE_BG,
                              borderLeft: onLeft ? "2px solid oklch(0.2 0.02 60)" : "none",
                              borderBottom: onLeft ? "2px solid oklch(0.2 0.02 60)" : "none",
                              borderRight: onLeft ? "none" : "2px solid oklch(0.2 0.02 60)",
                              borderTop: onLeft ? "none" : "2px solid oklch(0.2 0.02 60)",
                            }}
                          />
                          <p className="relative whitespace-pre-wrap text-[14.5px] font-semibold leading-relaxed" style={{ color: BUBBLE_INK }}>
                            {shownText}
                            {isSpeaking && shownText.length < line.text.length && <Caret />}
                          </p>
                        </motion.div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.article>
        );
      })}
    </div>
  );
}

// 타이핑 커서
function Caret() {
  return (
    <motion.span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-sm"
      style={{ background: BUBBLE_INK }}
      animate={{ opacity: [1, 0.15, 1] }}
      transition={{ duration: 0.8, repeat: Infinity }}
    />
  );
}
