import { User, Smile, Film, Sparkles, MessageSquare, Download, Layers } from "lucide-react";
import { useState } from "react";

import type { CharacterArchetype } from "../scene-3d/studio-3d-shaper-toon-maker";
import type { CutAspectRatio } from "../scene-3d/studio-3d-storyboard-cut-strip";
import type { TooningEmotionPreset, EmoteSfxKind } from "../scene-3d/studio-3d-tooning-emotion-fx";

export interface StudioBg3dShaperTooningStudioPanelProps {
  readonly onExportPsd?: () => void;
  readonly disabled?: boolean;
}

export function StudioBg3dShaperTooningStudioPanel({
  onExportPsd,
  disabled = false,
}: StudioBg3dShaperTooningStudioPanelProps) {
  const [activeTab, setActiveTab] = useState<"shaper" | "tooning" | "storyboard">("shaper");

  // Shaper State
  const [selectedArchetype, setSelectedArchetype] = useState<CharacterArchetype>("shonen-hero-8head");
  const [isSurfaceInking, setIsSurfaceInking] = useState(false);

  // Tooning Emotion & SFX State
  const [selectedEmotion, setSelectedEmotion] = useState<TooningEmotionPreset>("joy-radiant");
  const [bubbleText, setBubbleText] = useState("너… 정말 그럴 생각이야?");
  const [selectedEmote, setSelectedEmote] = useState<EmoteSfxKind>("sweat-drop");

  // Storyboard Cut Strip State
  const [cuts, setCuts] = useState<
    Array<{ id: string; cutNumber: number; title: string; aspectRatio: CutAspectRatio }>
  >([
    { id: "cut-1", cutNumber: 1, title: "1화 도입 롱샷", aspectRatio: "21:9-wide-action" },
    { id: "cut-2", cutNumber: 2, title: "주인공 등장", aspectRatio: "1:1-square-medium" },
    { id: "cut-3", cutNumber: 3, title: "감정 클로즈업", aspectRatio: "9:16-vertical-climax" },
  ]);

  const handleAddCut = () => {
    const nextIdx = cuts.length + 1;
    setCuts((prev) => [
      ...prev,
      {
        id: `cut-${Date.now()}`,
        cutNumber: nextIdx,
        title: `새 컷 ${nextIdx}`,
        aspectRatio: "1:1-square-medium",
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      {/* 3 Master Modes */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-card p-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setActiveTab("shaper")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "shaper"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <User className="h-3.5 w-3.5 text-accent" />
          <span>셰이퍼 캐릭터</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setActiveTab("tooning")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "tooning"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Smile className="h-3.5 w-3.5 text-accent" />
          <span>투닝 표정 & SFX</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => setActiveTab("storyboard")}
          className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[0.7rem] font-bold transition-all ${
            activeTab === "storyboard"
              ? "bg-raised text-fg shadow-sm border border-line"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          <Film className="h-3.5 w-3.5 text-accent" />
          <span>세로 연출 & PSD</span>
        </button>
      </div>

      {/* Tab 1: Shaper Character & Styling Maker */}
      {activeTab === "shaper" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              웹툰 체형 프로포션 (아키타입)
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: "shonen-hero-8head", label: "8등신 소년만화 히어로" },
                { id: "romance-lead-7head", label: "7.5등신 로맨스 남/여주" },
                { id: "teen-student-6head", label: "6등신 학원물 학생" },
                { id: "sd-chibi-4head", label: "4등신 SD 치비 캐릭터" },
                { id: "muscular-heavy-8head", label: "8등신 거구 근육형" },
              ].map((archetype) => (
                <button
                  key={archetype.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedArchetype(archetype.id as CharacterArchetype)}
                  className={`rounded-lg border p-2 text-left text-[0.68rem] font-semibold transition-all ${
                    selectedArchetype === archetype.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  {archetype.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-card/60 p-2.5 text-[0.68rem]">
            <div className="flex flex-col">
              <span className="font-bold text-fg">3D 표면 직접 잉킹 (3D Inking)</span>
              <span className="text-[0.62rem] text-fg-3">
                3D 캐릭터 표면에 그린 선이 포즈 변형 시에도 자연스럽게 따라 움직임
              </span>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsSurfaceInking(!isSurfaceInking)}
              className={`rounded-md border px-2.5 py-1 font-bold transition-all ${
                isSurfaceInking
                  ? "border-accent bg-accent text-bg"
                  : "border-line bg-card text-fg hover:bg-raised"
              }`}
            >
              {isSurfaceInking ? "잉킹 활성" : "잉킹 대기"}
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Tooning Emotion & World-Space 3D SFX */}
      {activeTab === "tooning" && (
        <div className="flex flex-col gap-2.5">
          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              16종 표정 블렌드셰이프 프리셋
            </span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[
                { id: "joy-radiant", label: "환한 미소" },
                { id: "smirk-villain", label: "썩소 / 능글" },
                { id: "cry-grief", label: "오열 / 눈물" },
                { id: "rage-furious", label: "분노 / 핏발" },
                { id: "blush-embarrassed", label: "수줍음 / 홍조" },
                { id: "shock-aghast", label: "경악 / 충격" },
                { id: "despair-shadow", label: "절망 / 동공풀림" },
                { id: "determination-heroic", label: "비장한 결의" },
              ].map((emotion) => (
                <button
                  key={emotion.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedEmotion(emotion.id as TooningEmotionPreset)}
                  className={`rounded-lg border p-1.5 text-center text-[0.68rem] font-semibold transition-all ${
                    selectedEmotion === emotion.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  {emotion.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-card/60 p-2.5">
            <span className="text-[0.68rem] font-semibold text-fg-2">
              3D 월드 공간 말풍선 & 대사 (Mouth Tracking)
            </span>
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-accent shrink-0" />
              <input
                type="text"
                value={bubbleText}
                disabled={disabled}
                onChange={(e) => setBubbleText(e.target.value)}
                placeholder="말풍선 대사 입력..."
                className="w-full rounded-md border border-line bg-field px-2 py-1 text-[0.7rem] text-fg focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[0.7rem] font-semibold text-fg-2">
              3D 감정 이모트 스티커 파티클
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "sweat-drop", label: "땀방울 (당황)" },
                { id: "anger-cross", label: "빠직 마크 (분노)" },
                { id: "sparkle-star", label: "반짝이 (호기심)" },
                { id: "question-exclamation", label: "물음표 (!?)" },
                { id: "dark-aura", label: "암흑 오라" },
                { id: "gloom-lines", label: "세로 침울선" },
              ].map((emote) => (
                <button
                  key={emote.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedEmote(emote.id as EmoteSfxKind)}
                  className={`flex items-center justify-center gap-1 rounded-lg border p-1.5 text-[0.65rem] font-semibold transition-all ${
                    selectedEmote === emote.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line bg-card text-fg hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  <Sparkles className="h-3 w-3 text-accent" />
                  <span>{emote.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Storyboard Vertical Strip & PSD Multi-Pass Export */}
      {activeTab === "storyboard" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.7rem] font-semibold text-fg-2">
              세로 스크롤 웹툰 컷 리스트 ({cuts.length}컷)
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={handleAddCut}
              className="rounded-md border border-line bg-card px-2 py-1 text-[0.65rem] font-bold text-fg hover:bg-raised"
            >
              + 컷 추가
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {cuts.map((cut) => (
              <div
                key={cut.id}
                className="flex items-center justify-between rounded-lg border border-line bg-card/60 p-2 text-[0.68rem]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 font-bold text-accent">
                    {cut.cutNumber}
                  </span>
                  <span className="font-semibold text-fg">{cut.title}</span>
                </div>
                <span className="rounded bg-raised px-1.5 py-0.5 text-[0.62rem] text-fg-3">
                  {cut.aspectRatio}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-1 flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-2.5">
            <div className="flex items-center gap-1.5 text-[0.68rem] font-bold text-fg">
              <Layers className="h-3.5 w-3.5 text-accent" />
              <span>8종 분리 레이어 PSD 마스터 내보내기</span>
            </div>
            <p className="text-[0.62rem] text-fg-3">
              선화(Line), 밑색(Flat), 1·2차 툰 음영(Shadow), 역광(Rim), 감정 SFX, 말풍선, 배경이 각각 독립 분리된 PSD로 즉시 출력됩니다.
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={onExportPsd}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.7rem] font-bold text-bg shadow-sm transition-all hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5" />
              <span>클립스튜디오/포토샵용 PSD 내보내기</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
