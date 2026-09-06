// AI 어시스트 설정 패널 — BYOK(Bring Your Own Key) 연결 정보 입력. studio-ai-client.ts의
// StudioAiSettings를 그대로 편집하는 완전히 제어되는(controlled) 프레젠테이션 패널이다 — 값과
// onChange를 부모(StudioPage.tsx)에서 받는다(studio-brand-kit "라이브러리 매니저" 자기완결형
// 패턴이 아니라, StudioImageAdjustmentsPanel 계열의 "모든 값을 prop으로 받는 얇은 패널" 컨벤션을
// 따른다) — 같은 팝오버 안의 배경 생성/구도 제안 패널이 설정 변경을 즉시(리마운트 없이) 반영해야
// 하기 때문이다(설정을 각 패널이 마운트 시점에 저장소에서 개별로 읽으면, 이 패널에서 방금
// 입력한 키를 옆 패널이 못 보는 stale-read 문제가 생긴다 — 부모가 단일 진실 공급원이어야 한다).
//
// "테스트" 버튼은 실제 네트워크 요청(Chat Completions, max_tokens:1)을 보낸다 — 아주 저렴하지만
// $0은 아니다(사용자 본인 키·본인 비용이므로 이 앱 입장에서는 여전히 $0).
import { CheckCircle2, Eye, EyeOff, Loader2, Settings2, XCircle } from "lucide-react";
import { useState } from "react";

import { testAiConnection, type StudioAiSettings } from "./studio-ai-client";

const LABEL = "block text-[0.65rem] font-medium text-fg-2";
const INPUT =
  "min-h-11 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type TestState = { status: "idle" } | { status: "busy" } | { status: "success"; latencyMs: number } | { status: "error"; message: string };

export function StudioAiSettingsPanel({
  settings,
  onChange,
}: {
  settings: StudioAiSettings;
  onChange: (next: StudioAiSettings) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  const patch = (partial: Partial<StudioAiSettings>) => onChange({ ...settings, ...partial });

  const runTest = async () => {
    if (testState.status === "busy") return;
    setTestState({ status: "busy" });
    const result = await testAiConnection(settings);
    setTestState(
      result.ok ? { status: "success", latencyMs: result.data.latencyMs } : { status: "error", message: result.error }
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
        <Settings2 size={14} />
        AI 어시스트 설정
      </div>
      <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
        직접 준비한 AI API 키를 입력하세요(OpenAI 또는 호환 서비스). 키는{" "}
        <span className="font-semibold text-fg-2">현재 탭 세션에만 임시 보관</span>되고 탭을 닫으면 삭제돼요.
        이 앱 서버로 보내지 않고 입력한 엔드포인트로 브라우저가 직접 요청합니다.
      </p>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>엔드포인트 baseURL</span>
        <input
          type="text"
          value={settings.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className={INPUT}
          spellCheck={false}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>API 키</span>
        <span className="relative flex items-center">
          <input
            type={showApiKey ? "text" : "password"}
            value={settings.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="sk-..."
            className={`${INPUT} pr-12`}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            aria-label={showApiKey ? "API 키 숨기기" : "API 키 표시"}
            className="absolute right-0 grid size-11 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
        {settings.apiKey ? (
          <button
            type="button"
            onClick={() => {
              patch({ apiKey: "" });
              setShowApiKey(false);
              setTestState({ status: "idle" });
            }}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-bad transition-colors hover:bg-bad/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad"
          >
            <XCircle size={14} aria-hidden /> 이 탭에서 키 지우기
          </button>
        ) : null}
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>이미지 모델</span>
          <input
            type="text"
            value={settings.imageModel}
            onChange={(e) => patch({ imageModel: e.target.value })}
            className={INPUT}
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>텍스트 모델</span>
          <input
            type="text"
            value={settings.textModel}
            onChange={(e) => patch({ textModel: e.target.value })}
            className={INPUT}
            spellCheck={false}
          />
        </label>
      </div>

      <details className="rounded-md border border-line bg-card/50 px-2 py-1.5 text-fg-3">
        <summary className="flex min-h-11 cursor-pointer select-none items-center text-xs font-medium text-fg-2">
          고급: 엔드포인트 경로 직접 지정
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>배경 생성(이미지 생성) 경로</span>
            <input
              type="text"
              value={settings.imageGenerationPath}
              onChange={(e) => patch({ imageGenerationPath: e.target.value })}
              className={INPUT}
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>자동 채색(이미지 편집) 경로</span>
            <input
              type="text"
              value={settings.imageEditPath}
              onChange={(e) => patch({ imageEditPath: e.target.value })}
              className={INPUT}
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>구도 제안(채팅 완성) 경로</span>
            <input
              type="text"
              value={settings.chatCompletionsPath}
              onChange={(e) => patch({ chatCompletionsPath: e.target.value })}
              className={INPUT}
              spellCheck={false}
            />
          </label>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testState.status === "busy"}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-medium text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {testState.status === "busy" ? <Loader2 size={13} className="animate-spin" /> : <Settings2 size={13} />}
          연결 테스트
        </button>
        {testState.status === "success" && (
          <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-good">
            <CheckCircle2 size={13} /> 연결됨 ({testState.latencyMs}ms)
          </span>
        )}
        {testState.status === "error" && (
          <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-bad">
            <XCircle size={13} /> {testState.message}
          </span>
        )}
      </div>
    </div>
  );
}
