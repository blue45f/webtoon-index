/**
 * Lightweight browser harness for Hybrid DCC multi-tool Playwright E2E.
 * Not part of the production Studio shell entry.
 */
import { createRoot } from "react-dom/client";

import { StudioHybridDccPanel } from "@/src/domains/creator/hybrid-dcc/StudioHybridDccPanel";
import "@/src/styles/globals.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("hybrid-dcc-e2e: missing #root");
}
createRoot(root).render(
  <main data-hybrid-dcc-e2e-root="true">
    <StudioHybridDccPanel />
  </main>,
);
