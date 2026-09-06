import { useEffect, useState } from "react";

import { api } from "@/src/infrastructure/api";

// 런타임 앱 설정(GET /api/config). 광고형 수익화 on/off + 콘텐츠 노출 킬스위치를 읽는다.
// 수익화는 기본 OFF(관리자가 켜야 노출). 콘텐츠 플래그는 기본 ON(노출) — 관리자가 끄면 즉시 숨긴다.
// 안전 폴백: 설정 로드 실패 시 콘텐츠는 노출 유지(현재 동작 보존), 수익화는 OFF(광고 오노출 방지).
export interface AppConfig {
  monetizationEnabled: boolean;
  showCovers: boolean;
  showPricing: boolean;
  showAvailability: boolean;
  showSynopsis: boolean;
  showRelatedInfo: boolean;
}

const DEFAULTS: AppConfig = {
  monetizationEnabled: false,
  showCovers: true,
  showPricing: true,
  showAvailability: true,
  showSynopsis: true,
  showRelatedInfo: true,
};

// 모듈 스코프 캐시 — 앱 전체에서 한 번만 fetch한다. 여러 컴포넌트가 동시에 마운트돼도
// 같은 in-flight 프로미스를 공유하므로 재요청이 발생하지 않는다.
let cached: AppConfig | null = null;
let inflight: Promise<AppConfig> | null = null;

function loadAppConfig(): Promise<AppConfig> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = api
    .get<Partial<AppConfig>>("/config")
    .then((payload) => {
      cached = {
        // 수익화는 명시 true 일 때만 ON(안전: 광고 오노출 방지).
        monetizationEnabled: payload?.monetizationEnabled === true,
        // 콘텐츠 킬스위치는 명시 false 일 때만 OFF(안전: 설정에 없으면 노출 유지 = 현재 동작 보존).
        showCovers: payload?.showCovers !== false,
        showPricing: payload?.showPricing !== false,
        showAvailability: payload?.showAvailability !== false,
        showSynopsis: payload?.showSynopsis !== false,
        showRelatedInfo: payload?.showRelatedInfo !== false,
      };
      return cached;
    })
    .catch(() => {
      // 실패 시에도 안전한 기본값(수익화 OFF)으로 고정 — 광고가 잘못 노출되지 않게 한다.
      cached = DEFAULTS;
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// useAppConfig() — /api/config를 (모듈 캐시로) 단 한 번만 읽어 전역 토글을 반환한다.
// 로드 전: 수익화=false(안전), 콘텐츠 플래그=true(노출 유지 — 깜빡임 방지). 로드 후 설정을 반영한다.
export function useAppConfig(): AppConfig & { loading: boolean } {
  const [config, setConfig] = useState<AppConfig | null>(cached);

  useEffect(() => {
    if (config) return;
    let alive = true;
    loadAppConfig().then((next) => {
      if (alive) setConfig(next);
    });
    return () => {
      alive = false;
    };
  }, [config]);

  return {
    monetizationEnabled: config?.monetizationEnabled ?? false,
    showCovers: config?.showCovers ?? true,
    showPricing: config?.showPricing ?? true,
    showAvailability: config?.showAvailability ?? true,
    showSynopsis: config?.showSynopsis ?? true,
    showRelatedInfo: config?.showRelatedInfo ?? true,
    loading: config === null,
  };
}
