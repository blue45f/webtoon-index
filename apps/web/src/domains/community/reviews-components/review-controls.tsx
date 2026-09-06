
import { EyeOff, Eye } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { useRouter, useSearchParams, usePathname } from "@/src/compat/navigation";

export type ReviewSort = "recent" | "likes" | "high" | "low";

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: "recent", label: "최신순" },
  { value: "likes", label: "공감순" },
  { value: "high", label: "별점 높은순" },
  { value: "low", label: "별점 낮은순" },
];
const RATINGS: { value: string; label: string }[] = [
  { value: "all", label: "전체 평점" },
  { value: "high", label: "고평점 4★+" },
  { value: "low", label: "저평점 ~3★" },
];

// 리뷰 정렬·필터 컨트롤 — searchParams 보존하며 갱신
export function ReviewControls() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sort = (sp.get("sort") as ReviewSort) || "recent";
  const spoilerHidden = sp.get("spoiler") === "hide";
  const rating = sp.get("rating") || "all";

  const setParam = (key: string, val: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (!val) p.delete(key);
    else p.set(key, val);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-panel p-1" role="tablist">
        {SORTS.map((t) => {
          const active = t.value === sort;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => setParam("sort", t.value === "recent" ? null : t.value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                active ? "bg-accent text-on-accent" : "text-fg-2 hover:text-fg"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-panel p-1">
        {RATINGS.map((r) => {
          const active = r.value === rating;
          return (
            <button
              key={r.value}
              onClick={() => setParam("rating", r.value === "all" ? null : r.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[0.8rem] font-medium transition-colors duration-150",
                active ? "bg-raised text-fg" : "text-fg-3 hover:text-fg-2"
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setParam("spoiler", spoilerHidden ? null : "hide")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8rem] font-medium transition-colors",
          spoilerHidden
            ? "border-accent/50 bg-accent-soft text-accent"
            : "border-line bg-panel text-fg-3 hover:text-fg-2"
        )}
      >
        {spoilerHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        스포일러 {spoilerHidden ? "숨김" : "표시"}
      </button>
    </div>
  );
}
