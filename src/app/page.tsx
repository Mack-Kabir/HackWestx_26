"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeSquats, demoFrames, type PoseFrame } from "@/lib/analysis";
import { analyzeVideo, type ClipResult } from "@/lib/video";
import type { Coaching } from "@/lib/coaching";
import Link from "next/link";

const clock = (t: number) =>
  Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0");
function Skeleton({ frame }: { frame?: PoseFrame }) {
  if (!frame) return null;
  const links = [
    [11, 12],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ];
  const ids = [...new Set(links.flat())];
  const visible = (i: number) => (frame.landmarks[i]?.visibility ?? 0) > 0.7;
  return (
    <svg
      className="skeleton"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-label="Detected body landmarks"
    >
      {links
        .filter(([a, b]) => visible(a) && visible(b))
        .map(([a, b]) => (
          <line
            key={a + "-" + b}
            x1={frame.landmarks[a].x * 1000}
            y1={frame.landmarks[a].y * 1000}
            x2={frame.landmarks[b].x * 1000}
            y2={frame.landmarks[b].y * 1000}
            stroke="#d7ff93"
            strokeWidth="4"
          />
        ))}
      {ids.filter(visible).map((i) => (
        <circle
          key={i}
          cx={frame.landmarks[i].x * 1000}
          cy={frame.landmarks[i].y * 1000}
          r="6"
          fill="#d7ff93"
          stroke="#284635"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
export default function Home() {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState("");
  const [result, setResult] = useState<ClipResult | null>(null),
    [time, setTime] = useState(0),
    [ratio, setRatio] = useState(1);
  const [selected, setSelected] = useState(0),
    [overlay, setOverlay] = useState(true);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [status, setStatus] = useState("");
  const [error, setError] = useState(""),
    [coaching, setCoaching] = useState<Coaching | null>(null),
    [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState(""),
    [configured, setConfigured] = useState(false);
  const abort = useRef<AbortController | null>(null),
    coachAbort = useRef<AbortController | null>(null),
    video = useRef<HTMLVideoElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch("/api/coach")
      .then((r) => r.json())
      .then((r) => setConfigured(r.configured))
      .catch(() => {});
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(
    () => () => {
      abort.current?.abort();
      coachAbort.current?.abort();
    },
    [],
  );
  function reset() {
    coachAbort.current?.abort();
    setCoaching(null);
    setCoachError("");
    setCoachBusy(false);
    setError("");
    setTime(0);
    setSelected(0);
  }
  function choose(f?: File) {
    if (!f || busy) return;
    reset();
    setResult(null);
    setFile(null);
    setUrl("");
    if (!f.type.startsWith("video/") || f.size > 100 * 1024 * 1024) {
      setError("Choose a video file under 100 MB.");
      return;
    }
    setFile(f);
    setUrl(URL.createObjectURL(f));
  }
  function demo() {
    reset();
    setFile(null);
    setUrl("");
    setRatio(1);
    const frames = demoFrames();
    setResult({
      analysis: analyzeSquats(frames, 1000, 1000, 12, "synthetic"),
      frames,
      keyframes: [],
    });
  }
  async function analyze() {
    if (!file) return;
    reset();
    setResult(null);
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      setResult(
        await analyzeVideo(file, controller.signal, (p, s) => {
          setProgress(p);
          setStatus(s);
        }),
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Analysis failed. Try again.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function coach() {
    if (!result || result.analysis.source === "synthetic") return;
    setCoachBusy(true);
    setCoachError("");
    const controller = new AbortController();
    coachAbort.current = controller;
    const all = result.keyframes;
    const chosen =
      all.length <= 6
        ? all
        : Array.from(
            { length: 6 },
            (_, i) => all[Math.round((i * (all.length - 1)) / 5)],
          );
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          duration: result.analysis.duration,
          coverage: result.analysis.coverage,
          reps: result.analysis.reps,
          keyframes: chosen.map(({ time, image }) => ({ time, image })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCoaching(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setCoachError(e instanceof Error ? e.message : "Coaching failed.");
    } finally {
      if (coachAbort.current === controller) setCoachBusy(false);
    }
  }
  function jump(t: number) {
    setTime(t);
    if (video.current) {
      video.current.pause();
      video.current.currentTime = t;
    }
  }
  function selectRep(i: number) {
    setSelected(i);
    const rep = result?.analysis.reps[i];
    if (rep) jump(rep.bottom);
  }
  function download() {
    if (!result) return;
    const href = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...result.analysis, coaching, landmarks: result.frames },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = "formchain-analysis.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const analysis = result?.analysis,
    synthetic = analysis?.source === "synthetic",
    rep = analysis?.reps[selected];
  const frame = result?.frames.reduce<PoseFrame | undefined>(
    (best, f) =>
      !best || Math.abs(f.time - time) < Math.abs(best.time - time) ? f : best,
    undefined,
  );
  const selectedFrames = rep
    ? result?.keyframes.slice(selected * 3, selected * 3 + 3)
    : result?.keyframes;
  const paths: string[] = [];
  let segment = "";
  analysis?.measurements.forEach((m) => {
    if (m.knee === null) {
      if (segment) paths.push(segment);
      segment = "";
    } else
      segment +=
        (segment ? " L" : "M") +
        (m.time / analysis.duration) * 1000 +
        "," +
        (190 - m.knee);
  });
  if (segment) paths.push(segment);
  const averageTime = analysis?.reps.length
    ? analysis.reps.reduce((s, r) => s + r.end - r.start, 0) /
      analysis.reps.length
    : 0;
  return (
    <main>
      <a className="skip" href="#review">
        Skip to workout review
      </a>
      <header className="site-header">
        <Link className="wordmark" href="/">
          formchain<span aria-hidden="true">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#review" className="nav-current">
            Your practice
          </a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <span className="privacy-label">
          <span aria-hidden="true">◌</span> Your space to move
        </span>
      </header>
      <div className="journal" id="review">
        <div className="page-title">
          <div>
            <p className="overline">THE MOVEMENT JOURNAL</p>
            <h1>{result ? "Your squat, rep by rep." : "Review your squat."}</h1>
            <p className="intro">
              {result
                ? "A closer look at the set you just recorded."
                : "A clearer view of how you move. Start with one short set."}
            </p>
          </div>
          <div className="session-label">
            <span className="session-icon" aria-hidden="true">
              ↗
            </span>
            <span>
              Strength practice<small>Squat · One set</small>
            </span>
          </div>
        </div>
        <div className="review-layout">
          <section className="recording" aria-labelledby="recording-title">
            <div className="section-bar">
              <h2 id="recording-title">
                {synthetic
                  ? "Sample recording"
                  : file
                    ? "Your recording"
                    : "Start with a recording"}
              </h2>
              {result && (
                <span className="subtle-tag">
                  {synthetic ? "Synthetic sample" : "Analyzed on your device"}
                </span>
              )}
            </div>
            <div
              className={"video-stage " + (!url && !synthetic ? "empty" : "")}
            >
              {url || synthetic ? (
                <div
                  className="video-fit"
                  style={{
                    aspectRatio: ratio,
                    maxWidth: "calc(var(--stage-height) * " + ratio + ")",
                  }}
                >
                  {url ? (
                    <video
                      ref={video}
                      src={url}
                      controls
                      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                      onLoadedMetadata={(e) =>
                        setRatio(
                          e.currentTarget.videoWidth /
                            e.currentTarget.videoHeight,
                        )
                      }
                      onError={() =>
                        setError(
                          "This format cannot be played. Try an H.264 MP4 or WebM.",
                        )
                      }
                    />
                  ) : (
                    <div className="sample-scene">
                      <span>SYNTHETIC LANDMARK SAMPLE</span>
                      <div className="sample-floor" />
                    </div>
                  )}
                  {overlay && <Skeleton frame={frame} />}
                </div>
              ) : (
                <div
                  className="upload-content"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    choose(e.dataTransfer.files[0]);
                  }}
                >
                  <div className="framing-guide" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <svg viewBox="0 0 220 180">
                      <circle cx="114" cy="36" r="12" />
                      <path d="M112 52 L94 97 L129 122 L107 157 M94 97 L64 124 L45 153 M109 59 L140 77 L164 69" />
                      <path className="ground-line" d="M30 162 H186" />
                    </svg>
                  </div>
                  <h3>
                    Give your movement
                    <br />a second look.
                  </h3>
                  <p>
                    Upload a 3–30 second clip of your set.
                    <br />A clear side view works best.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => input.current?.click()}
                  >
                    Choose a video <span aria-hidden="true">↗</span>
                  </button>
                  <button className="sample-button" onClick={demo}>
                    Explore a sample
                  </button>
                  <small>MP4 or WebM · Up to 100 MB</small>
                </div>
              )}
            </div>
            <input
              ref={input}
              type="file"
              accept="video/*"
              aria-label="Upload squat video"
              hidden
              disabled={busy}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {synthetic && (
              <div className="scrubber">
                <span>{clock(time)}</span>
                <input
                  aria-label="Sample timeline"
                  type="range"
                  min="0"
                  max="12"
                  step=".0667"
                  value={time}
                  onChange={(e) => jump(Number(e.target.value))}
                />
                <span>0:12</span>
              </div>
            )}
            {(url || synthetic) && (
              <div className="video-actions">
                <button
                  className="toggle"
                  aria-pressed={overlay}
                  onClick={() => setOverlay(!overlay)}
                >
                  <span aria-hidden="true">{overlay ? "●" : "○"}</span> Pose
                  overlay
                </button>
                <div>
                  <button
                    className="button quiet"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    Change clip
                  </button>
                  {file && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={analyze}
                    >
                      {busy
                        ? "Analyzing…"
                        : result
                          ? "Analyze again"
                          : "Analyze clip"}
                    </button>
                  )}
                </div>
              </div>
            )}
            {busy && (
              <div className="progress" role="status">
                <label>
                  {status}
                  <strong>{progress}%</strong>
                </label>
                <progress value={progress} max="100" />
                <button
                  className="link-button"
                  onClick={() => abort.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            )}
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <p className="recording-caption">
              {synthetic
                ? "A generated sample for exploring the review tools."
                : file
                  ? file.name
                  : "Your video stays on your device during movement analysis."}
            </p>
          </section>
          <aside className="session-review" aria-labelledby="set-title">
            <p className="overline">YOUR SET AT A GLANCE</p>
            <h2 id="set-title">
              {analysis
                ? "Every repetition counts."
                : "Small details. Useful insight."}
            </h2>
            <div className="rep-summary">
              <strong>{analysis?.reps.length ?? "—"}</strong>
              <div>
                <span>repetitions detected</span>
                <small>
                  {analysis
                    ? analysis.duration.toFixed(1) + " seconds of video"
                    : "Ready when you are"}
                </small>
              </div>
            </div>
            <div className="tracking">
              <span aria-hidden="true">◉</span>
              <p>
                {analysis
                  ? "Body tracked in " +
                    Math.round(analysis.coverage * 100) +
                    "% of frames"
                  : "Keep your full body in view"}
                <small>
                  {analysis
                    ? "Tracking coverage describes visibility, not form quality."
                    : "Start standing, complete your set, then return to standing."}
                </small>
              </p>
            </div>
            <div className="focus-note">
              <p className="overline">A MOMENT TO NOTICE</p>
              <h3>
                {rep
                  ? "Look at rep " + (selected + 1) + "."
                  : "Your recording is the starting point."}
              </h3>
              <p>
                {rep
                  ? "Compare your lowest position with the start and return. Depth and speed can vary; those reps still belong in your set."
                  : "We’ll find the repeated movements and give you a way to review each one."}
              </p>
              {rep && (
                <button
                  className="link-button"
                  onClick={() => jump(rep.bottom)}
                >
                  Go to lowest position <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
            <div className="coaching">
              <h3>A little more context</h3>
              {coaching ? (
                <>
                  <p className="coaching-source">
                    Gemini review · {coaching.exercise} · {coaching.confidence}{" "}
                    confidence
                  </p>
                  <p>{coaching.summary}</p>
                  {coaching.cues.map((c, i) => (
                    <p key={i}>
                      <button
                        className="link-button"
                        onClick={() => jump(c.timestamp)}
                      >
                        {clock(c.timestamp)}
                      </button>{" "}
                      {c.observation} {c.suggestion}
                    </p>
                  ))}
                  {coaching.limitations.map((l) => (
                    <small key={l}>{l}</small>
                  ))}
                </>
              ) : (
                <p>
                  {analysis
                    ? "Add an AI review of selected frames to help interpret your set."
                    : "Once your set is analyzed, you can request feedback on selected frames."}
                </p>
              )}
              {analysis && !synthetic && (
                <>
                  <button
                    className="button outline"
                    disabled={!configured || coachBusy}
                    onClick={coach}
                  >
                    {coachBusy ? "Reviewing…" : "Get Gemini coaching"}
                  </button>
                  <small>
                    {configured
                      ? "Shares up to six images spanning your set and its measurements with Google when you choose."
                      : "AI coaching is not connected yet. Your local review is available."}
                  </small>
                </>
              )}
              {coachError && (
                <p className="message error" role="alert">
                  {coachError}
                </p>
              )}
            </div>
          </aside>
        </div>
        <section className="rep-section" aria-labelledby="rep-title">
          <div className="section-heading">
            <div>
              <p className="overline">THE DETAILS, AT YOUR PACE</p>
              <h2 id="rep-title">One rep at a time.</h2>
            </div>
            <p>
              {analysis
                ? analysis.reps.length +
                  " detected · " +
                  averageTime.toFixed(1) +
                  "s average cycle"
                : "Your repetitions will appear after analysis."}
            </p>
          </div>
          {Boolean(analysis?.reps.length) && (
            <div className="rep-tabs" aria-label="Select a repetition">
              {analysis?.reps.map((r, i) => (
                <button
                  aria-pressed={selected === i}
                  className={selected === i ? "selected" : ""}
                  key={r.start}
                  onClick={() => selectRep(i)}
                >
                  <span>REP {String(i + 1).padStart(2, "0")}</span>
                  <small>
                    {clock(r.start)}–{clock(r.end)}
                  </small>
                </button>
              ))}
            </div>
          )}
          <div className="timeline">
            <div className="chart-title">
              <span>Camera-view knee angle</span>
              <small>Lower on the graph = more knee bend</small>
            </div>
            <div className="chart">
              <div className="y-axis">
                <span>180°</span>
                <span>90°</span>
                <span>0°</span>
              </div>
              <svg
                viewBox="0 0 1000 200"
                preserveAspectRatio="none"
                role="img"
                aria-label="Knee angle over the clip; repetition details are available below"
              >
                <line x1="0" x2="1000" y1="10" y2="10" />
                <line x1="0" x2="1000" y1="100" y2="100" />
                <line x1="0" x2="1000" y1="190" y2="190" />
                {analysis?.reps.map((r, i) => (
                  <rect
                    key={i}
                    x={(r.start / analysis.duration) * 1000}
                    width={((r.end - r.start) / analysis.duration) * 1000}
                    y="0"
                    height="200"
                    fill={selected === i ? "#dfe7d6" : "#eeeee6"}
                    opacity=".75"
                  />
                ))}
                {paths.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    stroke="#9b5137"
                    strokeWidth="3"
                    fill="none"
                  />
                ))}
                {analysis && (
                  <line
                    x1={(time / analysis.duration) * 1000}
                    x2={(time / analysis.duration) * 1000}
                    y1="0"
                    y2="200"
                    className="cursor"
                  />
                )}
              </svg>
              {!result && (
                <span className="chart-placeholder">
                  A timeline of your movement, with every rep marked.
                </span>
              )}
            </div>
            <div className="x-axis">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <span key={n}>
                  {analysis ? (analysis.duration * n).toFixed(1) : "—"}s
                </span>
              ))}
            </div>
          </div>
          {rep && (
            <div className="selected-review">
              <div className="rep-measurements">
                <div>
                  <span>Rep {selected + 1} · lowest position</span>
                  <strong>
                    {Math.round(rep.minKnee)}
                    <small>°</small>
                  </strong>
                  <p>Camera-view estimate</p>
                </div>
                <div>
                  <span>Lowering</span>
                  <strong>
                    {rep.descent.toFixed(1)}
                    <small>s</small>
                  </strong>
                  <p>Start to lowest position</p>
                </div>
                <div>
                  <span>Rising</span>
                  <strong>
                    {rep.ascent.toFixed(1)}
                    <small>s</small>
                  </strong>
                  <p>Lowest position to return</p>
                </div>
              </div>
              {Boolean(selectedFrames?.length) && (
                <div className="contact-sheet">
                  {selectedFrames?.map((f, i) => (
                    <button key={i} onClick={() => jump(f.time)}>
                      <picture>
                        <img
                          src={f.image}
                          alt={f.label + " at " + clock(f.time)}
                        />
                      </picture>
                      <span>
                        {["Start", "Lowest position", "Return"][i]}
                        <small>{clock(f.time)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="measurement-note">
                A front or angled camera can change these measurements. Review
                the video before drawing conclusions about technique.
              </p>
            </div>
          )}
          {analysis && (
            <details className="method-details">
              <summary>How these repetitions were counted</summary>
              <p>
                The detector looks for a visible bend-and-return cycle relative
                to your upright position. Smaller depth or faster tempo does not
                remove a repetition.
              </p>
              <p>
                {analysis.detection
                  ? "Reference knee angle: " +
                    analysis.detection.baseline.toFixed(1) +
                    "°. "
                  : ""}
                Missing tracking breaks a cycle. Unfinished movements are
                excluded.
              </p>
              {analysis.detection?.notes.map((n, i) => (
                <p key={i}>
                  {clock(n.start)}–{clock(n.end)}:{" "}
                  {n.reason.replaceAll("_", " ")} excluded.
                </p>
              ))}
              {analysis.cues.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </details>
          )}
        </section>
        <section id="how-it-works" className="how-section">
          <div>
            <p className="overline">A MORE CONSIDERED PRACTICE</p>
            <h2>Record. Notice. Repeat.</h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Find your frame</h3>
                <p>
                  A stable camera and a full-body view give you clearer
                  evidence.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Look at the movement</h3>
                <p>
                  Select a repetition. Compare its start, lowest position, and
                  return.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Take one observation forward</h3>
                <p>
                  Use the review to ask a better question about your next set.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <footer>
          <span className="wordmark">formchain.</span>
          <p>
            {synthetic
              ? "Synthetic sample · No workout rewards"
              : "Your practice, in perspective."}
          </p>
          <button className="link-button" disabled={!result} onClick={download}>
            Export session JSON ↓
          </button>
        </footer>
      </div>
    </main>
  );
}
