import { Heart, MessageCircle, Palette, PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { CoverImage } from "@/shared/components/cover-image";
import { Section } from "@/shared/components/section";
import { cn, formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { listWorks, type WorkSummary } from "@/src/infrastructure/creator-client";

// 작품 상세의 "팬 창작" 섹션 — 이 웹툰(titleId)에 연결된 사용자 창작물 + 스튜디오 바로가기.
export function TitleFanWorks({ titleId }: { titleId: string }) {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    listWorks({ titleId, sort: "recent" }, ctrl.signal)
      .then((w) => alive && setWorks(w))
      .catch(() => alive && setWorks([]));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [titleId]);

  const studioHref = `/studio?titleId=${encodeURIComponent(titleId)}`;

  return (
    <Section
      eyebrow="FAN CREATION"
      title="팬 창작"
      desc="이 작품을 좋아하는 사람들이 창작 스튜디오로 만든 팬 창작물이에요."
      action={{ label: "이 웹툰으로 창작하기", href: studioHref }}
      className="mt-14"
    >
      {works === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-raised/40" />
          ))}
        </div>
      ) : works.length === 0 ? (
        <Link
          href={studioHref}
          className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-card/30 px-6 py-10 text-center transition-colors hover:border-accent/50"
        >
          <Palette size={24} className="text-accent" />
          <p className="text-sm font-medium text-fg">아직 팬 창작물이 없어요.</p>
          <p className="text-xs text-fg-3">스튜디오로 이 웹툰의 첫 팬 창작물을 만들어보세요.</p>
        </Link>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {works.map((work) => (
            <Link
              key={work.id}
              href={`/create/${work.id}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/30 transition-colors hover:border-line-strong"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-raised/40">
                <CoverImage
                  src={work.cover}
                  alt={work.title}
                  className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                  fallback={
                    <span className="grid h-full w-full place-items-center bg-gradient-to-br from-raised to-card text-fg-3">
                      <PenLine size={24} />
                    </span>
                  }
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-fg group-hover:text-accent">
                  {work.title}
                </h3>
                <span className="truncate text-xs text-fg-3">{work.author.name}</span>
                <div className="mt-auto flex items-center gap-3 pt-1 text-[0.72rem] text-fg-3">
                  <span className="inline-flex items-center gap-1">
                    <Heart size={12} className={cn(work.liked && "fill-accent text-accent")} />
                    <span className="numeral">{formatCount(work.likes)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle size={12} />
                    <span className="numeral">{formatCount(work.comments)}</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
