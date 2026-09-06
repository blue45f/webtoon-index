import { Glasses, Box, Volume2, Hand, Sparkles } from "lucide-react";
import { useState, useId } from "react";

import type { SpatialSfxPresetKind } from "../scene-3d/studio-3d-spatial-audio";
import type { ArPlaneOrientation } from "../scene-3d/studio-3d-spatial-webtoon-ar";
import type { VrStoryLayoutTopology } from "../scene-3d/studio-3d-spatial-webtoon-vr";

export interface StudioBg3dSpatialWebtoonPanelProps {
  readonly onModeChange?: (mode: "ar" | "vr" | "audio" | "hands") => void;
  readonly disabled?: boolean;
}

export function StudioBg3dSpatialWebtoonPanel({
  onModeChange,
  disabled = false,
}: StudioBg3dSpatialWebtoonPanelProps) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<"ar" | "vr" | "audio" | "hands">("ar");

  // AR States
  const [arScale, setArScale] = useState(0.1);
  const [arOrientation, setArOrientation] = useState<ArPlaneOrientation>("horizontal-table");
  const [shadowCatcherEnabled, setShadowCatcherEnabled] = useState(true);

  // VR States
  const [vrTopology, setVrTopology] = useState<VrStoryLayoutTopology>("curved-amphitheater");
  const [comfortVignette, setComfortVignette] = useState(true);

  // Spatial Audio States
  const [selectedSfx, setSelectedSfx] = useState<SpatialSfxPresetKind>("explosion-rumble");
  const [emitterCount, setEmitterCount] = useState(2);

  const handleTabSelect = (tab: "ar" | "vr" | "audio" | "hands") => {
    setActiveTab(tab);
    onModeChange?.(tab);
  };

  const scaleId = `${idPrefix}-ar-scale`;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* Navigation Sub-Tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-card p-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleTabSelect("ar")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "ar"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Box className="h-3.5 w-3.5 text-accent" />
          <span>AR 디오라마</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleTabSelect("vr")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "vr"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Glasses className="h-3.5 w-3.5 text-accent" />
          <span>VR 갤러리</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleTabSelect("audio")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "audio"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Volume2 className="h-3.5 w-3.5 text-accent" />
          <span>공간 음향</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleTabSelect("hands")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "hands"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Hand className="h-3.5 w-3.5 text-accent" />
          <span>핸드 트래킹</span>
        </button>
      </div>

      {/* Tab 1: AR Diorama Placement */}
      {activeTab === "ar" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              AR 배치 대상 평면
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "horizontal-table", label: "책상 위 디오라마" },
                { id: "horizontal-floor", label: "바닥 1:1 실물" },
                { id: "vertical-wall", label: "벽면 액자/포스터" },
              ].map((plane) => (
                <button
                  key={plane.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setArOrientation(plane.id as ArPlaneOrientation)}
                  className={`rounded-lg border p-2 text-center text-[0.68rem] font-semibold transition-all ${
                    arOrientation === plane.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  {plane.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between">
              <label htmlFor={scaleId} className="text-[0.68rem] font-medium text-fg-3">
                AR 축척 스케일
              </label>
              <span className="font-mono text-[0.68rem]">
                {arScale === 1 ? "1:1 (실물 크기)" : `1:${Math.round(1 / arScale)} (${(arScale * 100).toFixed(0)}%)`}
              </span>
            </div>
            <input
              id={scaleId}
              type="range"
              min={0.02}
              max={1.0}
              step={0.02}
              value={arScale}
              disabled={disabled}
              onChange={(e) => setArScale(Number(e.target.value))}
              className="accent-accent"
            />
            <div className="mt-1 flex justify-between text-[0.6rem] text-fg-3">
              <span>미니어처 (1:50)</span>
              <span>테이블 디오라마 (1:10)</span>
              <span>실물 크기 (1:1)</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line bg-card/60 p-2 text-[0.68rem]">
            <span className="font-medium text-fg-2">바닥 실시간 그림자 캐처 (Shadow Plane)</span>
            <input
              type="checkbox"
              checked={shadowCatcherEnabled}
              disabled={disabled}
              onChange={(e) => setShadowCatcherEnabled(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
          </div>
        </div>
      )}

      {/* Tab 2: VR Spatial Gallery */}
      {activeTab === "vr" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              VR 공간 웹툰 배치 토폴로지
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "curved-amphitheater", label: "원형 극장형 (몰입 곡면)" },
                { id: "vertical-tunnel", label: "세로 스크롤 터널" },
                { id: "holocube-stage", label: "홀로큐브 다면체" },
              ].map((topo) => (
                <button
                  key={topo.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setVrTopology(topo.id as VrStoryLayoutTopology)}
                  className={`rounded-lg border p-2 text-center text-[0.68rem] font-semibold transition-all ${
                    vrTopology === topo.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  {topo.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line bg-card/60 p-2 text-[0.68rem]">
            <div className="flex flex-col">
              <span className="font-semibold text-fg">멀미 방지 비네팅 (Comfort Vignette)</span>
              <span className="text-[0.62rem] text-fg-3">순간 이동 및 스냅 회전 시 시야 테두리를 부드럽게 감쇄</span>
            </div>
            <input
              type="checkbox"
              checked={comfortVignette}
              disabled={disabled}
              onChange={(e) => setComfortVignette(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
          </div>
        </div>
      )}

      {/* Tab 3: Spatial Audio */}
      {activeTab === "audio" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              3D 공간 효과음 프리셋 선택
            </span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                { id: "explosion-rumble", label: "대폭발 충격음" },
                { id: "sword-slash", label: "검격 파열음" },
                { id: "rain-ambience", label: "빗소리 환경음" },
                { id: "thunder-crack", label: "낙뢰 굉음" },
                { id: "whisper-intimate", label: "밀착 속삭임" },
                { id: "monologue-reverb", label: "독백 리버브" },
              ].map((sfx) => (
                <button
                  key={sfx.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedSfx(sfx.id as SpatialSfxPresetKind)}
                  className={`flex items-center gap-1.5 rounded-lg border p-2 text-left text-[0.68rem] font-semibold transition-all ${
                    selectedSfx === sfx.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  <Sparkles className="h-3 w-3 text-accent" />
                  <span>{sfx.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-card/60 p-2.5 text-[0.68rem]">
            <span className="font-semibold text-fg-2">활성 3D 이미터: {emitterCount}개 노드</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEmitterCount((c) => c + 1)}
              className="rounded-md border border-line bg-card px-2 py-1 text-[0.65rem] font-bold text-fg hover:bg-raised"
            >
              + 씬에 음향 이미터 추가
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Hand Tracking */}
      {activeTab === "hands" && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-2.5 text-[0.68rem]">
          <span className="font-bold text-fg">WebXR 25-관절 공간 제스처 단축키</span>
          <div className="grid grid-cols-2 gap-2 text-fg-2">
            <div className="rounded-lg bg-raised p-2">
              <span className="block font-bold text-accent">양손 핀치 줌 (Two-Hand Scale)</span>
              <span className="mt-0.5 block text-[0.62rem] text-fg-3">
                양손 검지와 엄지를 맞잡고 거리를 벌려 스테이지 확대/축소
              </span>
            </div>
            <div className="rounded-lg bg-raised p-2">
              <span className="block font-bold text-accent">양손 프레임 캡처 (Two-Hand Crop)</span>
              <span className="mt-0.5 block text-[0.62rem] text-fg-3">
                양손으로 L자 사각형 프레임을 만들어 웹툰 컷 즉시 촬영
              </span>
            </div>
            <div className="rounded-lg bg-raised p-2">
              <span className="block font-bold text-accent">손바닥 펼침 (Open Palm Summon)</span>
              <span className="mt-0.5 block text-[0.62rem] text-fg-3">
                손바닥을 위로 펼쳐 3D 도구 및 펜 팔레트 호출
              </span>
            </div>
            <div className="rounded-lg bg-raised p-2">
              <span className="block font-bold text-accent">검지 포인팅 (Index Teleport)</span>
              <span className="mt-0.5 block text-[0.62rem] text-fg-3">
                바닥을 가리켜 포물선 궤적으로 공간 이동
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
