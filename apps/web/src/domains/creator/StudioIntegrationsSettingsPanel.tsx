// 연동 설정 통합 패널 — API 키를 등록해야 하는 모든 BYOK(Bring Your Own Key) 기능을 한 곳에서
// 관리한다. 이전에는 두 곳을 따로 오가야 했다: (1) AI 어시스트 팝오버 맨 위에 인라인으로 펼쳐져
// 있던 StudioAiSettingsPanel(baseURL/API키/이미지·텍스트 모델/엔드포인트 경로 — 배경생성·자동채색·
// 캐릭터 일관성 생성·구도 제안·대사 번역·시나리오 자동 생성이 전부 studio-ai-client.ts의 이 설정
// 하나를 공유한다), (2) 스톡 사진 팝오버 안에 내장돼 있던 Unsplash Access Key 입력
// <details>(studio-stock-image-client.ts). 이 패널이 그 둘을 세로로 배치한 단일 화면으로 합쳐,
// "API 키 등록"이라는 같은 작업을 위해 사용자가 여러 팝오버를 오갈 필요가 없게 한다.
//
// StudioPage.tsx의 "연동 설정" 툴바 버튼과, AI 어시스트 팝오버 안의 "AI 어시스트 설정" 진입점
// 버튼 둘 다 이 패널을 연다(같은 menu==="integrations" 상태를 공유) — 진입점이 여러 개여도 실제
// 설정 화면은 하나뿐이라는 게 이번 통합의 핵심이다.
//
// 로직 재구현 금지 원칙: 이 파일은 새 상태 관리 로직을 만들지 않는다.
//   - AI 어시스트 섹션은 기존 StudioAiSettingsPanel을 그대로 합성(재사용)한다 — 폼 필드·"연결 테스트"
//     버튼 로직을 여기서 복제하지 않는다. settings/onChange는 StudioPage.tsx가 소유한 단일 진실
//     공급원(aiSettings state)을 그대로 받아 내려보낸다(AI 배경생성/캐릭터 일관성/구도 제안 패널과
//     설정 변경이 즉시 동기화되어야 하기 때문 — StudioAiSettingsPanel.tsx 상단 주석 참고).
//   - 스톡 이미지 섹션은 StudioStockImagePanel.tsx에 있던 Access Key 입력 UI를 그대로 옮겨왔다(그
//     패널은 이제 이 통합 패널을 열도록 안내만 한다). load/save/isConfigured 함수는
//     studio-stock-image-client.ts 걸 그대로 재사용한다 — 이 통합 패널이 유일한 소유자가 되었으므로
//     StudioStockImagePanel.tsx처럼 스스로 상태를 들고 있는다(부모로 끌어올리지 않는다 — 이 패널과
//     스톡 사진 검색 패널은 menu가 단일 값이라 동시에 열리지 않으므로, 마운트 시점 재로드만으로
//     충분하다).
import { CheckCircle2, Eye, EyeOff, ExternalLink, Images } from "lucide-react";
import { useEffect, useState } from "react";

import { StudioAiSettingsPanel } from "./ai/StudioAiSettingsPanel";
import {
  discardLegacyStudioStockImageAccessKey,
  isStudioStockImageConfigured,
  loadStudioStockImageAccessKey,
  saveStudioStockImageAccessKey,
  STUDIO_STOCK_IMAGE_DEVELOPER_SIGNUP_URL,
} from "./studio-stock-image-client";

import type { StudioAiSettings } from "./ai/studio-ai-client";

const LABEL = "block text-[0.65rem] font-medium text-fg-2";
const INPUT =
  "min-h-11 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface StudioIntegrationsSettingsPanelProps {
  aiSettings: StudioAiSettings;
  onAiSettingsChange: (next: StudioAiSettings) => void;
}

function browserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const scope = globalThis as typeof globalThis & Partial<
      Pick<Window, "localStorage" | "sessionStorage">
    >;
    return scope[kind] ?? null;
  } catch {
    return null;
  }
}

export function StudioIntegrationsSettingsPanel({ aiSettings, onAiSettingsChange }: StudioIntegrationsSettingsPanelProps) {
  const [accessKey, setAccessKey] = useState(() =>
    loadStudioStockImageAccessKey(browserStorage("sessionStorage")),
  );
  const [showAccessKey, setShowAccessKey] = useState(false);
  const stockImageConfigured = isStudioStockImageConfigured(accessKey);

  useEffect(() => {
    discardLegacyStudioStockImageAccessKey(browserStorage("localStorage"));
  }, []);

  function updateAccessKey(next: string) {
    setAccessKey(next);
    saveStudioStockImageAccessKey(browserStorage("sessionStorage"), next);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.63rem] leading-relaxed text-fg-3">
        API 키가 필요한 기능을 한 곳에서 관리해요. AI 키와 Unsplash 키는 현재 탭 세션에만
        저장되며 어느 키도 이 앱 서버로 전송하지 않아요.
      </p>

      <StudioAiSettingsPanel settings={aiSettings} onChange={onAiSettingsChange} />

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
          <Images size={14} />
          무료 스톡 이미지 (Unsplash)
        </div>
        <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
          무료 Unsplash 계정으로 Access Key를 발급받아 입력하면 스톡 사진을 검색해 캔버스에 바로 삽입할 수
          있어요. 키는 <span className="font-semibold text-fg-2">현재 탭 세션에만</span> 저장되고, 이 앱
          서버로는 전송되지 않아요 — 검색은 브라우저가 Unsplash로 직접 요청해요.{" "}
          <a
            href={STUDIO_STOCK_IMAGE_DEVELOPER_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
          >
            키 발급받기 <ExternalLink size={9} />
          </a>
        </p>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Unsplash Access Key</span>
          <span className="relative flex items-center">
            <input
              type={showAccessKey ? "text" : "password"}
              value={accessKey}
              onChange={(e) => updateAccessKey(e.target.value)}
              placeholder="Access Key"
              className={`${INPUT} pr-12`}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowAccessKey((v) => !v)}
              aria-label={showAccessKey ? "Access Key 숨기기" : "Access Key 표시"}
              className="absolute right-0 grid size-11 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {showAccessKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>

        {stockImageConfigured && (
          <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-good">
            <CheckCircle2 size={13} /> Access Key 등록됨
          </span>
        )}
      </div>
    </div>
  );
}
