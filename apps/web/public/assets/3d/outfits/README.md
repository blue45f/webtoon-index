# Legacy outfit GLB audit

The 18 `outfit_*.glb` files in this directory are historical Blender reference
artifacts. They are **not** the wardrobe assets shown in ToonSpectrum Studio.

An August 2026 binary and source audit found that every file here contains only
one or two rigid mesh nodes and has no `skins`, animation, `JOINTS_0`, or
`WEIGHTS_0`. No production module under `src/domains/creator` references this
directory or any of these filenames. Replacing six of these files with prettier
static shells would therefore change download size without changing anything a
Studio user can equip, pose, or capture.

The user-visible wardrobe has a different, rig-compatible authority boundary:

1. `studio-vrm-wardrobe.ts` measures each loaded VRM and generates multi-part
   `GarmentPart` surfaces from that model's proportions.
2. `studio-vrm-skinned-garment.ts` assigns real raw-rig bone indices, normalized
   weights, inverse-bind matrices, and a skeleton to supported garments.
3. `StudioVrmWardrobePropsProjection.tsx` attaches those surfaces to the live
   VRM. `pleated` and `longskirt` use the bounded `xpbd-skirt-v1` path; dress,
   robe, trench-coat, and trouser shells use the raw-rig skinned procedural
   path; shoes use the explicit rigid procedural path.
4. Wave 3 rebuilt the ten previously `legacy-only` procedural garments with
   cuffs, collars, hems, pockets, seams, waistbands, and other multi-part
   details. Every current live wardrobe item is now selectable and retains its
   original persisted ID; the explicit replacement boundary remains available
   for a future item that fails an audit.

A future GLB wardrobe importer must preserve that same contract: per-model fit,
raw humanoid bone resolution, skin indices and weights, inverse-bind matrices,
surface receipts, deterministic cleanup, and an unavailable state when the
contract cannot be met. Until such an importer exists, these legacy files must
not be presented as runtime-ready wearables.

The executable regression for this boundary lives in
`src/domains/creator/studio-vrm-outfit-static-asset-audit.test.ts`.
