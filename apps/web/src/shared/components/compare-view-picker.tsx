import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { MiniPoster } from "./rank-row";
import { TitlePoster } from "./title-poster";

import type { Title } from "@/shared/lib/types";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { TYPE_LABEL } from "@/shared/lib/taxonomy";

export function Picker({
  value,
  onPick,
  onClear,
}: {
  value: Title | null;
  onPick: (t: Title) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;

    const controller = new AbortController();
    fetch(`/api/titles?q=${encodeURIComponent(query)}&limit=6`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("search failed"))))
      .then((data: { items?: Title[] }) => setResults(data.items ?? []))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [q]);

  if (value) {
    return (
      <div className="relative">
        <button
          onClick={onClear}
          className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-lg border border-[oklch(0.95_0.01_85/0.22)] bg-[oklch(0.16_0.01_70/0.58)] text-[oklch(0.95_0.01_85/0.82)] backdrop-blur-md transition-colors hover:text-fg"
          aria-label="교체"
        >
          <X size={14} />
        </button>
        <TitlePoster title={value} size="md" />
        <p className="mt-2 truncate text-center text-sm font-semibold">{value.title}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={15} className="text-fg-3" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            const next = e.target.value;
            setQ(next);
            if (!next.trim()) {
              setResults([]);
              setLoading(false);
            } else {
              setLoading(true);
            }
          }}
          placeholder="작품 검색"
          aria-label="작품 검색"
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5" aria-busy={loading}>
        {results.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-fg-3">
            {loading ? "검색 중" : q.trim() ? "결과 없음" : "비교할 작품을 검색하세요"}
          </p>
        ) : (
          results.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised"
            >
              <MiniPoster title={t} className="w-8 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{t.title}</span>
                <span className="text-xs text-fg-3">
                  {TYPE_LABEL[t.type]} · ★{statsAreEstimated(t) ? "≈" : ""}{t.stats.ratingAvg.toFixed(1)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
