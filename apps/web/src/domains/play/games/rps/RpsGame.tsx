import { Box, Camera, CameraOff, Hand as HandIcon, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { GameHelp } from "../../GameHelp";

import {
  EMPTY_SCORE,
  HAND_EMOJI,
  HAND_LABEL,
  type Initiative,
  matchOver,
  mukjjippaStep,
  pickAiHand,
  resolveRound,
  scoreReducer,
  type Hand,
  type Outcome,
  type Score,
} from "./rps-logic";
import { useHandGesture } from "./use-hand-gesture";
import { useRpsVoice } from "./use-rps-voice";

import type { PlayGameProps } from "../../play-types";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";


const RpsVrmStage = lazy(() => import("./RpsVrmStage"));

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TARGET = 3;
const ALL: Hand[] = ["rock", "paper", "scissors"];
type Phase = "idle" | "counting" | "result" | "over";
type Mode = "rps" | "muk";

const OUTCOME_KO: Record<Outcome, string> = { win: "승!", lose: "패…", draw: "무승부" };

export function RpsGame({ onExit }: PlayGameProps) {
  const [camera, setCamera] = useState(false);
  const { videoRef, gesture, status } = useHandGesture(camera);
  const [use3d, setUse3d] = useState(true);
  const [vrmReady, setVrmReady] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const { speak, supported: voiceSupported, voices, voiceURI, setVoiceURI } = useRpsVoice(voiceOn);

  const [mode, setMode] = useState<Mode>("rps");
  const [initiative, setInitiative] = useState<Initiative>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [score, setScore] = useState<Score>(EMPTY_SCORE);
  const [player, setPlayer] = useState<Hand | null>(null);
  const [ai, setAi] = useState<Hand | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [message, setMessage] = useState<string>("");

  const rngRef = useRef(seededRng(1));
  const historyRef = useRef<Hand[]>([]);
  const liveGesture = useRef<Hand | null>(null);
  const speakRef = useRef(speak);
  const modeRef = useRef(mode);
  const initiativeRef = useRef<Initiative>(null);
  const resolveShotRef = useRef<(h: Hand | null) => void>(() => {});

  useEffect(() => {
    liveGesture.current = gesture;
  }, [gesture]);
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    resolveShotRef.current = resolveShot;
  });

  const setInit = (v: Initiative) => {
    initiativeRef.current = v;
    setInitiative(v);
  };

  const winner = matchOver(score, TARGET);

  function resolveMuk(playerHand: Hand, aiHand: Hand) {
    const step = mukjjippaStep(initiativeRef.current, playerHand, aiHand);
    if (step.replay) {
      setOutcome("draw");
      setMessage("비겼어요 — 다시!");
      setPhase("result");
      speakRef.current("비겼다!");
      return;
    }
    if (step.matchWinner) {
      const won = step.matchWinner === "player";
      setOutcome(won ? "win" : "lose");
      setScore((s) => scoreReducer(s, won ? "win" : "lose"));
      setInit(null); // 다음 매치는 다시 선 정하기부터
      setMessage(won ? "묵찌빠 — 내가 이겼다!" : "묵찌빠 — 내가 졌다…");
      setPhase("result");
      speakRef.current(won ? "이겼다!" : "졌다…");
      return;
    }
    // 매치 계속 — 선 갱신.
    setInit(step.initiative);
    const mine = step.initiative === "player";
    setOutcome(null);
    setMessage(mine ? "내가 선공!" : "상대 선공!");
    setPhase("result");
    speakRef.current(mine ? "선공!" : "상대 선공!");
  }

  function resolveShot(playerHand: Hand | null) {
    if (!playerHand) {
      setMessage("손을 인식하지 못했어요 — 또렷하게 내봐요!");
      setPhase("idle");
      return;
    }
    historyRef.current = [...historyRef.current.slice(-8), playerHand];
    const aiHand = pickAiHand(rngRef.current, historyRef.current, true);
    setPlayer(playerHand);
    setAi(aiHand);
    if (modeRef.current === "muk") {
      resolveMuk(playerHand, aiHand);
      return;
    }
    const out = resolveRound(playerHand, aiHand);
    setOutcome(out);
    setScore((s) => scoreReducer(s, out));
    setMessage("");
    setPhase("result");
    speakRef.current(out === "win" ? "이겼다!" : out === "lose" ? "졌다…" : "비겼어!");
  }

  // 카운트다운(3→2→1→샷). 구호는 단계별 — 묵찌빠 공격 단계면 "묵·찌·빠!", 그 외 "가위·바위·보!".
  useEffect(() => {
    if (phase !== "counting") return;
    const muk = modeRef.current === "muk" && initiativeRef.current !== null;
    const words = muk ? ["묵", "찌", "빠!"] : ["가위", "바위", "보!"];
    if (count >= 1 && count <= 3) speakRef.current(words[3 - count]);
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), muk ? 520 : 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => resolveShotRef.current(liveGesture.current), 350);
    return () => clearTimeout(t);
  }, [phase, count]);

  // 결과 후 다음 라운드(또는 매치 종료).
  useEffect(() => {
    if (phase !== "result") return;
    const t = setTimeout(() => {
      setScore((s) => {
        if (matchOver(s, TARGET)) setPhase("over");
        else {
          setPhase("idle");
          setCount(3);
        }
        return s;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [phase]);

  // 카메라 모드: idle이면 잠시 후 자동으로 다음 카운트다운 시작(연속 플레이).
  useEffect(() => {
    if (!camera || phase !== "idle" || winner) return;
    if (status !== "ready") return;
    const t = setTimeout(() => {
      setCount(3);
      setPhase("counting");
    }, 700);
    return () => clearTimeout(t);
  }, [camera, phase, winner, status]);

  function restart() {
    rngRef.current = seededRng((Math.floor(score.round) + 7) * 2654435761);
    historyRef.current = [];
    setScore(EMPTY_SCORE);
    setPlayer(null);
    setAi(null);
    setOutcome(null);
    setMessage("");
    setCount(3);
    setInit(null);
    setPhase("idle");
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    modeRef.current = next;
    restart();
  }

  function toggleCamera() {
    setCamera((c) => !c);
    setPhase("idle");
    setCount(3);
    setMessage("");
  }

  const aiFace = outcome === "win" ? "😣" : outcome === "lose" ? "😎" : "🤖";

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 — 제목 + 게임 방법 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-fg">웹툰 가위바위보</h2>
        <GameHelp
          id="rps"
          title="웹툰 가위바위보"
          steps={[
            {
              emoji: "🎯",
              title: "목표",
              desc: (
                <>
                  <b className="text-fg">웹툰봇</b>을 이겨 <b className="text-fg">선승 {TARGET}점</b>을 먼저 따내요.
                </>
              ),
            },
            {
              emoji: "✊",
              title: "손 내기",
              desc: (
                <>
                  <span className="text-emerald-500">손동작</span>(웹캠)·<span className="text-amber-500">음성 구호</span> 따라 내거나,
                  카메라를 끄면 <b className="text-fg">가위·바위·보 버튼</b>으로 골라요.
                </>
              ),
            },
            {
              emoji: "⏱️",
              title: "타이밍",
              desc: (
                <>
                  <b className="text-fg">"가위·바위·보!"</b> 구호의 <b className="text-fg">"보!"</b> 순간에 든 손이 그 판의 선택이에요.
                </>
              ),
            },
            {
              emoji: "🤜",
              title: "묵찌빠",
              desc: (
                <>
                  탭을 <b className="text-fg">묵찌빠</b>로 바꾸면 먼저 <span className="text-amber-500">선(先)</span>을 잡고,
                  같은 손이 나오는 순간 선을 쥔 쪽이 이겨요.
                </>
              ),
            },
            {
              emoji: "🏆",
              title: "승부",
              desc: (
                <>
                  이기면 <span className="text-emerald-500">내 점수</span>, 지면 <span className="text-rose-500">봇 점수</span>가 올라가요.
                  먼저 <b className="text-fg">{TARGET}점</b>이면 최종 승리!
                </>
              ),
            },
          ]}
        />
      </div>

      {/* 모드 전환 */}
      <div className="flex items-center justify-center gap-1 rounded-full border border-line bg-card/50 p-1 text-sm" role="tablist" aria-label="게임 모드">
        {(["rps", "muk"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 font-medium transition",
              mode === m ? "bg-accent text-on-accent" : "text-fg-2 hover:text-fg",
            )}
          >
            {m === "rps" ? "가위바위보" : "묵찌빠"}
          </button>
        ))}
      </div>

      {/* 점수판 */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-card/50 px-4 py-2 text-sm">
        <span className="font-semibold text-emerald-500">
          나 {score.win}
          {mode === "muk" && initiative === "player" && <span className="ml-1 text-[0.7rem] text-amber-500">●선</span>}
        </span>
        <span className="text-fg-3">선승 {TARGET}{mode === "rps" ? ` · ${score.draw}무` : ""}</span>
        <span className="font-semibold text-rose-500">
          {mode === "muk" && initiative === "ai" && <span className="mr-1 text-[0.7rem] text-amber-500">선●</span>}
          {score.lose} 봇
        </span>
      </div>

      {/* 대결 무대 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 플레이어 */}
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3">
          {camera ? (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black/40">
              <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
              {status === "ready" && (
                <div className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-lg">
                  {gesture ? HAND_EMOJI[gesture] : "🖐?"}
                </div>
              )}
              {status !== "ready" && (
                <div className="absolute inset-0 grid place-items-center px-2 text-center text-[0.7rem] text-white/90">
                  {status === "loading" && "카메라 준비 중…"}
                  {status === "denied" && "카메라 권한이 거부됨 — 버튼으로 플레이하세요"}
                  {status === "error" && "카메라를 열 수 없어요 — 버튼으로 플레이"}
                </div>
              )}
            </div>
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-emerald-500/10 text-5xl">
              {phase === "result" && player ? HAND_EMOJI[player] : "🙂"}
            </div>
          )}
          <span className="text-xs font-medium text-fg-2">나</span>
        </div>

        {/* 봇 — 3D VRM 캐릭터 상대(폴백: 이모지) */}
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-gradient-to-b from-rose-500/15 to-violet-500/10">
            {use3d ? (
              <>
                <Suspense fallback={null}>
                  <RpsVrmStage
                    hand={phase === "result" ? ai : null}
                    outcome={phase === "result" ? outcome : null}
                    onReady={() => setVrmReady(true)}
                  />
                </Suspense>
                {!vrmReady && <div className="absolute inset-0 grid place-items-center text-5xl">{aiFace}</div>}
                {/* 제스처 가독성 보조 오버레이 */}
                {phase === "result" && ai && (
                  <div className="absolute bottom-1 right-1 rounded-md bg-black/55 px-1.5 py-0.5 text-2xl">{HAND_EMOJI[ai]}</div>
                )}
                {phase === "counting" && <div className="absolute bottom-1 right-1 text-2xl">❓</div>}
              </>
            ) : (
              <div className="grid h-full w-full place-items-center text-5xl">
                {phase === "result" && ai ? HAND_EMOJI[ai] : phase === "counting" ? "❓" : aiFace}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setUse3d((v) => !v)}
            className="inline-flex items-center gap-1 text-[0.66rem] text-fg-3 hover:text-fg-2"
          >
            <Box className="h-3 w-3" /> {use3d ? "웹툰봇 (3D)" : "웹툰봇 (2D)"}
          </button>
        </div>
      </div>

      {/* 중앙 상태 */}
      <div className="min-h-[2.2rem] text-center" aria-live="polite">
        {phase === "counting" && (
          <span className="text-2xl font-extrabold text-accent">
            {count > 0 ? count : mode === "muk" && initiative !== null ? "빠!" : "냅다!"}
          </span>
        )}
        {phase === "result" && outcome && (
          <span
            className={cn(
              "text-xl font-extrabold",
              outcome === "win" && "text-emerald-500",
              outcome === "lose" && "text-rose-500",
              outcome === "draw" && "text-fg-2",
            )}
          >
            {message || OUTCOME_KO[outcome]} {player && ai && `(${HAND_LABEL[player]} vs ${HAND_LABEL[ai]})`}
          </span>
        )}
        {phase === "result" && !outcome && message && (
          <span className="text-lg font-bold text-amber-500">
            {message} {player && ai && `(${HAND_LABEL[player]} vs ${HAND_LABEL[ai]})`}
          </span>
        )}
        {phase === "over" && (
          <span className="text-xl font-extrabold text-accent">
            {winner === "player" ? "🏆 최종 승리!" : "💀 최종 패배"}
          </span>
        )}
        {phase === "idle" && message && <span className="text-sm text-rose-500">{message}</span>}
        {phase === "idle" && !message && camera && status === "ready" && <span className="text-sm text-fg-3">손을 준비하세요…</span>}
      </div>

      {/* 조작 */}
      {phase === "over" ? (
        <div className="flex items-center justify-center gap-2">
          <Button variant="solid" onClick={restart}>
            <RotateCcw className="mr-1 h-4 w-4" /> 다시
          </Button>
          <Button variant="outline" onClick={onExit}>다른 게임</Button>
        </div>
      ) : (
        <>
          {!camera && (
            <div className="flex items-center justify-center gap-3">
              {ALL.map((h) => (
                <button
                  key={h}
                  type="button"
                  disabled={phase === "result"}
                  onClick={() => resolveShot(h)}
                  className={cn(
                    "grid h-16 w-16 place-items-center rounded-2xl border-2 border-line bg-card text-3xl transition",
                    "hover:-translate-y-1 hover:border-accent disabled:opacity-50",
                  )}
                  aria-label={HAND_LABEL[h]}
                >
                  {HAND_EMOJI[h]}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant={camera ? "solid" : "outline"} size="sm" onClick={toggleCamera}>
              {camera ? <CameraOff className="mr-1 h-4 w-4" /> : <Camera className="mr-1 h-4 w-4" />}
              {camera ? "버튼으로 플레이" : "손동작으로 플레이"}
            </Button>
            {voiceSupported && (
              <Button variant={voiceOn ? "solid" : "outline"} size="sm" onClick={() => setVoiceOn((v) => !v)}>
                {voiceOn ? <Volume2 className="mr-1 h-4 w-4" /> : <VolumeX className="mr-1 h-4 w-4" />}
                음성 {voiceOn ? "켬" : "끔"}
              </Button>
            )}
            {voiceSupported && voiceOn && voices.length > 1 && (
              <select
                aria-label="음성 선택"
                value={voiceURI ?? ""}
                onChange={(e) => setVoiceURI(e.target.value)}
                className="max-w-[11rem] rounded-lg border border-line bg-card px-2 py-1 text-[0.72rem] text-fg-2"
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name.replace(/Microsoft|Google|\(.*?\)/g, "").trim() || v.name}
                  </option>
                ))}
              </select>
            )}
            {!camera && (
              <span className="inline-flex items-center gap-1 text-[0.7rem] text-fg-3">
                <HandIcon className="h-3.5 w-3.5" /> 버튼을 눌러 한 판
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default RpsGame;
