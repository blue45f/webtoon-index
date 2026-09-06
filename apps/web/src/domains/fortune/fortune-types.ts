// 운세 웹툰 패널(컷) 타입은 @toonspectrum/core/fortune 엔진과 동일 형태로 웹 앱·백엔드가
// 공유한다. 백엔드가 [N컷 - 묘사] + 이름: "대사" 콘티를 파싱해 내려주며, 여기서는
// 웹 화면이 같은 구조를 소비하도록 코어 타입을 그대로 재-export 한다.

import type { FortunePanel, FortunePanelLine } from "@toonspectrum/core";

export type { FortunePanel, FortunePanelLine };

export interface FortuneCharacterInfo {
  id: string;
  name: string;
  origin: string;
  greeting: string;
  avatarUrl: string;
}

// 재생 타임라인의 한 스텝 — 패널의 각 대사/나레이션(라인 인덱스 포함).
// 오케스트레이터가 이 순서대로 음성+애니메이션을 진행한다.
export interface PlaybackStep {
  panel: number; // 패널(컷) 인덱스
  line: number; // 패널 내 line 인덱스 (panel.lines 기준)
  text: string;
  characterId: string | null;
}

// 패널 배열 → 스텝 시퀀스. 빈 텍스트·효과음 전용 줄은 건너뛴다.
export function buildSteps(panels: FortunePanel[]): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  panels.forEach((panel, panelIndex) => {
    panel.lines.forEach((line, lineIndex) => {
      const text = line.text?.trim();
      if (!text) return;
      steps.push({ panel: panelIndex, line: lineIndex, text, characterId: line.characterId });
    });
  });
  return steps;
}
