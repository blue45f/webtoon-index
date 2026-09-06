import { AdminNotice, AdminSpinner } from "./admin-ui";

import type { AdminGate } from "./admin-gate-state";

import { useT } from "@/shared/lib/i18n";

// 게이트 통과 전(로딩·비로그인·권한 없음·오류) 공용 안내 — 통과 시 null을 반환한다.
export function AdminGateFallback({ gate }: { gate: AdminGate }) {
  const t = useT();
  if (gate.kind === "loading") return <AdminSpinner />;
  if (gate.kind === "guest") {
    return (
      <AdminNotice
        title={t("admin.gate.guestTitle")}
        body={t("admin.gate.guestBody")}
      />
    );
  }
  if (gate.kind === "forbidden") {
    return (
      <AdminNotice
        title={t("admin.gate.forbiddenTitle")}
        body={t("admin.gate.forbiddenBody")}
      />
    );
  }
  if (gate.kind === "error") return <AdminNotice title={t("admin.gate.errorTitle")} body={gate.message} />;
  return null;
}
