/**
 * BlendIsolationGroup — 블렌드 모드를 요소 단위로 적용하기 위한 자가 캐시 Konva 그룹.
 *
 * Konva Group에 `globalCompositeOperation`을 걸면 그룹이 하나로 합성되지 않는다 —
 * 그룹은 컨텍스트에 합성 모드를 세팅한 뒤 자식을 차례로 그리므로, 자식 **하나하나가**
 * 레이어 캔버스에 개별 합성된다. 자유곡선 한 획은 수십 개의 스탬프로 그려지기 때문에
 * 같은 물리가 스탬프 수만큼 반복 적용되고, 그 결과 대부분의 블렌드 모드가 반복 합성의
 * 고정점으로 붕괴한다(실측: 곱하기 → 검정, 제외 → 정확히 127, 색상 번 → 검정).
 * darken/lighten만 정확했던 이유도 같다 — 그 둘만 반복 적용에 대해 멱등이기 때문이다.
 *
 * 트릭은 [[ClipMaskGroup]]과 같다: 그룹을 cache()하면 자식이 먼저 오프스크린 캔버스로
 * 렌더된다. 캐시된 노드는 `_drawCachedSceneCanvas`로 **비트맵 한 장**으로 그려지므로
 * 합성 모드가 획 전체에 정확히 한 번 적용된다.
 *
 * ClipMaskGroup과 배치가 다르다는 점이 중요하다. 거기서는 합성이 *자식*(source-in
 * content)에 붙고 캐시는 그 합성을 그룹 안으로 **가두는** 역할이다. 여기서는 반대로
 * 합성이 *캐시된 그룹 자신*에 붙어 평탄화된 결과가 아래 레이어와 섞인다. 합성을 자식에
 * 두면 격리만 되고 정작 아래 레이어와는 섞이지 않으므로 블렌드가 사라진다.
 *
 * cacheKey: 요소의 렌더 결과가 바뀌면 달라지는 키. 바뀔 때마다 다시 캐시한다
 * (마운트 시에도 1회 실행되므로 첫 캐시도 이 effect가 담당한다).
 */
import { useEffect, useRef } from "react";
import { Group } from "react-konva/lib/ReactKonvaCore";

import type Konva from "konva";
import type { ReactNode } from "react";

export function BlendIsolationGroup({
  cacheKey,
  composite,
  clip,
  children,
}: {
  cacheKey: string;
  composite: NonNullable<Konva.NodeConfig["globalCompositeOperation"]>;
  clip?: { x: number; y: number; width: number; height: number };
  children: ReactNode;
}): React.ReactElement {
  const ref = useRef<Konva.Group>(null);

  useEffect(() => {
    let cancelled = false;
    const recache = () => {
      const node = ref.current;
      if (cancelled || !node) return;
      node.clearCache();
      // 자식 이미지가 아직 로드 전이면 그룹 크기가 0 — 이때 cache()는 Konva 경고를 낸다.
      // 크기가 생긴 뒤(지연 재캐시)에만 캐시한다. 캐시 실패 시에는 캐시 없이 그리는데,
      // 그러면 블렌드가 스탬프마다 적용되는 예전 동작으로 돌아간다 — 획이 사라지는 것보다는
      // 낫지만 정확하지 않으므로, 아래 지연 재시도가 늦게 도착한 이미지까지 따라잡는다.
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
    <Group
      ref={ref}
      globalCompositeOperation={composite}
      {...(clip
        ? { clipX: clip.x, clipY: clip.y, clipWidth: clip.width, clipHeight: clip.height }
        : {})}
    >
      {children}
    </Group>
  );
}
