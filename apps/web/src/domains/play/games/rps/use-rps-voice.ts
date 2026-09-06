// 가위바위보 음성(Web Speech, 무료 브라우저 내장 TTS). ko-KR 보이스로 구호·결과를 읽는다.
// 자연스러움 우선순위: 뉴럴/Online(Edge·Azure) > Google(Chrome) > 클라우드 > OS 기본(Yuna 등).
// 기기마다 가용 보이스가 다르므로 사용자가 직접 고를 수도 있게 목록을 노출한다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 이름·로컬여부로 "자연스러움" 점수. 높을수록 자연스러운 무료 보이스. */
function naturalScore(v: SpeechSynthesisVoice): number {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  let s = 0;
  if (/natural|neural/.test(n)) s += 100; // Edge/Azure 뉴럴(가장 자연스러움)
  if (/google/.test(n)) s += 60; // Chrome Google 한국어(OS 기본보다 자연스러움)
  if (/online/.test(n)) s += 40; // 온라인(네트워크) 변형
  if (v.localService === false) s += 20; // 클라우드 보이스가 대체로 더 자연스러움
  if (/sunhi|선희|heami|혜미|yuna|유나|sora|female|여성/.test(n)) s += 5;
  return s;
}

function koVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return all
    .filter((v) => v.lang?.toLowerCase().startsWith("ko"))
    .sort((a, b) => naturalScore(b) - naturalScore(a));
}

export interface RpsVoice {
  speak: (text: string) => void;
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  setVoiceURI: (uri: string) => void;
}

/** enabled일 때만 발화. 가장 자연스러운 ko 보이스를 자동 선택하되 사용자가 바꿀 수 있다. */
export function useRpsVoice(enabled: boolean): RpsVoice {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => setAllVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [supported]);

  const voices = useMemo(() => koVoices(allVoices), [allVoices]);

  // 첫 로드 시 가장 자연스러운 보이스 자동 선택.
  useEffect(() => {
    if (voiceURI === null && voices.length > 0) setVoiceURI(voices[0].voiceURI);
  }, [voices, voiceURI]);

  // 비활성화되면 진행 중 발화 중단.
  useEffect(() => {
    if (!enabled && supported) window.speechSynthesis.cancel();
  }, [enabled, supported]);

  // 렌더 중 ref 변이 금지 → effect에서 최신값 보관, speak에서 읽는다.
  const voicesRef = useRef(voices);
  const voiceURIRef = useRef(voiceURI);
  useEffect(() => {
    voicesRef.current = voices;
  }, [voices]);
  useEffect(() => {
    voiceURIRef.current = voiceURI;
  }, [voiceURI]);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      const vs = voicesRef.current;
      const sel = vs.find((v) => v.voiceURI === voiceURIRef.current) ?? vs[0] ?? null;
      if (sel) u.voice = sel;
      u.rate = 1.15;
      u.pitch = 1.05;
      synth.speak(u);
    },
    [enabled, supported],
  );

  return { speak, supported, voices, voiceURI, setVoiceURI };
}
