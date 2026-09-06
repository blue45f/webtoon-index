/**
 * ClipMaskGroup — 알파 정밀 클리핑 마스크용 자가 캐시 Konva 그룹.
 *
 * Konva Group은 기본적으로 합성(compositing)을 격리하지 않는다 —
 * globalCompositeOperation은 레이어 전체 캔버스를 대상으로 합성되므로,
 * "source-in" 같은 모드를 쓰면 같은 그룹의 형제가 아니라 레이어 전체와 섞여 버린다.
 *
 * 트릭: 그룹을 cache()하면 자식들을 먼저 오프스크린 캔버스로 렌더해
 * 합성이 그 캔버스 안으로 격리된다. 그 결과 "source-in" content 노드는
 * 오직 같은 그룹 안 형제(마스크)의 알파로만 잘린다(알파 정밀 클리핑).
 *
 * 그래서 이 컴포넌트가 하는 일은 자식을 <Group ref>로 감싸 캐시하는 것뿐이다.
 *
 * children 규약: [마스크 노드, content 노드]. content 노드는
 * globalCompositeOperation="source-in"이어야 형제 마스크의 알파로 잘린다.
 *
 * cacheKey: 내용/지오메트리가 바뀌면 달라지는 키. 바뀔 때마다 그룹을 다시 캐시한다
 * (마운트 시에도 1회 실행되므로 첫 캐시도 이 effect가 담당한다).
 *
 * UrlImage의 캐시 패턴(clearCache → cache → getLayer()?.batchDraw())을 그대로 따른다.
 * 순수 래퍼 — Konva/react-konva 외 의존 없음.
 */
import { useEffect, useRef } from "react";
import { Group } from "react-konva/lib/ReactKonvaCore";

import type Konva from "konva";
import type { ReactNode } from "react";

export function ClipMaskGroup({
  cacheKey,
  composite,
  children,
}: {
  cacheKey: string;
  /**
   * How the finished (cached, mask-applied) sandwich composites against what is below it.
   *
   * Inside the group, clipping is always the children's own `source-in` contract; this prop is for
   * the OUTSIDE — a masked layer that itself carries a blend mode, or a masked layer that must in
   * turn clip to the layer below (nested clipBelow + own mask). Because the group is cached, the
   * mode applies exactly once to the flattened bitmap, never per child.
   */
  composite?: Konva.NodeConfig["globalCompositeOperation"];
  children: ReactNode;
}): React.ReactElement {
  const ref = useRef<Konva.Group>(null);

  // cacheKey가 바뀔 때(그리고 마운트 시)마다 그룹을 다시 캐시해 합성을 격리한다.
  // 마스크/콘텐츠가 비동기로 로드되는 이미지면 첫 캐시가 빈 비트맵을 잡으므로,
  // 잠시 동안 몇 번 더 재캐시해 늦게 도착한 이미지까지 마스크에 반영한다.
  useEffect(() => {
    let cancelled = false;
    const recache = () => {
      const node = ref.current;
      if (cancelled || !node) return;
      node.clearCache();
      // 자식 이미지가 아직 로드 전이면 그룹 크기가 0 — 이때 cache()는 Konva 경고를 낸다.
      // 크기가 생긴 뒤(지연 재캐시)에만 캐시하고, 그 전엔 마스크 없이 그대로 렌더한다.
      const rect = node.getClientRect({ skipTransform: true });
      if (rect.width > 0 && rect.height > 0) {
        try {
          node.cache();
        } catch {
          node.clearCache();
        }
      }
      node.getLayer()?.batchDraw();
    };
    recache();
    const timers = [120, 350, 700, 1200].map((ms) => globalThis.setTimeout(recache, ms));
    return () => {
      cancelled = true;
      timers.forEach((t) => globalThis.clearTimeout(t));
    };
  }, [cacheKey]);

  return (
    <Group ref={ref} {...(composite ? { globalCompositeOperation: composite } : {})}>
      {children}
    </Group>
  );
}
