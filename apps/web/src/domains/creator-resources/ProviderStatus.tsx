import { useEffect, useState } from "react";

import type { ProviderAvailability } from "@/shared/lib/creator-resource-workflow";
import type { ResourceProvider } from "@/shared/lib/creator-resources";

import { parseProviderAvailability } from "@/shared/lib/creator-resource-workflow";
import { RESOURCE_LABELS } from "@/shared/lib/creator-resources";
import { apiPath } from "@/src/infrastructure/api";

export function ProviderStatus({ provider }: { provider?: ResourceProvider }) {
  const [entries, setEntries] = useState<ProviderAvailability[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    let disposed = false;
    void fetch(apiPath("/api/creator-resources/providers"), { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("configuration_unavailable");
        const value = parseProviderAvailability(await response.json());
        if (!value) throw new Error("configuration_invalid");
        if (!disposed) setEntries(value);
      }).catch(() => { if (!disposed) setFailed(true); })
      .finally(() => window.clearTimeout(timer));
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, []);
  return <section aria-label="데이터 제공처 설정 상태" className="rounded-xl border border-line bg-panel p-4 text-sm leading-7">
    <p className="font-semibold">검색 제공처 설정</p>
    <div role="status">
      {failed ? <p className="text-fg-2">설정 상태를 확인하지 못했습니다. 검색을 다시 시도하거나 공식 사이트를 확인하세요.</p>
        : entries ? entries.filter((entry) => !provider || entry.provider === provider).map((entry) =>
          <p key={entry.provider}>{RESOURCE_LABELS[entry.provider]} · {entry.availability === "keyless" ? "인증키 없이 검색 가능" : entry.availability === "configured" ? "서버 인증키 설정됨" : "서버 인증키 미설정"}</p>)
          : <p className="text-fg-2">설정 상태 확인 중…</p>}
    </div>
    <p className="text-xs text-fg-2">인증키 설정 여부만 표시합니다. 실제 연결 성공·이용권한·잔여 쿼터를 보증하지 않습니다.</p>
  </section>;
}
