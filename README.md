# FormChain — Movement Lab

HackWesTX VII prototype. Browser-based squat review: clip upload, MediaPipe landmarks, complete repetitions, knee-angle timeline, phase keyframes, JSON export, and an optional server-side Gemini coaching adapter. The wellbeing redesign and its evidence are documented in [the design research report](docs/health-product-design-research.md).

## Run locally

Use Node.js 22 or later. Development has been checked on Node.js 25.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Choose **Explore a sample** for a synthetic three-repetition demonstration. The sample exercises the real measurement code but does not use MediaPipe, Gemini, or an athlete recording.

For a real analysis, choose a 3–30 second MP4/H.264 or WebM video under 100 MB, filmed from the side with one person's shoulder, hip, knee, and ankle visible. Begin and end standing. Click **Analyze clip**. The clip stays in browser memory, with no server upload during local analysis. Model assets load from Google storage and jsDelivr; first analysis needs an internet connection. No results persist after refreshing.

## Gemini setup

Create `.env.local` from `.env.example`, then set `GEMINI_API_KEY` and `GEMINI_MODEL` to an image-capable model with structured JSON support enabled for your Google account. Restart the server. Keys remain server-side; do not use a `NEXT_PUBLIC_` prefix.

After local analysis, **Get Gemini coaching** sends up to six JPEG keyframes and the measured rep summary to the `/api/coach` route and Google. The model returns an exercise label, confidence category, timestamped cues, and limitations. Provider failures leave local results available. Missing configuration returns HTTP 503; invalid input returns 400; input above 2 MB returns 413. A non-squat or uncertain classification hides the displayed movement score. Exports retain provisional local metrics, explicitly marked `exercise: squat`; these are not reward attestations.

The live Gemini path has not yet been verified with credentials. The public endpoint has no authentication or persistent rate limiting; keep this prototype local until those controls exist.

## What is measured

- Decode 15 sample frames per second of source video, offline. Actual analysis speed depends on the device; this is not a real-time throughput claim.
- MediaPipe lite detects up to two people. Only frames with exactly one detected person are accepted. Choose one body side for the entire clip based on landmark visibility.
- Convert normalized landmarks into pixel coordinates before computing 2D knee angles and torso lean. Smooth knee angles before phase detection.
- Version 2 estimates an upright reference from the 90th percentile of visible knee angles. A cycle leaves the top band (reference minus 8°), crosses reference minus 14°, bends at least 20° relative to the reference, and returns to the top band. Require two excursion samples and at least 0.3 s overall to reject brief noise. Depth and phase speed do not determine whether a rep counts.
- Missing landmarks or tracking gaps above 0.25 s reset the cycle. Unfinished reps are excluded. These conservative thresholds can miss valid reps and require testing on actual footage.
- The prototype movement score averages `min(70, max(0, 160 − minimumKneeAngle)) + descentPoints + ascentPoints`. Descent earns 15 points at ≥0.8 s (otherwise 5); ascent earns 15 at ≥0.5 s (otherwise 5). A score requires a complete rep and ≥75% usable frames.

The legacy movementScore remains in JSON for compatibility but is removed from the primary interface. It is an uncalibrated range-and-tempo rubric. Torso lean is reported in the JSON, not universally penalized. Knee tracking in the frontal plane, joint loading, muscle activation, anatomical squat depth, body composition, and injury risk are not measured. Gemini is asked to ground its commentary in the supplied images and state uncertainty.

## Validation

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Alternatively use an installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

Tests include a reduced trace from a real 14.4-second front-squat clip: five repetitions detected where the original detector counted only one. Run the actual video through the browser regression with `SQUAT_CLIP=/absolute/path/to/clip.mp4 PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. The video itself is not committed. Tests also cover geometry, synthetic reps, partial reps, static/empty scenes, occlusion, gaps, aspect ratio, schema rejection, accessibility, and mobile layout. Validation on one real clip does not establish accuracy across people, exercises, or camera views.

## Next steps

1. Validate counts and phases against manually labeled side-view squat clips; verify Gemini with configured credentials.
2. Add Kimodo motion generation with skeleton mapping and a 3D viewer. Current SVG playback is observed/synthetic landmark inspection, not Kimodo output.
3. Add Solana devnet wallet proofs and rewards. No wallet, transaction, token, leaderboard, or verified gym-time tracking exists yet. Clip duration is not total time at the gym.

Continuity and task handoffs: `.codex/PROJECT_LEDGER.md`.

## References

- [MediaPipe Pose Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [NVIDIA Kimodo](https://research.nvidia.com/labs/sil/projects/kimodo/)
- [Solana transactions](https://solana.com/docs/intro/quick-start/writing-to-network)
