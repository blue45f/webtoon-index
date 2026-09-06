import {
  Grab,
  Camera,
  EyeOff,
  Sun,
  Scissors,
  Sparkles,
  Layers,
  Wind,
  Type,
  Palette,
  DoorOpen,
  Clapperboard,
  User,
  Grid,
  Move3d,
  Aperture,
  Download,
  Paintbrush,
  MessageSquare,
  Zap,
  Footprints,
  Sliders,
  Search,
  Check,
} from "lucide-react";
import { useState, useMemo } from "react";

import {
  Studio3DBillboardBubbleEngine,
  type BubbleKind,
} from "../scene-3d/studio-3d-billboard-bubble-anchor";
import { Studio3DFootContactSolver } from "../scene-3d/studio-3d-foot-contact-lock";
import {
  Studio3DWebtoonFilterEngine,
  type WebtoonFilterId,
} from "../scene-3d/studio-3d-webtoon-filters";

import { StudioBg3dCharacterAnimatorPanel } from "./StudioBg3dCharacterAnimatorPanel";
import { StudioBg3dCinematicDirectorPanel } from "./StudioBg3dCinematicDirectorPanel";
import { StudioBg3dClonerPanel } from "./StudioBg3dClonerPanel";
import { StudioBg3dDeformersPanel } from "./StudioBg3dDeformersPanel";
import { StudioBg3dDynamicComponentsPanel } from "./StudioBg3dDynamicComponentsPanel";
import { StudioBg3dHalftoneScreentonePanel } from "./StudioBg3dHalftoneScreentonePanel";
import { StudioBg3dMatCapStudioPanel } from "./StudioBg3dMatCapStudioPanel";
import { StudioBg3dMultiPassExporterPanel } from "./StudioBg3dMultiPassExporterPanel";
import { StudioBg3dParticleVfxPanel } from "./StudioBg3dParticleVfxPanel";
import { StudioBg3dPostProcessVfxPanel } from "./StudioBg3dPostProcessVfxPanel";
import { StudioBg3dShaperTooningStudioPanel } from "./StudioBg3dShaperTooningStudioPanel";
import { StudioBg3dSpatialFxPanel } from "./StudioBg3dSpatialFxPanel";
import { StudioBg3dTextExtruderPanel } from "./StudioBg3dTextExtruderPanel";

import type { CameraLensPreset, PerspectiveGuideMode } from "../scene-3d/studio-3d-camera-perspective-lens";
import type { HairCrossSectionProfile } from "../scene-3d/studio-3d-procedural-hair-strand";
import type { HandGripArchetype, CharacterSocketSlot } from "../scene-3d/studio-3d-prop-hand-grip-solver";
import type { TimeOfDayPreset } from "../scene-3d/studio-3d-scene-auto-culling";

export type ProSuiteActiveTab =
  | "grip"
  | "dynamic"
  | "lens"
  | "director"
  | "character"
  | "cloner"
  | "particle"
  | "text3d"
  | "matcap"
  | "screentone"
  | "deform"
  | "postfx"
  | "multipass"
  | "culling"
  | "hair"
  | "shaper"
  | "tooning"
  | "speedlines"
  | "filters"
  | "footlock";

export type ProSuiteCategory = "all" | "character" | "director" | "fx" | "assets";

export interface StudioBg3dProSuitePanelProps {
  readonly disabled?: boolean;
}

export function StudioBg3dProSuitePanel({ disabled = false }: StudioBg3dProSuitePanelProps) {
  const [activeTab, setActiveTab] = useState<ProSuiteActiveTab>("grip");
  const [activeCategory, setActiveCategory] = useState<ProSuiteCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Tab: Prop Grip State
  const [selectedGrip, setSelectedGrip] = useState<HandGripArchetype>("sword-power-grip");
  const [selectedSocket, setSelectedSocket] = useState<CharacterSocketSlot>("hand-right");
  const [tightness, setTightness] = useState(1.0);

  // Tab: Lens & Foreshortening State
  const [selectedLens, setSelectedLens] = useState<CameraLensPreset>("24mm-dramatic-low-angle");
  const [foreshortening, setForeshortening] = useState(1.8);
  const [guideMode, setGuideMode] = useState<PerspectiveGuideMode>("2-point");

  // Tab: Culling & Atmosphere State
  const [selectedTimeOfDay, setSelectedTimeOfDay] = useState<TimeOfDayPreset>("golden-hour-sunset");
  const [autoCullObstructions, setAutoCullObstructions] = useState(true);

  // Tab: Hair Strand State
  const [hairProfile, setHairProfile] = useState<HairCrossSectionProfile>("triangular-anime-spike");
  const [strandTaper, setStrandTaper] = useState(1.3);

  // Tab: Webtoon Filters (Snaptoon/Abler)
  const filterEngine = useMemo(() => new Studio3DWebtoonFilterEngine(), []);
  const [selectedFilterId, setSelectedFilterId] = useState<WebtoonFilterId>("modern-crisp-cel");
  const activeFilterConfig = filterEngine.getPreset(selectedFilterId);

  // Tab: Foot Contact Lock (Plask AI / AccuRIG)
  const footContactSolver = useMemo(() => new Studio3DFootContactSolver(), []);
  const [footGroundLevel, setFootGroundLevel] = useState(0.0);
  const [footAutoPelvis, setFootAutoPelvis] = useState(true);
  const [footPreventSlip, setFootPreventSlip] = useState(true);
  const [footStatusMessage, setFootStatusMessage] = useState("지면 착지 락 활성화 (Ground Lock OK)");

  // Tab: Tooning 3D Speech Bubble & Emote Anchor
  const bubbleEngine = useMemo(() => new Studio3DBillboardBubbleEngine(), []);
  const [bubbleInputText, setBubbleInputText] = useState("너… 정말 그럴 생각이야?");
  const [selectedEmoteKind, setSelectedEmoteKind] = useState("sweat");

  const allNavButtons: Array<{
    id: ProSuiteActiveTab;
    label: string;
    icon: typeof Grab;
    category: ProSuiteCategory;
    tags: string;
  }> = [
    // Character & Pose (5)
    { id: "grip", label: "소품 그립", icon: Grab, category: "character", tags: "손 악력 검 칼 무기 폰 컵" },
    { id: "shaper", label: "셰이퍼 3D", icon: Paintbrush, category: "character", tags: "네이버 셰이퍼 인체 등신 드로잉 펜선 표면" },
    { id: "footlock", label: "지면 착지락", icon: Footprints, category: "character", tags: "플라스크 발 착지 지면 고정 IK 관절 락 걷기" },
    { id: "character", label: "캐릭터/표정", icon: User, category: "character", tags: "비율 얼굴 표정 눈썹 입 애니메이션" },
    { id: "hair", label: "헤어 가닥", icon: Scissors, category: "character", tags: "머리 가닥 스파이크 리본 컬 헤어스타일" },

    // Director & Story (4)
    { id: "lens", label: "만화 렌즈", icon: Camera, category: "director", tags: "화각 어안 원근 과장 투시 소점" },
    { id: "director", label: "컷 디렉터", icon: Clapperboard, category: "director", tags: "연출 롱샷 클로즈업 바스트 앵글" },
    { id: "tooning", label: "투닝 연출", icon: MessageSquare, category: "director", tags: "말풍선 감정 이모트 땀방울 분노 컷스트립" },
    { id: "culling", label: "배경 컬링", icon: Sun, category: "director", tags: "벽체 천장 자동 숨김 시간대 태양광 골든아워" },

    // FX & Render (6)
    { id: "filters", label: "웹툰 필터", icon: Sliders, category: "fx", tags: "스냅툰 에이블러 흑백 먹칠 파스텔 누아르 셀 셰이딩" },
    { id: "speedlines", label: "2.5D 집중선", icon: Zap, category: "fx", tags: "스냅툰 액션 집중선 속도선 방사형 효과선" },
    { id: "text3d", label: "3D 효과음", icon: Type, category: "fx", tags: "의성어 의태어 쿵 쾅 번쩍 타이포 입체" },
    { id: "particle", label: "3D 파티클", icon: Wind, category: "fx", tags: "비 눈 벚꽃 먼지 날씨 연출" },
    { id: "matcap", label: "맷캡 재질", icon: Palette, category: "fx", tags: "은선 도자기 메탈릭 클레이 툰 재질" },
    { id: "screentone", label: "3D 망점/톤", icon: Grid, category: "fx", tags: "망점 빗금 톤 스크린톤 하프톤 만화" },

    // Objects & Assets (5)
    { id: "dynamic", label: "인터랙션", icon: DoorOpen, category: "assets", tags: "문 창문 서랍 상자 전등 컴포넌트" },
    { id: "cloner", label: "3D 클로너", icon: Layers, category: "assets", tags: "복제 배열 군중 그리드 인스턴스" },
    { id: "deform", label: "디포머", icon: Move3d, category: "assets", tags: "비틀기 구부리기 벤드 테이퍼 부풀리기" },
    { id: "postfx", label: "렌즈 PostFX", icon: Aperture, category: "assets", tags: "아웃포커스 보케 블룸 비네트 색수차" },
    { id: "multipass", label: "멀티패스", icon: Download, category: "assets", tags: "에이블러 PSD 레이어 분리 선화 그림자 컬러" },
  ];

  const filteredButtons = allNavButtons.filter((btn) => {
    if (activeCategory !== "all" && btn.category !== activeCategory) {
      return false;
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      return btn.label.toLowerCase().includes(q) || btn.tags.includes(q);
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* Category Pills & Quick Filter Search */}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/70 p-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[0.65rem]">
          {[
            { id: "all", label: "전체 (20)" },
            { id: "character", label: "캐릭터/포즈" },
            { id: "director", label: "연출/스토리" },
            { id: "fx", label: "필터/이펙트" },
            { id: "assets", label: "오브젝트/에셋" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              disabled={disabled}
              onClick={() => setActiveCategory(cat.id as ProSuiteCategory)}
              className={`whitespace-nowrap rounded-md px-2 py-0.5 font-bold transition-all ${
                activeCategory === cat.id
                  ? "bg-accent text-on-accent shadow-sm"
                  : "border border-line bg-card text-fg-3 hover:text-fg"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-2 size-3 text-fg-3" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={disabled}
            placeholder="3D 프로 툴 검색 (예: 집중선, 필터, 말풍선, 착지, 문, 손, PSD)..."
            className="min-h-7 w-full rounded-md border border-line bg-card pl-7 pr-2 text-[0.65rem] text-fg placeholder:text-fg-3 focus-visible:outline-accent"
          />
        </div>
      </div>

      {/* Navigation Tabs Grid */}
      <div className="grid grid-cols-5 gap-1 rounded-lg border border-line bg-card p-1">
        {filteredButtons.map((btn) => {
          const Icon = btn.icon;
          const isSelected = activeTab === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              disabled={disabled}
              onClick={() => setActiveTab(btn.id)}
              className={`flex items-center justify-center gap-1 rounded-md py-1 text-[0.62rem] font-bold transition-all ${
                isSelected
                  ? "border border-line bg-raised text-fg shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              <Icon className="size-3 text-accent shrink-0" />
              <span className="truncate">{btn.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab: Prop Snapping & Hand Grip */}
      {activeTab === "grip" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              6종 만화 손 그립 아키타입
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: "sword-power-grip", label: "검/칼 파워 그립" },
                { id: "gun-pistol-trigger", label: "권총 방아쇠 그립" },
                { id: "phone-pinch-hold", label: "스마트폰 핀치 홀드" },
                { id: "cup-wrap-grasp", label: "머그컵/음료 감싸기" },
                { id: "pen-precision-tripod", label: "펜/도구 정밀 삼점 그립" },
                { id: "relaxed-open-hold", label: "자연스러운 기본 손" },
              ].map((grip) => (
                <button
                  key={grip.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedGrip(grip.id as HandGripArchetype)}
                  className={`rounded-lg border p-1.5 text-left text-[0.68rem] font-semibold transition-all ${
                    selectedGrip === grip.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {grip.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">소켓 바인딩 위치</span>
              <span className="font-bold text-accent">{selectedSocket}</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                { id: "hand-right", label: "오른손" },
                { id: "hand-left", label: "왼손" },
                { id: "back-sheath", label: "등 칼집" },
                { id: "waist-holster", label: "허리 홀스터" },
                { id: "head-accessory", label: "머리 모자" },
                { id: "glasses-bridge", label: "안경 안면" },
              ].map((socket) => (
                <button
                  key={socket.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedSocket(socket.id as CharacterSocketSlot)}
                  className={`rounded border p-1 text-center text-[0.62rem] font-semibold ${
                    selectedSocket === socket.id
                      ? "border-accent bg-accent/20 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {socket.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">손가락 쥐는 악력 (Tightness)</span>
              <span className="font-bold text-accent">{tightness.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              disabled={disabled}
              value={tightness}
              onChange={(e) => setTightness(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        </div>
      )}

      {/* Tab: SHAPER 3D Character Studio */}
      {activeTab === "shaper" && <StudioBg3dShaperTooningStudioPanel disabled={disabled} />}

      {/* Tab: Plask AI Foot Contact Grounding Solver */}
      {activeTab === "footlock" && (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-fg">플라스크 지면 착지 락 (Foot Contact Lock)</span>
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[0.65rem] font-bold text-accent">
                Plask/AccuRIG AI
              </span>
            </div>
            <p className="mt-1 text-[0.62rem] text-fg-3">
              포즈 변경 시 발바닥이 지면을 관통하거나 허공에 뜨지 않도록 Two-Bone IK와 지면 밀착을 보정합니다.
            </p>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">지면 높이 (Ground Elevation)</span>
              <span className="font-bold text-accent">{footGroundLevel.toFixed(2)}m</span>
            </div>
            <input
              type="range"
              min="-1.0"
              max="2.0"
              step="0.05"
              disabled={disabled}
              value={footGroundLevel}
              onChange={(e) => setFootGroundLevel(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setFootAutoPelvis(!footAutoPelvis)}
              className={`flex items-center justify-between rounded-lg border p-2 font-semibold ${
                footAutoPelvis
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line bg-card text-fg-3"
              }`}
            >
              <span>골반 높이 자동 보정</span>
              <Check className={`size-3 ${footAutoPelvis ? "opacity-100" : "opacity-0"}`} />
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => setFootPreventSlip(!footPreventSlip)}
              className={`flex items-center justify-between rounded-lg border p-2 font-semibold ${
                footPreventSlip
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line bg-card text-fg-3"
              }`}
            >
              <span>발 미끄러짐 방지</span>
              <Check className={`size-3 ${footPreventSlip ? "opacity-100" : "opacity-0"}`} />
            </button>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const res = footContactSolver.solve({
                root: { x: 0, y: footGroundLevel, z: 0 },
                pelvis: { x: 0, y: footGroundLevel + 0.95, z: 0 },
                leftLeg: {
                  hip: { x: -0.15, y: 0.9, z: 0 },
                  knee: { x: -0.15, y: 0.5, z: 0.05 },
                  ankle: { x: -0.15, y: footGroundLevel, z: 0 },
                  toe: { x: -0.15, y: footGroundLevel, z: 0.15 },
                },
                rightLeg: {
                  hip: { x: 0.15, y: 0.9, z: 0 },
                  knee: { x: 0.15, y: 0.5, z: 0.05 },
                  ankle: { x: 0.15, y: footGroundLevel, z: 0 },
                  toe: { x: 0.15, y: footGroundLevel, z: 0.15 },
                },
              });
              setFootStatusMessage(res.summary);
            }}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.7rem] font-bold text-on-accent shadow-sm transition-all hover:opacity-90"
          >
            <Footprints className="size-3.5" />
            <span>양발 바닥 착지 락 & 골반 높이 적용</span>
          </button>
          <span className="text-center font-mono text-[0.62rem] text-accent">{footStatusMessage}</span>
        </div>
      )}

      {/* Tab: Snaptoon & Abler Webtoon Filter Presets */}
      {activeTab === "filters" && (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-xl border border-line bg-card/60 p-2.5">
            <span className="font-bold text-fg">스냅툰·에이블러 스타일 7종 웹툰 렌더 필터</span>
            <p className="mt-0.5 text-[0.62rem] text-fg-3">
              장르별 최적화된 펜선 두께, 2~4단 셀 셰이딩 음영, 하이라이트 블룸을 실시간 적용합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {filterEngine.listPresets().map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedFilterId(preset.id)}
                className={`flex flex-col rounded-lg border p-2 text-left transition-all ${
                  selectedFilterId === preset.id
                    ? "border-accent bg-accent/15 text-accent shadow-sm"
                    : "border-line bg-card text-fg hover:bg-raised"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[0.72rem]">{preset.name}</span>
                  <span className="font-mono text-[0.62rem] font-semibold text-fg-3">
                    선 {preset.lineThicknessPx}px · {preset.celSteps}단 음영
                  </span>
                </div>
                <span className="mt-0.5 text-[0.62rem] text-fg-3">{preset.description}</span>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">외곽선 두께 (Line Weight)</span>
              <span className="font-bold text-accent">{activeFilterConfig.lineThicknessPx}px</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">채도 / 대비 (Saturation & Contrast)</span>
              <span className="font-mono text-accent">
                {activeFilterConfig.colorSaturation}x / {activeFilterConfig.contrast}x
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Snaptoon 2.5D Speed Lines */}
      {activeTab === "speedlines" && <StudioBg3dSpatialFxPanel disabled={disabled} />}

      {/* Tab: Tooning 3D Speech Bubble & Emote Anchor */}
      {activeTab === "tooning" && (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-xl border border-line bg-card/60 p-2.5">
            <span className="font-bold text-fg">투닝 3D 빌보드 말풍선 & 만화 이모트</span>
            <p className="mt-0.5 text-[0.62rem] text-fg-3">
              카메라 회전에도 정면을 유지하는 3D 빌보드 말풍선과 머리 추종 만화 감정 기호를 배치합니다.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-card/60 p-2.5">
            <span className="font-semibold text-fg-2">말풍선 대사 입력</span>
            <input
              type="text"
              value={bubbleInputText}
              onChange={(e) => setBubbleInputText(e.target.value)}
              disabled={disabled}
              placeholder="말풍선에 들어갈 대사를 입력하세요..."
              className="min-h-8 w-full rounded-md border border-line bg-card px-2 text-xs text-fg focus-visible:outline-accent"
            />
            <div className="grid grid-cols-4 gap-1 pt-1">
              {[
                { kind: "speech", label: "일반 대화" },
                { kind: "shout", label: "외침(스파이크)" },
                { kind: "thought", label: "독백(구름)" },
                { kind: "whisper", label: "속삭임(점선)" },
              ].map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    bubbleEngine.addBubble({
                      text: bubbleInputText,
                      kind: item.kind as BubbleKind,
                      socket: "head-top",
                      offset: { x: 0, y: 0.35, z: 0 },
                      scale: 1.0,
                      billboardFacing: true,
                      tailTargetOffset: { x: 0, y: -0.35, z: 0 },
                      bubbleBgColor: "#ffffff",
                      textColor: "#111115",
                    });
                  }}
                  className="rounded border border-line bg-card py-1 text-center text-[0.62rem] font-semibold text-fg hover:bg-raised"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[0.68rem] font-semibold text-fg-2">
              만화 감정 이모트 기호
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[
                { id: "sweat", label: "땀방울" },
                { id: "anger", label: "분노 번개" },
                { id: "question", label: "물음표 (?)" },
                { id: "exclamation", label: "느낌표 (!)" },
                { id: "sparkle", label: "반짝이" },
                { id: "dark-lines", label: "어두운 빗금" },
                { id: "heart", label: "하트" },
              ].map((emote) => (
                <button
                  key={emote.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedEmoteKind(emote.id)}
                  className={`rounded-lg border p-1 text-center text-[0.62rem] font-semibold transition-all ${
                    selectedEmoteKind === emote.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {emote.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Dynamic Components */}
      {activeTab === "dynamic" && <StudioBg3dDynamicComponentsPanel />}

      {/* Tab: Dynamic Lens & Foreshortening */}
      {activeTab === "lens" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              초점거리 렌즈 화각 프리셋
            </span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                { id: "12mm-ultra-wide-fisheye", label: "12mm 어안 (격투 펀치)" },
                { id: "24mm-dramatic-low-angle", label: "24mm 드라마틱 로우" },
                { id: "50mm-natural-dialogue", label: "50mm 자연스러운 대화" },
                { id: "85mm-portrait-bokeh", label: "85mm 로맨스 인물샷" },
                { id: "200mm-telephoto-compression", label: "200mm 망원 압축" },
              ].map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedLens(lens.id as CameraLensPreset)}
                  className={`rounded-lg border p-1.5 text-center text-[0.68rem] font-semibold transition-all ${
                    selectedLens === lens.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {lens.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">만화 다이내믹 원근 왜곡 배율</span>
              <span className="font-bold text-accent">{foreshortening.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="3.5"
              step="0.1"
              disabled={disabled}
              value={foreshortening}
              onChange={(e) => setForeshortening(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-card/60 p-2.5 text-[0.68rem]">
            <span className="font-semibold text-fg-2">투시 소점 가이드 라인</span>
            <div className="flex gap-1">
              {(["off", "1-point", "2-point", "3-point"] as PerspectiveGuideMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={disabled}
                  onClick={() => setGuideMode(mode)}
                  className={`rounded px-2 py-0.5 font-bold ${
                    guideMode === mode
                      ? "bg-accent text-on-accent"
                      : "border border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Cinematic Director */}
      {activeTab === "director" && <StudioBg3dCinematicDirectorPanel />}

      {/* Tab: Character Proportions & Expressions */}
      {activeTab === "character" && <StudioBg3dCharacterAnimatorPanel />}

      {/* Tab: Cloner Panel */}
      {activeTab === "cloner" && <StudioBg3dClonerPanel disabled={disabled} />}

      {/* Tab: Particle VFX Panel */}
      {activeTab === "particle" && <StudioBg3dParticleVfxPanel disabled={disabled} />}

      {/* Tab: 3D Text Extruder Panel */}
      {activeTab === "text3d" && <StudioBg3dTextExtruderPanel disabled={disabled} />}

      {/* Tab: MatCap Studio Panel */}
      {activeTab === "matcap" && <StudioBg3dMatCapStudioPanel disabled={disabled} />}

      {/* Tab: Screentone Panel */}
      {activeTab === "screentone" && <StudioBg3dHalftoneScreentonePanel />}

      {/* Tab: Deformers Panel */}
      {activeTab === "deform" && <StudioBg3dDeformersPanel />}

      {/* Tab: PostProcess VFX Panel */}
      {activeTab === "postfx" && <StudioBg3dPostProcessVfxPanel />}

      {/* Tab: MultiPass Exporter Panel */}
      {activeTab === "multipass" && <StudioBg3dMultiPassExporterPanel />}

      {/* Tab: Architecture Auto-Culling & Day/Night */}
      {activeTab === "culling" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between rounded-xl border border-line bg-card/60 p-2.5 text-[0.68rem]">
            <div className="flex flex-col">
              <span className="font-bold text-fg">시야 방해 벽체/천장 자동 숨김</span>
              <span className="text-[0.62rem] text-fg-3">
                카메라와 캐릭터 사이를 가로막는 앞벽/천장 자동 투명화
              </span>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAutoCullObstructions(!autoCullObstructions)}
              className={`flex items-center gap-1 rounded-md border px-2.5 py-1 font-bold transition-all ${
                autoCullObstructions
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg hover:bg-raised"
              }`}
            >
              <EyeOff className="size-3" />
              <span>{autoCullObstructions ? "컬링 ON" : "컬링 OFF"}</span>
            </button>
          </div>

          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              시간대별 조명 & 분위기 프리셋
            </span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                { id: "noon-clear-sky", label: "정오 쾌청 햇살" },
                { id: "golden-hour-sunset", label: "골든아워 노을" },
                { id: "blue-hour-dusk", label: "블루아워 황혼" },
                { id: "cyberpunk-neon-night", label: "사이버펑크 네온야경" },
                { id: "eerie-fog-mist", label: "새벽 안개/미스트" },
              ].map((time) => (
                <button
                  key={time.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedTimeOfDay(time.id as TimeOfDayPreset)}
                  className={`rounded-lg border p-1.5 text-center text-[0.68rem] font-semibold transition-all ${
                    selectedTimeOfDay === time.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {time.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Hair Strand Maker */}
      {activeTab === "hair" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              머리카락 가닥 단면 프로파일
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: "triangular-anime-spike", label: "아니메 삼각 스파이크" },
                { id: "flat-ribbon", label: "납작 리본 가닥" },
                { id: "round-smooth-curl", label: "부드러운 원형 컬" },
                { id: "creased-manga-chunk", label: "음영 각진 만화 덩어리" },
              ].map((prof) => (
                <button
                  key={prof.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setHairProfile(prof.id as HairCrossSectionProfile)}
                  className={`rounded-lg border p-1.5 text-left text-[0.68rem] font-semibold transition-all ${
                    hairProfile === prof.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:bg-raised"
                  }`}
                >
                  {prof.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-[0.68rem]">
              <span className="font-semibold text-fg-2">끝단 뾰족함 (Taper Sharpness)</span>
              <span className="font-bold text-accent">{strandTaper.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="2.5"
              step="0.1"
              disabled={disabled}
              value={strandTaper}
              onChange={(e) => setStrandTaper(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          <button
            type="button"
            disabled={disabled}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.7rem] font-bold text-on-accent shadow-sm transition-all hover:opacity-90"
          >
            <Sparkles className="size-3.5" />
            <span>새 가닥 생성 & 3D 메쉬 빌드</span>
          </button>
        </div>
      )}
    </div>
  );
}
