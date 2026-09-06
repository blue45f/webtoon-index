import { useEffect, useRef, useState } from "react";

import { createStudioReferenceRebuildWorker } from "./studio-reference-rebuild-worker-client";

const PRESETS = [
  ["school-room", "채광 교실"],
  ["school-desk", "책걸상 세트"],
  ["library-room", "복층 아카이브"],
  ["bookcase", "몰딩 책장"],
  ["reading-table", "독서 테이블"],
  ["reading-chair", "패브릭 독서 의자"],
] as const;
const MAX_BYTES = 8 * 1024 * 1024;

type Props = {
  disabled: boolean;
  onFile: (file: File) => void;
  onBusyChange: (busy: boolean) => void;
};

export function StudioReferenceRebuildPresets({ disabled, onFile, onBusyChange }: Props) {
  const [selected, setSelected] = useState<string>(PRESETS[0][0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef<{ worker: Worker; timer: ReturnType<typeof setTimeout> } | null>(null);
  const latest = useRef({ disabled, onFile, onBusyChange });
  useEffect(() => { latest.current = { disabled, onFile, onBusyChange }; }, [disabled, onFile, onBusyChange]);

  const stop = (): void => {
    const active = operation.current;
    operation.current = null;
    if (active) {
      clearTimeout(active.timer);
      active.worker.terminate();
    }
    setBusy(false);
    latest.current.onBusyChange(false);
  };

  useEffect(() => () => {
    const active = operation.current;
    operation.current = null;
    if (active) {
      clearTimeout(active.timer);
      active.worker.terminate();
    }
  }, []);

  const build = (): void => {
    if (disabled || operation.current || !PRESETS.some(([id]) => id === selected)) return;
    const worker = createStudioReferenceRebuildWorker();
    if (!worker) {
      setMessage("모델 생성 Worker를 열지 못했습니다. 검토실의 GLB 저장을 이용해 주세요.");
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setMessage("브라우저에서 새 GLB 메시를 만드는 중입니다.");
    const fail = (detail: string): void => {
      if (operation.current?.worker !== worker) return;
      stop();
      setMessage(detail);
    };
    const timer = setTimeout(() => fail("모델 생성 시간이 초과되었습니다. 다시 시도해 주세요."), 30_000);
    operation.current = { worker, timer };
    worker.onerror = () => fail("모델 생성에 실패했습니다. 검토실에서 GLB를 저장해 가져올 수 있습니다.");
    worker.onmessageerror = () => fail("생성 결과를 읽지 못했습니다. 다시 시도해 주세요.");
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (operation.current?.worker !== worker) return;
      const data = event.data as { version?: unknown; type?: unknown; id?: unknown; bytes?: unknown } | null;
      if (!data || data.version !== 1 || data.type !== "built" || data.id !== selected
        || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength < 24 || data.bytes.byteLength > MAX_BYTES) {
        fail("유효한 GLB 생성 결과를 받지 못했습니다.");
        return;
      }
      const header = new DataView(data.bytes);
      if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
        || header.getUint32(8, true) !== data.bytes.byteLength || latest.current.disabled) {
        fail("모델을 전달할 수 없습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.");
        return;
      }
      const file = new File([data.bytes], `ToonStudio-${selected}-reference-rebuild.glb`, { type: "model/gltf-binary" });
      stop();
      try {
        latest.current.onFile(file);
        setMessage("기존 가져오기 경로로 전달했습니다. 안전 검사와 저장 결과는 모델 목록에서 확인하세요.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "모델을 전달하지 못했습니다.");
      }
    };
    worker.postMessage({ version: 1, type: "build", id: selected });
  };

  return (
    <details className="mt-3 rounded-xl border border-line bg-card/60">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-bold text-fg">
        미리보기 참고 재제작 · 교실과 도서관
      </summary>
      <div className="space-y-2 border-t border-line p-3">
        <p className="text-xs leading-relaxed text-fg-3">
          2개 장면과 재사용 모듈 4종입니다. ACON 원본 복원본이나 CC0 소재가 아닙니다.
          위 이용 권리 기록의 현재 선택으로 기존 가져오기·검증 경로에 전달합니다.
        </p>
        <label className="block text-xs font-semibold text-fg-2">
          재제작 모델
          <select value={selected} disabled={busy || disabled} onChange={(event) => setSelected(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-xs text-fg">
            {PRESETS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled && !busy} onClick={() => { if (busy) { stop(); setMessage("모델 생성을 취소했습니다."); } else build(); }}
          className="min-h-11 w-full rounded-lg border border-accent/50 bg-accent-soft px-3 text-xs font-bold text-accent disabled:opacity-50">
          {busy ? "생성 취소" : "GLB 생성 후 가져오기"}
        </button>
        <a className="inline-flex min-h-11 items-center text-xs font-semibold text-accent underline"
          href={`/assets/reference-rebuild/index.html?asset=${encodeURIComponent(selected)}`} target="_blank" rel="noopener noreferrer">
          실제 3D 검토실 열기 ↗
        </a>
        {message ? <p role="status" aria-live="polite" className="text-xs leading-relaxed text-fg-3">{message}</p> : null}
      </div>
    </details>
  );
}
