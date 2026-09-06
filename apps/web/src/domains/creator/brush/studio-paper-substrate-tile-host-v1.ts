/**
 * 종이 기질 타일 호스트 — 전용 워커에서 굽고 메인 스레드는 기다리지 않는다
 * (2026-08-21 paper substrate wave, 3단계).
 *
 * 실측(이 저장소, 256² 한 장): 프로바이더 오라클만 1.0–1.9초, R8+PNG까지 포함한 전체 굽기는
 * 2.0–2.9초다. 메인 스레드에서 부르면 첫 페이지 렌더가 그만큼 멈춘다 — 성능은 목표가 아니지만
 * **veto**다(ADR-0010). 비용의 5분의 4는 프로바이더가 배경이 쓰지도 않는 flow 채널을 위해
 * 픽셀마다 componentSample을 4번 더 도는 데서 온다(다음 최적화 지점).
 * `studio-procedural-media-surface-worker-client`가 이미 완성돼 있었고(소비자 0) 이 모듈이
 * 그 유일한 소비자다.
 *
 * **이 파일은 의도적으로 잎(leaf)이다.** 무거운 것(1,905줄 프로바이더, 워커 클라이언트,
 * 레시피 테이블)은 전부 동적 import 뒤에 있다. 뷰포트는 이 얇은 진입점만 정적으로 잡으므로
 * 종이를 한 번도 안 켠 문서는 기질 레인 코드를 내려받지도 않는다(studio 번들 래칫 계약).
 *
 * 열화 규약 — 종이는 절대 사라지지 않는다.
 * 워커 실패/미지원/동적 로드 실패 → `null`을 돌려주고, 호출자는 기존 128² 빠른 타일
 * (`getStudioPaperSurfacePreviewTile`)을 계속 쓴다. 즉 최악의 경우가 "오늘과 같은 그림"이다.
 */

import type { StudioProceduralMediaSurfaceWorkerClient } from "../studio-procedural-media-surface-worker-client";
import type { PaperGrainKind } from "./studio-paper-texture";

/** 이 호스트가 쓰는 고정 엔진 epoch — 종이는 문서 속성이라 엔진 세대와 무관하다. */
const SUBSTRATE_ENGINE_EPOCH = 1;

/**
 * 기본 타일 한 변(문서 px = 텍셀). 반복 주기가 곧 화면에 보이는 주기라 128보다 256을 골랐다 —
 * 웹툰 폭(~1,000px)에 8번이 아니라 4번 반복된다. 굽기 비용은 워커가 흡수한다.
 */
export const STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1 = 256;

export interface StudioPaperSubstrateTileHostRequestV1 {
  readonly kind: PaperGrainKind;
  readonly seed: number;
  /** 타일 한 변(px). 문서 px 주기와 같다. 미지정이면 256. */
  readonly size?: number;
  /** 문서 px 당 텍셀 배수(아티스트의 종이 확대 축). */
  readonly documentScale?: number;
  /** 종이 결 회전(라디안). */
  readonly rotationRadians?: number;
  /** 핵심 바깥으로 둘러칠 halo 폭. 릴리프 셰이딩의 가장자리 클램프를 밀어내는 데 쓴다. */
  readonly halo?: number;
}

export interface StudioPaperSubstrateTileHeightsV1 {
  /** 이음매 없는 핵심 타일 한 변(= 문서 px 주기). */
  readonly size: number;
  readonly halo: number;
  /** 실제 버퍼 한 변 = size + halo×2. */
  readonly fieldWidth: number;
  /** 부호 있는 릴리프 [-1,1], row-major, 길이 fieldWidth². */
  readonly heightField: Float32Array;
  /** 물/안료 흡수 계수 [0,1] — 젖은 매체 경로가 쓸 채널. */
  readonly absorbency: Float32Array;
  /** 건식 접촉 계수 [0,1]. */
  readonly grain: Float32Array;
  readonly recipeFingerprint: string;
  readonly execution: "dedicated-worker";
}

let sharedClient: StudioProceduralMediaSurfaceWorkerClient | null = null;
let sharedClientUnavailable = false;
let nextRequestSequence = 1;

async function resolveClient(): Promise<StudioProceduralMediaSurfaceWorkerClient | null> {
  if (sharedClientUnavailable) return null;
  if (sharedClient) return sharedClient;
  if (typeof Worker === "undefined") {
    sharedClientUnavailable = true;
    return null;
  }
  try {
    const { createStudioProceduralMediaSurfaceWorkerClient } = await import(
      "../studio-procedural-media-surface-worker-client"
    );
    sharedClient = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: SUBSTRATE_ENGINE_EPOCH,
    });
  } catch {
    sharedClientUnavailable = true;
    return null;
  }
  return sharedClient;
}

function clampSize(value: number | undefined): number {
  const raw = Math.round(value ?? STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1);
  if (!Number.isFinite(raw)) return STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1;
  return raw < 32 ? 32 : raw > 512 ? 512 : raw;
}

/**
 * 이음매 없는 기질 타일 한 장을 워커에서 굽는다. 실패는 전부 `null`이다 — 호출자는
 * 실패 종류를 구분할 필요가 없고 열화 경로 하나만 갖는다.
 */
export async function requestStudioPaperSubstrateTileHeightsV1(
  request: StudioPaperSubstrateTileHostRequestV1,
  signal?: AbortSignal,
): Promise<StudioPaperSubstrateTileHeightsV1 | null> {
  const client = await resolveClient();
  if (!client) return null;
  const size = clampSize(request.size);
  const halo = Math.max(0, Math.min(8, Math.round(request.halo ?? 0)));
  let recipe: Awaited<
    ReturnType<
      typeof import("./studio-paper-substrate-recipe-v1")["createStudioPaperSubstrateRecipeV1"]
    >
  >;
  try {
    const { createStudioPaperSubstrateRecipeV1 } = await import(
      "./studio-paper-substrate-recipe-v1"
    );
    recipe = createStudioPaperSubstrateRecipeV1(request.kind, request.seed, {
      documentScale: request.documentScale,
      rotationRadians: request.rotationRadians,
      seamlessPeriod: size,
    });
  } catch {
    return null;
  }
  if (!recipe) return null;
  let result: Awaited<ReturnType<StudioProceduralMediaSurfaceWorkerClient["render"]>>;
  try {
    result = await client.render(
      {
        requestSequence: nextRequestSequence,
        engineEpoch: SUBSTRATE_ENGINE_EPOCH,
        recipe,
        region: { originX: 0, originY: 0, width: size, height: size, halo },
      },
      signal,
    );
  } catch {
    return null;
  } finally {
    nextRequestSequence += 1;
  }
  if (result.status !== "completed") return null;
  const { artifact } = result.receipt;
  const fieldWidth = size + halo * 2;
  if (
    artifact.width !== fieldWidth
    || artifact.height !== fieldWidth
    || artifact.heightField.length !== fieldWidth * fieldWidth
  ) return null;
  return Object.freeze({
    size,
    halo,
    fieldWidth,
    heightField: artifact.heightField,
    absorbency: artifact.absorbency,
    grain: artifact.grain,
    recipeFingerprint: recipe.fingerprint,
    execution: "dedicated-worker" as const,
  });
}

/** 테스트/HMR 정리용. 공유 클라이언트를 폐기하고 다음 요청에서 다시 만든다. */
export function disposeStudioPaperSubstrateTileHostV1(): void {
  sharedClient?.dispose();
  sharedClient = null;
  sharedClientUnavailable = false;
}
