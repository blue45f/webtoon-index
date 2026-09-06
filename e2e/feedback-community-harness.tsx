// Test-only entry: not referenced by the production app or build. All API responses are fixture-routed by Playwright.
import { createRoot } from "react-dom/client";

import { useApp } from "../apps/web/src/shared/lib/store";
import { FeedbackPage } from "../apps/web/src/domains/legal/FeedbackPage";
import "../apps/web/src/styles/globals.css";

const viewer = new URLSearchParams(window.location.search).get("viewer");
useApp.getState().setSessionIdentity(viewer === "guest" ? null : "member", null);
const root = document.getElementById("root");
if (!root) throw new Error("Feedback test mount missing");
createRoot(root).render(<><div style={{ borderBottom: "1px solid var(--color-line)", padding: "16px 32px", display: "flex", justifyContent: "space-between", color: "var(--color-fg-2)", fontSize: 12 }}><strong>ToonStudio</strong><span>UI 검증 · 테스트 데이터</span></div><main><FeedbackPage /></main></>);
