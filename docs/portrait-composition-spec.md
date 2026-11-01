# framing-cam 人像构图规则规格 (Portrait Composition Spec) v0.1

Status: draft for implementation · Author: Rem (research) · Date: 2026-11-01
Scope: portrait-orientation frames 4:5, 3:4, 9:16; single subject; MediaPipe Pose (33 landmarks) + Face Mesh (468/478).

## 0. Evidence levels (read first)

Every number below is tagged:

- **[S]** directly stated by a cited source.
- **[D]** derived from a sourced rule by explicit arithmetic/geometry (derivation shown).
- **[P]** proposed engineering default (no source gives a number); tune with user testing.

Photography sources give mostly *qualitative* rules (eyes ≈ upper third, less headroom as you get closer, don't crop on joints, give lead room). The only hard numbers found in sources are "eyes ≈ 1/3 from top" and "28% reads as slightly too little headroom vs 33%". All other ranges are [D]/[P].

## 1. Sources (all links checked HTTP 200 on 2026-11-01)

| # | Source | What we use |
|---|---|---|
| S1 | Wikipedia, *Headroom (framing)* — https://en.wikipedia.org/wiki/Headroom_%28framing%29 | Eyes ≈ 1/3 down from top; "the closer the subject, the less headroom"; ECU cuts top of head; caption example: eyes at 28% = "subtle lack of headroom" vs 33% good. |
| S2 | Wikipedia, *Rule of thirds* — https://en.wikipedia.org/wiki/Rule_of_thirds | Thirds grid, eye on upper third line / intersections. |
| S3 | Wikipedia, *Lead room* — https://en.wikipedia.org/wiki/Lead_room | Extra space in direction subject faces/looks/moves. |
| S4 | Wikipedia, *Shot (filmmaking)* — https://en.wikipedia.org/wiki/Shot_%28filmmaking%29 ; *Close-up* https://en.wikipedia.org/wiki/Close-up ; *Medium shot* https://en.wikipedia.org/wiki/Medium_shot ; *Cowboy shot* https://en.wikipedia.org/wiki/Cowboy_shot ; *Full shot* https://en.wikipedia.org/wiki/Full_shot | Shot-size definitions (close-up = head/shoulders; medium = waist up; cowboy/american = mid-thigh up; full = head to feet). |
| S5 | StudioBinder, *Types of Camera Shots / Shot Sizes* — https://www.studiobinder.com/blog/types-of-camera-shots-sizes-in-film/ | Shot-size taxonomy incl. medium close-up (chest), medium (waist), cowboy (mid-thigh), full, wide/establishing (environment). |
| S6 | Digital Photography School, *Portrait Crop: Good crop, bad crop* — https://digital-photography-school.com/good-crop-bad-crop-how-to-crop-portraits/ | "If it bends, don't crop it"; safe crops: below knee, mid-thigh, waist, across forearm, top of head; avoid chin crop; raise arms for waist crop. |
| S7 | Icon Photography School, *Amputation* — https://photographyicon.com/amputate/ | Joint list (ankle, knee, wrist, elbow, neck); "frame mid-thigh or mid-shin", "mid-bicep or mid-forearm"; forehead crops OK in tight portraits. |
| S8 | The Lens Lounge, *Cropping portraits rules* — https://thelenslounge.com/cropping-portraits-rules/ | Don't crop across hip/shoulder/joints; don't crop too close to knee/elbow; avoid bust-line; hem-line caveat. |
| S9 | The Camera Club, *Portrait Cropping cheat sheet* (PDF) — https://www.thecameraclub.co.uk/Website%20Downloads/Cheat%20Sheets/08_CROPPING_TCC_cheat_sheet.pdf | Eyes on top third line/intersections; keep ears/side of head; thigh crop long but not at knee; ankles less critical. |
| S10 | Mastering Portrait Photography, *Foundations: Cropping* — https://masteringportraitphotography.com/foundations/foundations-composition/foundations-cropping/ | Crop confidently or not at all; hairline crop places eyes on thirds; avoid chin; elements near the edge cause tension. |
| S11 | Google, *MediaPipe Pose Landmarker* — https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker | 33-landmark indices, normalized coords. |

## 2. Coordinate conventions & derived landmarks

- Normalized image coords: x ∈ [0,1] left→right, y ∈ [0,1] top→bottom, **in the output-crop frame** (after aspect crop). All fractions are of frame height H (y) or width W (x).
- For left/right pairs use mean of visible ones (visibility ≥ 0.5); if only one visible, use it.

| Symbol | Definition | Indices |
|---|---|---|
| `eye` | mean y of eyes | Pose 2,5 (or FaceMesh 468/473 iris, fallback 33/263) |
| `chin` | FaceMesh 152; fallback: `mouth + 1.0*(mouth - eye)` where mouth = Pose 9,10 [D] |
| `faceTop` | FaceMesh 10 (upper forehead) |
| `headTop` | `faceTop - 0.30*(chin - faceTop)` **[P]** (hair/crown above landmark 10; anthropometric estimate, tune) |
| `headH` | `chin - headTop` |
| `shoulder` | Pose 11,12 |
| `elbow` | Pose 13,14 · `wrist` 15,16 · `hip` 23,24 · `knee` 25,26 · `ankle` 27,28 · `heel` 29,30 · `toe` 31,32 |
| `feetBottom` | max y of 29–32 |
| `neckBase` | `shoulder - 0.15*(shoulder - chin)` [P] |
| `waist` | `hip - 0.25*(hip - shoulder)` [P] (natural waist sits above MediaPipe hip joint) |
| `faceCx` | mean x of FaceMesh 234/454 (or Pose 0) |
| `yaw` | head yaw sign: nose(Pose 0).x − mid(ear 7,8).x, normalized by ear distance; >0 = facing image-right |

## 3. Universal rules

R1 Eye line [S1,S2,S9]: target eye y ≈ 1/3 H. Source example says 0.28 already reads "slightly tight". S1: as the shot tightens, *headroom* shrinks while the eye stays ≈1/3; in looser/wide shots S1 allows departing from that (more space above the head). Per-shot ranges in §4 follow this.
R2 Headroom decreases with shot tightness [S1]. Close-up may touch/cut the crown slightly; never cut between hairline and eyes [S7,S10].
R3 Don't crop on a joint; crop mid-segment [S6,S7,S8,S9]. Banned edges: chin, neck, shoulder line, elbow, wrist/fingers, bust line, hip, knee, ankle/toes.
R4 Lead room [S3]: shift subject opposite to gaze/body direction, leaving more space in front.
R5 Side edges [S9,S10]: keep ears/whole head inside; nothing should be "kissing" the edge — keep a margin or cut decisively.
R6 Bottom edge = the crop line; it must fall in a safe band (§5).

### Horizontal placement [D/P]
- Frontal (|yaw| < 0.15): center `faceCx` at 0.50 (±0.04). Rationale: in narrow portrait frames the thirds verticals are only 0.33W apart; centred frontal portraits are conventional for headshots [P].
- Turned (|yaw| ≥ 0.15) or body clearly rotated: put `faceCx` on the **back-side third line**: x = 0.40–0.36 when facing right (leave room right), 0.60–0.64 when facing left. Thirds line = 0.333/0.667 [S2]; we use a softened 0.36–0.40 because in close-ups the head width (≈0.5–0.7W) makes a true 0.333 push the back of the head out of frame (violates R5) [D].
- Wide/environment shots: subject on thirds verticals 0.333/0.667 (±0.05) [S2], lead room side per R4.

## 4. Per-shot-size rules

Notation: `eyeY` target fraction of H; `headroom` = headTop/H; `subjH` = visible subject height (headTop → bottom edge or feetBottom) / H; `bottom` = which band the bottom frame edge must lie in.

### Method for aspect-ratio differences [D]
Vertical targets are fractions of H and mostly *aspect-invariant* (the sources' 1/3 rule is a ratio). What changes with aspect is width: at a fixed H the frame is 0.80H (4:5), 0.75H (3:4), 0.5625H (9:16) wide. Consequences:
1. 9:16 has less side room → horizontal offset ranges are narrowed, shoulders may exceed frame width in close-ups (acceptable to crop arms at mid-bicep, R3).
2. 9:16 is tall → for close-ups the bottom edge naturally falls lower on the body (chest instead of upper chest) when headH is held constant; for full body there is spare vertical space, so headroom/foot room grow.
3. 9:16 is usually viewed with UI overlays (top bar, bottom caption). We propose eye 0.02H lower in 9:16 as a safe-area adjustment [P].

### 4.1 Close-up (CU, head & shoulders / MCU)
Def: head + shoulders to upper chest [S4,S5].
- eyeY: 4:5 **0.33–0.38**, 3:4 **0.33–0.38**, 9:16 **0.35–0.40** [S1 base 0.33; upper bound allows tight crop where crown is cut, D/P].
- headroom: 0.03–0.08 H (4:5, 3:4); 0.04–0.10 (9:16). Crown crop allowed up to 0.15·headH above `faceTop` only when headH > 0.45H ("tight headshot" mode) [S7,S10; numbers P].
- headH / H: 4:5 0.38–0.50, 3:4 0.36–0.48, 9:16 0.30–0.42 [D: from eyeY + bottom band; e.g. 4:5 eye 0.35, bottom at shoulder+0.4*(elbow−shoulder) gives headH≈0.42].
- bottom: band B_CU = upper arm mid-segment `[shoulder + 0.35*(elbow−shoulder), shoulder + 0.70*(elbow−shoulder)]` — i.e. below shoulder line, above bust/elbow [S6 "across... upper", S7 mid-bicep, S8 avoid bust line → P upper limit 0.70].
- forbidden: chin ± 0.10·headH, neckBase band, shoulder line ± 0.10·(elbow−shoulder).
- horizontal: §3; ears both inside with ≥0.03W margin [S9].

### 4.2 Half body (MS, waist up)
Def: waist up [S4,S5].
- eyeY: 4:5 **0.30–0.36**, 3:4 **0.30–0.36**, 9:16 **0.32–0.38**.
- headroom: 0.06–0.12 H (4:5/3:4); 0.07–0.14 (9:16) [P].
- subjH (headTop→bottom): ≈0.88–0.94 [D = 1 − headroom].
- bottom: band B_MS = at/just above waist, below elbows & below the bust line: `[shoulder + 0.70*(waist−shoulder), waist − 0.02*H]` OR mid-forearm if arms hang: ensure bottom is not within wrist ±0.05·(wrist−elbow) or elbow ±0.12·(wrist−elbow) [S6 "at the waist", "across forearm"; S8 not through hip].
- forbidden: hip ± 0.10·(knee−hip); elbow/wrist bands. If wrist lies within 0.05H of bottom → instruct "raise hands" or reframe [S6,S9].

### 4.3 Three-quarter (Cowboy / American shot, mid-thigh or below-knee)
Def: mid-thigh (cowboy) or just below knee [S4,S5,S6].
- eyeY: 4:5 **0.25–0.32**, 3:4 **0.25–0.32**, 9:16 **0.27–0.34** [D: eye-to-mid-thigh is ~0.6–0.7 of eye-to-feet; holding headroom 0.07–0.12 forces eye above 1/3; S1 allows departure from exact third for looser framing].
- headroom: 0.07–0.13 H; 9:16 0.08–0.15 [P].
- bottom: two safe bands
  - Thigh: `[hip + 0.40*(knee−hip), hip + 0.70*(knee−hip)]` (S9: thigh crop "as long as possible... avoid ending up with a knee crop" → prefer 0.55–0.70) [S6,S7,S9; numbers P].
  - Shin: `[knee + 0.30*(ankle−knee), knee + 0.65*(ankle−knee)]` [S6 "below the knee", S7 mid-shin; numbers P].
- forbidden: knee ± 0.15·(knee−hip); hip ±0.10·(knee−hip); hem-line warning if clothing edge detected near bottom [S8].

### 4.4 Full body (FS)
Def: head to toe in frame [S4,S5].
- eyeY: 4:5 **0.14–0.22**, 3:4 **0.14–0.22**, 9:16 **0.16–0.24** [D: with headroom 0.06–0.12 and eye ≈ 0.06–0.07 body-heights below crown (eye is ~1/2 headH below headTop, head ≈ 1/7.5 stature), eyeY = headroom + ~0.065·subjH·... ≈ 0.12–0.21].
- headroom: 0.05–0.12 H; foot room (1 − feetBottom): 0.04–0.10 H. No source gives a ratio; propose footRoom ≈ 0.6–1.0 × headroom (classic "less space under feet than above head") [P].
- subjH: 4:5 0.78–0.90, 3:4 0.78–0.90, 9:16 0.75–0.88 (9:16 allows a little more air because width constraint is irrelevant for standing figure) [D/P].
- bottom: must be below toes (`feetBottom + 0.03H`) — never at ankle [S7,S9].
- horizontal: body midline (mean x of hips/shoulders) at 0.50 ±0.05 frontal; turned → 0.42/0.58 [P].
- side margin: max/min x of wrists/elbows ≥ 0.04W from edges [P, S10 "elements near edge"].

### 4.5 Full body with environment (WS / environmental)
Def: full figure small in setting [S4,S5].
- subjH: 4:5 0.35–0.60, 3:4 0.35–0.60, 9:16 0.30–0.55 [P].
- eyeY: placement by thirds on subject not head: put subject's eye/head on or near the upper third line, i.e. eyeY 0.28–0.40; alternatively feet on lower third line (feetBottom 0.62–0.72) when sky/space above is the subject [S1 "equal weight to sky and ground... rather than proper headroom", S2]. Choose mode by subjH: if subjH ≤ 0.45 use "feet-on-lower-third", else "head-on-upper-third" [P].
- headroom: unconstrained lower bound 0.10; no upper bound except eyeY range [S1].
- horizontal: body midline at 0.333 or 0.667 (±0.05), lead room toward facing direction [S2,S3].
- bottom: feetBottom ≤ 0.92 (not touching edge) [P, S10].
- horizon (optional, if segmentation/horizon available): not through the head/neck; prefer upper or lower third [S2; P].

## 5. Joint-safe crop bands (summary, landmark-relative)

Let seg(a,b,t) = a + t·(b − a) on y.

| Edge location | Safe band (t range) | Forbidden zone | Source |
|---|---|---|---|
| Crown | top edge ≤ faceTop − 0.15·headH (only tight CU) else above headTop | between faceTop and eye | S1,S7,S10 |
| Upper arm / chest | seg(shoulder, elbow, 0.35–0.70) | shoulder ±0.10, elbow ±0.12 of segment; chin/neck | S6,S7,S8 |
| Forearm | seg(elbow, wrist, 0.30–0.70) | elbow, wrist ±0.10 | S6,S7 |
| Waist | seg(shoulder, hip, 0.75–0.90) | hip ±0.10 of hip→knee | S6,S8 |
| Thigh | seg(hip, knee, 0.40–0.70), prefer 0.55–0.70 | knee ±0.15 | S6,S7,S9 |
| Shin | seg(knee, ankle, 0.30–0.65) | knee, ankle ±0.15 | S6,S7 |
| Feet | ≥ feetBottom + 0.03H | ankle…toe | S7,S9 |

All t values are [P] quantifications of the sourced qualitative rule "crop mid-segment, not too close to the joint" (S8). A band width of ~0.3 of the segment keeps ≥ ~0.1–0.15 segment-length clearance from joints at 1 m–3 m distances where MediaPipe jitter ≈ 1–2% H.

Side edges: any body landmark within 0.02W of the side edge is "kissing"; either include with ≥0.04W margin or exclude its joint by ≥ 0.10 segment [P, S10].

## 6. Instruction logic: tolerance & hysteresis [P]

- Smoothing: One-Euro filter or EMA α=0.3 at 30 fps on all landmarks before scoring; ignore landmarks with visibility < 0.5.
- Dead-band: each metric has target range [lo, hi]; inside → OK. Outside by > `enter` margin to trigger a hint; return to OK only when back inside by `exit` margin (hysteresis):
  - eyeY: enter 0.03H, exit 0.015H
  - headroom: enter 0.02H, exit 0.01H
  - horizontal center: enter 0.04W, exit 0.02W
  - crop-band violation: enter when bottom edge inside forbidden zone for ≥ 300 ms; exit after inside safe band ≥ 300 ms
- Dwell: hint must persist ≥ 400 ms before shown; min 1.2 s between different hints; one hint at a time.
- Priority: (1) subject out of frame/ears/feet cut → (2) joint crop → (3) headroom/eye line → (4) horizontal/lead room → (5) tilt/level.
- Shot-size classification (auto mode): lowest visible landmark set — ankles visible & in frame → FS (subjH<0.6 → WS); knees visible → 3/4; hips visible → MS; else CU. Hysteresis: require new class for ≥ 0.8 s.
- "Ready" state: all metrics OK for ≥ 0.5 s → green indicator/auto-capture.
- Mapping to instructions: eyeY too high (small number) → "tilt down / move camera down"; too low → "tilt up"; subj too small → "step closer / zoom in"; bottom in knee band → "frame a bit higher (mid-thigh) or lower (below knee)" choose nearer safe band.

## 7. JSON config

```json
{
  "version": "0.1.0",
  "units": "normalized_frame",
  "evidence_note": "S=sourced, D=derived, P=proposed; see spec",
  "landmarks": {
    "eye": {"pose": [2, 5], "faceMesh": [468, 473], "fallbackFaceMesh": [33, 263]},
    "chin": {"faceMesh": [152]},
    "faceTop": {"faceMesh": [10]},
    "headTopFromFace": {"faceTopMinusChinToFaceTopRatio": 0.30, "evidence": "P"},
    "shoulder": [11, 12], "elbow": [13, 14], "wrist": [15, 16],
    "hip": [23, 24], "knee": [25, 26], "ankle": [27, 28], "feet": [29, 30, 31, 32],
    "ears": [7, 8], "nose": 0,
    "waistFromHip": {"towardShoulder": 0.25, "evidence": "P"},
    "minVisibility": 0.5
  },
  "horizontal": {
    "frontalYawMax": 0.15,
    "frontalCenterX": [0.46, 0.54],
    "turnedFaceX": {"facingRight": [0.36, 0.40], "facingLeft": [0.60, 0.64]},
    "wideThirdsX": {"facingRight": [0.283, 0.383], "facingLeft": [0.617, 0.717]},
    "sideMarginMin": 0.04, "kissingThreshold": 0.02
  },
  "cropBands": {
    "upperArm": {"from": "shoulder", "to": "elbow", "safe": [0.35, 0.70], "forbidNearFrom": 0.10, "forbidNearTo": 0.12},
    "forearm": {"from": "elbow", "to": "wrist", "safe": [0.30, 0.70], "forbidNear": 0.10},
    "waist": {"from": "shoulder", "to": "hip", "safe": [0.75, 0.90]},
    "thigh": {"from": "hip", "to": "knee", "safe": [0.40, 0.70], "preferred": [0.55, 0.70], "forbidNearTo": 0.15},
    "shin": {"from": "knee", "to": "ankle", "safe": [0.30, 0.65], "forbidNear": 0.15},
    "belowFeet": {"minGapBelowFeet": 0.03},
    "crownTightCrop": {"maxAboveFaceTopFracHeadH": 0.15, "requiresHeadHOver": 0.45},
    "forbidChinBandFracHeadH": 0.10
  },
  "shots": {
    "closeUp": {
      "bottomBands": ["upperArm"],
      "ratios": {
        "4:5":  {"eyeY": [0.33, 0.38], "headroom": [0.03, 0.08], "headH": [0.38, 0.50]},
        "3:4":  {"eyeY": [0.33, 0.38], "headroom": [0.03, 0.08], "headH": [0.36, 0.48]},
        "9:16": {"eyeY": [0.35, 0.40], "headroom": [0.04, 0.10], "headH": [0.30, 0.42]}
      }
    },
    "halfBody": {
      "bottomBands": ["waist", "forearm"],
      "ratios": {
        "4:5":  {"eyeY": [0.30, 0.36], "headroom": [0.06, 0.12]},
        "3:4":  {"eyeY": [0.30, 0.36], "headroom": [0.06, 0.12]},
        "9:16": {"eyeY": [0.32, 0.38], "headroom": [0.07, 0.14]}
      }
    },
    "threeQuarter": {
      "bottomBands": ["thigh", "shin"],
      "ratios": {
        "4:5":  {"eyeY": [0.25, 0.32], "headroom": [0.07, 0.13]},
        "3:4":  {"eyeY": [0.25, 0.32], "headroom": [0.07, 0.13]},
        "9:16": {"eyeY": [0.27, 0.34], "headroom": [0.08, 0.15]}
      }
    },
    "fullBody": {
      "bottomBands": ["belowFeet"],
      "footRoomToHeadroom": [0.6, 1.0],
      "ratios": {
        "4:5":  {"eyeY": [0.14, 0.22], "headroom": [0.05, 0.12], "footRoom": [0.04, 0.10], "subjH": [0.78, 0.90]},
        "3:4":  {"eyeY": [0.14, 0.22], "headroom": [0.05, 0.12], "footRoom": [0.04, 0.10], "subjH": [0.78, 0.90]},
        "9:16": {"eyeY": [0.16, 0.24], "headroom": [0.06, 0.13], "footRoom": [0.05, 0.11], "subjH": [0.75, 0.88]}
      }
    },
    "environment": {
      "bottomBands": ["belowFeet"],
      "modeSwitchSubjH": 0.45,
      "maxFeetBottom": 0.92,
      "ratios": {
        "4:5":  {"subjH": [0.35, 0.60], "eyeY": [0.28, 0.40], "feetOnLowerThird": [0.62, 0.72]},
        "3:4":  {"subjH": [0.35, 0.60], "eyeY": [0.28, 0.40], "feetOnLowerThird": [0.62, 0.72]},
        "9:16": {"subjH": [0.30, 0.55], "eyeY": [0.28, 0.40], "feetOnLowerThird": [0.62, 0.72]}
      }
    }
  },
  "hysteresis": {
    "smoothing": {"type": "ema", "alpha": 0.3},
    "eyeY": {"enter": 0.03, "exit": 0.015},
    "headroom": {"enter": 0.02, "exit": 0.01},
    "centerX": {"enter": 0.04, "exit": 0.02},
    "cropBandMs": 300, "hintDwellMs": 400, "hintGapMs": 1200,
    "shotClassHoldMs": 800, "readyHoldMs": 500,
    "priority": ["outOfFrame", "jointCrop", "headroomEye", "horizontal", "level"]
  }
}
```

## 8. Open questions / validation plan
1. `headTop` offset (0.30) must be calibrated on a labeled set (hair volume varies); consider selfie-segmentation top-of-mask instead.
2. Run ranges against ~50 professionally framed reference portraits per shot size and aspect (measure landmarks with MediaPipe) to replace [P] values with empirical percentiles (P10–P90).
3. 9:16 safe-area offset depends on target platform UI; make configurable.
