/**
 * Studio GIF Element — 업로드된 애니메이션 GIF를 "재생되는 캔버스 요소"로 다루기 위한 순수 감지
 * 로직. 미리캔버스의 "움직이는 GIF 추가" 대응 — 단, 이 모듈은 **GIF를 디코딩하지 않는다.**
 *
 * ── 스코프(의도적 축소, 근거) ────────────────────────────────────────────────
 * 브라우저의 `<img src="data:image/gif;base64,...">` 자체가 이미 GIF 애니메이션을 네이티브로
 * 디코딩·재생한다 — 프레임 파싱·LZW 압축 해제·팔레트 합성을 전부 브라우저 엔진이 알아서 한다.
 * 이 앱이 새로 만들 필요가 있는 건 딱 하나, "지금 이 이미지 요소가 애니메이션 GIF라서 주기적으로
 * 다시 그려야 한다"는 판정뿐이다 — 그래서 이 모듈은 프레임을 하나도 디코딩하지 않고, GIF 바이너리
 * 헤더만 가볍게 훑어 **Graphic Control Extension(GCE) 블록이 하나라도 있는지**만 확인한다.
 * 실사용되는 거의 모든 GIF 인코더(포토샵/ffmpeg/브라우저/Giphy 등)는 프레임 지연시간(delay)을
 * 지정하려면 GCE가 반드시 필요하므로, "GCE 존재 = 애니메이션(다중 프레임) GIF"는 실무적으로 아주
 * 신뢰도 높은 신호다(완전한 형식적 보증은 아니다 — §알려진 한계 참고).
 *
 * ── 왜 외부 라이브러리(gifuct-js 등)를 안 쓰는가 ────────────────────────────
 * 이 저장소는 새 npm 의존성 추가가 금지된 배치에서 작성됐다. 전체 GIF 디코딩(팔레트 합성 →
 * ImageData 프레임 배열)은 상당한 스코프라 실용적이지 않지만, "GCE 블록이 있는가"만 보는 것은
 * GIF89a 스펙의 블록 구조(도입자 바이트로 구분되는 가변길이 청크 나열)를 그대로 한 번 훑으면 되는
 * 가벼운 작업이라 순수 TypeScript로 안전하게 구현 가능하다.
 *
 * ── GIF 블록 구조 요약(87a/89a 공통, GCE는 89a 전용) ────────────────────────
 * Header(6B "GIF87a"/"GIF89a") → Logical Screen Descriptor(7B, packed 바이트에 Global Color
 * Table 유무·크기) → [Global Color Table] → 블록 나열(Trailer 0x3B 전까지):
 *   - Extension Introducer(0x21) + Label(1B) + 서브블록열(각 서브블록=크기(1B)+데이터, 크기0=종료)
 *     · Label 0xF9 = Graphic Control Extension(우리가 찾는 것) → 발견 즉시 true.
 *     · Label 0xFE(Comment)/0x01(Plain Text)/0xFF(Application, 예: NETSCAPE2.0 반복재생)는 같은
 *       서브블록 규칙으로 스킵만 한다(라벨별 분기 불필요 — 스펙상 라벨과 무관하게 항상 크기-접두
 *       서브블록열이라 제네릭하게 건너뛸 수 있다).
 *   - Image Descriptor(0x2C) + 9B 기술자(마지막 바이트 packed에 Local Color Table 유무·크기) →
 *     [Local Color Table] → LZW 최소 코드 크기(1B) → 이미지 데이터 서브블록열(위와 동일 규칙).
 *     **픽셀 데이터 자체는 디코딩하지 않고 서브블록 크기만큼 건너뛴다.**
 *   - Trailer(0x3B) 도달 = 스트림 끝, GCE 못 찾음.
 * 위 두 서브블록-스킵 루프는 오프셋이 매 반복 최소 1바이트 이상 전진을 보장하므로(크기 0인
 * 서브블록도 종료 마커로 소비된다) 무한루프가 구조적으로 불가능하다 — 그래도 비정상/손상 입력에
 * 대비해 `GIF_SCAN_BYTE_LIMIT`으로 한 번 더 방어한다(아래 참고).
 *
 * ── 실패 시 정책: 항상 "안전한 쪽"(false)으로 닫힌다 ─────────────────────────
 * 버퍼가 잘렸거나, 알 수 없는 블록 도입자를 만나거나, 스캔 상한을 넘으면 예외를 던지지 않고
 * `false`를 반환한다 — 최악의 경우 진짜 애니메이션 GIF를 정적으로 오판정하는 것뿐이라(캔버스에
 * 첫 프레임만 그려짐 — 업로드 자체나 다른 기능을 절대 깨뜨리지 않는다), fail-closed가 안전하다.
 *
 * DOM 임포트 없음(studio-skew.ts와 동일한 관례) — 유일한 전역 의존은 `atob`(브라우저와 Node 16+
 * 양쪽에 표준으로 존재하는 전역 함수, 이 저장소의 Node 요구 버전은 24+)뿐이라 Vitest(node
 * environment)에서도 폴리필 없이 그대로 동작한다.
 */

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** GIF Extension Introducer — 그 다음 바이트가 확장 블록의 Label이다. */
const GIF_EXTENSION_INTRODUCER = 0x21;
/** Graphic Control Extension의 Label 바이트 — 이게 있으면 애니메이션으로 판정한다. */
const GIF_GRAPHIC_CONTROL_LABEL = 0xf9;
/** Image Descriptor 블록 도입자. */
const GIF_IMAGE_DESCRIPTOR = 0x2c;
/** Trailer(스트림 종료) 바이트. */
const GIF_TRAILER = 0x3b;

/**
 * 스캔 바이트 상한(8MiB) — 손상/비정상 GIF가 Trailer도 못 만나고 끝없이 서브블록을 반복하는
 * 병적인 입력에서도 스캔 비용을 이 이하로 강제 제한한다. 실제 애니메이션 GIF의 첫 GCE는 헤더
 * 직후(수백 바이트~수 KB 이내)에 나타나므로, 이 상한 안에서 못 찾으면 정직하게 "애니메이션 아님"
 * 으로 판정해도 실사용에서 오탐(진짜 애니메이션인데 놓치는 경우)은 사실상 없다.
 */
export const GIF_SCAN_BYTE_LIMIT = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// (1) 파일이 .gif 인지 감지 — 이름/MIME 기반, 동기, I/O 없음
// ---------------------------------------------------------------------------

/** `isGifFile`이 받는 최소 구조 — 실제 `File`은 이 구조를 만족하므로 그대로 넘길 수 있다. */
export interface GifFileLike {
  name: string;
  type?: string;
}

/**
 * 파일이 GIF인지(확장자 또는 MIME 타입) 감지한다. 업로드 처리에서 "이 파일은 캔버스 다운스케일
 * 재인코딩 경로를 타면 안 된다(애니메이션이 깨진다)"를 판단하는 첫 관문(빠르고 저렴한 사전 체크) —
 * 실제 바이트가 진짜 GIF인지, 그중 애니메이션인지는 `isAnimatedGifBytes`/`isAnimatedGifDataUrl`이
 * 뒤이어 확정한다. 이름/타입 중 하나만 일치해도 true — 과다 판정의 유일한 실질적 효과는 "원본
 * 바이트를 그대로 보존하는 경로를 탄다"는 것뿐이라(그 다음 GCE 스캔이 실제 애니메이션 여부를
 * 별도로 가른다) 관대하게 판단해도 안전하다.
 */
export function isGifFile(file: GifFileLike): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type === "image/gif") return true;
  return /\.gif$/i.test(file.name ?? "");
}

// ---------------------------------------------------------------------------
// (2) 애니메이션 GIF 여부 판별 — 바이너리 헤더 스캔, 전체 디코딩 없음
// ---------------------------------------------------------------------------

/** GIF 매직 바이트("GIF87a"/"GIF89a") 확인 — 6바이트 미만이면 GIF일 수 없다. */
function hasGifSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // '7'(GIF87a) 또는 '9'(GIF89a)
    bytes[5] === 0x61 // a
  );
}

/**
 * 크기-접두 서브블록열을 건너뛴다(Extension/Image Data 공통 규칙) — 각 서브블록은
 * [크기(1B)][데이터(크기 B)]이고, 크기 0 바이트가 종료 마커다. 반환값은 종료 마커 다음
 * 오프셋(다음 블록 시작 위치), 스캔 상한/버퍼 끝에 먼저 닿으면 null(스트림이 잘렸거나 손상).
 */
function skipGifSubBlocks(bytes: Uint8Array, start: number, scanLen: number): number | null {
  let pos = start;
  while (pos < scanLen) {
    const size = bytes[pos];
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return null;
}

/**
 * 주어진 바이트가 "Graphic Control Extension 블록을 하나 이상 포함한 GIF"인지 판별한다 —
 * 이것이 곧 "애니메이션 GIF"의 실무적 정의다(헤더 설명 참고). 픽셀 데이터는 절대 디코딩하지
 * 않고, 블록 도입자만 보고 각 블록의 선언된 길이만큼 건너뛴다. 잘린 버퍼·미지의 블록·스캔 상한
 * 초과 등 확신할 수 없는 모든 경우 false(안전한 기본값 — 최악의 결과는 "정적으로 오판정"뿐).
 */
export function isAnimatedGifBytes(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!hasGifSignature(bytes)) return false;
  if (bytes.length < 13) return false; // Header(6)+Logical Screen Descriptor(7) 미만 = 잘린 파일.

  const scanLen = Math.min(bytes.length, GIF_SCAN_BYTE_LIMIT);
  const logicalScreenPacked = bytes[10]; // Header(6)+width(2)+height(2) 다음 바이트.
  let offset = 13; // Header(6) + Logical Screen Descriptor(7).
  if (logicalScreenPacked & 0x80) {
    // Global Color Table Flag — 크기 필드(하위 3비트) N → 2^(N+1)개 항목 × 3바이트(RGB).
    const entries = 1 << ((logicalScreenPacked & 0x07) + 1);
    offset += entries * 3;
  }

  while (offset < scanLen) {
    const introducer = bytes[offset];
    if (introducer === GIF_TRAILER) return false; // 스트림 끝까지 GCE 없음.
    if (introducer === GIF_EXTENSION_INTRODUCER) {
      if (offset + 1 >= scanLen) return false; // Label 바이트를 읽을 수 없음(잘림).
      if (bytes[offset + 1] === GIF_GRAPHIC_CONTROL_LABEL) return true; // 발견!
      const next = skipGifSubBlocks(bytes, offset + 2, scanLen);
      if (next === null) return false;
      offset = next;
      continue;
    }
    if (introducer === GIF_IMAGE_DESCRIPTOR) {
      // Image Descriptor = 도입자(1B) + left/top/width/height(각 2B) + packed(1B) = 10B.
      if (offset + 10 > scanLen) return false;
      const imagePacked = bytes[offset + 9];
      let pos = offset + 10;
      if (imagePacked & 0x80) {
        // Local Color Table Flag — Global과 동일한 크기 공식.
        const entries = 1 << ((imagePacked & 0x07) + 1);
        pos += entries * 3;
      }
      if (pos >= scanLen) return false; // LZW 최소 코드 크기 바이트를 읽을 수 없음.
      pos += 1; // LZW 최소 코드 크기(값 자체는 픽셀 디코딩에만 필요 — 스킵에는 무관).
      const next = skipGifSubBlocks(bytes, pos, scanLen);
      if (next === null) return false;
      offset = next;
      continue;
    }
    return false; // 알 수 없는 블록 도입자 — 손상되었거나 지원 밖 스트림, 안전하게 false.
  }
  return false; // 스캔 상한(GIF_SCAN_BYTE_LIMIT) 도달 — 그 안에서 GCE를 못 찾음.
}

// ---------------------------------------------------------------------------
// (3) data: URL ↔ 바이트 변환 — StudioPage 통합용 얇은 접착 헬퍼
// ---------------------------------------------------------------------------

/**
 * `data:<mime>;base64,<...>` 문자열에서 원본 바이트를 복원한다. base64가 아니거나(예:
 * URL-인코딩 텍스트 data: URL) 형식이 안 맞거나 디코딩이 실패하면 null(예외를 던지지 않는다 —
 * 호출부가 매번 try/catch를 두지 않아도 되게, studio-ai-client.ts의 "throw 없이 항상 결과
 * 타입으로 실패를 알린다" 관례와 동일한 정신).
 */
export function gifBytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const match = /^data:[^,]*;base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null; // atob가 잘못된 base64에 DOMException을 던지는 경우 — fail-closed.
  }
}

/**
 * `isAnimatedGifBytes` + `gifBytesFromDataUrl`의 합성 — StudioPage 통합 지점에서 이미
 * `FileReader.readAsDataURL`로 읽어 둔 문자열 하나만 있으면 이 함수 한 번으로 판정이 끝난다
 * (별도로 파일을 다시 읽을 필요 없음). data: URL이 아니거나 GIF가 아니면 false.
 */
export function isAnimatedGifDataUrl(dataUrl: string): boolean {
  const bytes = gifBytesFromDataUrl(dataUrl);
  return bytes !== null && isAnimatedGifBytes(bytes);
}
