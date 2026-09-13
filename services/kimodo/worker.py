"""Single-process, authenticated Kimodo job worker. Run beside a configured kimodo_gen CLI."""
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL = "Kimodo-SOMA-RP-v1.1"
SEED = 42
PROMPTS = {
    "bodyweight": "A person performs one controlled bodyweight squat, starting upright, lowering into a squat and returning to standing",
    "front-squat": "A person performs one controlled front squat with hands held at the front shoulders, starting upright, lowering into a squat and returning to standing",
}
jobs = {}
lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=1)


def build_command(duration, variant, output):
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 2 <= duration <= 8 or variant not in PROMPTS:
        raise ValueError("Invalid motion request")
    return ["kimodo_gen", PROMPTS[variant], "--model", MODEL, "--duration", str(duration), "--seed", str(SEED), "--num_samples", "1", "--bvh", "--bvh_standard_tpose", "--output", str(output)]


def resolve_bvh_output(stem):
    """Support the single-sample names emitted by current and earlier CLIs."""
    candidates = [stem.with_suffix(".bvh"), Path(str(stem) + "_00.bvh")]
    existing = [path for path in candidates if path.is_file()]
    if len(existing) != 1:
        raise OSError("Kimodo did not produce exactly one BVH file")
    return existing[0]


def generate(job_id, duration, variant):
    with lock:
        jobs[job_id]["status"] = "running"
    try:
        with tempfile.TemporaryDirectory(prefix="formchain-motion-") as folder:
            stem = Path(folder) / "motion"
            subprocess.run(build_command(duration, variant, stem), check=True, capture_output=True, timeout=240)
            output = resolve_bvh_output(stem)
            if output.stat().st_size > 2_000_000:
                raise ValueError("Output too large")
            bvh = output.read_text()
        with lock:
            jobs[job_id].update(status="complete", bvh=bvh, model=MODEL)
    except (OSError, ValueError, subprocess.SubprocessError):
        with lock:
            jobs[job_id].update(status="failed", error="Generation failed. Check worker model access, GPU memory, and CLI installation.")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        encoded = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self):
        token = os.environ.get("KIMODO_API_TOKEN", "")
        ok = bool(token) and secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)
        if not ok:
            self.reply(401, {"error": "Unauthorized"})
        return ok

    def do_GET(self):
        if not self.authorized():
            return
        if self.path == "/health":
            self.reply(200, {"cliInstalled": bool(shutil.which("kimodo_gen")), "model": MODEL, "seed": SEED, "output": "SOMA77 BVH, standard T-pose"})
            return
        job_id = self.path.removeprefix("/jobs/")
        with lock:
            item = jobs.get(job_id)
            self.reply(200 if item else 404, {k: v for k, v in item.items() if k != "created"} if item else {"error": "Job not found or worker restarted"})

    def do_POST(self):
        if not self.authorized():
            return
        if self.path != "/jobs":
            self.reply(404, {"error": "Unknown endpoint"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 1024:
                raise ValueError()
            request = json.loads(self.rfile.read(size))
            build_command(request["duration"], request["variant"], "motion")
        except (ValueError, KeyError, TypeError):
            self.reply(400, {"error": "Invalid request"})
            return
        if not shutil.which("kimodo_gen"):
            self.reply(503, {"error": "Install and verify kimodo_gen first"})
            return
        with lock:
            expired = [key for key, value in jobs.items() if time.time() - value["created"] > 900 and value["status"] not in ("queued", "running")]
            for key in expired:
                del jobs[key]
            if len(jobs) >= 10 or any(j["status"] in ("queued", "running") for j in jobs.values()):
                self.reply(429, {"error": "Worker busy. Try again after the current generation completes."})
                return
            job_id = str(uuid.uuid4())
            jobs[job_id] = {"id": job_id, "status": "queued", "created": time.time()}
        executor.submit(generate, job_id, request["duration"], request["variant"])
        self.reply(202, {"id": job_id, "status": "queued"})


if __name__ == "__main__":
    if not os.environ.get("KIMODO_API_TOKEN"):
        raise SystemExit("Set KIMODO_API_TOKEN before starting the worker.")
    ThreadingHTTPServer((os.environ.get("KIMODO_BIND", "127.0.0.1"), int(os.environ.get("PORT", "8001"))), Handler).serve_forever()
