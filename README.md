# FormChain — Movement Lab

HackWesTX VII prototype. Browser-based squat review: clip upload, MediaPipe landmarks, complete repetitions, knee-angle timeline, phase keyframes, JSON export, an optional server-side Gemini coaching adapter, and a Kimodo-ready 3D motion viewer. The wellbeing redesign and its evidence are documented in [the design research report](docs/health-product-design-research.md).

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

## Kimodo motion replay

The review includes a Three.js BVH viewer that works without a GPU: choose **Open BVH animation** and import a BVH file under 2 MB. Imported animation is parsed and bounded in the browser before rendering.

Live generation uses the small authenticated adapter in `services/kimodo/worker.py`. Run it on a Linux machine where NVIDIA's `kimodo_gen` CLI, SOMA-RP v1.1 checkpoint, and a supported CUDA GPU are already installed:

```sh
export KIMODO_API_TOKEN='replace-with-a-long-random-secret'
python3 services/kimodo/worker.py
```

Set the same secret and the worker's private URL as `KIMODO_API_TOKEN` and `KIMODO_URL` in the web app's `.env.local`, then restart Next.js. The worker listens on `127.0.0.1:8001` by default. If the web app runs elsewhere, expose the worker only through a private authenticated tunnel or TLS reverse proxy; setting `KIMODO_BIND=0.0.0.0` alone is not a secure deployment.

The adapter allows one bounded job at a time, sends only a selected squat variation and four-second duration, invokes `kimodo_gen`, and returns BVH. It never receives the workout video or landmarks. Generated output is labeled as a generic demonstration; it does not reconstruct the athlete, prove form quality, or replace the measured review. This local Apple Silicon machine has no NVIDIA GPU, so the live generation path is adapter-tested but not model-executed.

## Solana devnet workout proof

After a real video produces at least one repetition, at least 75% tracking coverage, and the prototype range/tempo metric, the sidebar offers an optional Solana receipt. Wallet Standard discovery uses the current `@solana/kit` stack and is fixed to devnet. The connected wallet pays the small devnet fee and signs a Memo-program transaction.

The public memo includes:

- a SHA-256 digest of the bounded versioned claim;
- exercise name, repetition count, and clip/set duration;
- no video, keyframes, landmarks, coaching text, wallet secret, or raw score.

The private claim committed by the digest contains the analysis/detector versions, tracking coverage, and provisional range/tempo score. The transaction is a wallet-signed **self-claim** only. It does not prove attendance, total time at a gym, correct form, or reward eligibility. Synthetic samples, low-coverage clips, and incomplete sets cannot use the proof control. No token is minted and no production points are issued.

`NEXT_PUBLIC_SOLANA_RPC_URL` can override the public devnet endpoint at build time. Because it is browser-visible, never place a secret-bearing provider URL there.

`npm test` executes the exact Memo instruction with a throwaway signer in an in-memory LiteSVM validator. An optional live smoke test creates a new in-memory signer, requests faucet SOL, and writes an explicitly labeled integration-test memo—not a workout claim:

```sh
npm run test:devnet
```

This performs a public devnet write. The public faucet is rate-limited and may fail independently of the transaction implementation.

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
python3 -m unittest tests/test_worker.py
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Alternatively use an installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

Tests include a reduced trace from a real 14.4-second front-squat clip: five repetitions detected where the original detector counted only one. Run the actual video through the browser regression with `SQUAT_CLIP=/absolute/path/to/clip.mp4 PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. The video itself is not committed. Tests also cover geometry, synthetic reps, partial reps, static/empty scenes, occlusion, gaps, aspect ratio, schema rejection, accessibility, and mobile layout. Validation on one real clip does not establish accuracy across people, exercises, or camera views.

## Next steps

1. Validate counts and phases against manually labeled side-view squat clips; verify Gemini with configured credentials.
2. Run the Kimodo worker on a supported NVIDIA host and verify the adapter against a real SOMA-RP v1.1 generation. The viewer and authenticated job path are implemented; live model execution remains unverified.
3. Verify the Wallet Standard flow with an installed devnet wallet and an Explorer-confirmed workout receipt. The client, claim hashing, Memo transaction, local validator execution, and conditional control are implemented. Add server attestation and app-level rewards only after deciding what evidence is trustworthy; clip duration is not total time at the gym.

Continuity and task handoffs: `.codex/PROJECT_LEDGER.md`.

## References

- [MediaPipe Pose Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [NVIDIA Kimodo](https://research.nvidia.com/labs/sil/projects/kimodo/)
- [Solana Next.js + Kit](https://solana.com/docs/frontend/nextjs-solana)
- [Solana transactions](https://solana.com/docs/intro/quick-start/writing-to-network)
