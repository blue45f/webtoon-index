import { useFx } from "@toonspectrum/core/fx";
import { Moon, Settings2, Sun, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/shared/lib/cx";
import { getLanguageOptions, useI18n, useT } from "@/shared/lib/i18n";
import { useTheme } from "@/shared/lib/theme";

/**
 * FloatingControls — 웹 앱의 플로팅 설정 컨트롤 클러스터.
 *
 * 다크모드·언어·(선택) 효과음 토글. 전역 클릭 이펙트·BGM 컨트롤은 제품에서 제거됨.
 *  - 웹  : 다크모드 + 언어(기본). 사운드 토글은 기본 숨김.
 *
 * @example 웹 App
 *   <FloatingControls placement="bottom-left" />
 */
export interface FloatingControlsProps {
  /** 사운드(SFX) 토글 노출. 기본 false (클릭 이펙트 제거 후 불필요). */
  showSound?: boolean;
  /**
   * @deprecated BGM 컨트롤은 제거됨. prop 은 호환용으로 무시된다.
   */
  showBgm?: boolean;
  /** 다크/주간 테마 토글 노출. 기본 true. */
  showTheme?: boolean;
  /** 언어 셀렉트 노출. 기본 true. */
  showLang?: boolean;
  /**
   * 고정 위치 프리셋.
   *  - "bottom-left" (기본): 좌하단(웹) — 모바일에선 우하단 단일 토글로 회피.
   *  - "bottom-right": 우하단.
   *  - "static"      : 위치 클래스 없음(부모가 배치 — 기존 웹 래퍼 호환).
   */
  placement?: "bottom-left" | "bottom-right" | "static";
  /** 인터랙션 없을 때 숨김까지(ms). 기본 4000. */
  hideAfterMs?: number;
  /** 근접 포인터로 깨우는 반경(px). 기본 120. 0이면 근접 감지 비활성. */
  wakeRadiusPx?: number;
  /** 추가 클래스(루트). */
  className?: string;
}

const PILL =
  "grid size-11 place-items-center rounded-full border bg-panel/95 shadow-lg shadow-[oklch(0.1_0.02_70/0.35)] backdrop-blur transition-colors";

const PLACEMENT_CLASS: Record<NonNullable<FloatingControlsProps["placement"]>, string> = {
  // 모바일: 우하단(하단 탭바 ~56px + safe-area 위로 띄움). 데스크톱: 좌하단.
  "bottom-left": "fixed z-40 bottom-4 left-4 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-md:left-auto max-md:right-4",
  "bottom-right": "fixed right-4 bottom-4 z-40",
  static: "",
};

// 좁은 화면의 fixed 컨트롤은 본문을 가리지 않도록 모두 단일 토글로 접는다.
// static만 부모가 레이아웃을 소유하므로 항상 펼친다.
const COLLAPSIBLE: Record<NonNullable<FloatingControlsProps["placement"]>, boolean> = {
  "bottom-left": true,
  "bottom-right": true,
  static: false,
};

export function FloatingControls({
  showSound = false,
  showBgm: _showBgm = false,
  showTheme = true,
  showLang = true,
  placement = "bottom-left",
  hideAfterMs = 4000,
  wakeRadiusPx = 120,
  className,
}: FloatingControlsProps) {
  void _showBgm;
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const langOptions = getLanguageOptions(lang);
  const fx = useFx();
  const soundOn = fx.audio.sfxEnabled && !fx.audio.muted;

  const isDark = theme === "dark";
  const [visible, setVisible] = useState(true);
  // 모바일 접힘 패널 펼침 상태(데스크톱에선 무시 — 항상 펼침).
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), hideAfterMs);
  };

  const reveal = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    scheduleHide();
  };

  // 초기 노출 후 자동 숨김 예약.
  useEffect(() => {
    scheduleHide();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  });

  // 근접 포인터 감지 + 스크롤 — 클러스터 근처로 마우스가 오거나 스크롤하면 깨운다(터치는 hover 가 대신).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (wakeRadiusPx <= 0) return;
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const near = Math.hypot(dx, dy) <= wakeRadiusPx + Math.max(rect.width, rect.height) / 2;
      if (near) reveal();
    };
    const onScroll = () => reveal();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  });

  const toggleSound = () => {
    if (fx.audio.muted) fx.setMuted(false);
    fx.setSfxEnabled(!soundOn);
  };

  // 펼쳐진 컨트롤들(데스크톱 행 / 모바일 펼침 패널 공용).
  const controls = (
    <>
      {/* 선택적 SFX 토글 — 기본 비노출. 전역 클릭 이펙트/BGM UI 는 제거됨. */}
      {showSound && (
        <button
          type="button"
          onClick={toggleSound}
          aria-label={soundOn ? t("control.sound.disable") : t("control.sound.enable")}
          aria-pressed={soundOn}
          title={soundOn ? t("control.sound.disable") : t("control.sound.enable")}
          data-no-sfx
          className={cx(
            PILL,
            soundOn ? "border-accent/45 text-accent" : "border-line text-fg-2 hover:text-fg"
          )}
        >
          {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      )}

      {/* 다크/주간 테마 토글 */}
      {showTheme && (
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? t("control.theme.light") : t("control.theme.dark")}
          aria-pressed={isDark}
          title={isDark ? t("control.theme.light") : t("control.theme.dark")}
          className={cx(PILL, "border-line text-fg-2 hover:text-fg")}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}

      {/* 언어 선택 — 다국어 옵션을 전체 Google Play locale 목록에서 제공합니다. */}
      {showLang && (
        <div
          className="inline-flex h-11 items-center gap-1 rounded-full border border-line bg-panel/95 p-0.5 shadow-lg shadow-[oklch(0.1_0.02_70/0.35)] backdrop-blur"
        >
          <select
            aria-label={t("control.language.label")}
            value={lang}
            onChange={(event) => setLang(event.target.value)}
            className="max-w-[14rem] rounded-full bg-transparent px-2 py-2 text-xs font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            {/*
              대부분의 로케일은 실측 번역률이 3% 미만이라 사실상 영어로 렌더된다.
              한 목록에 섞어 두면 "번역 있음"으로 위장되므로 실측값 기준으로 그룹을 나눈다.
            */}
            <optgroup label={t("control.language.group.translated")}>
              {langOptions
                .filter((o) => o.fullyTranslated)
                .map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t("control.language.group.englishBase")}>
              {langOptions
                .filter((o) => !o.fullyTranslated)
                .map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
      )}
    </>
  );

  const collapsible = COLLAPSIBLE[placement];

  return (
    <div
      ref={rootRef}
      className={cx(PLACEMENT_CLASS[placement], className)}
      onMouseEnter={reveal}
      onMouseLeave={scheduleHide}
      onFocusCapture={reveal}
      onBlurCapture={scheduleHide}
    >
      {/* 펼친 행 — 무동작 시 흐려지며 물러나고(hover/focus/근접 시 복귀).
          접힘형은 데스크톱(md+)에서 보이고, static 배치는 항상 보인다. */}
      <div
        className={cx(
          "items-center gap-2 transition-[opacity,transform] duration-500 ease-out",
          collapsible ? "hidden md:flex" : "flex",
          "motion-reduce:opacity-100 hover:opacity-100 focus-within:opacity-100",
          visible ? "opacity-100" : "translate-y-1 opacity-40"
        )}
      >
        {controls}
      </div>

      {/* 모바일(접힘형만): 단일 토글 — 콘텐츠를 가리지 않게 면적 최소화. 탭하면 위로 펼침. */}
      {collapsible && (
        <div className="flex flex-col items-end gap-2 md:hidden">
          {open && (
            <div className="flex flex-col items-center gap-2 motion-safe:animate-fade-up">{controls}</div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? t("control.settings.close") : t("control.cluster.settings")}
            title={open ? t("control.settings.close") : t("control.cluster.open")}
            className={cx(
              PILL,
              "size-12",
              open ? "border-accent/45 text-accent" : "border-line-strong text-fg-2 hover:text-fg"
            )}
          >
            {open ? <X size={18} /> : <Settings2 size={18} />}
          </button>
        </div>
      )}
    </div>
  );
}

export default FloatingControls;
