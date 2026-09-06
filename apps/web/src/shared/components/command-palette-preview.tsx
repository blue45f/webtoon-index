import {
  Sparkles,
  CornerDownLeft,
  Sliders,
  Info,
  Keyboard,
} from "lucide-react";

import { MiniPoster } from "./rank-row";
import { RatingInline } from "./ui/stars";

import type { PaletteSelectedItem } from "./command-palette-types";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { genreBorder, genreTextColor, genreTint } from "@/shared/lib/genre-color";
import { STATUS_LABEL, TYPE_LABEL } from "@/shared/lib/taxonomy";
import { cn } from "@/shared/lib/utils";

interface CommandPalettePreviewProps {
  selectedItem: PaletteSelectedItem;
  onExecute?: () => void;
}

export function CommandPalettePreview({
  selectedItem,
  onExecute,
}: CommandPalettePreviewProps) {
  if (!selectedItem) {
    return (
      <div className="flex h-full flex-col justify-between p-6 text-fg-3">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
            <Sparkles size={14} />
            <span>ToonSpectrum ⌘K 통합 팔레트</span>
          </div>
          <p className="text-sm leading-relaxed text-fg-2">
            작품 탐색부터 스튜디오 도구, 시스템 제어까지 키보드로 즉시 실행하세요.
          </p>

          <div className="mt-6 space-y-2.5 rounded-xl border border-line bg-card/60 p-3.5 text-xs">
            <div className="font-semibold text-fg">접두사 빠른 필터</div>
            <div className="grid grid-cols-2 gap-2 text-fg-2">
              <div className="flex items-center gap-1.5">
                <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">&gt;</kbd>
                <span>명령어 모드</span>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">@</kbd>
                <span>작품 검색</span>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">/</kbd>
                <span>스튜디오 도구</span>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className="rounded border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">#</kbd>
                <span>장르/태그</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line/60 bg-panel/40 p-3 text-[11px] text-fg-3">
          <div className="flex items-center gap-1.5 text-fg-2">
            <Keyboard size={13} className="text-accent" />
            <span className="font-medium">키보드 팁</span>
          </div>
          <p className="mt-1">
            <kbd className="font-mono text-fg-2">Tab</kbd> 키로 탭을 순환하고, <kbd className="font-mono text-fg-2">↑↓</kbd> 로 항목을 탐색하세요.
          </p>
        </div>
      </div>
    );
  }

  // 1. Title Preview
  if (selectedItem.type === "title") {
    const t = selectedItem.title;
    const isNovel = t.type === "webnovel";

    return (
      <div className="flex h-full flex-col justify-between overflow-y-auto p-5 text-fg">
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <MiniPoster
              title={t}
              className="w-20 shrink-0 shadow-lg shadow-[oklch(0.1_0.02_70/0.6)]"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    isNovel
                      ? "border border-line-strong bg-raised font-serif text-fg-2"
                      : "bg-accent-soft font-display text-accent"
                  )}
                >
                  {TYPE_LABEL[t.type]}
                </span>
                {t.status && (
                  <span className="rounded border border-line bg-card px-1.5 py-0.5 text-[10px] text-fg-3">
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                )}
                {t.ageRating === "19" && (
                  <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                    19+
                  </span>
                )}
              </div>
              <h3 className="line-clamp-2 text-base font-bold leading-snug text-fg">
                {t.title}
              </h3>
              <p className="truncate text-xs text-fg-3">
                {t.author}
                {t.artist && t.artist !== t.author && ` · 그림 ${t.artist}`}
              </p>
              <div className="pt-0.5">
                <RatingInline
                  value={t.stats.ratingAvg}
                  estimated={statsAreEstimated(t)}
                  size="sm"
                />
              </div>
            </div>
          </div>

          {/* Genre chips */}
          {t.genres && t.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {t.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    color: genreTextColor(g, 0.88),
                    backgroundColor: genreTint(g, 0.16),
                    borderColor: genreBorder(g, 0.3),
                    borderWidth: 1,
                  }}
                >
                  #{g}
                </span>
              ))}
            </div>
          )}

          {/* Availability Platforms */}
          {t.availability && t.availability.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-line bg-card/60 p-3 text-xs">
              <div className="font-semibold text-fg-2">제공 플랫폼 및 가용성</div>
              <div className="flex flex-wrap gap-2">
                {t.availability.map((p) => (
                  <div
                    key={p.platformId}
                    className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs"
                  >
                    <span className="size-2 rounded-full bg-accent" />
                    <span className="text-fg-2">{p.platformId}</span>
                    <span className="text-[10px] text-fg-3">
                      ({p.pricing === "free" ? "무료" : p.pricing === "wait-free" ? "기다무" : "유료"})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Synopsis */}
          {t.synopsis && (
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-fg-3">줄거리</div>
              <p className="line-clamp-4 leading-relaxed text-fg-2">
                {t.synopsis}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3">
          <button
            type="button"
            onClick={onExecute}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-lg shadow-accent/20 transition-all hover:bg-accent-2 active:scale-[0.98]"
          >
            <span>상세 보기</span>
            <CornerDownLeft size={13} />
          </button>
        </div>
      </div>
    );
  }

  // 2. Command Preview
  if (selectedItem.type === "command") {
    const cmd = selectedItem.command;
    const Icon = cmd.icon;
    const state = cmd.getState?.();

    return (
      <div className="flex h-full flex-col justify-between p-5 text-fg">
        <div className="space-y-4">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-raised shadow-inner">
              <Icon size={22} className="text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  {cmd.category.toUpperCase()}
                </span>
                {state && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      state.active
                        ? "bg-emerald-950/70 text-emerald-400"
                        : "bg-panel text-fg-3"
                    )}
                  >
                    {state.label}
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-fg">{cmd.title}</h3>
              <p className="text-xs text-fg-3">{cmd.subtitle}</p>
            </div>
          </div>

          {cmd.description && (
            <div className="rounded-xl border border-line bg-card/60 p-3.5 text-xs leading-relaxed text-fg-2">
              {cmd.description}
            </div>
          )}

          {cmd.shortcut && (
            <div className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-xs">
              <span className="text-fg-3">단축키</span>
              <div className="flex items-center gap-1">
                {cmd.shortcut.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onExecute}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-lg shadow-accent/20 transition-all hover:bg-accent-2 active:scale-[0.98]"
        >
          <span>명령 실행</span>
          <CornerDownLeft size={13} />
        </button>
      </div>
    );
  }

  // 3. Studio Tool Preview
  if (selectedItem.type === "studio-tool") {
    const tool = selectedItem.tool;
    const Icon = tool.icon;

    return (
      <div className="flex h-full flex-col justify-between p-5 text-fg">
        <div className="space-y-4">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-raised shadow-inner">
              <Icon size={22} className="text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  스튜디오 도구
                </span>
                <span className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-2">
                  단축키: {tool.shortcutKey}
                </span>
              </div>
              <h3 className="text-base font-bold text-fg">{tool.name}</h3>
              <p className="text-xs text-fg-3">{tool.category}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card/60 p-3.5 text-xs leading-relaxed text-fg-2">
            <p className="font-medium text-fg">도구 설명</p>
            <p className="mt-1 text-fg-3">{tool.tip}</p>
          </div>

          <div className="rounded-lg border border-line/80 bg-panel/60 p-3 text-[11px] text-fg-3">
            <div className="flex items-center gap-1.5 font-medium text-fg-2">
              <Sliders size={13} className="text-accent" />
              <span>작업 팁</span>
            </div>
            <p className="mt-1">
              스튜디오 캔버스에서 키보드 <kbd className="font-mono text-fg">{tool.shortcutKey}</kbd>를 눌러 즉시 전환할 수 있습니다.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExecute}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-lg shadow-accent/20 transition-all hover:bg-accent-2 active:scale-[0.98]"
        >
          <span>도구 선택 / 스튜디오 열기</span>
          <CornerDownLeft size={13} />
        </button>
      </div>
    );
  }

  // 4. Page Preview
  if (selectedItem.type === "page") {
    const page = selectedItem.page;
    const Icon = page.icon;

    return (
      <div className="flex h-full flex-col justify-between p-5 text-fg">
        <div className="space-y-4">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-raised shadow-inner">
              <Icon size={22} className="text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  페이지 이동
                </span>
                <span className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
                  {page.href}
                </span>
              </div>
              <h3 className="text-base font-bold text-fg">{page.title}</h3>
              <p className="text-xs text-fg-3">{page.subtitle}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card/60 p-3.5 text-xs leading-relaxed text-fg-2">
            <div className="flex items-center gap-1.5 font-semibold text-fg">
              <Info size={13} className="text-accent" />
              <span>화면 안내</span>
            </div>
            <p className="mt-1.5 text-fg-3">{page.subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExecute}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-lg shadow-accent/20 transition-all hover:bg-accent-2 active:scale-[0.98]"
        >
          <span>페이지로 이동</span>
          <CornerDownLeft size={13} />
        </button>
      </div>
    );
  }

  // 5. Recent Query
  if (selectedItem.type === "recent-query") {
    return (
      <div className="flex h-full flex-col justify-between p-5 text-fg">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
            <Sparkles size={14} />
            <span>최근 검색어</span>
          </div>
          <h3 className="text-lg font-bold text-fg">'{selectedItem.query}'</h3>
          <p className="text-xs text-fg-3">
            이 검색어로 작품 및 카탈로그 검색을 즉시 다시 실행합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={onExecute}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-on-accent shadow-lg shadow-accent/20 transition-all hover:bg-accent-2 active:scale-[0.98]"
        >
          <span>검색 실행</span>
          <CornerDownLeft size={13} />
        </button>
      </div>
    );
  }

  return null;
}
