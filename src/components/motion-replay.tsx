"use client";
import { useEffect, useRef, useState } from "react";
import { validateBvh, motionResponse } from "@/lib/motion";

export default function MotionReplay() {
  const [configured, setConfigured] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [bvh, setBvh] = useState(""),
    [source, setSource] = useState(""),
    [error, setError] = useState("");
  const [variant, setVariant] = useState<"bodyweight" | "front-squat">(
      "front-squat",
    ),
    [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0),
    [position, setPosition] = useState(0);
  const mount = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    cancel = useRef<AbortController | null>(null);
  const playback = useRef({ playing: false, time: 0 });
  useEffect(() => {
    fetch("/api/motion")
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured))
      .catch(() => {});
    return () => cancel.current?.abort();
  }, []);
  useEffect(() => {
    if (!bvh || !mount.current) return;
    let stopped = false,
      dispose = () => {};
    async function init() {
      try {
        validateBvh(bvh);
        const THREE = await import("three");
        const { BVHLoader } = await import("three/addons/loaders/BVHLoader.js");
        const { OrbitControls } =
          await import("three/addons/controls/OrbitControls.js");
        if (stopped || !mount.current) return;
        const animation = new BVHLoader().parse(bvh),
          scene = new THREE.Scene();
        scene.background = new THREE.Color("#eceee3");
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        const host = mount.current;
        host.appendChild(renderer.domElement);
        renderer.domElement.setAttribute(
          "aria-label",
          "3D skeletal motion viewer",
        );
        const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
        camera.position.set(3, 1.7, 3.5);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.95, 0);
        controls.enablePan = false;
        controls.minDistance = 1;
        controls.maxDistance = 8;
        const group = new THREE.Group(),
          root = animation.skeleton.bones[0];
        group.add(root);
        scene.add(group);
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(animation.clip).play();
        mixer.setTime(0);
        group.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromPoints(
          animation.skeleton.bones.map((b) =>
            b.getWorldPosition(new THREE.Vector3()),
          ),
        );
        const height = Math.max(0.1, bounds.max.y - bounds.min.y),
          factor = 1.8 / height,
          center = bounds.getCenter(new THREE.Vector3());
        group.scale.setScalar(factor);
        group.position.set(
          -center.x * factor,
          -bounds.min.y * factor,
          -center.z * factor,
        );
        group.updateMatrixWorld(true);
        const helper = new THREE.SkeletonHelper(root);
        const helperMaterial = new THREE.LineBasicMaterial({
          color: "#294e3b",
          depthTest: false,
        });
        helper.material = helperMaterial;
        scene.add(helper);
        const geometry = new THREE.SphereGeometry(0.019, 10, 8),
          material = new THREE.MeshBasicMaterial({ color: "#55744b" });
        const markers = animation.skeleton.bones.map(() => {
          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          return mesh;
        });
        const grid = new THREE.GridHelper(5, 20, "#b0bba5", "#d6dcce");
        scene.add(grid);
        const resize = new ResizeObserver(() => {
          const w = host.clientWidth,
            h = host.clientHeight;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        resize.observe(host);
        setDuration(animation.clip.duration);
        setPosition(0);
        playback.current = { playing: false, time: 0 };
        setPlaying(false);
        let raf = 0,
          last = performance.now(),
          lastUi = 0;
        const draw = (now: number) => {
          if (stopped) return;
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          if (playback.current.playing)
            playback.current.time =
              (playback.current.time + dt) % animation.clip.duration;
          mixer.setTime(playback.current.time);
          group.updateMatrixWorld(true);
          markers.forEach((mesh, i) =>
            animation.skeleton.bones[i].getWorldPosition(mesh.position),
          );
          controls.update();
          renderer.render(scene, camera);
          if (now - lastUi > 100) {
            setPosition(playback.current.time);
            lastUi = now;
          }
          raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        dispose = () => {
          cancelAnimationFrame(raf);
          resize.disconnect();
          controls.dispose();
          mixer.stopAllAction();
          mixer.uncacheRoot(root);
          geometry.dispose();
          material.dispose();
          helper.geometry.dispose();
          helperMaterial.dispose();
          grid.geometry.dispose();
          if (Array.isArray(grid.material))
            grid.material.forEach((m) => m.dispose());
          else grid.material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error
              ? e.message
              : "3D rendering is unavailable in this browser.",
          );
      }
    }
    void init();
    return () => {
      stopped = true;
      dispose();
    };
  }, [bvh]);
  function load(text: string, label: string) {
    try {
      validateBvh(text);
      setError("");
      setBvh(text);
      setSource(label);
      setPlaying(false);
      playback.current = { playing: false, time: 0 };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid animation.");
    }
  }
  async function generate() {
    setBusy(true);
    setError("");
    setStatus("Starting motion generation…");
    const controller = new AbortController();
    cancel.current = controller;
    try {
      let response = await fetch("/api/motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, duration: 4 }),
        signal: controller.signal,
      });
      let data = await response.json();
      if (!response.ok) throw new Error(data.error);
      let job = motionResponse.parse(data);
      const start = Date.now();
      while (job.status === "queued" || job.status === "running") {
        if (Date.now() - start > 270000)
          throw new Error(
            "Generation took too long. Check the worker before retrying.",
          );
        setStatus(
          job.status === "queued"
            ? "Waiting for the motion worker…"
            : "Kimodo is generating a four-second demonstration…",
        );
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, 2000);
          controller.signal.addEventListener("abort", abort, { once: true });
          if (controller.signal.aborted) abort();
        });
        response = await fetch("/api/motion/" + job.id, {
          signal: controller.signal,
        });
        data = await response.json();
        if (!response.ok) throw new Error(data.error);
        job = motionResponse.parse(data);
      }
      if (job.status === "failed") throw new Error(job.error);
      load(
        job.bvh,
        "Generated by " + job.model + " · " + variant + " demonstration",
      );
      setStatus("Motion is ready to review.");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Motion generation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="motion-section" id="motion-replay">
      <div className="section-heading">
        <div>
          <p className="overline">ANOTHER WAY TO SEE THE MOVEMENT</p>
          <h2>Explore a motion replay.</h2>
        </div>
        <span className="subtle-tag">3D demonstration</span>
      </div>
      <div className="motion-layout">
        <div>
          {bvh ? (
            <>
              <div ref={mount} className="motion-canvas" />
              <div className="motion-controls">
                <button
                  className="button quiet"
                  onClick={() => {
                    playback.current.playing = !playing;
                    setPlaying(!playing);
                  }}
                >
                  {playing ? "Pause replay" : "Play replay"}
                </button>
                <input
                  aria-label="3D replay timeline"
                  type="range"
                  min="0"
                  max={duration || 1}
                  step=".01"
                  value={position}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    playback.current.time = t;
                    playback.current.playing = false;
                    setPlaying(false);
                    setPosition(t);
                  }}
                />
                <span>{position.toFixed(1)}s</span>
              </div>
              <p className="recording-caption">
                {source}. Drag to orbit; scroll to zoom.
              </p>
            </>
          ) : (
            <div className="replay-empty">
              <span aria-hidden="true">↻</span>
              <h3>A different perspective.</h3>
              <p>
                Generate a skeletal demonstration or open a BVH animation to
                explore its movement in 3D.
              </p>
            </div>
          )}
        </div>
        <div className="motion-explanation">
          <h3>Review a generated example</h3>
          <p>
            Kimodo can create a new squat animation. It illustrates a movement;
            it does not reconstruct your recording or certify technique.
          </p>
          <label htmlFor="variation">Squat variation</label>
          <select
            id="variation"
            value={variant}
            disabled={busy}
            onChange={(e) => setVariant(e.target.value as typeof variant)}
          >
            <option value="front-squat">Front squat</option>
            <option value="bodyweight">Bodyweight squat</option>
          </select>
          <button
            className="button primary"
            disabled={!configured || busy}
            onClick={generate}
          >
            {busy ? "Generating…" : "Generate with Kimodo"}
          </button>
          {!configured && (
            <p className="connection-note">
              Live generation needs a connected Kimodo worker. You can open a
              BVH animation below to use the viewer now.
            </p>
          )}
          <button
            className="button outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Open BVH animation
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".bvh"
            aria-label="Import BVH animation"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 2_000_000) {
                setError("Choose a BVH file smaller than 2 MB.");
                return;
              }
              load(await f.text(), "Imported animation · " + f.name);
            }}
          />
          {busy && (
            <div role="status">
              <p>{status}</p>
              <button
                className="link-button"
                onClick={() => {
                  cancel.current?.abort();
                  setStatus(
                    "Stopped waiting. The worker may finish its current job.",
                  );
                }}
              >
                Stop waiting
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
