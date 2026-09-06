import { useEffect, useRef, useState } from "react";

import { completeStudioServerText, getStudioServerAiStatus } from "../studio-server-ai-client";

import { downloadPromoRemotion } from "./promo-downloads";
import { downloadPromoBlob, importPromoPanel, promoRecorderMime, readPromoFile, recordPromoVideo } from "./promo-media";
import { emptyPromoProject, localPromoPlan, parsePromoAiPlan, parsePromoProject, PROMO_MAX_PANELS, PROMO_STYLES, PROMO_STYLE_LABELS, promoAiPrompt, promoDataUrl, promoSrt, promoTimeline } from "./promo-model";
import { PromoPanelEditor } from "./PromoPanelEditor";
import { PromoPreview } from "./PromoPreview";

import type { PromoPanel, PromoProject } from "./promo-model";

import "./promo-studio.css";

export function StudioPromoPage() {
  const [project, setProject] = useState<PromoProject>(emptyPromoProject);
  const [undo, setUndo] = useState<PromoProject | null>(null);
  const [phase, setPhase] = useState<"idle" | "import" | "ai" | "record">("idle");
  const [message, setMessage] = useState("컷을 추가하고 원하는 분위기를 골라보세요.");
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [aiStatus, setAiStatus] = useState("서버 AI 연결 확인 중");
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState<720 | 1080>(720);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = phase !== "idle";
  const mime = promoRecorderMime();
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    getStudioServerAiStatus(controller.signal).then((status) => {
      if (controller.signal.aborted) return;
      setConfigured(status.configured);
      setAiStatus(status.configured ? "서버 AI 사용 가능 · 로그인 필요" : "서버 AI 미설정 · 로컬 템플릿 사용 가능");
    }).catch(() => { if (!controller.signal.aborted) setAiStatus("AI 연결 확인 실패 · 로컬 템플릿 사용 가능"); });
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!project.panels.length) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [project.panels.length]);
  const apply = (next: PromoProject) => { setUndo(project); setProject(next); };
  const patch = (value: Partial<PromoProject>) => apply({ ...project, ...value });
  const start = (next: typeof phase): AbortController | null => {
    if (operation.current) return null;
    const controller = new AbortController();
    operation.current = controller;
    setPhase(next); setError(""); setProgress(0);
    return controller;
  };
  const failed = (reason: unknown, signal: AbortSignal) => {
    if (!mounted.current) return;
    if (signal.aborted) setMessage("작업을 취소했어요. 원본 프로젝트는 유지됩니다.");
    else setError(reason instanceof Error ? reason.message : "작업을 완료하지 못했어요.");
  };
  const finish = (controller: AbortController) => {
    if (operation.current === controller) operation.current = null;
    if (mounted.current) setPhase("idle");
  };
  const uploadPanels = async (files: FileList | null) => {
    if (!files?.length) return;
    const controller = start("import");
    if (!controller) return;
    try {
      if (project.panels.length + files.length > PROMO_MAX_PANELS) throw new Error(`최대 ${PROMO_MAX_PANELS}컷까지 추가할 수 있어요.`);
      const panels: PromoPanel[] = [];
      for (const file of Array.from(files)) panels.push(await importPromoPanel(file, project.panels.length + panels.length, controller.signal));
      if (!controller.signal.aborted) { patch({ panels: [...project.panels, ...panels] }); setMessage(`${panels.length}컷을 추가했어요. 컷 설명을 입력하면 AI가 더 정확하게 구성할 수 있어요.`); }
    } catch (reason) { failed(reason, controller.signal); } finally { finish(controller); }
  };
  const importProject = async (file: File | undefined) => {
    if (!file) return;
    const controller = start("import");
    if (!controller) return;
    try {
      if (file.size > 80_000_000) throw new Error("프로젝트 파일은 80MB 이하여야 해요.");
      const next = parsePromoProject(JSON.parse(await file.text()));
      if (!controller.signal.aborted) { apply(next); setMessage("프로젝트를 불러왔어요. 변경 전 상태는 실행 취소로 복원할 수 있어요."); }
    } catch (reason) { failed(reason, controller.signal); } finally { finish(controller); }
  };
  const uploadAudio = async (file: File | undefined) => {
    if (!file) return;
    const controller = start("import");
    if (!controller) return;
    try {
      if (file.size > 20_000_000 || !file.type.startsWith("audio/")) throw new Error("BGM은 20MB 이하 오디오 파일이어야 해요.");
      const src = promoDataUrl(await readPromoFile(file, controller.signal), "audio");
      if (!controller.signal.aborted) { patch({ audio: { src, volume: 0.25 } }); setMessage("BGM을 추가했어요. 영상 길이에 맞춰 반복하고 시작과 끝에 페이드를 적용해요."); }
    } catch (reason) { failed(reason, controller.signal); } finally { finish(controller); }
  };
  const generate = async () => {
    const controller = start("ai");
    if (!controller) return;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const prompt = promoAiPrompt(project);
      const result = await completeStudioServerText({ task: "composition", promptVersion: 1, ...prompt, operationId: `promo-${crypto.randomUUID()}` }, controller.signal);
      if (controller.signal.aborted) throw new DOMException("취소했어요.", "AbortError");
      if (!result.ok) throw new Error(result.error);
      const panels = parsePromoAiPlan(result.data.content, project);
      patch({ panels });
      setMessage(`AI 구성 적용 · ${result.data.provider} / ${result.data.model}. 컷 설명 기반 제안이며 원본 이미지는 전송하지 않았어요. 공개 전 자막과 순서를 검토해 주세요.`);
    } catch (reason) { failed(reason, controller.signal); } finally { clearTimeout(timeout); finish(controller); }
  };
  const exportVideo = async () => {
    const controller = start("record");
    if (!controller) return;
    try {
      const blob = await recordPromoVideo(project, { signal: controller.signal, onProgress: (value) => { if (mounted.current) setProgress(value); }, shortSide: quality });
      if (!controller.signal.aborted) { downloadPromoBlob(blob, `toonstudio-promo.${blob.type.includes("mp4") ? "mp4" : "webm"}`); setMessage("영상 파일을 저장했어요. 업로드 전 영상과 BGM을 재생해 확인해 주세요."); }
    } catch (reason) { failed(reason, controller.signal); } finally { finish(controller); }
  };
  const exportRemotion = () => {
    try { downloadPromoRemotion(project); setMessage("Remotion 프로젝트 ZIP을 저장했어요. 압축 해제 후 README의 명령으로 H.264 MP4를 렌더링할 수 있어요."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "프로젝트 내보내기에 실패했어요."); }
  };
  const movePanel = (index: number, direction: -1 | 1) => {
    const panels = [...project.panels];
    const target = index + direction;
    if (target < 0 || target >= panels.length) return;
    const current = panels[index];
    const neighbor = panels[target];
    if (!current || !neighbor) return;
    panels[index] = neighbor; panels[target] = current;
    patch({ panels });
  };
  return (
    <main className="promo-studio" aria-labelledby="promo-title">
      <header className="promo-header">
        <div><a href="/studio" className="promo-back">← 툰스튜디오</a><p className="promo-eyebrow">TOONSTUDIO · MOTION COMIC</p><h1 id="promo-title">당신의 웹툰을, 움직이는 예고편으로.</h1><p>컷을 올리고 이야기를 더하면, 홍보영상과 짧은 모션툰이 됩니다.</p></div>
        <span className="promo-badge">15 / 30 / 60초</span>
      </header>
      <div className="promo-workspace">
        <div className="promo-editing">
          <fieldset className="promo-card" disabled={busy}>
            <legend>01 · 영상 기획</legend>
            <label htmlFor="promo-work-title">작품 제목</label><input id="promo-work-title" value={project.title} maxLength={80} onChange={(event) => patch({ title: event.target.value })} />
            <label htmlFor="promo-synopsis">줄거리와 홍보 방향</label><textarea id="promo-synopsis" value={project.synopsis} maxLength={2000} rows={3} placeholder="어떤 독자에게, 어떤 매력을 보여주고 싶나요? 스포일러 제외 범위도 적어주세요." onChange={(event) => patch({ synopsis: event.target.value })} />
            <label htmlFor="promo-cta">마지막 2초의 안내 문구</label><input id="promo-cta" value={project.cta} maxLength={80} onChange={(event) => patch({ cta: event.target.value })} />
            <div className="promo-inline-grid">
              <label htmlFor="promo-ratio">화면 비율<select id="promo-ratio" value={project.ratio} onChange={(event) => patch({ ratio: event.target.value as PromoProject["ratio"] })}><option value="9:16">세로 9:16 · 쇼츠/릴스</option><option value="16:9">가로 16:9 · 예고편</option><option value="1:1">정사각형 1:1 · 피드</option></select></label>
              <label htmlFor="promo-seconds">전체 길이<select id="promo-seconds" value={project.seconds} onChange={(event) => patch({ seconds: Number(event.target.value) as PromoProject["seconds"] })}>{[15, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds}초</option>)}</select></label>
              <label htmlFor="promo-style">연출 분위기<select id="promo-style" value={project.style} onChange={(event) => patch({ style: event.target.value as PromoProject["style"] })}>{PROMO_STYLES.map((style) => <option key={style} value={style}>{PROMO_STYLE_LABELS[style]}</option>)}</select></label>
            </div>
          </fieldset>
          <section className="promo-card" aria-labelledby="promo-cuts-title">
            <div className="promo-section-head"><h2 id="promo-cuts-title">02 · 컷과 장면 구성</h2><span>{project.panels.length} / {PROMO_MAX_PANELS}컷</span></div>
            <label htmlFor="promo-panels" className="promo-upload-label">웹툰 컷 추가 · PNG, JPEG, WebP · 컷당 10MB 이하</label>
            <input id="promo-panels" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(event) => { void uploadPanels(event.target.files); event.target.value = ""; }} />
            <p className="promo-muted">긴 원고는 컷 단위로 잘라서 추가하세요. 이미지는 최대 2048px로 정리하며 원본 파일은 수정하지 않습니다.</p>
            <div className="promo-button-row">
              <button type="button" className="promo-primary" disabled={busy || !configured || !project.panels.length} onClick={() => void generate()}>AI로 홍보 콘티 구성</button>
              <button type="button" disabled={busy || !project.panels.length} onClick={() => { patch({ panels: localPromoPlan(project) }); setMessage("로컬 연출 템플릿을 적용했어요. AI 생성 결과가 아니며 네트워크 요청 없이 동작해요."); }}>로컬 연출 템플릿</button>
              <button type="button" disabled={busy || !undo} onClick={() => { if (undo) { setProject(undo); setUndo(null); setMessage("이전 구성을 복원했어요."); } }}>실행 취소</button>
            </div>
            <p className="promo-muted">{aiStatus}. AI에는 제목·줄거리·컷 설명·자막만 전송합니다. 서버의 기존 사용량 제한이 적용됩니다.</p>
            {!project.panels.length ? <div className="promo-empty">아직 컷이 없어요. 3~6컷으로 첫 번째 예고편을 만들어보세요.</div> : null}
            <div className="promo-shots">{promoTimeline(project).map((scene, index) => <PromoPanelEditor key={scene.panel.id} scene={scene} index={index} count={project.panels.length} disabled={busy} onChange={(value) => patch({ panels: project.panels.map((panel) => panel.id === scene.panel.id ? { ...panel, ...value } : panel) })} onMove={(direction) => movePanel(index, direction)} onRemove={() => patch({ panels: project.panels.filter((panel) => panel.id !== scene.panel.id) })} />)}</div>
          </section>
          <fieldset className="promo-card" disabled={busy}>
            <legend>03 · 배경음악</legend>
            <label htmlFor="promo-audio">BGM 파일 · 20MB / 3분 이하 · 사용 권한을 확보한 음원</label><input id="promo-audio" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/webm" onChange={(event) => { void uploadAudio(event.target.files?.[0]); event.target.value = ""; }} />
            {project.audio ? <div className="promo-button-row"><label htmlFor="promo-volume">BGM 음량 {Math.round(project.audio.volume * 100)}%<input id="promo-volume" type="range" min={0} max={1} step={0.05} value={project.audio.volume} onChange={(event) => { if (project.audio) patch({ audio: { ...project.audio, volume: Number(event.target.value) } }); }} /></label><button type="button" onClick={() => patch({ audio: null })}>BGM 제거</button></div> : <p className="promo-muted">BGM 없이도 영상을 만들 수 있어요. 음원 생성·음성 합성 기능은 포함하지 않습니다.</p>}
          </fieldset>
        </div>
        <aside className="promo-output">
          <PromoPreview project={project} disabled={busy} />
          <section className="promo-card" aria-labelledby="promo-export-title">
            <h2 id="promo-export-title">04 · 내보내기</h2>
            <label htmlFor="promo-quality">브라우저 영상 해상도<select id="promo-quality" value={quality} disabled={busy} onChange={(event) => setQuality(Number(event.target.value) as 720 | 1080)}><option value={720}>720p · 빠른 저장</option><option value={1080}>1080p · 높은 해상도</option></select></label>
            <button type="button" className="promo-primary promo-full" disabled={busy || !project.panels.length || !mime} onClick={() => void exportVideo()}>영상 저장 · {mime?.includes("mp4") ? "MP4" : "WebM"}</button>
            <p className="promo-muted">{mime ? "실시간 녹화 중 이 탭을 유지해 주세요. 다른 탭으로 이동하면 취소합니다. 정확한 프레임 렌더링·H.264 MP4는 Remotion을 사용하세요." : "이 브라우저는 영상 녹화를 지원하지 않아요. Remotion 프로젝트로 내보낼 수 있어요."}</p>
            <button type="button" className="promo-full" disabled={busy || !project.panels.length} onClick={exportRemotion}>Remotion 프로젝트 ZIP</button>
            <p className="promo-muted">원본 컷·BGM·자막·렌더 코드가 포함됩니다. 별도 Node.js 환경에서 MP4로 렌더링하며, 클라우드 서버나 유료 라이선스 구매는 자동 실행하지 않습니다.</p>
            <div className="promo-button-row">
              <button type="button" disabled={busy || !project.panels.length} onClick={() => downloadPromoBlob(new Blob([promoSrt(project)], { type: "text/plain;charset=utf-8" }), "toonstudio-captions.srt")}>자막 SRT</button>
              <button type="button" disabled={busy} onClick={() => downloadPromoBlob(new Blob([JSON.stringify(project)], { type: "application/json" }), "toonstudio-promo.json")}>프로젝트 JSON 저장</button>
            </div>
            <label htmlFor="promo-import">프로젝트 JSON 불러오기 (현재 구성 교체)</label><input id="promo-import" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { void importProject(event.target.files?.[0]); event.target.value = ""; }} />
            <p className="promo-muted">작업은 현재 탭 메모리에만 있습니다. 닫기 전에 프로젝트 JSON을 저장하세요. 미디어가 포함되므로 공유 대상을 확인하세요.</p>
          </section>
          <div className="promo-feedback" aria-live="polite" aria-atomic="true">
            {phase === "ai" ? <p>AI가 홍보 문구와 컷 순서를 구성하고 있어요.</p> : null}
            {phase === "import" ? <p>파일을 검사하고 불러오는 중이에요.</p> : null}
            {phase === "record" ? <><p>영상 저장 중 · {Math.round(progress * 100)}%</p><progress value={progress} max={1} aria-label="영상 저장 진행률" /></> : null}
            {!busy ? <p>{message}</p> : <button type="button" onClick={() => operation.current?.abort()}>작업 취소</button>}
          </div>
          {error ? <p className="promo-error" role="alert">{error}</p> : null}
        </aside>
      </div>
    </main>
  );
}
