# framing-cam composition calibration — results (v0.2)

Run 2026-11-01 (UTC+8). All numbers here are produced by `scripts/` from `measurements.csv` / `stats.json`; nothing hand-entered.

## Pipeline
1. `scripts/fetch_commons.py` — Wikimedia Commons MediaWiki API (no key; Unsplash/Pexels APIs need keys, none available on the box). 5 query sets × 5 queries; JPEG; licence CC0 / Public domain / CC BY / CC BY-SA (no NC/ND); width ≥ 600; capture date ≥ 2000 (first unfiltered run was dominated by 19th-c. studio photos and was discarded). 1024-px thumbnails. → `manifest.csv` (284 photos; URL, author, licence, licence URL, date).
2. `scripts/measure.py` — MediaPipe 1.2.0 Tasks: PoseLandmarker heavy (num_poses=3), FaceLandmarker (on full image; if no face, re-run on an upscaled head crop from pose landmarks 0–10), ImageSegmenter selfie_multiclass_256x256. → `detections.csv`, `excluded.csv`.
3. `scripts/analyze.py` — classification, metrics, aspect simulation, percentiles → `measurements.csv` (one row per photo × variant), `stats.json`.
4. `scripts/make_config.py` → `revised-config.json` (v0.1 config with calibrated P10–P90 where n ≥ 10).

Reproduce: `. /workspace/mpenv/bin/activate && cd /workspace/specs/calibration && python scripts/measure.py && python scripts/analyze.py && python scripts/make_config.py`

## Exclusions: 125 of 284 (159 kept)
| reason | n |
|---|---|
| no pose detected | 84 (37 of them in "environment" queries — many are landscapes with tiny/no people) |
| no face (even after head-crop retry) | 21 |
| multiple people (2nd pose > 40% height of main) | 10 |
| non-photo title (painting/statue/etc.) | 9 |
| face/pose mismatch | 1 |

## Classification (landmark-based) vs search category
Class = where the bottom frame edge falls on the pose chain chin(0)–shoulder(1)–hip(2)–knee(3)–ankle(4)–feet(5): <1.6 close-up; 1.6–2.35 half body; 2.35–5 three-quarter; feet in frame (≥5) → full body, or environment if subject height < 0.6 H.

| search ↓ / measured → | closeup | halfbody | threequarter | fullbody | environment |
|---|---|---|---|---|---|
| closeup (39) | **31** | 7 | 1 | 0 | 0 |
| halfbody (26) | 3 | **8** | 9 | 5 | 1 |
| threequarter (25) | 1 | 2 | **8** | 9 | 5 |
| fullbody (44) | 4 | 2 | 3 | **32** | 3 |
| environment (24) | 2 | 3 | 8 | 7 | **5** |

Agreement 52.8%. Commons search terms are weak labels; all statistics below use the **measured** class. Native-class sample sizes: closeup 41, halfbody 22, threequarter 29, fullbody 53, environment 14 (halfbody and environment are below the 30 target).

## Native frames — P10 / P50 / P90 (fraction of frame)
| class (n) | eyeY | headroom | subject height | face height (chin–lm10) | faceX |
|---|---|---|---|---|---|
| closeup (41) | 0.277 – 0.417 | 0.000 – 0.125 (12% crown-cropped) | 0.875 – 1.0 | 0.284 – 0.504 | 0.450 – 0.537 |
| halfbody (22) | 0.235 – 0.384 | 0.049 – 0.252 | 0.748 – 0.951 | 0.190 – 0.292 | 0.408 – 0.541 |
| threequarter (29) | 0.157 – 0.373 | 0.041 – 0.292 | 0.708 – 0.959 | 0.089 – 0.166 | 0.425 – 0.669 |
| fullbody (53) | 0.098 – 0.290 | 0.025 – 0.204 | 0.697 – 0.940 | 0.072 – 0.114 | 0.341 – 0.539 |
| environment (14) | 0.277 – 0.512 | 0.221 – 0.480 | 0.364 – 0.585 | 0.033 – 0.102 | 0.414 – 0.589 |

(P50s and all other fields are in `stats.json`.) Native eyeY median by native aspect: closeup portrait/square/landscape 0.327/0.334/0.349; fullbody portrait 0.131 vs landscape 0.221 (n=43/9).

Bottom-edge position (t along segment, native):
- closeup: shoulder→hip t P10–P90 0.104–0.550 (n=38) — i.e. photographers crop at chest level along the torso; v0.1 used the shoulder→elbow segment.
- halfbody: shoulder→hip t 0.640–0.943 (n=18); 4 cropped just below hip (hip→knee t 0.06–0.20).
- threequarter: hip→knee t 0.391–0.845 (n=8); knee→ankle 0.295–0.892 (n=14); 7 photos cropped between ankle and feet (cut feet) — a "forbidden" crop that does occur in the sample.
- foot room (full body, n=53): 0.013 – 0.134 (P50 0.056); environment 0.081 – 0.326.
- lead room (offset of face from centre toward the facing direction, only |yaw|>0.15): fullbody P50 +0.041 (n=26), threequarter +0.057 (n=16); closeup/halfbody/environment ≈ 0 (n=10–11). Positive = more room in front. Yaw sign is from nose vs ear midpoint and was not manually verified.

## Aspect-ratio handling
Simulated crops on landmark coordinates (no re-detection): if native wider than target → crop width, centred on face x (clamped to the image) — y metrics unchanged, so faceX ≈ 0.5 **by construction** (not a finding); if native taller → crop height centred on the image, shifted down only if it would cut the head top. The class is recomputed after cropping (so n differs per variant). Most Commons photos are wider than 9:16, so 9:16 numbers ≈ native y-distribution.

| class | 4:5 n · eyeY · headroom | 3:4 n · eyeY · headroom | 9:16 n · eyeY · headroom |
|---|---|---|---|
| closeup | 48 · 0.269–0.432 · 0.000–0.138 | 45 · 0.264–0.416 · 0.000–0.123 | 41 · 0.277–0.417 · 0.000–0.125 |
| halfbody | 21 · 0.190–0.386 · 0.040–0.239 | 24 · 0.196–0.380 · 0.040–0.242 | 23 · 0.222–0.383 · 0.046–0.249 |
| threequarter | 57 · 0.118–0.339 · 0.040–0.277 | 47 · 0.110–0.378 · 0.037–0.288 | 33 · 0.134–0.364 · 0.034–0.280 |
| fullbody | 24 · 0.110–0.370 · 0.040–0.297 | 32 · 0.111–0.300 · 0.040–0.243 | 48 · 0.103–0.298 · 0.028–0.210 |
| environment | 9 (too few) | 11 · 0.274–0.402 · 0.214–0.358 | 14 · 0.277–0.512 · 0.221–0.480 |

## Head-top: face-length estimate vs segmentation mask
Mask top = first row containing hair or face-skin class within the face's x-range. n=150 (7 crown-cropped excluded; those also make the mask top unusable).
- Estimate `lm10 − 0.30·faceLen` vs mask: signed error (+ = estimate too low) P10/P50/P90 = −0.141 / **+0.166** / +0.395 face-lengths; |error| P50 0.191, P90 0.414 face-lengths; in frame height |err| P50 0.030, P90 0.079.
- Best-fit k (lm10 − k·faceLen = mask top): P10/P50/P90 = 0.159 / **0.466** / 0.695. By class P50: closeup 0.438, halfbody 0.489, threequarter 0.475, fullbody 0.526, environment 0.342.
- **Verdict:** 0.30 is biased low (top of head estimated ~0.17 face-lengths too low on median); k≈0.47 removes bias but the person-to-person spread (hair volume, hats, head tilt) is ±0.27 face-lengths — ~0.03–0.08 H in close-ups, larger than the headroom tolerances. Use the segmentation mask top as the primary head-top source; use k=0.47 only as fallback. Mask quality was not visually audited per photo (hats/hair ornaments count as "hair/other" inconsistently).

## Proposed (v0.1) vs calibrated (native unless noted) — biggest gaps in bold
| metric | v0.1 proposed | calibrated P10–P90 |
|---|---|---|
| closeup eyeY (4:5) | 0.33–0.38 | 0.269–0.432 (wider both ways) |
| closeup headroom (4:5) | 0.03–0.08 | 0.00–0.138 |
| halfbody eyeY (4:5) | 0.30–0.36 | **0.190–0.386 (much lower bound)** |
| halfbody headroom (4:5) | 0.06–0.12 | **0.04–0.239** |
| threequarter eyeY (4:5) | 0.25–0.32 | **0.118–0.339** |
| threequarter headroom | 0.07–0.13 | **0.04–0.277** |
| fullbody eyeY (4:5) | 0.14–0.22 | 0.110–0.370 (native 0.098–0.290) |
| fullbody footRoom | 0.04–0.10 | 0.013–0.134 (native) |
| environment subjH | 0.35–0.60 | 0.364–0.585 (native) — matches |
| environment eyeY | 0.28–0.40 | 0.277–0.512 (native) |
| head-top k | 0.30 | **0.466 median (0.16–0.70)** |
| lead-room offset (turned) | face at 0.36–0.40 (offset ≈0.10–0.14) | **P50 offset only +0.04–0.06 (full/3-4); ≈0 others** |
| closeup bottom band | shoulder→elbow 0.35–0.70 | measured along torso shoulder→hip 0.10–0.55 |

Interpretation: the sample's P10–P90 is wider than v0.1 because it mixes styles (editorial, event, Wikipedia portraits, amateur). Wider ranges are a natural "acceptable" band; v0.1's narrow bands may stay as the "ideal" target with calibrated ranges as the no-hint dead-band. `revised-config.json` currently writes calibrated P10–P90 as the target ranges (n≥10 only; environment 4:5 keeps v0.1, n=9).

## Caveats
- Source bias: Wikimedia Commons ≠ professional stock (Unsplash/Pexels not used: API keys required). Many photos are event/press/Wikipedia-subject portraits, often landscape-oriented and loosely framed; quality not curated; "professional" is not guaranteed.
- Search-category labels are weak (52.8% agreement); classes are measured, with arbitrary thresholds (1.6 / 2.35 / 5 / 0.6).
- Halfbody (22) and environment (14) are under the 30-photo target; P10/P90 on n<30 are unstable.
- Pose landmarks for cut-off joints are extrapolated by MediaPipe; bottom-edge t values for joints outside the frame are therefore approximate.
- Simulated crops are geometric re-projections, not new compositions; width crops force faceX≈0.5.
- Detection-failure exclusion skews toward large, frontal, well-lit subjects.
