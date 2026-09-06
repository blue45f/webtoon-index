/**
 * Studio Pattern Fill Panel
 * 도형 채우기 패턴 인스펙터 — 검색 가능한 패턴 스와치 그리드(실제 타일 미리보기) +
 * 전경/배경색 + 배율 슬라이더 + 해제. studio-pattern-fill의 순수 헬퍼로만 스펙을
 * 만들어 onChange로 돌려주는 상태 없는(fully-controlled) 프레젠테이션 컴포넌트.
 * value=null이면 미적용 상태. 우선순위 규약: 패턴 > 그라데이션 > 단색 채우기.
 *
 * 심리스 타일 섹션(Krita식): 현재 타일을 픽셀로 래스터해(rasterizeTile 주입,
 * 기본 = 브라우저 캔버스) 3×3 반복 미리보기와 이음새 점수를 보여주고,
 * "이음새 부드럽게(심리스 변환)" 토글 + feather 슬라이더로 변환 전/후를
 * 비교하는 패널 로컬 분석 도구다 — 문서(스펙)에는 아무것도 쓰지 않는다.
 */
import { Blend, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { PANEL_LABEL_ROW, StudioSliderRow } from "./studio-panel-ui";
import {
  DEFAULT_PATTERN_SPEC,
  PATTERN_SCALE_RANGE,
  normalizePatternSpec,
  patternPreviewCss,
  searchStudioPatterns,
  setPatternBg,
  setPatternFg,
  setPatternId,
  setPatternScale,
  type StudioPatternSpec,
  type StudioPatternDef,
} from "./studio-pattern-fill";
import {
  DEFAULT_SEAMLESS_FEATHER_PX,
  SEAMLESS_FEATHER_RANGE,
  SEAMLESS_PREVIEW_REPEAT,
  buildSeamlessTilePreview,
  clampSeamlessFeather,
  formatSeamScore,
  makeTileSeamless,
  seamVisibilityScore,
  type SeamlessTileImage,
} from "./studio-seamless-tile";
import {
  drawSeamlessTileToCanvas,
  rasterizePatternTile,
  type SeamlessTileRasterizer,
} from "./studio-seamless-tile-raster";

import type { ReactElement } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type StudioPatternFillPanelProps = {
  /** 현재 요소의 패턴 스펙 — null이면 미적용(그라데이션/단색 채우기). */
  value: StudioPatternSpec | null;
  /** 스펙 변경/적용 콜백 — null은 해제(그라데이션/단색 복귀). */
  onChange: (spec: StudioPatternSpec | null) => void;
  /** 섹션 제목 — 기본 "패턴 채우기". */
  title?: string;
  /**
   * 심리스 분석용 타일 래스터라이저 — 기본은 브라우저 캔버스(rasterizePatternTile).
   * jsdom 테스트가 합성 픽셀을 주입하는 이음새(seam)이며 null 해석은 "분석 불가".
   */
  rasterizeTile?: SeamlessTileRasterizer;
};

/**
 * 패턴 스와치 그리드 — 각 칸이 실제 타일(data URL)을 반복 렌더한 실미리보기.
 * 적용 중이면 현재 전경/배경색을 스와치에도 반영해 "내 색으로 보이는" 스와치가 된다.
 */
function PatternSwatchGrid({
  current,
  patterns,
  onChange,
}: {
  current: StudioPatternSpec | null;
  patterns: readonly StudioPatternDef[];
  onChange: (spec: StudioPatternSpec) => void;
}): ReactElement {
  return (
    <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
      {patterns.map((def) => {
        const active = current?.patternId === def.id;
        // 스와치 미리보기는 판독성을 위해 배율 1 고정(배율은 아래 슬라이더가 담당).
        const preview = normalizePatternSpec({
          ...(current ?? DEFAULT_PATTERN_SPEC),
          patternId: def.id,
          scale: 1,
        });
        return (
          <button
            key={def.id}
            type="button"
            title={def.tip}
            aria-pressed={active}
            onClick={() => onChange(setPatternId(current ?? DEFAULT_PATTERN_SPEC, def.id))}
            className={cn(
              "group flex flex-col gap-1 rounded-lg border border-line bg-card p-1.5 text-left transition-colors hover:bg-raised",
              active && "border-accent bg-raised"
            )}
          >
            <span aria-hidden className="h-6 w-full rounded-md border border-line/60" style={patternPreviewCss(preview)} />
            <span className={cn("truncate text-[0.72rem] text-fg-2 group-hover:text-fg", active && "text-fg")}>
              {def.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 심리스 타일 섹션 — 현재 타일 픽셀을 비동기 래스터 → 이음새 점수 분석 →
 * 3×3 반복 미리보기 + 변환 토글 + feather 슬라이더(StudioSliderRow 지연 커밋:
 * 드래그는 로컬 미리보기만 다시 그리고, 손을 떼는 순간 한 번 확정).
 * 문서에는 쓰지 않는 패널 로컬 도구라 검색어(query)와 같은 급의 로컬 상태만 가진다.
 */
function SeamlessTileSection({
  spec,
  rasterizeTile,
}: {
  spec: StudioPatternSpec;
  rasterizeTile: SeamlessTileRasterizer;
}): ReactElement {
  const { patternId, fg, bg } = spec;
  // 배율(scale)은 이음새와 무관 — 배율 슬라이더 드래그마다 재래스터하지 않도록 필드로만 메모.
  const sourceSpec = useMemo<StudioPatternSpec>(
    () => (bg == null ? { patternId, fg, scale: 1 } : { patternId, fg, bg, scale: 1 }),
    [patternId, fg, bg]
  );

  const [baseTile, setBaseTile] = useState<SeamlessTileImage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [seamlessOn, setSeamlessOn] = useState(false);
  const [featherPx, setFeatherPx] = useState(DEFAULT_SEAMLESS_FEATHER_PX);
  // 슬라이더 드래그 중의 일시 미리보기 값 — 커밋/취소 시 null로 돌아간다.
  const [featherDraft, setFeatherDraft] = useState<number | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setBaseTile(null);
    rasterizeTile(sourceSpec).then(
      (tile) => {
        if (cancelled) return;
        setBaseTile(tile);
        setStatus(tile == null ? "unavailable" : "ready");
      },
      () => {
        if (cancelled) return;
        setBaseTile(null);
        setStatus("unavailable");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [sourceSpec, rasterizeTile]);

  const effectiveFeather = clampSeamlessFeather(featherDraft ?? featherPx, baseTile ?? undefined);
  const analysis = useMemo(() => {
    if (baseTile == null) return null;
    const before = seamVisibilityScore(baseTile);
    const repeat = { cols: SEAMLESS_PREVIEW_REPEAT, rows: SEAMLESS_PREVIEW_REPEAT };
    if (!seamlessOn) {
      return { before, after: null, preview: buildSeamlessTilePreview(baseTile, repeat) };
    }
    const converted = makeTileSeamless(baseTile, { featherPx: effectiveFeather });
    return { before, after: seamVisibilityScore(converted), preview: buildSeamlessTilePreview(converted, repeat) };
  }, [baseTile, seamlessOn, effectiveFeather]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (canvas == null || analysis == null) return;
    drawSeamlessTileToCanvas(canvas, analysis.preview);
  }, [analysis]);

  return (
    <div className="space-y-2 border-t border-line/40 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">심리스 타일</p>
        <button
          type="button"
          aria-pressed={seamlessOn}
          disabled={baseTile == null}
          onClick={() => setSeamlessOn((on) => !on)}
          className={cn(
            buttonClass({ size: "sm", variant: "quiet" }),
            seamlessOn && "bg-accent-soft/60 text-fg"
          )}
          title="타일을 반 칸씩 감아 붙이고 이음새를 feather 폭만큼 섞어 반복 경계를 숨깁니다. 다시 누르면 원본 타일로 돌아가요."
        >
          <Blend className="size-3.5" aria-hidden />
          이음새 부드럽게(심리스 변환)
        </button>
      </div>

      {/* 3×3 반복 미리보기 — 가운데 타일의 네 이음새가 전부 보이는 최소 격자 */}
      {status === "ready" ? (
        <canvas
          ref={previewCanvasRef}
          role="img"
          aria-label={seamlessOn ? "심리스 변환 후 3×3 반복 미리보기" : "타일 3×3 반복 미리보기"}
          className="block h-28 w-full rounded-lg border border-line/60 bg-card [image-rendering:pixelated]"
        />
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[0.62rem] text-fg-3">
          {status === "loading" ? "타일 픽셀을 분석하는 중..." : "이 환경에서는 타일 픽셀 분석을 사용할 수 없어요."}
        </div>
      )}

      <StudioSliderRow
        label="feather 폭"
        min={SEAMLESS_FEATHER_RANGE.min}
        max={SEAMLESS_FEATHER_RANGE.max}
        step={SEAMLESS_FEATHER_RANGE.step}
        value={featherPx}
        disabled={!seamlessOn || baseTile == null}
        onChange={(next) => setFeatherDraft(next)}
        onCommit={(next) => {
          setFeatherPx(clampSeamlessFeather(next));
          setFeatherDraft(null);
        }}
        formatReadout={(draft) => `${clampSeamlessFeather(draft, baseTile ?? undefined)}px`}
      />

      {/* 변환 전/후 이음새 점수 — 0%면 가장자리가 완전히 이어진 상태 */}
      <p className="text-[0.62rem] tabular-nums text-fg-3" role="status" aria-live="polite">
        {analysis == null
          ? status === "loading"
            ? "이음새 점수를 계산하는 중..."
            : "이음새 점수를 계산할 수 없어요."
          : analysis.after == null
            ? `이음새 점수 ${formatSeamScore(analysis.before)} — 변환하면 반복 경계가 부드러워져요.`
            : `이음새 점수 ${formatSeamScore(analysis.before)} → ${formatSeamScore(analysis.after)}`}
      </p>
    </div>
  );
}

export function StudioPatternFillPanel({
  value,
  onChange,
  title = "패턴 채우기",
  rasterizeTile = rasterizePatternTile,
}: StudioPatternFillPanelProps): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState("");
  // 문서(localStorage)에서 온 값일 수 있으므로 항상 정규화해 다룬다 — 컨트롤이 안전한 값만 본다.
  // 메모: 심리스 섹션의 재래스터 이펙트가 렌더마다 돌지 않도록 value 기준으로 고정한다.
  const current = useMemo(() => (value == null ? null : normalizePatternSpec(value)), [value]);
  const visiblePatterns = searchStudioPatterns(query);

  return (
    <div className="space-y-2">
      {/* 헤더 + 해제(그라데이션/단색 복귀) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold text-fg-3 uppercase tracking-wider">{title}</p>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={current == null}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="패턴을 제거합니다 — 그라데이션이 있으면 그라데이션, 없으면 단색 채우기로 돌아갑니다."
        >
          <RotateCcw className="size-3.5" />
          패턴 해제
        </button>
      </div>

      {/* 우선순위 규약 힌트 — 패턴 > 그라데이션 > 단색 */}
      <p className="text-[0.72rem] text-fg-3">
        {current == null
          ? "스와치를 고르면 적용됩니다. 패턴은 그라데이션·단색보다 우선해요."
          : "패턴이 그라데이션·단색 채우기보다 우선 적용되고 있어요."}
      </p>

      {current != null && (
        <>
          {/* 라이브 미리보기 — 캔버스와 동일 타일·동일 배율(background-size) */}
          <div aria-hidden className="h-8 w-full rounded-lg border border-line/60" style={patternPreviewCss(current)} />

          {/* 전경(잉크)색 */}
          <label className={PANEL_LABEL_ROW}>
            무늬 색상
            <input
              type="color"
              value={current.fg}
              onChange={(e) => onChange(setPatternFg(current, e.target.value))}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
            />
          </label>

          {/* 배경 — 투명(아래 요소가 비침) 또는 불투명 단색 */}
          <label className={PANEL_LABEL_ROW}>
            배경 투명
            <input
              type="checkbox"
              checked={current.bg == null}
              onChange={(e) => onChange(setPatternBg(current, e.target.checked ? null : "#ffffff"))}
              className="size-4 accent-accent cursor-pointer"
            />
          </label>
          {current.bg != null && (
            <label className={PANEL_LABEL_ROW}>
              배경 색상
              <input
                type="color"
                value={current.bg}
                onChange={(e) => onChange(setPatternBg(current, e.target.value))}
                className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
              />
            </label>
          )}

          {/* 배율 — 타일 크기(무늬 밀도). 25%면 촘촘, 400%면 성김. */}
          <StudioSliderRow
            label="배율"
            min={PATTERN_SCALE_RANGE.min}
            max={PATTERN_SCALE_RANGE.max}
            step={PATTERN_SCALE_RANGE.step}
            value={current.scale}
            onChange={(next) => onChange(setPatternScale(current, next))}
            readout={`${Math.round(current.scale * 100)}%`}
          />

          {/* 심리스 타일 — 3×3 반복 미리보기 + 이음새 점수 + 심리스 변환(패널 로컬 분석) */}
          <SeamlessTileSection spec={current} rasterizeTile={rasterizeTile} />
        </>
      )}

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">패턴 검색</label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="패턴 검색 (하프톤, 속도, 물결…)"
          className="min-h-10 w-full rounded-lg border border-line bg-card py-1 pl-8 pr-10 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-1 focus:ring-accent/35 pointer-coarse:min-h-11"
        />
        {query ? (
          <button
            type="button"
            aria-label="패턴 검색어 지우기"
            onClick={() => setQuery("")}
            className="absolute right-0 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg pointer-coarse:size-11"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="text-[0.62rem] tabular-nums text-fg-3" role="status" aria-live="polite">
        {query ? `검색 결과 ${visiblePatterns.length}개` : `패턴 ${visiblePatterns.length}개`}
      </p>

      {visiblePatterns.length > 0 ? (
        <PatternSwatchGrid current={current} patterns={visiblePatterns} onChange={onChange} />
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center">
          <p className="text-xs font-semibold text-fg-2">일치하는 패턴이 없습니다</p>
          <p className="mt-1 text-[0.62rem] text-fg-3">‘번개’, ‘벽돌’, ‘스파클’처럼 모양으로 찾아보세요.</p>
        </div>
      )}
    </div>
  );
}
