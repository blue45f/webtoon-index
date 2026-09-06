/**
  type PropAttachmentConfig,
 * Studio VRM poser view slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this component destructures the original local names.
 */
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Sparkles,
  WandSparkles,
  X,
  Webcam,
} from "lucide-react";

import {
  PROP_CATEGORY_LABELS,
} from "./studio-vrm-poser-catalogs";
import {
  cx,
} from "./studio-vrm-poser-helpers";
import {
  hasStudioVrmWebcamSessionConsent,
  rememberStudioVrmWebcamSessionConsent,
} from "./studio-vrm-poser-preferences-sqlite"; // session-only key: "studio_webcam_consent"
import {
  DEFAULT_BONE_OFFSETS,
  SCENE_PROPS,
} from "./studio-vrm-procedural-scene-props";
import {
  propDefById,
} from "./studio-vrm-props";
import type {
  ScenePropAttachmentConfig as PropAttachmentConfig,
} from "./studio-vrm-scene-props";
import type {
  TrackingOptions,
} from "./studio-vrm-webcam-tracking";
import {
  CONTROL_BUTTON,
} from "./StudioVrmPoserTypes";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type {
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

export function StudioVrmPoserPanelBodyD({ h }: { h: StudioVrmPoserHost }) {
  const {
    vrm,
    activeProps,
    setActiveProps,
    propAttachments,
    setPropAttachments,
    selectedPropId,
    setSelectedPropId,
    vrmPhysics,
    physicsPreview,
    setPhysicsPreview,
    springJointCount,
    webcamActive,
    setWebcamActive,
    webcamLoading,
    webcamError,
    setWebcamError,
    webcamErrorStage,
    setWebcamErrorStage,
    showConsent,
    setShowConsent,
    webcamConsentGranted,
    setWebcamConsentGranted,
    faceDetected,
    trackingOptions,
    setTrackingOptions,
    browserPermissionState,
    setBrowserPermissionState,
    calibrating,
    calibrationCountdown,
    calibrationProgress,
    calibrated,
    calibrationPersistenceStatus,
    calibrationPersistenceMessage,
    faceLostLong,
    videoRef,
    handlePanelTabChange,
    hideOnTab,
    handleStartCalibration,
    handleClearCalibration,
    handleCapturePose,
    updatePhysics,
    resettlePhysics,
    resetPhysics,
  } = h;
  return (
              <>
              <details hidden={hideOnTab("scene")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <WandSparkles size={15} className="text-accent" aria-hidden />
                  흔들림 물리 (머리카락·치마)
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                {springJointCount === 0 ? (
                  <p className="rounded-lg border border-dashed border-line/70 bg-card/40 px-2.5 py-2 text-[0.68rem] text-fg-3">
                    {vrm ? "이 모델에는 흔들림 뼈 정보가 없어요." : "모델을 먼저 불러오세요."}
                  </p>
                ) : (
                  <>
                    <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                      흔들림 뼈 {springJointCount}개. 강도·중력·바람을 조절하면 정착된 정지 컷에 반영됩니다.
                    </p>
                    <div className="space-y-2.5">
                      <label className="block text-[0.68rem] text-fg-2">
                        <span className="flex justify-between"><span>흔들림 강도(탄성)</span><span>{vrmPhysics.stiffnessScale.toFixed(2)}</span></span>
                        <input
                          type="range" min="0" max="2" step="0.05"
                          aria-label="흔들림 강도(탄성)"
                          className="w-full accent-accent h-2"
                          value={vrmPhysics.stiffnessScale}
                          onChange={(e) => updatePhysics({ stiffnessScale: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block text-[0.68rem] text-fg-2">
                        <span className="flex justify-between"><span>중력</span><span>{vrmPhysics.gravityScale.toFixed(2)}</span></span>
                        <input
                          type="range" min="0" max="2" step="0.05"
                          aria-label="중력"
                          className="w-full accent-accent h-2"
                          value={vrmPhysics.gravityScale}
                          onChange={(e) => updatePhysics({ gravityScale: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block text-[0.68rem] text-fg-2">
                        <span className="flex justify-between"><span>바람 방향</span><span>{Math.round(vrmPhysics.windDirectionDeg)}°</span></span>
                        <input
                          type="range" min="-180" max="180"
                          aria-label="바람 방향"
                          className="w-full accent-accent h-2"
                          value={vrmPhysics.windDirectionDeg}
                          onChange={(e) => updatePhysics({ windDirectionDeg: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block text-[0.68rem] text-fg-2">
                        <span className="flex justify-between"><span>바람 세기</span><span>{vrmPhysics.windStrength.toFixed(2)}</span></span>
                        <input
                          type="range" min="0" max="2" step="0.05"
                          aria-label="바람 세기"
                          className="w-full accent-accent h-2"
                          value={vrmPhysics.windStrength}
                          onChange={(e) => updatePhysics({ windStrength: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        className={cx(
                          CONTROL_BUTTON,
                          "flex-1",
                          physicsPreview
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => setPhysicsPreview((p: boolean) => !p)}
                      >
                        {physicsPreview ? "미리보기 끄기" : "흔들림 미리보기"}
                      </button>
                      <button
                        type="button"
                        className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                        onClick={resettlePhysics}
                      >
                        정착 다시
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mt-2 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised"
                      onClick={resetPhysics}
                    >
                      물리 초기화
                    </button>
                  </>
                )}
              </details>

              {/* ── 웹캠 실시간 페이스 트래킹 ───────────────────────────── */}
              <details hidden={hideOnTab("face")} className="group mt-4 rounded-xl border border-line bg-card/45 p-3">
                <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Webcam size={15} className="text-accent" aria-hidden />
                  웹캠 실시간 페이스 트래킹
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                {!vrm ? (
                  <p className="rounded-lg border border-dashed border-line/70 bg-card/40 px-2.5 py-2 text-[0.68rem] text-fg-3">
                    모델을 먼저 불러오세요.
                  </p>
                ) : (
                  <>
                    <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                      내 행동이나 표정을 실시간으로 따라하게 만듭니다. 포즈 캡처를 클릭하면 현재 표정과 머리 각도가 저장됩니다.
                    </p>

                    {webcamActive && (
                      <div className="relative mx-auto mb-3 aspect-video max-h-[28dvh] w-full max-w-[min(100%,16rem)] overflow-hidden rounded-lg border border-line bg-black sm:max-h-none sm:max-w-none">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className={cx(
                            "h-full w-full object-cover",
                            trackingOptions.mirrorMode ? "scale-x-[-1]" : ""
                          )}
                        />
                        <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.66rem] font-bold text-white">
                          <span
                            className={cx(
                              "size-1.5 rounded-full",
                              faceDetected ? "bg-green-500 animate-pulse" : "bg-red-500"
                            )}
                          />
                          {faceDetected ? "얼굴 감지됨" : "얼굴 감지 중..."}
                        </div>
                        {faceLostLong && (
                          <div
                            className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 text-center text-[0.66rem] font-semibold text-amber-300"
                            role="status"
                          >
                            얼굴이 보이지 않아요 — 카메라 정면에 위치해 주세요
                          </div>
                        )}
                        {calibrating && (
                          <div
                            className="absolute inset-0 grid place-items-center bg-black/45 px-3 text-center"
                            role="status"
                            aria-live="polite"
                          >
                            <p className="text-[0.72rem] font-bold leading-relaxed text-white">
                              {calibrationCountdown > 0
                                ? `정면을 보고 무표정을 유지하세요… ${calibrationCountdown}`
                                : `측정 중… ${Math.round(calibrationProgress * 100)}%`}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {webcamLoading && (
                      <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-card/50 py-4 text-xs text-fg-2">
                        <Loader2 className="animate-spin text-accent" size={16} />
                        AI 트래킹 모델 및 카메라 로딩 중...
                      </div>
                    )}

                    {/* 선제적 권한 상태 경고 배너 */}
                    {!webcamActive && !webcamError && typeof window !== "undefined" && (
                      <>
                        {!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-500 mb-3 leading-relaxed">
                            <AlertTriangle className="shrink-0 mt-0.5" size={14} />
                            <div>
                              <p className="font-semibold mb-1 text-[0.72rem]">⚠️ 비보안 환경 접속 (카메라 비활성화)</p>
                              <p className="text-[0.65rem] opacity-90 text-left">
                                현재 비보안(HTTP) 주소로 접속 중입니다. 브라우저 정책상 웹캠은 HTTPS 또는 localhost 에서만 동작합니다.
                                <br />
                                {window.location.protocol === "https:" ? "" : (
                                  window.location.hostname.includes("vercel") || window.location.hostname.includes("toonspectrum")
                                    ? `현재 URL을 https:// 로 시작하게 변경하거나 ${window.location.origin.replace("http:", "https:")}${window.location.pathname} 로 접속하세요.`
                                    : `로컬 개발 시 http://localhost:5173 (또는 현재 dev 서버)로 직접 접속. 운영 환경은 HTTPS(${window.location.hostname.includes(".") ? "현재 도메인" : "https://www.toonstudio.cloud/studio"})로 접속하세요.`
                                )}
                              </p>
                            </div>
                          </div>
                        )}
                        {window.isSecureContext && browserPermissionState === "denied" && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-500 mb-3 leading-relaxed">
                            <AlertTriangle className="shrink-0 mt-0.5" size={14} />
                            <div className="flex-1">
                              <p className="font-semibold mb-1 text-[0.72rem]">⚠️ 카메라 권한 차단됨 (팝업이 뜨지 않음)</p>
                              <p className="text-[0.65rem] opacity-90 text-left mb-1.5">
                                브라우저 UI에서는 허용한 것처럼 보이지만, 여전히 즉시 차단됩니다. (두 단계 권한 모두 확인 필요)
                              </p>
                              <ol className="list-decimal pl-4 text-[0.68rem] space-y-0.5 opacity-95">
                                <li>이 사이트 <strong>정확한 주소</strong>(https://www.toonstudio.cloud) 에서 브라우저 '자물쇠' → 카메라 '허용' (localhost와 별개)</li>
                                <li><strong>macOS 시스템:</strong> 시스템 설정 → 개인정보 보호 및 보안 → 카메라 → 브라우저 앱 스위치 <strong>켜기</strong></li>
                                <li>설정 바꾼 후 브라우저 완전 종료 → 재시작 → 이 페이지 F5</li>
                              </ol>
                              <button
                                type="button"
                                className="mt-2 rounded border border-line bg-card px-2.5 py-1 text-[0.65rem] text-fg-2 hover:bg-raised hover:text-fg"
                                onClick={() => handlePanelTabChange("pose")}
                              >
                                웹캠 없이 포즈 프리셋 사용
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {webcamError && (
                      <div className="flex flex-col gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-500 mb-3 leading-relaxed">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="shrink-0 mt-0.5" size={14} />
                          <div>
                            <p className="font-semibold mb-1 text-[0.72rem]">
                              {webcamErrorStage === "engine"
                                ? "동작 인식 엔진 오류"
                                : "카메라 권한 및 연결 오류"}
                            </p>
                            <p className="whitespace-pre-line text-[0.65rem] opacity-90">{webcamError}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 pl-6">
                          <button
                            type="button"
                            className="rounded border border-red-500/40 px-2.5 py-1 text-[0.65rem] hover:bg-red-500/10"
                            onClick={() => {
                              setWebcamError(null);
                              setWebcamErrorStage(null);
                              setWebcamActive(true);
                            }}
                          >
                            다시 시도
                          </button>
                          {webcamErrorStage !== "engine" ? (
                            <button
                              type="button"
                              className="rounded border border-red-500/40 px-2.5 py-1 text-[0.65rem] hover:bg-red-500/10"
                              onClick={() => {
                                // Re-check permission state
                                setBrowserPermissionState("prompt");
                                setWebcamError(null);
                                setWebcamErrorStage(null);
                              }}
                            >
                              권한 상태 재확인
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded border border-line bg-card px-2.5 py-1 text-[0.65rem] text-fg-2 hover:bg-raised hover:text-fg"
                            onClick={() => handlePanelTabChange("pose")}
                          >
                            웹캠 없이 포즈 프리셋 사용
                          </button>
                        </div>
                      </div>
                    )}

                    {showConsent && !webcamActive && (
                      <div className="rounded-lg border border-accent/25 bg-accent-soft/30 p-3 mb-3 text-[0.68rem] leading-relaxed text-fg-2 mt-3">
                        <p className="font-bold mb-1.5 flex items-center gap-1 text-accent">
                          🔒 개인정보 보호 및 카메라 활성화 안내
                        </p>
                        <div className="mb-2.5 text-fg-3 leading-relaxed text-[0.65rem] space-y-1">
                          <p>웹캠 실시간 페이스 트래킹을 이용하려면 카메라 권한 허용이 필요합니다.</p>
                          <p className="text-fg font-semibold mt-1">촬영되는 모든 영상은 외부 서버로 전송되지 않으며,</p>
                          <p>사용자 기기 내부에서 실시간 AI 모델에 의해 로컬로만 분석 처리되어 프라이버시가 안전하게 보호됩니다.</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded bg-accent px-3 py-1.5 text-white font-semibold hover:bg-accent/90 cursor-pointer text-xs"
                            onClick={() => {
                              rememberStudioVrmWebcamSessionConsent();
                              setWebcamConsentGranted(true);
                              setShowConsent(false);
                              setWebcamActive(true);
                            }}
                          >
                            동의하고 카메라 켜기
                          </button>
                          <button
                            type="button"
                            className="rounded border border-line bg-card px-3 py-1.5 text-fg-2 hover:bg-raised cursor-pointer text-xs"
                            onClick={() => setShowConsent(false)}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}

                    {!webcamLoading && !showConsent && (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={cx(
                              CONTROL_BUTTON,
                              "flex-1",
                              webcamActive
                                ? "border-red-500/35 bg-red-500/10 text-red-500 hover:bg-red-500/15"
                                : "border-accent/55 bg-accent-soft text-accent hover:bg-accent-soft/80"
                            )}
                            onClick={() => {
                              if (webcamActive) {
                                setWebcamActive(false);
                              } else {
                                setWebcamError(null);
                                if (
                                  webcamConsentGranted
                                  || hasStudioVrmWebcamSessionConsent()
                                ) {
                                  setWebcamActive(true);
                                } else {
                                  setShowConsent(true);
                                }
                              }
                            }}
                          >
                            {webcamActive ? "트래킹 중지" : "트래킹 시작"}
                          </button>

                          {webcamActive && (
                            <button
                              type="button"
                              className={cx(
                                CONTROL_BUTTON,
                                "flex-1 border-accent/50 bg-accent text-on-accent hover:bg-accent/90"
                              )}
                              onClick={handleCapturePose}
                              disabled={!faceDetected}
                            >
                              포즈 · 표정 캡처
                            </button>
                          )}
                        </div>

                        {webcamActive && (
                          <div className="mt-2.5 space-y-2.5 rounded-lg border border-line/60 bg-card/20 p-2">
                            <label className="flex cursor-pointer items-center justify-between text-[0.6875rem] text-fg-2">
                              <span>거울 모드 (좌우 반전)</span>
                              <input
                                type="checkbox"
                                className="accent-accent"
                                checked={trackingOptions.mirrorMode}
                                onChange={(e) =>
                                  setTrackingOptions((prev: TrackingOptions) => ({ ...prev, mirrorMode: e.target.checked }))
                                }
                              />
                            </label>
                            <label className="flex cursor-pointer items-center justify-between text-[0.6875rem] text-fg-2">
                              <span>시선 고정 (정면 바라보기)</span>
                              <input
                                type="checkbox"
                                className="accent-accent"
                                checked={trackingOptions.gazeLock}
                                onChange={(e) =>
                                  setTrackingOptions((prev: TrackingOptions) => ({ ...prev, gazeLock: e.target.checked }))
                                }
                              />
                            </label>
                            <label className="flex cursor-pointer items-center justify-between text-[0.6875rem] text-fg-2">
                              <span>손가락 추적 (재시작 시 적용)</span>
                              <input
                                type="checkbox"
                                className="accent-accent"
                                checked={trackingOptions.fingerTracking}
                                onChange={(e) =>
                                  setTrackingOptions((prev: TrackingOptions) => ({ ...prev, fingerTracking: e.target.checked }))
                                }
                              />
                            </label>
                            <div className="block text-[0.68rem] text-fg-2">
                              <label htmlFor="tracking-sensitivity" className="flex justify-between mb-1">
                                <span>트래킹 감도</span>
                                <span>{trackingOptions.sensitivity.toFixed(1)}x</span>
                              </label>
                              <input
                                id="tracking-sensitivity"
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.1"
                                className="w-full accent-accent h-2"
                                value={trackingOptions.sensitivity}
                                onChange={(e) =>
                                  setTrackingOptions((prev: TrackingOptions) => ({ ...prev, sensitivity: Number(e.target.value) }))
                                }
                              />
                            </div>
                            <div className="block text-[0.68rem] text-fg-2 mt-2">
                              <label htmlFor="tracking-smoothing" className="flex justify-between mb-1">
                                <span>트래킹 부드러움</span>
                                <span>{Math.round((1 - trackingOptions.smoothing) * 100)}%</span>
                              </label>
                              <input
                                id="tracking-smoothing"
                                type="range"
                                min="0.05"
                                max="1.0"
                                step="0.05"
                                className="w-full accent-accent h-2"
                                value={trackingOptions.smoothing}
                                onChange={(e) =>
                                  setTrackingOptions((prev: TrackingOptions) => ({ ...prev, smoothing: Number(e.target.value) }))
                                }
                              />
                            </div>
                            <div className="space-y-1.5 border-t border-line/60 pt-2.5 text-[0.68rem] text-fg-2">
                              <div className="flex items-center justify-between">
                                <span>
                                  정면 캘리브레이션
                                  {calibrated && !calibrating ? " · 적용됨" : ""}
                                  {calibrationPersistenceStatus === "sqlite" && calibrated
                                    ? " · SQLite 저장됨"
                                    : ""}
                                  {calibrationPersistenceStatus === "saving" ? " · 저장 중" : ""}
                                  {calibrationPersistenceStatus === "memory" ? " · 현재 탭만" : ""}
                                </span>
                                {calibrated && !calibrating && (
                                  <button
                                    type="button"
                                    className="rounded border border-line px-2 py-0.5 text-[0.66rem] text-fg-3 hover:bg-raised hover:text-fg"
                                    onClick={handleClearCalibration}
                                  >
                                    초기화
                                  </button>
                                )}
                              </div>
                              {calibrating ? (
                                <p className="rounded bg-accent-soft/40 px-2 py-1.5 font-semibold text-accent" role="status">
                                  {calibrationCountdown > 0
                                    ? `정면을 보고 무표정을 유지하세요… ${calibrationCountdown}`
                                    : `측정 중… ${Math.round(calibrationProgress * 100)}%`}
                                </p>
                              ) : (
                                <button
                                  type="button"
                                  className={cx(CONTROL_BUTTON, "w-full border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                                  onClick={handleStartCalibration}
                                  disabled={!faceDetected}
                                >
                                  {calibrated ? "다시 캘리브레이션" : "정면 캘리브레이션"}
                                </button>
                              )}
                              <p className="text-[0.64rem] leading-relaxed text-fg-3">
                                정면·무표정 기준으로 머리 각도와 시선, 눈 크기를 보정합니다. 비스듬히 앉아도 정면 응시가 유지됩니다.
                              </p>
                              {calibrationPersistenceMessage && (
                                <p
                                  className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[0.64rem] leading-relaxed text-amber-700 dark:text-amber-300"
                                  role="status"
                                >
                                  {calibrationPersistenceMessage}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </details>

              <details hidden={hideOnTab("props")} className="group mt-3 rounded-xl border border-line bg-card/35">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm font-bold text-fg [&::-webkit-details-marker]:hidden">
                  <Sparkles size={15} className="text-accent" aria-hidden />
                  주변 장면 오브젝트
                  {activeProps.length > 0 && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.62rem] text-accent">{activeProps.length}</span>}
                  <ChevronDown size={14} className="ml-auto text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <div className="border-t border-line/40 px-3 pb-3 pt-2.5">
                  <p className="mb-3 text-[0.68rem] leading-relaxed text-fg-3">
                    동물·효과·장면 장식을 월드에 놓거나 본에 연결합니다. 손에 쥐는 소품은 위의 스마트 그립을 사용하세요.
                  </p>
                {(["animal", "item", "effect"] as const).map((cat) => {
                  const items = SCENE_PROPS.filter((p) => p.category === cat && !(cat === "item" && propDefById(p.id)));
                  if (items.length === 0) return null;
                  return (
                    <div key={cat} className="mb-3">
                      <p className="mb-1.5 text-[0.65rem] font-bold text-fg-2">{PROP_CATEGORY_LABELS[cat]}</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {items.map((prop) => {
                          const isActive = activeProps.includes(prop.id);
                          const isSelected = selectedPropId === prop.id;
                          return (
                            <button
                              key={prop.id}
                              type="button"
                              aria-pressed={isActive}
                              aria-label={`${prop.label}${isActive ? " 편집" : " 추가"}`}
                              className={cx(
                                "flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center transition-colors relative",
                                isActive
                                  ? isSelected
                                    ? "border-accent bg-accent text-on-accent ring-2 ring-accent/40"
                                    : "border-accent/60 bg-accent-soft text-accent ring-1 ring-accent/30"
                                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                              )}
                              onClick={() => {
                                setActiveProps((prev: string[]) => prev.includes(prop.id) ? prev : [...prev, prop.id]);
                                setSelectedPropId(prop.id);
                              }}
                            >
                              <span className="text-base leading-none" aria-hidden>{prop.emoji}</span>
                              <span className="text-[0.68rem] font-semibold leading-tight">{prop.label}</span>
                              {isActive && (
                                <span 
                                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent"
                                  aria-hidden
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {activeProps.length > 0 && (
                  <button
                    type="button"
                    className="mt-1 w-full rounded-lg border border-line bg-card py-1.5 text-xs text-fg hover:bg-raised"
                    onClick={() => {
                      setActiveProps([]);
                      setSelectedPropId(null);
                    }}
                  >
                    주변 오브젝트 모두 제거
                  </button>
                )}

                {selectedPropId && activeProps.includes(selectedPropId) && (() => {
                  const prop = SCENE_PROPS.find((p) => p.id === selectedPropId);
                  if (!prop) return null;
                  const config = propAttachments[selectedPropId] || {
                    bone: "none",
                    offsetX: 0,
                    offsetY: 0,
                    offsetZ: 0,
                    rotX: 0,
                    rotY: 0,
                    rotZ: 0,
                    scale: 1,
                  };

                  const handleConfigChange = (patch: Partial<PropAttachmentConfig>) => {
                    setPropAttachments((prev: Record<string, PropAttachmentConfig>) => ({
                      ...prev,
                      [selectedPropId]: { ...config, ...patch },
                    }));
                  };

                  return (
                    <div className="mt-3 space-y-3 rounded-xl border border-accent/40 bg-accent-soft/20 p-3 animate-fade-in motion-reduce:animate-none">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-xs font-bold text-accent">
                          <span aria-hidden>{prop.emoji}</span>
                          <span>{prop.label} 장착 및 위치 설정</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="min-h-9 rounded px-2 text-[0.68rem] text-bad hover:bg-bad/10 pointer-coarse:min-h-11"
                            onClick={() => {
                              setActiveProps((prev: string[]) => prev.filter((id: string) => id !== selectedPropId));
                              setSelectedPropId(null);
                            }}
                          >
                            제거
                          </button>
                          <button
                            type="button"
                            className="min-h-9 rounded px-2 text-[0.68rem] text-fg-3 hover:bg-raised pointer-coarse:min-h-11"
                            onClick={() => setSelectedPropId(null)}
                          >
                            닫기
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor={`prop-attach-bone-${selectedPropId}`} className="block text-[0.68rem] font-semibold text-fg-2 mb-1">장착 부위 (Bone)</label>
                        <select
                          id={`prop-attach-bone-${selectedPropId}`}
                          className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          value={config.bone}
                          onChange={(e) => {
                            const nextBone = e.target.value as VRMHumanBoneName | "none";
                            const defaultVals = nextBone !== "none" ? DEFAULT_BONE_OFFSETS[selectedPropId]?.[nextBone] || {} : {};
                            handleConfigChange({
                              bone: nextBone,
                              offsetX: defaultVals.offsetX ?? 0,
                              offsetY: defaultVals.offsetY ?? 0,
                              offsetZ: defaultVals.offsetZ ?? 0,
                              rotX: defaultVals.rotX ?? 0,
                              rotY: defaultVals.rotY ?? 0,
                              rotZ: defaultVals.rotZ ?? 0,
                              scale: defaultVals.scale ?? 1.0,
                            });
                          }}
                        >
                          <option value="none">없음 (3D 월드 좌표 배치)</option>
                          <option value="head">머리 (Head)</option>
                          <option value="chest">가슴 (Chest)</option>
                          <option value="rightHand">오른손 (Right Hand)</option>
                          <option value="leftHand">왼손 (Left Hand)</option>
                          <option value="hips">골반 (Hips)</option>
                        </select>
                      </div>

                      {(
                        <div className="space-y-2.5">
                          <div className="border-t border-line/40 pt-2.5">
                            <p className="text-[0.68rem] font-semibold text-fg-3 mb-1.5">위치 미세조정 (X / Y / Z)</p>
                            <div className="grid grid-cols-3 gap-2">
                              <label className="block text-[0.68rem] text-fg-3">
                                X: {(config.offsetX || 0).toFixed(2)}
                                <input
                                  type="range"
                                  min="-0.5"
                                  max="0.5"
                                  step="0.01"
                                  className="w-full accent-accent h-2"
                                  value={config.offsetX}
                                  onChange={(e) => handleConfigChange({ offsetX: Number(e.target.value) })}
                                />
                              </label>
                              <label className="block text-[0.68rem] text-fg-3">
                                Y: {(config.offsetY || 0).toFixed(2)}
                                <input
                                  type="range"
                                  min="-0.5"
                                  max="0.5"
                                  step="0.01"
                                  className="w-full accent-accent h-2"
                                  value={config.offsetY}
                                  onChange={(e) => handleConfigChange({ offsetY: Number(e.target.value) })}
                                />
                              </label>
                              <label className="block text-[0.68rem] text-fg-3">
                                Z: {(config.offsetZ || 0).toFixed(2)}
                                <input
                                  type="range"
                                  min="-0.5"
                                  max="0.5"
                                  step="0.01"
                                  className="w-full accent-accent h-2"
                                  value={config.offsetZ}
                                  onChange={(e) => handleConfigChange({ offsetZ: Number(e.target.value) })}
                                />
                              </label>
                            </div>
                          </div>

                          <div className="border-t border-line/40 pt-2.5">
                            <p className="text-[0.68rem] font-semibold text-fg-3 mb-1.5">회전 조정 (앞/뒤, 뒤틀기, 안/밖)</p>
                            <div className="grid grid-cols-3 gap-2">
                              <label className="block text-[0.68rem] text-fg-3">
                                앞/뒤: {Math.round(config.rotX)}°
                                <input
                                  type="range"
                                  min="-180"
                                  max="180"
                                  className="w-full accent-accent h-2"
                                  value={config.rotX}
                                  onChange={(e) => handleConfigChange({ rotX: Number(e.target.value) })}
                                />
                              </label>
                              <label className="block text-[0.68rem] text-fg-3">
                                뒤틀기: {Math.round(config.rotY)}°
                                <input
                                  type="range"
                                  min="-180"
                                  max="180"
                                  className="w-full accent-accent h-2"
                                  value={config.rotY}
                                  onChange={(e) => handleConfigChange({ rotY: Number(e.target.value) })}
                                />
                              </label>
                              <label className="block text-[0.68rem] text-fg-3">
                                안/밖: {Math.round(config.rotZ)}°
                                <input
                                  type="range"
                                  min="-180"
                                  max="180"
                                  className="w-full accent-accent h-2"
                                  value={config.rotZ}
                                  onChange={(e) => handleConfigChange({ rotZ: Number(e.target.value) })}
                                />
                              </label>
                            </div>
                          </div>

                          <div className="border-t border-line/40 pt-2.5">
                            <label className="block">
                              <span className="flex items-center justify-between text-[0.65rem] text-fg-3">
                                <span>크기 배율</span>
                                <span>{config.scale.toFixed(1)}x</span>
                              </span>
                              <input
                                type="range"
                                min="0.2"
                                max="2.5"
                                step="0.1"
                                aria-label="크기 배율"
                                className="w-full accent-accent h-1 mt-1"
                                value={config.scale}
                                onChange={(e) => handleConfigChange({ scale: Number(e.target.value) })}
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                </div>
              </details>
              </>
  );
}
