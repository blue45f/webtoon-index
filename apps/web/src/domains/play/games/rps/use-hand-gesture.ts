// 웹캠 손동작 훅 — MediaPipe HandLandmarker로 손을 잡아 가위/바위/보를 실시간 분류한다.
// 스튜디오의 트래킹 인프라(initHandLandmarker, solveHandToFingerBones)를 재사용한다.

import { useEffect, useRef, useState } from "react";

import { classifyGesture, stabilizeGesture, type Hand } from "./rps-logic";

import { solveHandToFingerBones } from "@/src/domains/creator/vrm/studio-vrm-hand-solver";
import {
  disposeHandLandmarker,
  initHandLandmarker,
} from "@/src/domains/creator/vrm/studio-vrm-webcam-tracking";


export type GestureStatus = "idle" | "loading" | "ready" | "denied" | "error";

export interface HandGestureState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  gesture: Hand | null;
  status: GestureStatus;
}

/** enabled가 true일 때만 카메라+추적을 가동한다. gesture는 디바운스된 현재 손. */
export function useHandGesture(enabled: boolean): HandGestureState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [gesture, setGesture] = useState<Hand | null>(null);
  const [status, setStatus] = useState<GestureStatus>("idle");
  const samplesRef = useRef<(Hand | null)[]>([]);
  const gestureRef = useRef<Hand | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setGesture(null);
      gestureRef.current = null;
      samplesRef.current = [];
      return;
    }

    let active = true;
    let raf = 0;
    let stream: MediaStream | null = null;
    let videoEl: HTMLVideoElement | null = null;
    let lastTime = -1;
    setStatus("loading");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!active) return;
        const video = videoRef.current;
        if (!video) return;
        videoEl = video;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const hand = await initHandLandmarker();
        if (!active) return;
        setStatus("ready");

        const loop = () => {
          if (!active) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.currentTime !== lastTime) {
            lastTime = v.currentTime;
            const res = hand.detectForVideo(v, performance.now());
            const lm = res?.landmarks?.[0];
            let g: Hand | null = null;
            if (lm) {
              const curls = solveHandToFingerBones(lm, "right");
              g = classifyGesture(curls, "right");
            }
            const buf = samplesRef.current;
            buf.push(g);
            if (buf.length > 8) buf.shift();
            const stable = stabilizeGesture(buf, 5);
            if (stable !== gestureRef.current) {
              gestureRef.current = stable;
              setGesture(stable);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (!active) return;
        const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setStatus(denied ? "denied" : "error");
      }
    })();

    return () => {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      if (stream) for (const t of stream.getTracks()) t.stop();
      if (videoEl) videoEl.srcObject = null;
      disposeHandLandmarker();
      samplesRef.current = [];
      gestureRef.current = null;
    };
  }, [enabled]);

  return { videoRef, gesture, status };
}
