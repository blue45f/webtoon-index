import { Tv, Film, Sparkles, Play } from "lucide-react";

import { MiniPoster } from "./rank-row";


import type { Title } from "@/shared/lib/types";

import { TYPE_LABEL } from "@/shared/lib/taxonomy";
import { type MediaAdaptation, MEDIA_KIND_LABEL, mediaThumb, mediaLink } from "@/shared/lib/title-universe";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useInView } from "@/src/hooks/use-in-view";



const EXT_ICON: Record<MediaAdaptation["kind"], typeof Tv> = {
  drama: Tv,
  movie: Film,
  anime: Sparkles,
  ott: Tv,
};

// 노드 등장 안무용 공통 스타일. step = 체인 상의 순서(0=원작).
function nodeReveal(inView: boolean, step: number): React.CSSProperties {
  return {
    opacity: inView ? 1 : 0,
    transform: inView ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 420ms var(--ease-out-expo), transform 420ms var(--ease-out-quint)",
    transitionDelay: `${step * 130 + 90}ms`,
  };
}

function Node({
  title,
  role,
  highlight,
  inView,
  step,
}: {
  title: Title;
  role: string;
  highlight?: boolean;
  inView: boolean;
  step: number;
}) {
  return (
    <Link
      href={`/title/${title.slug}`}
      className={cn(
        "group flex w-[5.5rem] shrink-0 flex-col items-center gap-1.5 text-center",
        highlight && "scale-[1.03]"
      )}
      style={nodeReveal(inView, step)}
    >
      <MiniPoster
        title={title}
        className={cn(
          "w-full ring-1 transition-all",
          highlight ? "ring-accent" : "ring-[oklch(0.95_0.01_85/0.14)] group-hover:ring-line-strong"
        )}
      />
      <span className="eyebrow text-[0.58rem] text-fg-3">{role}</span>
      <span className="line-clamp-2 text-[0.72rem] font-medium leading-tight text-fg-2 group-hover:text-fg">
        {title.title}
      </span>
    </Link>
  );
}

// 영상화 노드 — 공식 예고편 썸네일 + 공식 시청/정보 페이지로 링크아웃.
function MediaNode({ media, inView, step }: { media: MediaAdaptation; inView: boolean; step: number }) {
  const Icon = EXT_ICON[media.kind] ?? Tv;
  const thumb = mediaThumb(media);
  return (
    <a
      href={mediaLink(media)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex w-[5.5rem] shrink-0 flex-col items-center gap-1.5 text-center"
      style={nodeReveal(inView, step)}
    >
      <span className="relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-md border border-line-strong bg-[linear-gradient(145deg,oklch(0.245_0.011_64),oklch(0.185_0.009_68))] text-accent shadow-[inset_0_1px_0_oklch(1_0_0/0.05)] transition-all group-hover:border-accent/60">
        {thumb ? (
          <>
            {/* 유튜브 공식 예고편 썸네일(16:9)을 3:4 카드에 cover */}
            <img src={thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105" />
            <span className="absolute inset-0 bg-[oklch(0.14_0.02_70/0.32)] transition-colors group-hover:bg-[oklch(0.14_0.02_70/0.12)]" />
            <span className="relative grid size-7 place-items-center rounded-full bg-[oklch(0.14_0.02_70/0.55)] text-[oklch(0.97_0.01_85)] backdrop-blur-sm">
              <Play size={13} className="fill-current" />
            </span>
          </>
        ) : (
          <>
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_0%,oklch(0.72_0.185_42/0.22),transparent_58%)]" />
            <Icon size={20} className="relative" />
          </>
        )}
      </span>
      <span className="eyebrow text-[0.58rem] text-fg-3">{MEDIA_KIND_LABEL[media.kind]}</span>
      <span className="line-clamp-2 text-[0.72rem] font-medium leading-tight text-fg-2 group-hover:text-fg">
        {media.name}
        <span className="block text-[0.62rem] text-fg-3 tnum">{media.year}</span>
      </span>
    </a>
  );
}

// 커넥터 — reveal 시 라인이 좌→우로 그려진 뒤 노드 도트가 들어온다.
function Connector({ inView, step }: { inView: boolean; step: number }) {
  const lineDelay = `${step * 130}ms`;
  const dotDelay = `${step * 130 + 60}ms`;
  return (
    <div className="flex shrink-0 items-center self-start pt-7" aria-hidden>
      <span
        className="h-px w-4 origin-left bg-line-strong transition-transform duration-[360ms] ease-out-quint sm:w-7"
        style={{ transform: inView ? "scaleX(1)" : "scaleX(0)", transitionDelay: lineDelay }}
      />
      <span
        className="size-1.5 rounded-full bg-accent transition-[opacity,transform] duration-200 ease-out-expo"
        style={{
          opacity: inView ? 1 : 0,
          transform: inView ? "scale(1)" : "scale(0.2)",
          transitionDelay: dotDelay,
        }}
      />
    </div>
  );
}

// 원작 → 웹툰 → 영상화 그래프
export function AdaptationGraph({
  original,
  adaptations,
  externalMedia = [],
  currentId,
  className,
}: {
  original: Title;
  adaptations: Title[];
  externalMedia?: MediaAdaptation[];
  currentId?: string;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("flex items-start gap-1 overflow-x-auto rail pb-1", className)}>
      <Node
        title={original}
        role={original.type === "webnovel" ? "원작 소설" : "원작"}
        highlight={original.id === currentId}
        inView={inView}
        step={0}
      />
      {adaptations.map((a, i) => (
        <div key={a.id} className="flex items-start gap-1">
          <Connector inView={inView} step={i + 1} />
          <Node
            title={a}
            role={TYPE_LABEL[a.type] + "화"}
            highlight={a.id === currentId}
            inView={inView}
            step={i + 1}
          />
        </div>
      ))}
      {externalMedia.map((e, i) => {
        const step = adaptations.length + 1 + i;
        return (
          <div key={`${e.kind}-${e.name}-${e.year}`} className="flex items-start gap-1">
            <Connector inView={inView} step={step} />
            <MediaNode media={e} inView={inView} step={step} />
          </div>
        );
      })}
    </div>
  );
}
