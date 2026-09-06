# Character Shaper (캐릭터 셰이퍼) — design brief and build contract

Date: 2026-09-04 · Status: build contract for the `claude/shaper-site-analysis-implementation` wave

## 0. Why this exists

NAVER WEBTOON's SHAPER (shaper.webtoons.com) presents a webtoon character tool as four promises:
**presets** (14 combinable categories: face shape, eyes, irises, nose, mouth, ears, hair, body, tops,
bottoms, shoes, accessories, pose, hand pose), **direct drawing on the model**, **AI assistance**
(reference-image preset recommendation, photo/camera pose recognition), and **creator utilities**
(transparent background, layer-separated PSD). Its public site is a calm, image-first landing with a
four-step "HOW TO" guide.

ToonStudio already ships every engine piece (see `docs/studio-shaper-quality-gap-audit-2026-09-03.md`)
but presents them as a developer tool: five top tabs × five sub tabs, text chips instead of visual
presets, IK jargon before creative intent, and a viewport that shares space with paragraphs. The
job of this wave is a **product-grade surface** whose convenience, UI/UX and visual quality exceed
SHAPER's, built on the existing runtime rather than beside it.

Non-goals: copying SHAPER's UI, marketing copy, assets or naming; a second scene document; fake
"applied" states for capabilities a model does not have.

## 1. Product definition

**Name:** 캐릭터 셰이퍼 · Character Shaper · route `/studio/character` (surface id `character`).

**One-line:** "프리셋으로 시작하고, 사진·웹캠으로 포즈를 잡고, 모델 위에 직접 그리고, 투명 PNG·레이어 PSD로 컷에 넣는다."

**Primary path (no numeric slider needed):**

1. Pick a VRM (bundled library or upload) — the model loads in a large viewport.
2. Walk the **slot rail** (15 slots) and click visual cards. Each click applies immediately and is
   one undo step. The summary bar shows what changed.
3. Drop a reference image → AI recommends a full recipe + palette; apply in one click.
4. Drop a photo or turn on the webcam → pose lands on the model; choose which body region to keep.
5. Toggle 표면 드로잉 and paint on the model (brush / eraser / eyedropper / fill).
6. 투명 배경 on → "캔버스에 추가" (transparent PNG into the current page) or "PSD 내보내기"
   (semantic layers: skin, face, eyes, hair, top, bottom, shoes, accessory, shadow, highlight, line).

**Secondary path:** every slot has a *precision inspector* (range + number input, reset, default
marker) and the whole legacy builder remains one click away as "고급 편집".

## 2. Information architecture

```text
┌ Summary bar ─────────────────────────────────────────────────────────────────────┐
│ ⟵ 캐릭터 셰이퍼 · [모델명 ▾] · 스타일 요약 · 팔레트 ●●●● · 변경 n · ↶ ↷ · 비교(hold) · 저장 · 고급 · ✕ │
├ Slot rail ┬ Shelf ───────────────┬ Viewport ───────────────────────┬ Inspector ─────────┤
│ 얼굴형     │ 검색 · 장르 필터        │ large 3D view                    │ 선택 항목 미리보기    │
│ 눈        │ 추천 strip            │ camera presets (정면/사선/상반신…) │ 정밀 조절 (range+num)│
│ 눈동자     │ 2-col visual cards     │ turntable · 툰 아웃라인 · 투명 bg  │ 색상 (팔레트/HEX)     │
│ 코 …      │ states: selected /     │ zoom/reset · 그리드/프레임 가이드    │ 지원 범위 노트        │
│ 헤어 · 체형 │ partial / unavailable  │ paint HUD when 표면 드로잉 on      │ (advanced collapsed) │
│ 상의 하의  │ keyboard roving focus  │                                   │                      │
│ 신발 액세서리│                       │                                   │                      │
│ 표정 포즈 손│                       │                                   │                      │
├ Dock ────────────────────────────────────────────────────────────────────────────┤
│ [참고 이미지 AI 추천] [사진 포즈] [웹캠] │ [표면 드로잉] │ 투명 배경 ○ [캔버스에 추가] [PNG] [PSD] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Desktop ≥ 1280: rail 72px, shelf 320–360px, viewport flexible (never < 520px wide), inspector
  320px (collapsible). Dialog max-width 1600px, height = viewport minus safe areas.
- Tablet 768–1279: inspector becomes a slide-over from the right; shelf 280px.
- Mobile < 768: viewport on top (min 44vh), horizontal slot rail, shelf + inspector in a bottom
  sheet with a drag handle and two snap points; dock collapses into a "＋" action sheet.
- Reference drawer (AI recommendation / photo pose / webcam) opens as a left slide-over covering
  the shelf; closing it returns focus to the dock button that opened it.
- Reduced motion: no card entrance animation, no turntable auto-start, state feedback stays.

## 3. Interaction rules (acceptance-critical)

- Cards: 4:5 preview viewport, name, one-line intent, compatibility badge. States: default, hover,
  focus-visible, selected (accent ring + check), partial (warn badge + reason), unavailable
  (dimmed + reason, still focusable, `aria-disabled`), applying (spinner ≤ 1 frame budget shown
  only if > 120 ms). Touch targets ≥ 44px. Roving `tabindex` inside the grid; arrow keys move,
  Enter/Space commit, Home/End jump. `aria-pressed` on the selected card.
- Commit = one `CharacterApplyPlan` executed by the binding → one undo step in the Shaper history.
  Hover never mutates the scene. The inspector shows the hovered card's enlarged preview.
- Switching a slot must not touch other slots (verified by tests on `deriveCharacterRecipe`).
- Unavailable/partial entries state the reason in plain Korean, e.g. "이 모델에는 눈 크기 shape key와
  적응형 얼굴 메시가 없어 적용할 수 없습니다." Never silently substitute.
- Every continuous control: range + locale-safe number input, unit, default marker, per-control
  reset, Shift = ×10 step, Alt = ×0.1 step, clamped and finite, one history transaction per
  completed edit (commit on pointer-up / blur / Enter, not per frame).
- Summary bar: model name, style summary (e.g. "7두신 · 보브 · 교복"), palette swatches
  (skin / hair / iris / top / bottom), changed-slot count, undo/redo, hold-to-compare against the
  session baseline, save variant (uses host `handleSaveFullLocal` with a name), 고급 편집 toggle,
  close (returns focus to the launcher).
- Keyboard: `1`–`9`/`0` jump slots when focus is in the rail, `⌘Z/⇧⌘Z` undo/redo inside the
  dialog (do not leak to the page), `T` turntable, `B` toggle 표면 드로잉, `Esc` closes drawer →
  sheet → dialog in that order.
- Everything is Korean-first with the existing tone (short, honest, no marketing adjectives).

## 4. Runtime binding (host API map)

The dialog receives the existing poser host `h` from `useStudioVrmPoserController(props)`
(see `StudioVrmPoser.tsx`). Verified host members, by capability:

| Capability | Host members |
|---|---|
| Model | `vrm`, `status` (`empty/loading/ready/error`), `libraryEntries`, `activeModelId`, `loadModelFromLibraryEntry`, `handleFileChange`, `handleSampleLoad`, `displayModelName` (dialog only — derive from library entry) |
| Avatar Forge (face/hair/proportion) | `avatarForgeState`, `handleAvatarForgeChange(nextState)`, `avatarForgeFaceController`, `detectedOriginalHairCount`, `proportionRigStatus`, `proportionRigMessage` |
| Semantic face morphs | `inspectStudioVrmSemanticFaceMorphProfile(vrm)` (pure) + `setAvatarForgeSemanticFaceMorph(state, id, value)` → `handleAvatarForgeChange` |
| Colors | `customColors`, `setCustomColors` (keys: `tops`, `bottoms`, `hair`, `body`, `face`; applied by `applyVrmCustomColors` in `StudioVrmActor`) |
| Wardrobe (procedural garments) | `wardrobeState`, `equipWardrobeItem(slot, itemId|null)`, `updateWardrobeEquip(slot, patch)`, `equipWardrobeSetById(setId)`, `clearWardrobe()`, `wardrobeFitReport`, `wardrobeMetrics`, `wardrobeAutoHide`, `toggleWardrobeAutoHide` |
| Costume (model's own clothes) | `costumeState`, `costumeMeshes`, `toggleCostumeMesh(key)`, `recolorCostumeMesh`, `recolorCostumeSlot(slot, hex)`, `resetCostume()`, `isCostumeAutoHidden` |
| Props / accessories | `vrmPropItems`, `addVrmProp(propId)`, `updateVrmProp(uid, patch)`, `removeVrmProp(uid)`, `effectivePropRigMetrics` |
| Expression | `activeExpressionId`, `expressionWeights`, `handleExpressionPresetSelect(preset)`, `updateExpressionWeight(name, value)`, `availableExpressionActions` |
| Pose | `activePoseId`, `handlePoseSelect(presetId)`, `handleMirrorPose`, `handleResetActivePose`, `allPoseListItems`, `savedPoses`, `handleSavePose` |
| Hand pose | `applyHandPosePreset(side, poseType)`, `fingerEdits`, `updateFingerCurl` |
| Photo pose | `handlePhotoPoseApply(payload)` with `StudioVrmPhotoPoseScanner` |
| Webcam | `webcamActive`, `setWebcamActive`, `webcamLoading`, `webcamError`, `showConsent`, `setShowConsent`, `webcamConsentGranted`, `videoRef`, `trackingOptions`, `faceDetected`, `handleCapturePose` (freeze) |
| AI reference | `avatarForgeReferenceCatalogue`, `handleAvatarForgeReferencePreview`, `handleAvatarForgeReferenceApply`, `avatarForgeReferenceInteractionBlocked`, `StudioVrmAvatarReferenceRecommendationsPanel` |
| Surface paint | `activePanelTab`/`activeCharacterSection` (paint mode is `character` + `surface`), `handlePanelTabChange`, `handleCharacterSectionChange`, `texturePaintSettings`, `handleTexturePaintSettingsChange`, `texturePaintEyedropperActive`, `setTexturePaintEyedropperActive`, `texturePaintDisabledReason`, `texturePaintStatus`, `handleTexturePaintUndo/Redo/Reset`, `texturePaintSnapshot` |
| Camera / view | `activeCameraId`, `setActiveCameraId` (`CAMERA_PRESETS`), `turntable`, `setTurntable`, `zoomViewport`, `handleViewReset`, `lighting`, `setLighting`, `lightingTone`, `setLightingTone`, `envVariant`, `setEnvVariant`, `materialFx`, `setMaterialFx`, `bodyRotation`, `handleBodyRotationChange` |
| Output | `transparentBackground`, `setTransparentBackground`, `insertBackgroundColor`, `setInsertBackgroundColor`, `handleInsert()`, `isCapturing`, `onCaptureUpdate` → `CaptureState {gl, scene, camera}` (viewport `CaptureBridge`) |
| History | `canUndo`, `canRedo`, `doUndo`, `doRedo` (pose/IK/paint aware) |
| Persistence | `savedFullStates`, `fullStateName`, `setFullStateName`, `handleSaveFullLocal`, `handleLoadFullLocal`, `handleCopyFullState`, `handlePasteFullState`, `vrmCreativePersistenceStatus` |
| Dialog chrome | `dialogRef`, `dialogTitleId`, `dialogDescriptionId`, `closeButtonRef`, `onClose`, `panelScrollRef` |

Rules for the binding (`useCharacterShaperBinding(h)`):

- Derive `CharacterHostSnapshot` from `h` each render (cheap object; memoize by the underlying
  references) and compute `CharacterRecipe` with `deriveCharacterRecipe(snapshot, catalog)`.
- Commit executes `CharacterApplyStep`s in order. Steps that need `handleAvatarForgeChange` are
  merged into **one** forge state write. After commit, push a snapshot on the Shaper history
  (bounded 60) so 되돌리기 restores the whole selection; when the host offers a native undo for
  the same change (pose/expression), the Shaper history entry still wins inside the dialog.
- Iris tint: `applyVrmCustomColors` does not know an eye part, so the binding owns
  `character-shaper-iris-tint.ts` — a texture-preserving HSL tint over meshes whose names match
  the `eye` protect pattern from `studio-vrm-costume.ts` (`iris|hitomi|eye(?!lash|line|brow)`),
  never touching eyelash/eyeline/brow/highlight meshes, restoring the original color factor when
  set to `null`. Runs in an effect keyed by `(vrm, irisColor)`.
- Never call host mutators while `isCapturing || isSharingPose || isThumbnailCapturing ||
  broadcastPreviewActive || proportionRigStatus === "applying"`; surface the reason instead.

## 5. Slot rules (catalog authoring)

Entries are ToonStudio originals: names, hints and parameter values are authored here, not copied.

| Slot | Entries (min) | Apply | Derive (host → entry) | Availability |
|---|---|---|---|---|
| face-shape 얼굴형 | 7 recipes (균형·계란·둥근·샤프·볼륨·각진·SD 동안) | `forge-face` | nearest recipe by face params (ε 1e-3) else custom | model-loaded |
| eyes 눈 | 8 (순정 반짝·고양이·반달·소년만화·처진·날카로운·둥근 동안·먼 눈) | `semantic-morph` {eyeSize, eyeSpacing, eyeTilt} | nearest bundle on those three ids | partial if some ids null |
| irises 눈동자 | 10 (표준·큰 눈동자·작은 눈동자 + 색: 흑갈·다크브라운·앰버·헤이즐·블루·그린·바이올렛·레드) | `iris` | irisSize + iris color match | iris-tint |
| nose 코 | 6 (점코·직선코·오뚝·낮은·넓은·긴 콧대) | `semantic-morph` {noseHeight, noseWidth} | nearest | partial |
| mouth 입 | 7 (자연 미소·단정한 일자·살짝 벌림·도톰·얇은·활짝·삐죽) | `mouth` (morphs {mouthWidth, lipFullness} + expression floor e.g. `happy 0.2`, `aa 0.25`) | nearest morphs + floor match | partial |
| ears 귀 | 5 (표준·작은·큰·엘프(prop `elfEars`)·동물(prop `catEars`)) | `ears` | earSize + prop presence | props for prop-backed |
| hair 헤어 | 1 원본 유지 + 14 styles × palette (cards per style using current palette; bangs as inspector chips) + 6 curated palettes in inspector | `forge-hair` / `hair-original` | style + replaceOriginal | hair-original needs `originalHairMeshCount > 0` |
| body 체형 | 8두신·7두신·6두신·5두신·4두신·3두신 (from `STUDIO_VRM_PROPORTION_PRESETS`) × forge body presets as inspector chips | `proportion` | `proportionPresetId` | model-loaded (partial while rig not ready) |
| top 상의 | 원본 유지 + wardrobe `top`+`outer` items (13) | `wardrobe` / `costume-original` | wardrobe itemId | wardrobe-metrics |
| bottom 하의 | 원본 유지 + wardrobe `bottom` (7) | same | same | same |
| shoes 신발 | 원본 유지 + wardrobe `shoes` (7) | same | same | same |
| accessory 액세서리 | props `head` + `body` categories (~30), multi-select | `prop` | `propIds` | props |
| expression 표정 | 28 `EXPRESSION_PRESETS` | `expression` | `activeExpressionId` | expression names |
| pose 포즈 | `NATURAL_IDLE_POSES` + `EXTRA_POSE_PRESETS` (~74) grouped: 일상·감정·액션·앉기/눕기·리액션 | `pose` | `activePoseId` | humanoid |
| hand-pose 손 포즈 | 13 shapes (`CharacterHandPoseType`) with side selector (왼손/오른손/양손) | `hand-pose` | `lastHandPoseType` (binding-tracked) | humanoid |

`elfEars` is a new procedural prop in `studio-vrm-props.ts` (two tapered cones on the head, colored
with the skin default `#f5c6a0`, fit like `catEars`). Add it with the same anchor/fit metadata and a
unit test; if the geometry switch cannot host it cleanly, mark the elf entry `unavailable` with the
reason "엘프 귀 소품이 아직 없습니다" — do not fake it.

## 6. Preview renderers

`character-shaper-preview.tsx` exports `CharacterSlotPreview({ spec, size, selected })` returning an
inline `<svg>` (viewBox 0 0 80 100) using only `currentColor`, `var(--color-*)` tokens and the
spec's own colors. Deterministic, no randomness, no external images. Hair previews may compose
`StudioVrmAvatarForgePreview` for silhouettes but must render inside the same 4:5 frame. Pose
previews receive `{ kind: "pose", presetId }` and resolve the preset (`NATURAL_IDLE_POSES` +
`EXTRA_POSE_PRESETS` by id) through `character-shaper-pose-glyph.ts`: project the preset's bone
directions/rotations to a `CharacterPoseGlyphFigure` (unit tests pin a running pose vs. standing pose to differ). Hand
poses use per-type finger curl tables. Expressions draw a face with brows/eyes/mouth driven by
weights (happy → smile arc, angry → brows down, surprised → round mouth), emoji only as `<title>`.

## 7. Semantic PSD export

`character-shaper-semantic-psd.ts` (+ `.worker`-free, main thread bounded to ≤ 2048² per pass):

1. From `CaptureState {gl, scene, camera}` render **beauty** (current lighting, transparent clear).
2. Render **flat**: temporarily neutralize shading — for MToon materials set `shadeColorFactor` to
   the base color and `shadingShiftFactor` to 1 (or swap lights to a single full ambient) and
   render; restore afterwards (try/finally, `needsUpdate`).
3. **shadow** = per-pixel `max(0, flat − beauty)` (multiply layer); **highlight** = `max(0, beauty −
   flat)` (screen layer); **line** = alpha-edge + luminance-edge Sobel on beauty, thresholded, ink
   color from `--color-fg` equivalent (`#1b1714`), plus MToon outline pixels (near-black in flat).
4. Masks: for each semantic group (face/eyes/hair/skin/top/bottom/shoes/accessory) set
   `mesh.visible=false` for everything else (including props/garment roots), render alpha, restore.
   Classification uses `collectStudioVrmCostumeMeshes` + costume patterns + prop/garment roots +
   name heuristics (`face`, `eye|iris|hitomi`, `hair`, `body|skin`).
5. Assemble with `ag-psd` `writePsd`: groups 「밑색」(per-mask flat layers), 「음영」 multiply,
   「하이라이트」 screen, 「표면 드로잉」 (only when the paint runtime exposes a paint-only texture;
   otherwise skipped with reason), 「주선」 normal. Include `CharacterPsdExportReceipt.skipped`.
6. Unit tests cover the pure image math (edge, ratio layers, mask compositing) and a `readPsd`
   round trip of layer names/order; the WebGL render path is exercised by the browser verify script.

Transparent PNG download and "캔버스에 추가" reuse `h.handleInsert` / `encodeStudioVrmCapturePngBlob`.

## 8. Reference tools

- **AI 추천**: reuse `StudioVrmAvatarReferenceRecommendationsPanel` (MediaPipe image embedder,
  local) inside the drawer with card previews from the recipe; add local **팔레트 추출**
  (`character-shaper-palette-extract.ts`: downscale ≤ 96px, median-cut 6 colors, skin/hair
  heuristics by luminance/saturation) that proposes hair base/tip + iris + top colors with
  one-click apply. Everything stays on device; state the provider ("MediaPipe 이미지 임베더 ·
  기기 내 처리") in the drawer.
- **사진 포즈**: reuse `StudioVrmPhotoPoseScanner` (source image + landmark overlay + region scope).
- **웹캠**: reuse the host webcam session; show consent, mirror, freeze (`handleCapturePose`).

## 9. Integration points (single owner: integration agent)

1. `studio-workspace-route.ts`: add `"character"` to `STUDIO_2D_WORKSPACE_SURFACES`; manifest
   pattern in `studio-route-manifest.ts`; update the three route tests.
2. `StudioCuttoonEditorHost.tsx`: `characterShaperOpen` state, `openCharacterShaperFromMenu()`,
   `studioRoute.surface === "character"` branch, `useRoutedSurfacePanelSync("character", …)`,
   canvas-return branch, pass `characterShaperOpen`/setter to `StudioThreeDPreviewPanelStack`.
3. `studio-page-lazy-ui.ts` + `StudioThreeDPreviewPanelStack.tsx`: lazy `StudioCharacterShaper`
   mounted like `StudioVrmPoser` with the same `onInsert={insertVrmResult}` and seed props.
4. Menus/commands: `studio-command-catalog.ts` (`3d/character` origin + command), the 3D main-menu
   items file that lists `3d/char`, tool rail 3D cluster launcher, mobile dock if the 3D cluster
   lives there, `studio-search-corpus.ts` panel entry, `components/command-palette-data.ts`
   (`PALETTE_STUDIO_TOOLS` + `PALETTE_PAGES` for `/shaper`), `studio-feature-tutorials.ts`
   (`threed` tutorial with `tryAction: "character-shaper"` handled in `StudioPage`).
5. Docs: `docs/studio/character-shaper.md` (manual), `STUDIO_MANUAL.md` section, README bullet,
   `docs/reports/character-shaper-implementation-2026-09-04.md` (evidence + screenshots).

## 10. Public page

`/shaper` — `src/domains/creator/CharacterShaperLandingPage.tsx`: hero (eyebrow "CHARACTER SHAPER",
headline, two CTAs: "스튜디오에서 열기" → `/studio/character`, "사용 가이드"), four feature blocks
with inline SVG illustrations (presets, drawing, AI, output), a numbered HOW TO (5 steps), keyboard
shortcuts table, honest capability notes (what needs a VRM with shape keys, what runs on device),
FAQ, and a closing CTA. Uses `Container`, `Section`, `RevealOnScroll`, `buttonClass`, warm-ink
tokens only. Register route, title, manifest, footer link, mobile nav entry, palette page.

## 11. File ownership (parallel agents must not cross)

| Owner | Files |
|---|---|
| model | `character-shaper-catalog.ts`, `character-shaper-recipe.ts`, `character-shaper-capability.ts`, `character-shaper-apply-plan.ts`, `character-shaper-iris-tint.ts`, `studio-vrm-props.ts` (elfEars only) + tests |
| preview | `character-shaper-preview.tsx`, `character-shaper-pose-glyph.ts`, `character-shaper-hand-glyph.ts` + tests |
| export | `character-shaper-semantic-psd.ts`, `character-shaper-image-math.ts`, `character-shaper-palette-extract.ts` + tests |
| ui-shell | `StudioCharacterShaperDialog.tsx`, `CharacterShaperSummaryBar.tsx`, `CharacterShaperSlotRail.tsx`, `CharacterShaperShelf.tsx`, `CharacterSlotCard.tsx`, `CharacterShaperViewportHud.tsx`, `CharacterShaperMobileSheet.tsx`, `character-shaper-ui-model.ts` + tests |
| ui-panels | `CharacterShaperInspector.tsx`, `CharacterShaperReferenceDrawer.tsx`, `CharacterShaperOutputDock.tsx`, `CharacterShaperPaintHud.tsx`, `CharacterShaperControls.tsx` + tests |
| binding + integration | `useCharacterShaperBinding.ts`, `useCharacterShaperHistory.ts`, `StudioCharacterShaper.tsx`, all files in §9 |
| landing | §10 files + `AppRouter.tsx`, `route-titles.ts`, `route-manifest.ts`, `site-footer.tsx`, `site-header-mobile-nav.tsx` |

Shared conventions: `import type` (verbatimModuleSyntax), import-x/order groups, `@/` alias only
for root `components`/`lib`, colocated `*.test.ts(x)` under Vitest `environment: node` (use
`@testing-library/react` only if already present — otherwise test pure logic and `renderToString`),
no new dependencies, no files added to `eslint.legacy-exceptions.json`, Korean UI copy, OKLCH tokens
(`bg-panel`, `text-fg-2`, `border-line`, `bg-accent-soft`, …), `buttonClass` from
`@/shared/components/ui/button-utils`, `cn` from `@/shared/lib/utils`, `lucide-react` icons at size 16/18.

## 12. Verification gates for this wave

- `pnpm exec vitest run src/domains/creator/character-shaper` green; touched route/menu/corpus tests green.
- `pnpm typecheck` (root tsc) green; `pnpm lint:quick` on changed files green (zero warnings).
- Browser evidence (dev server + Playwright, SwiftShader): `/studio/character` desktop 1440×900 and
  mobile 390×844 with the bundled sample VRM loaded, slot commits reflected in the viewport
  (pixel-diff between before/after hair + wardrobe changes), transparent PNG capture non-empty,
  PSD export receipt lists ≥ 8 layers. Screenshots stored under `docs/screenshots/character-shaper/`.
- Axe-style checks: every interactive element has an accessible name, dialog traps focus, `Esc`
  closes, no color-only state.

## 13. Fixed API surface (names are the contract between parallel owners)

`character-shaper-catalog.ts`
- `CHARACTER_SLOT_METAS: readonly CharacterSlotMeta[]`
- `CHARACTER_SLOT_CATALOG: CharacterSlotCatalog`
- `listCharacterSlotEntries(slot: CharacterSlotKind): readonly CharacterSlotEntry[]`
- `findCharacterSlotEntry(id: string): CharacterSlotEntry | null`
- `searchCharacterSlotEntries(slot: CharacterSlotKind, query: string, tag?: string | null): readonly CharacterSlotEntry[]`
- `CHARACTER_GENRE_TAG_LABELS: Readonly<Record<CharacterGenreTag, string>>`

`character-shaper-recipe.ts`
- `createEmptyCharacterRecipe(): CharacterRecipe`
- `deriveCharacterRecipe(snapshot: CharacterHostSnapshot, catalog?: CharacterSlotCatalog): CharacterRecipe`
- `describeCharacterRecipe(recipe: CharacterRecipe, catalog?: CharacterSlotCatalog): { style: string; lines: readonly string[]; changedSlots: readonly CharacterSlotKind[] }`
- `diffCharacterRecipes(a: CharacterRecipe, b: CharacterRecipe): readonly CharacterSlotKind[]`
- `serializeCharacterRecipe(recipe): string` / `parseCharacterRecipe(raw: unknown): CharacterRecipe` (validated, for copy/paste)

`character-shaper-capability.ts`
- `EMPTY_CHARACTER_CAPABILITY_PROFILE: CharacterCapabilityProfile`
- `createCharacterCapabilityProfile(input: { vrm: VRM | null; status; modelId; modelName; wardrobeMetricsReady: boolean; originalHairMeshCount: number; surfacePaintReady: boolean }): CharacterCapabilityProfile` (uses `inspectStudioVrmSemanticFaceMorphProfile`, `collectStudioVrmCostumeMeshes`, `vrm.expressionManager`, `vrm.humanoid`)
- `evaluateCharacterSlotEntry(entry: CharacterSlotEntry, profile: CharacterCapabilityProfile): CharacterSlotAvailability`

`character-shaper-apply-plan.ts`
- `planCharacterSlotApply(entry: CharacterSlotEntry, profile: CharacterCapabilityProfile, context: { snapshot: CharacterHostSnapshot; handSide: CharacterHandSide }): CharacterApplyPlan`
- `planCharacterSlotClear(slot: CharacterSlotKind, context): CharacterApplyPlan | null`
- `planCharacterSlotRemove(slot: CharacterSlotKind, entryId: string, context): CharacterApplyPlan | null`

`character-shaper-iris-tint.ts`
- `applyCharacterIrisTint(vrm: VRM, color: string | null): number`
- `canTintCharacterIris(vrm: VRM | null): boolean`

`character-shaper-preview.tsx`
- `CharacterSlotPreview({ spec, size?, selected?, className?, title? })` → inline `<svg>`
- `character-shaper-pose-glyph.ts`: `buildCharacterPoseGlyph(preset: StudioPosePreset): CharacterPoseGlyphFigure`, `STANDING_CHARACTER_POSE_GLYPH`
- `character-shaper-hand-glyph.ts`: `characterHandGlyphCurls(poseType): readonly number[]` (5 finger curls 0..1) + spread

`character-shaper-semantic-psd.ts`
- `captureCharacterSemanticPasses(input: { capture: { gl; scene; camera }; vrm: VRM; width: number; height: number; signal?: AbortSignal; garmentRoots?: readonly THREE.Object3D[]; propRoots?: readonly THREE.Object3D[]; paintTextureProvider?: (() => Map<THREE.Material, THREE.Texture> | null) }): Promise<{ passes: readonly CharacterSemanticPass[]; skipped: readonly { pass; reason }[] }>`
- `buildCharacterSemanticPsd(passes, skipped, options: { title: string }): { blob: Blob; receipt: CharacterPsdExportReceipt }`
- `character-shaper-image-math.ts`: `subtractClamped`, `sobelEdgeAlpha`, `maskMultiply`, `lumaOf` (pure, tested)
- `character-shaper-palette-extract.ts`: `extractCharacterReferencePalette(image: ImageData, options?): CharacterReferencePalette` with `interface CharacterReferencePalette { swatches: readonly string[]; skin: string | null; hair: string | null; accent: string | null }`

`useCharacterShaperBinding.ts` → `useCharacterShaperBinding(h: StudioVrmPoserHost): CharacterShaperBinding`
`useCharacterShaperHistory.ts` → snapshot stack used by the binding
`StudioCharacterShaper.tsx` → `StudioCharacterShaper(props: StudioVrmPoserProps)` (controller + binding + dialog / advanced toggle)
`StudioCharacterShaperDialog.tsx` → `StudioCharacterShaperDialog(props: StudioCharacterShaperDialogProps)`
Panel components: `CharacterShaperSummaryBar`, `CharacterShaperSlotRail`, `CharacterShaperShelf`, `CharacterSlotCard`, `CharacterShaperViewportHud`, `CharacterShaperMobileSheet` (ui-shell) · `CharacterShaperInspector`, `CharacterShaperReferenceDrawer`, `CharacterShaperOutputDock`, `CharacterShaperPaintHud`, `CharacterRangeControl` in `CharacterShaperControls.tsx` (ui-panels) — each exported from the file of its name with the props interface of its name from `character-shaper-ui-contract.ts`.

Tests: pure modules under `environment: node`; component tests use `// @vitest-environment jsdom` + `@testing-library/react` (present) with a mocked `h` object (plain object literal) and a stub binding.
