/**
 * DeskCloud 네이티브 마운트 — 형제 앱 공통 기능(피드백 설문·"What's new" 체인지로그·인앱 알림)을
 * 외부 위젯 번들이 아니라 **공식 npm SDK(@heejun/deskcloud)** 의 타입드 브라우저 클라이언트로
 * 연결하고, 화면은 **이 앱의 디자인 토큰/컴포넌트**로 직접 렌더한다(네이티브 룩앤필).
 *
 * 각 desk 는 자기 env URL(VITE_<DESK>DESK_URL)이 설정됐을 때만 렌더되며(env-gate, 각 Native*
 * 컴포넌트 내부에서 판단), 미설정이면 null 을 반환해 앱에 무영향이다. 미설정 시 앱의 기존
 * 1차(first-party) 기능(자체 ⌘K 팔레트·/feedback Q&A 등)이 그대로 동작한다.
 *
 * 보안: 브라우저 코드는 publishable(pk_) 표면만 쓴다. `@heejun/deskcloud/server`(sk_)는 절대
 * import 하지 않는다(클라이언트 번들에 비밀키 미포함).
 *
 * ── 플로팅 위치 규약(겹침 방지) ──────────────────────────────────────────────
 *   · 우상단: SurveyDesk 피드백(NativeFeedback)
 *   · 우하단: ChangelogDesk "새 소식"(NativeChangelog)
 *   · 좌상단(헤더 아래): NotifyDesk 알림 벨(NativeNotify)
 */
import { NativeChangelog } from "./NativeChangelog";
import { NativeFeedback } from "./NativeFeedback";
import { NativeNotify } from "./NativeNotify";

import type { ReactElement } from "react";

export function DeskCloudMounts(): ReactElement {
  return (
    <>
      {/* SurveyDesk — 인앱 피드백 설문(우상단, 본문 위 비침습) */}
      <NativeFeedback />
      {/* ChangelogDesk — "새 소식" 플로팅 런처(우하단) */}
      <NativeChangelog />
      {/* NotifyDesk — 알림 벨(좌상단, 헤더 아래 슬롯) */}
      <NativeNotify />
    </>
  );
}

export default DeskCloudMounts;
