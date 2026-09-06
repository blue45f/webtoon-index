/**
 * Studio Page Thumbnails — 페이지 스트립 "실내용" 미니 썸네일 + HTML5 드래그 재배열 훅.
 *
 * 썸네일은 studio-page-thumbs 의 순수 프록시 스펙(ThumbNode)을 SVG 로 그린다 —
 * 페이지마다 Konva Stage 를 띄우지 않는 경량 미리보기(PPT 사이드바 방식).
 * 페이지 색보정(그레이드)은 CSS filter + 비네트 오버레이로 캔버스 미리보기와 동일하게 근사.
 *
 * 재배열은 useStudioPageDnd 가 드래그 상태(원본 index·드롭 슬롯)만 관리하고,
 * 실제 순서 변경은 호출 측이 studio-pages.reorderPages 순수 함수로 수행한다.
 * 키보드/터치 대체 수단은 기존 이동 버튼(위/아래/맨위/맨아래)을 그대로 유지한다(a11y).
 */
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";

import { CANVAS_W } from "./studio-assets";
import {
  isDefaultPageGrade,
  normalizePageGrade,
  pageGradeToCssFilter,
  vignetteCss,
  type PageGrade,
} from "./studio-page-grade";
import {
  buildThumbNodes,
  type ThumbNode,
  type ThumbPageLike,
} from "./studio-page-thumbs";
import { useStudioRasterSourcePresentation } from "./use-studio-raster-source-presentation";

import { parseStudioWorkAssetSourceUri } from "@/shared/lib/studio-work-asset-contract";
import { cn } from "@/shared/lib/utils";

export type { StudioPageDnd, StudioPageDndItemProps } from "./studio-page-dnd";

// ── 썸네일 ──────────────────────────────────────────────────────────────────────────

type StudioThumbImageNode = Extract<ThumbNode, { readonly kind: "image" }>;

function StudioThumbImage({ node }: { readonly node: StudioThumbImageNode }): ReactElement {
  const presentation = useStudioRasterSourcePresentation(node.src, {
    consumer: "studio-page-thumbnail",
  });
  const transform = node.transform ?? undefined;
  if (parseStudioWorkAssetSourceUri(node.src) || presentation.src === null) {
    return (
      <g
        data-raster-source-placeholder="true"
        data-work-asset-placeholder={parseStudioWorkAssetSourceUri(node.src) ? "true" : undefined}
        transform={transform}
        opacity={node.opacity}
      >
        <title>검증된 이미지 바이트를 안전하게 불러오는 중</title>
        <rect
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={10}
          fill="rgb(99 102 241 / 0.08)"
          stroke="rgb(99 102 241 / 0.55)"
          strokeWidth={3}
          strokeDasharray="12 8"
        />
        <path
          d={`M ${node.x + node.w * 0.2} ${node.y + node.h * 0.62} L ${node.x + node.w * 0.42} ${node.y + node.h * 0.4} L ${node.x + node.w * 0.56} ${node.y + node.h * 0.54} L ${node.x + node.w * 0.78} ${node.y + node.h * 0.3}`}
          fill="none"
          stroke="rgb(99 102 241 / 0.7)"
          strokeWidth={Math.max(3, Math.min(node.w, node.h) * 0.025)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }
  return (
    <image
      href={presentation.src}
      x={node.x}
      y={node.y}
      width={node.w}
      height={node.h}
      preserveAspectRatio={node.cover ? "xMidYMid slice" : "none"}
      style={node.filterCss ? { filter: node.filterCss } : undefined}
      transform={transform}
      opacity={node.opacity}
    />
  );
}

function renderThumbNode(node: ThumbNode): ReactElement {
  const transform = node.transform ?? undefined;
  switch (node.kind) {
    case "rect":
      return (
        <rect
          key={node.key}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={node.rx || undefined}
          fill={node.fill ?? "none"}
          fillOpacity={node.fillOpacity !== 1 ? node.fillOpacity : undefined}
          stroke={node.stroke ?? undefined}
          strokeWidth={node.stroke ? node.strokeWidth : undefined}
          strokeDasharray={node.dashed ? "10 5" : undefined}
          transform={transform}
          opacity={node.opacity}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={node.key}
          cx={node.cx}
          cy={node.cy}
          rx={node.rx}
          ry={node.ry}
          fill={node.fill ?? "none"}
          stroke={node.stroke ?? undefined}
          strokeWidth={node.stroke ? node.strokeWidth : undefined}
          transform={transform}
          opacity={node.opacity}
        />
      );
    case "polygon":
      return (
        <polygon
          key={node.key}
          points={node.points}
          fill={node.fill ?? "none"}
          stroke={node.stroke ?? undefined}
          strokeWidth={node.stroke ? node.strokeWidth : undefined}
          strokeLinejoin="round"
          transform={transform}
          opacity={node.opacity}
        />
      );
    case "polyline":
      return (
        <polyline
          key={node.key}
          points={node.points}
          fill="none"
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={transform}
          opacity={node.opacity}
        />
      );
    case "path":
      return (
        <path
          key={node.key}
          d={node.d}
          fill={node.fill ?? "none"}
          stroke={node.stroke ?? undefined}
          strokeWidth={node.stroke ? node.strokeWidth : undefined}
          strokeDasharray={node.dashed ? "8 5" : undefined}
          strokeLinejoin="round"
          transform={transform}
          opacity={node.opacity}
        />
      );
    case "image":
      return <StudioThumbImage key={node.key} node={node} />;
    case "text":
      return (
        <text
          key={node.key}
          x={node.x}
          y={node.y}
          textAnchor={node.anchor}
          fontSize={node.fontSize}
          fontFamily={node.font}
          fontWeight={node.bold ? 700 : 400}
          fill={node.fill}
          stroke={node.stroke ?? undefined}
          strokeWidth={node.stroke ? node.strokeWidth : undefined}
          style={node.stroke ? { paintOrder: "stroke" } : undefined}
          transform={transform}
          opacity={node.opacity}
        >
          {node.lines.map((line, i) => (
            // 줄 순서 고정 배열(재정렬 없음)이라 index key 안전.
            <tspan key={i} x={node.x} dy={i === 0 ? 0 : node.lineStep}>
              {line}
            </tspan>
          ))}
        </text>
      );
  }
}

function useStudioThumbnailPresentationWindow(): {
  readonly nearViewport: boolean;
  readonly rootRef: RefObject<HTMLDivElement | null>;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(
    () => typeof globalThis.IntersectionObserver !== "function",
  );
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof globalThis.IntersectionObserver !== "function") {
      return;
    }
    const observer = new globalThis.IntersectionObserver((entries) => {
      setNearViewport(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: "320px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  return { nearViewport, rootRef };
}

/**
 * 페이지 실내용 미니 썸네일 — 요소들을 축소 SVG 프록시로 렌더한다.
 * page 객체 동일성이 유지되면 React Compiler 메모이제이션으로 재렌더를 건너뛴다
 * (StudioPage 의 commit 계열은 변경된 페이지만 새 객체로 만든다).
 */
export function StudioPageThumbnail({
  page,
  className,
}: {
  page: ThumbPageLike;
  className?: string;
}): ReactElement {
  const { nearViewport, rootRef } = useStudioThumbnailPresentationWindow();
  const { nodes, skipped } = buildThumbNodes(page);
  const grade = normalizePageGrade(page.grade as Partial<PageGrade> | undefined);
  const gradeFilter = pageGradeToCssFilter(grade);
  const hasGrade = !isDefaultPageGrade(grade);
  const canvasH = page.canvasH > 0 ? page.canvasH : 1080;
  const hasGradient = Array.isArray(page.bgGrad) && page.bgGrad.length >= 2;
  // useId 는 특수문자(«») id 를 만들 수 있어 url(#…) 참조가 불안정 — 페이지 uuid 기반 id 사용.
  const gradientId = `studio-page-thumb-grad-${page.id}`;

  return (
    <div
      ref={rootRef}
      className={cn("relative h-24 overflow-hidden rounded border border-line/60 bg-raised/40", className)}
    >
      <svg
        viewBox={`0 0 ${CANVAS_W} ${canvasH}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
        style={hasGrade && gradeFilter ? { filter: gradeFilter } : undefined}
      >
        {hasGradient ? (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={page.bgGrad?.[0]} />
              <stop offset="1" stopColor={page.bgGrad?.[1]} />
            </linearGradient>
          </defs>
        ) : null}
        <rect x={0} y={0} width={CANVAS_W} height={canvasH} fill={hasGradient ? `url(#${gradientId})` : page.bg} />
        {nodes.map((node) => node.kind === "image" && !nearViewport
          ? null
          : renderThumbNode(node))}
      </svg>
      {hasGrade && grade.vignette > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: vignetteCss(grade.vignette) }}
        />
      ) : null}
      {skipped > 0 ? (
        <span
          className="absolute bottom-0.5 right-1 rounded bg-black/55 px-1 text-[8px] font-semibold leading-3 text-white"
          title={`요소 ${skipped}개는 경량 미리보기에서 생략됨`}
        >
          +{skipped}
        </span>
      ) : null}
    </div>
  );
}
