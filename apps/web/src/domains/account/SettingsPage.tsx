
import { Settings, Globe, Star, SlidersHorizontal, ShieldCheck, Trash2, Check, Download, Upload, Clock, SearchX, UserCog, ChevronRight, BarChart3 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { Container } from "@/shared/components/section";
import { getLanguageOptions, useI18n, useT } from "@/shared/lib/i18n";
import { useApp, useHydrated, type RatingScale } from "@/shared/lib/store";
import {
  getRememberFlag,
  setRememberFlag,
  clearAllRememberedFilters,
} from "@/shared/lib/use-remembered-filters";
import { formatCount } from "@/shared/lib/utils";
import { fetchVisitStats, type VisitStats } from "@/shared/lib/visits-api";

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-card/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            value === o.id ? "bg-accent text-on-accent" : "text-fg-2 hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Globe;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line/60 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          <p className="mt-0.5 text-[0.78rem] leading-relaxed text-fg-2">{desc}</p>
        </div>
      </div>
      <div className="shrink-0 sm:pl-4">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const hydrated = useHydrated();
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const ratingScale = useApp((s) => s.ratingScale);
  const setRatingScale = useApp((s) => s.setRatingScale);
  const adultVerified = useApp((s) => s.adultVerified);
  const adultBirthdate = useApp((s) => s.adultBirthdate);
  const setAdultVerified = useApp((s) => s.setAdultVerified);
  const openAgeGate = useApp((s) => s.openAgeGate);
  const resetAll = useApp((s) => s.resetAll);
  const hydrateFromServer = useApp((s) => s.hydrateFromServer);
  const recentCount = useApp((s) => s.recentlyViewed.length);
  const clearRecentlyViewed = useApp((s) => s.clearRecentlyViewed);
  const recentSearchCount = useApp((s) => s.recentSearches.length);
  const clearRecentSearches = useApp((s) => s.clearRecentSearches);

  const [remember, setRemember] = useState(false);
  const [filtersCleared, setFiltersCleared] = useState(false);
  const [recentCleared, setRecentCleared] = useState(false);
  const [searchesCleared, setSearchesCleared] = useState(false);
  const [dataReset, setDataReset] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [imported, setImported] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const langOptions = getLanguageOptions(lang).map((entry) => ({
    id: entry.code,
    code: entry.code,
    label: entry.label,
  }));
  const scaleOptions: { id: RatingScale; label: string }[] = [
    { id: "star", label: t("settings.rating.star") },
    { id: "ten", label: t("settings.rating.ten") },
    { id: "hundred", label: t("settings.rating.hundred") },
  ];

  // 방문 통계는 best-effort 표시 — 실패하면 조용히 숨긴다(아래 Row가 null 가드).
  useEffect(() => {
    let alive = true;
    fetchVisitStats().then((stats) => {
      if (alive) setVisitStats(stats);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 내 서재(별점·읽음·구독·컬렉션)는 이 브라우저에만 저장되므로 JSON 백업으로 내보내기/가져오기 지원.
  const doExport = () => {
    const s = useApp.getState();
    const payload = {
      _app: "toonspectrum-library",
      version: 1,
      exportedAt: new Date().toISOString(),
      ratings: s.ratings,
      reads: s.reads,
      subscriptions: s.subscriptions,
      reviews: s.reviews,
      likedReviews: s.likedReviews,
      collections: s.collections,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toonspectrum-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result)) as Partial<Record<string, unknown>>;
        if (!d || typeof d !== "object") throw new Error("invalid");
        hydrateFromServer({
          ratings: (d.ratings as Record<string, number>) ?? {},
          reads: (d.reads as Record<string, never>) ?? {},
          subscriptions: (d.subscriptions as Record<string, boolean>) ?? {},
          reviews: (d.reviews as Record<string, never>) ?? {},
          likedReviews: (d.likedReviews as Record<string, boolean>) ?? {},
          collections: Array.isArray(d.collections) ? (d.collections as never[]) : [],
        });
        setImported(true);
        setImportError(null);
      } catch {
        setImportError(t("settings.data.importError"));
        setImported(false);
      }
    };
    reader.readAsText(file);
  };

  // 클라이언트에서만 localStorage 기반 선호값 반영.
  useStateOnceHydrated(hydrated, () => setRemember(getRememberFlag()));

  const toggleRemember = () => {
    const next = !remember;
    setRemember(next);
    setRememberFlag(next);
    if (!next) setFiltersCleared(true);
  };
  const clearFilters = () => {
    clearAllRememberedFilters();
    setRemember(false);
    setFiltersCleared(true);
  };
  const doReset = () => {
    resetAll();
    setDataReset(true);
    setConfirmReset(false);
  };

  return (
    <Container size="prose" className="py-6 sm:py-14">
      <header className="mb-6">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <Settings size={14} /> {t("settings.eyebrow")}
        </p>
        <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">{t("settings.title")}</h1>
        <p className="lede mt-2 text-pretty text-sm leading-relaxed text-fg-2">
          {t("settings.subtitle")}
        </p>
      </header>

      {/* 표시 설정 */}
      <section className="rounded-2xl border border-line bg-panel/40 px-5">
        <Row icon={Globe} title={t("settings.language.title")} desc={t("settings.language.desc")}>
          <label className="block">
            <span className="sr-only">{t("settings.language.title")}</span>
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value)}
              aria-label={t("settings.language.title")}
              className="h-9 w-[18rem] max-w-full rounded-lg border border-line bg-card px-2 py-1 text-sm text-fg outline-none transition-colors focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {langOptions.map((entry) => (
                <option key={entry.code} value={entry.code} title={entry.label}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </Row>
        <Row icon={Star} title={t("settings.rating.title")} desc={t("settings.rating.desc")}>
          <Choice options={scaleOptions} value={ratingScale} onChange={setRatingScale} />
        </Row>
      </section>

      {/* 필터 */}
      <h2 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-fg-3">{t("settings.section.filters")}</h2>
      <section className="rounded-2xl border border-line bg-panel/40 px-5">
        <Row
          icon={SlidersHorizontal}
          title={t("settings.filters.remember")}
          desc={t("settings.filters.remember.desc")}
        >
          <button
            type="button"
            onClick={toggleRemember}
            role="switch"
            aria-checked={hydrated && remember}
            aria-label={t("settings.filters.remember")}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              hydrated && remember ? "bg-accent" : "bg-line-strong"
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-canvas transition-transform ${
                hydrated && remember ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </Row>
        <Row
          icon={Trash2}
          title={t("settings.filters.clear")}
          desc={t("settings.filters.clear.desc")}
        >
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg"
          >
            {filtersCleared ? <Check size={14} className="text-good" /> : <Trash2 size={14} />}
            {filtersCleared ? t("settings.data.clear") : t("settings.filters.clearNow")}
          </button>
        </Row>
      </section>

      {/* 연령 확인 */}
      <h2 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-fg-3">{t("settings.section.age")}</h2>
      <section className="rounded-2xl border border-line bg-panel/40 px-5">
        <Row
          icon={ShieldCheck}
          title={t("settings.age.title")}
          desc={
            hydrated && adultVerified
              ? adultBirthdate
                ? t("settings.age.descriptionVerifiedWithBirthdate").replace("{date}", adultBirthdate)
                : t("settings.age.descriptionVerified")
              : t("settings.age.description")
          }
        >
          {hydrated && adultVerified ? (
            <button
              type="button"
              onClick={() => setAdultVerified(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg"
            >
              {t("settings.age.reset")}
            </button>
          ) : (
            <button
              type="button"
              onClick={openAgeGate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              {t("settings.age.verify")}
            </button>
          )}
        </Row>
      </section>

      {/* 내 데이터 */}
      <h2 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-fg-3">{t("settings.section.data")}</h2>
      <section className="rounded-2xl border border-line bg-panel/40 px-5">
        <Row icon={Download} title={t("settings.data.export")} desc={t("settings.data.exportDesc")}>
          <button
            type="button"
            onClick={doExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised"
          >
            <Download size={14} /> {t("settings.data.export")}
          </button>
        </Row>
        <Row icon={Upload} title={t("settings.data.import")} desc={t("settings.data.importDesc")}>
          <span className="inline-flex items-center gap-2">
            {imported && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-good">
                <Check size={14} /> {t("settings.data.confirmed")}
              </span>
            )}
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised"
            >
              <Upload size={14} /> {t("settings.data.import")}
            </button>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportPick} />
          </span>
        </Row>
        {importError && <p className="-mt-1 pb-3 text-xs text-bad">{importError}</p>}
        <Row
          icon={Clock}
          title={t("settings.data.recent")}
          desc={`${t("settings.data.recentDesc")}${
            recentCount > 0 ? ` (${t("settings.data.now")} ${formatCount(recentCount)})` : ""
          }`}
        >
          {recentCleared ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good">
              <Check size={14} /> {t("settings.data.clear")}
            </span>
          ) : (
            <button
              type="button"
              disabled={recentCount === 0}
              onClick={() => {
                clearRecentlyViewed();
                setRecentCleared(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Clock size={14} /> {t("settings.data.recent")}
            </button>
          )}
        </Row>
        <Row
          icon={SearchX}
          title={t("settings.data.search")}
          desc={`${t("settings.data.searchDesc")}${
            recentSearchCount > 0 ? ` (${t("settings.data.now")} ${formatCount(recentSearchCount)})` : ""
          }`}
        >
          {searchesCleared ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good">
              <Check size={14} /> {t("settings.data.clear")}
            </span>
          ) : (
            <button
              type="button"
              disabled={recentSearchCount === 0}
              onClick={() => {
                clearRecentSearches();
                setSearchesCleared(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <SearchX size={14} /> {t("settings.data.search")}
            </button>
          )}
        </Row>
        <Row
          icon={Trash2}
          title={t("settings.data.reset")}
          desc={t("settings.data.resetDesc")}
        >
          {dataReset ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good">
              <Check size={14} /> {t("settings.data.cleared")}
            </span>
          ) : confirmReset ? (
            <span className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={doReset}
                className="rounded-lg bg-bad px-3 py-1.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                {t("settings.data.confirmDelete")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 hover:bg-raised"
              >
                {t("settings.data.cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-bad/50 px-3 py-1.5 text-sm font-medium text-bad transition-colors hover:bg-bad/10"
            >
              <Trash2 size={14} /> {t("settings.data.confirmReset")}
            </button>
          )}
        </Row>
        {visitStats && (
          <Row
            icon={BarChart3}
            title={t("settings.data.stats")}
            desc={t("settings.data.statsDesc")}
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-2">
              <span className="tabular-nums">
                {t("settings.data.statsToday")}{" "}
                <span className="font-semibold text-fg">{formatCount(visitStats.todayVisits)}</span>
              </span>
              <span className="text-line-strong" aria-hidden>
                ·
              </span>
              <span className="tabular-nums">
                {t("settings.data.statsTotal")}{" "}
                <span className="font-semibold text-fg">{formatCount(visitStats.totalVisits)}</span>
              </span>
            </span>
          </Row>
        )}
      </section>

      {/* 계정 */}
      <h2 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-fg-3">{t("settings.section.account")}</h2>
      <section className="rounded-2xl border border-line bg-panel/40 px-5">
        <Row
          icon={UserCog}
          title={t("settings.account.title")}
          desc={t("settings.account.desc")}
        >
          <Link
            to="/me"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-raised hover:text-fg"
          >
            {t("settings.account.toProfile")} <ChevronRight size={14} />
          </Link>
        </Row>
      </section>
    </Container>
  );
}

// 하이드레이션 직후 1회 초기화(localStorage 선호값 반영). effect 의존성 가드.
function useStateOnceHydrated(hydrated: boolean, fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (hydrated && !done.current) {
      done.current = true;
      fn();
    }
  }, [hydrated, fn]);
}
