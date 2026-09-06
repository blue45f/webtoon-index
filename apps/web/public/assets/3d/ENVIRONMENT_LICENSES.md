# ToonSpectrum Studio BG3D environment pack

The twelve files under `public/assets/3d/environments/` were created from scratch by ToonSpectrum
with the reproducible Blender 5.2 generators
`scripts/blender/generate_environment_pack_v3.py` and
`scripts/blender/generate_environment_pack_v4.py` and
`scripts/blender/generate_environment_pack_v5.py`. ToonSpectrum dedicates these environment models
to the public domain under **CC0 1.0 Universal**.

- License: CC0-1.0
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Attribution required: no
- Commercial use: permitted
- Modification and redistribution: permitted
- Third-party meshes, textures, HDRIs, fonts, or other embedded resources: none. Wave 5's two
  embedded 128×128 detail maps per GLB are original procedural output of the Wave 5 generator.
- Generator output convention: metres, glTF Y-up, grounded at Y=0, self-contained GLB 2.0

## Asset manifest

| Studio asset ID | File | SHA-256 | Bytes | Nodes | Materials | Triangles |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `ts-bg3d-compact_apartment_interior-v1` | `environments/compact_apartment_interior.glb` | `c5409d3c3050725fa14afc67f5d63168ead262d352bcd7294018dd8cf11cdde9` | 1,520,948 | 118 | 11 | 49,452 |
| `ts-bg3d-stylized_cafe_interior-v1` | `environments/stylized_cafe_interior.glb` | `f0e038d48f6906c1316e3cbb633cb92c72a0053091acdb28a83d11b74e9cee2a` | 2,476,104 | 166 | 12 | 95,128 |
| `ts-bg3d-urban_neon_alley-v1` | `environments/urban_neon_alley.glb` | `4506e1d3fe34bfcd2dd754f237047c33d5a749218cdf7fb71266b98374e358e3` | 2,971,100 | 247 | 11 | 69,320 |
| `ts-bg3d-classroom_art_studio-v1` | `environments/classroom_art_studio.glb` | `b0e14d9e45b8181798a09fc675d6c3aadf46bae5a2b24200fe751518c55016d8` | 2,167,224 | 201 | 12 | 66,880 |
| `ts-bg3d-fantasy_ruin_courtyard-v1` | `environments/fantasy_ruin_courtyard.glb` | `cd7b7aaa142c473b8373c9d666edc2d130ee0735a2290502489d721f1d87cb22` | 2,081,960 | 213 | 9 | 74,352 |
| `ts-bg3d-scifi_command_corridor-v1` | `environments/scifi_command_corridor.glb` | `a2eff1b6d07f8e09ef2f1deebc240dd5ccb591384bce59d5f092cc4dd0d59821` | 3,486,400 | 248 | 11 | 92,456 |
| `ts-bg3d-hospital_emergency_nurse_station-v1` | `environments/hospital_emergency_nurse_station.glb` | `7c08f38b2dfdeb418fadfca4ee24f0e73b92f9b20abcde11f29a67d5dae9a8e6` | 2,263,556 | 188 | 13 | 60,920 |
| `ts-bg3d-korean_school_rooftop-v1` | `environments/korean_school_rooftop.glb` | `00a2ca9dd79b1e4957e94df7e2e9824e7c404e85f98bc45dc4691934d3e18115` | 1,871,832 | 204 | 12 | 53,000 |
| `ts-bg3d-hanok_market_courtyard-v1` | `environments/hanok_market_courtyard.glb` | `64540cd8540a6e8768152ae78bb908b97853aea064a263b9c43cd9b2373fe766` | 2,335,872 | 245 | 14 | 76,944 |
| `ts-bg3d-korean_convenience_store_night-v1` | `environments/korean_convenience_store_night.glb` | `e31665694ca5ab05e09736d24623a4bfe14cc07b9f60bec261445f7dcf6f476e` | 3,748,664 | 21 | 15 | 74,536 |
| `ts-bg3d-seoul_subway_platform-v1` | `environments/seoul_subway_platform.glb` | `d5670f9e0240402fbf69308bbbdfb936775c6a3c30420bd693f5747b71598669` | 3,734,156 | 21 | 10 | 99,656 |
| `ts-bg3d-fantasy_alchemist_workshop_library-v1` | `environments/fantasy_alchemist_workshop_library.glb` | `c8aa1be5f39a09b369f21fef47455f1070117947973fdee73c4b24c7e6bf675c` | 3,610,428 | 27 | 15 | 76,244 |

Catalog thumbnails in `public/assets/3d/environments/thumbnails/` are renders produced by the same
generator from the corresponding CC0 scenes and are released under the same terms.

## Reproduction

From the repository root with Blender 5.2 installed:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/generate_environment_pack_v3.py -- \
  --output-dir public/assets/3d/environments

/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/generate_environment_pack_v4.py -- \
  --output-dir public/assets/3d/environments

/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/generate_environment_pack_v5.py -- \
  --output-dir public/assets/3d/environments
```

The generator clears only the currently open Blender scene's object/data blocks between assets; it
does not reset Blender preferences. Use a dedicated background process or an otherwise disposable
scene when running it alongside a live Blender MCP session.
