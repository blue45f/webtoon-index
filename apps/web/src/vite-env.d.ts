/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Studio live ink: auto(default) selects the low-latency Canvas2D overlay before an operation.
  // `webgpu` is an explicit measured rollout; device/pipeline failure ends as unavailable.
  readonly VITE_STUDIO_LIVE_INK_BACKEND?: "auto" | "webgpu" | "canvas2d";
  // Percentage of locally bucketed, WebGPU-capable browsers admitted when the backend is `auto`.
  // Missing/invalid values are 0; explicit backend controls remain the pre-operation override.
  readonly VITE_STUDIO_LIVE_INK_ROLLOUT_PERCENT?: string;
  // Emergency build-time off switch. `1`, `true`, or `on` marks live ink unavailable without
  // selecting another renderer.
  readonly VITE_STUDIO_LIVE_INK_KILL_SWITCH?: string;
  // 장기 실행 Nest Socket.IO origin. Vercel serverless HTTP API와 realtime을 분리할 때 사용.
  readonly VITE_STUDIO_LIVE_ORIGIN?: string;
  // 로컬 Vite의 /socket.io + /studio-live 프록시를 실제 Nest 개발 서버에 연결할 때만 true.
  // 미설정이면 개발 빌드도 브라우저 로컬 협업으로 fail-closed한다.
  readonly VITE_STUDIO_LIVE_DEV_PROXY_ENABLED?: "true";
  // STUN-only WebRTC data-channel mesh for cursors/heartbeats/chat. Default on; `false` keeps
  // those envelopes on the server/Cloudflare path.
  readonly VITE_STUDIO_LIVE_P2P_ENABLED?: "false";
  // Cloudflare Durable Objects 기반 presence·댓글 invalidation·화면공유 signaling origin.
  // 경로·쿼리·인증정보 없는 정확한 HTTPS origin만 허용하며 미설정/오류 시 기존 transport를 유지한다.
  readonly VITE_STUDIO_REALTIME_ORIGIN?: string;
  // API와 Worker에 설정한 provider id가 기본값과 다를 때만 설정한다.
  readonly VITE_STUDIO_REALTIME_PROVIDER_ID?: string;
  // DeskCloud 네이티브 통합(@heejun/deskcloud) — 각 desk 의 API 베이스 URL.
  // 미설정 시 해당 통합을 마운트하지 않는다(앱 무영향). 선택 VITE_*_PK 는 publishable 키
  // (pk_…, 미설정 시 'pk_demo' 폴백, 브라우저 노출 안전).
  // SurveyDesk — 인앱 피드백 설문.
  readonly VITE_SURVEYDESK_URL?: string;
  readonly VITE_SURVEYDESK_PK?: string;
  // ChangelogDesk — 'What's new' 인앱 체인지로그.
  readonly VITE_CHANGELOGDESK_URL?: string;
  readonly VITE_CHANGELOGDESK_PK?: string;
  // NotifyDesk — 인앱 알림 벨/인박스.
  readonly VITE_NOTIFYDESK_URL?: string;
  readonly VITE_NOTIFYDESK_PK?: string;
  // desk-platform — 공개 문의(Inquiry) 게시판 백엔드 베이스 URL.
  // 미설정 시 prod 기본값(https://desk-platform.vercel.app)으로 폴백한다. (lib/inquiry-api.ts)
  readonly VITE_DESK_PLATFORM_URL?: string;
  // `1` re-enables automatic visits/ping. Default off — desk-platform currently 502s without CORS.
  readonly VITE_DESK_PLATFORM_VISITS?: "1";
}
