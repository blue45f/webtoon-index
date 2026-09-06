/**
 * 활성 래스터 백엔드 비콘.
 *
 * `StudioWebGpuEngine` 은 자기 백엔드를 알고 `onBackendChange` 로 알려 주지만,
 * StudioPage 는 그 값을 **ref** 에 넣는다(핫패스 재렌더 금지 규율). 그래서 지금까지
 * "지금 무엇으로 그리고 있나"를 컴포넌트 밖에서 읽을 방법이 없었다.
 *
 * 진단 패널은 그 값을 **실측치로** 보여 줘야 하므로, ref 쓰기 지점마다 이 비콘에도
 * 같은 값을 흘려보낸다. 비콘은 값 하나와 구독자 집합뿐이라 스트로크 경로에 붙어도
 * 비용이 없고, 값이 실제로 바뀔 때만 알린다.
 *
 * 아직 아무도 보고하지 않았으면 `null` 이다 — 진단 패널은 그것을 "미측정"으로
 * 표시해야 하고, "canvas2d" 로 추정해서는 안 된다.
 */

import type { StudioGpuBackend } from "./render/studio-webgpu-frame-contract";

let current: StudioGpuBackend | null = null;
const listeners = new Set<() => void>();

export function publishStudioRenderBackend(backend: StudioGpuBackend): void {
  if (current === backend) return;
  current = backend;
  for (const listener of [...listeners]) listener();
}

/** 마지막으로 보고된 래스터 백엔드. 보고가 없었으면 `null`. */
export function getStudioRenderBackend(): StudioGpuBackend | null {
  return current;
}

export function subscribeStudioRenderBackend(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 테스트 전용. */
export function resetStudioRenderBackendBeacon(): void {
  current = null;
  listeners.clear();
}
