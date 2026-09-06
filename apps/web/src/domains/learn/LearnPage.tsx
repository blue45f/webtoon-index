import { Link, useLocation } from "react-router-dom";

import { LearnPage as LearnContent } from "./LearnContent";
import { LearningRecordsPage } from "./LearningRecordsPage";

import "./learning-enhancements.css";

/** Public lazy entry; curriculum content and record management share the same document-local store. */
export function LearnPage() {
  const { pathname } = useLocation();
  if (pathname === "/learn/records" || pathname === "/learn/records/") {
    return <LearningRecordsPage />;
  }
  return (
    <>
      <aside className="learn-record-shortcut" lang="ko" aria-label="학습 기록 관리">
        <Link to="/learn/records">내 학습 기록 · 백업 / 복원 →</Link>
      </aside>
      <LearnContent />
    </>
  );
}
