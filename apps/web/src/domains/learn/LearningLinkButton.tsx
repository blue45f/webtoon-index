import { useId, useState } from "react";

export function LearningLinkButton({ makePath }: { makePath: () => string }) {
  const id = useId();
  const [manualUrl, setManualUrl] = useState("");
  const [message, setMessage] = useState("");
  async function copy() {
    let url = "";
    try {
      url = `${window.location.origin}${makePath()}`;
      await navigator.clipboard.writeText(url);
      setManualUrl("");
      setMessage("현재 예제 설정과 설명 단계의 링크를 복사했습니다. 개인 메모와 학습 기록은 포함하지 않습니다.");
    } catch {
      setManualUrl(url);
      setMessage(url ? "자동 복사를 사용할 수 없습니다. 아래 링크를 선택해 직접 복사하세요." : "공유 링크를 만들지 못했습니다. 강좌 주소를 확인하세요.");
    }
  }
  return (
    <div className="learn-share">
      <button type="button" onClick={() => { void copy(); }}>이 예제 설정 공유</button>
      {message && <p className="learn-small" role="status">{message}</p>}
      {manualUrl && <><label htmlFor={`${id}-url`}>직접 복사할 예제 링크</label><input id={`${id}-url`} type="text" value={manualUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></>}
    </div>
  );
}
