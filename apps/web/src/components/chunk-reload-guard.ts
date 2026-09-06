// 새 배포 뒤 삭제된 청크를 참조하면 전체 새로고침이 필요하다. React ErrorBoundary와
// 이벤트/effect 기반 동적 import가 같은 세션당 1회 게이트를 공유해 이중 새로고침을 막는다.
export {
  CHUNK_RELOAD_FLAG,
  hasAttemptedChunkReload,
  markChunkReloadAttempted,
} from "../shared/lib/chunk-load-recovery";
