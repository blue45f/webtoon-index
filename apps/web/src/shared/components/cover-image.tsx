import { useState } from "react";

import { cx } from "@/shared/lib/cx";
import { useAppConfig } from "@/src/hooks/use-app-config";

// 표지 <img> 래퍼 — CDN 링크가 만료/404 되면 깨진 이미지 박스 대신 폴백(그라디언트+글리프)으로 전환.
// 로드 완료 시 부드럽게 페이드-인(팝-인 방지). priority(LCP) 표지는 즉시 표시해 LCP에 영향 없음.
export function CoverImage({
  src,
  alt,
  fallback,
  className,
  priority,
}: {
  src: string;
  alt: string;
  fallback?: React.ReactNode;
  className?: string;
  priority?: boolean; // above-the-fold 커버는 즉시 로드(LCP 개선)
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 표지 킬스위치(관리자) — 저작권 리스크 시 즉시 자체 타이포 커버로 대체. 로드 실패도 동일 폴백.
  // (환경변수 COVER_IMAGE_POLICY=off 는 빌드·프록시 단의 하드 킬로 병행 존재한다.)
  const { showCovers } = useAppConfig();
  if (!showCovers || failed) return <>{fallback ?? null}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? "sync" : "async"}
      onError={() => setFailed(true)}
      onLoad={() => setLoaded(true)}
      // 캐시된 이미지는 onLoad 가 핸들러 부착 전에 끝나 안 뜰 수 있다 → 마운트 시 complete 면 즉시 표시
      // (투명 고착 방지). 네트워크 로드는 onLoad 가 페이드를 트리거.
      ref={(node) => {
        if (node?.complete) setLoaded(true);
      }}
      className={cx(
        className,
        !priority && "transition-opacity duration-500 ease-out",
        !priority && !loaded && "opacity-0"
      )}
    />
  );
}
