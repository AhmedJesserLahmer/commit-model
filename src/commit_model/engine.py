"""Runs the quantized model in llama.cpp's llama-server, for the CLI.

Mirrors vscode-extension/src/engine.ts: same llama.cpp release, same platform builds (GPU via
Vulkan or Metal, CPU-only fallback), same generation settings. The engine and the model are
downloaded once into a cache folder (default ~/.cache/commit-model).
"""
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from commit_model.diff_utils import fit_prompt

# The llama.cpp release the model was quantized and verified with.
LLAMA_TAG = "b11476"
# 1024 leaves headroom above the 768-token prompts the model was trained on.
CONTEXT_SIZE = 1024
MAX_NEW_TOKENS = 40
DEFAULT_CACHE_DIR = Path.home() / ".cache" / "commit-model"


def resolve_model_url(uri: str) -> str:
    """Turns `hf:<user>/<repo>/<file>` into a direct Hugging Face download URL; other URLs pass through."""
    if not uri.startswith("hf:"):
        return uri
    parts = uri[3:].split("/")
    if len(parts) < 3 or not all(parts):
        raise ValueError(f'Invalid Hugging Face model URI "{uri}". Expected hf:<user>/<repo>/<file>.gguf')
    user, repo, *file = parts
    return f"https://huggingface.co/{user}/{repo}/resolve/main/{'/'.join(file)}"


def download(url: str, dest: Path, label: str) -> None:
    """Downloads to `dest.part`, renamed at the end so an interrupted download never looks complete."""
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url) as response, open(part, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        received, last = 0, -1
        while chunk := response.read(1 << 20):
            out.write(chunk)
            received += len(chunk)
            percent = 100 * received // total if total else 0
            if percent != last and sys.stderr.isatty():
                print(f"\rDownloading {label}... {percent}%", end="", file=sys.stderr, flush=True)
                last = percent
    if sys.stderr.isatty():
        print(file=sys.stderr)
    part.rename(dest)


def candidate_builds(use_gpu: bool) -> list[tuple[str, bool]]:
    """(release variant, uses GPU) pairs to try, best first, ending with a CPU-only build."""
    machine = platform.machine().lower()
    arch = "arm64" if machine in ("arm64", "aarch64") else "x64" if machine in ("x86_64", "amd64") else None
    if arch is None:
        raise RuntimeError(f"Unsupported processor architecture: {machine}")
    if sys.platform == "darwin":
        # macOS builds include Metal; CPU-only mode is chosen at launch with -ngl 0.
        return [(f"macos-{arch}", use_gpu)]
    if sys.platform.startswith("linux"):
        gpu_build, cpu_build = f"ubuntu-vulkan-{arch}", f"ubuntu-{arch}"
    elif sys.platform == "win32":
        gpu_build, cpu_build = f"win-vulkan-{arch}", f"win-cpu-{arch}"
    else:
        raise RuntimeError(f"Unsupported operating system: {sys.platform}")
    return ([(gpu_build, True)] if use_gpu else []) + [(cpu_build, False)]


def ensure_engine(variant: str, cache_dir: Path) -> Path:
    """Path to llama-server for this build, downloading and unpacking it the first time."""
    engine_dir = cache_dir / "engine" / LLAMA_TAG / variant
    done_marker = engine_dir / ".complete"
    if not done_marker.exists():
        shutil.rmtree(engine_dir, ignore_errors=True)
        engine_dir.mkdir(parents=True)
        archive_name = f"llama-{LLAMA_TAG}-bin-{variant}.{'zip' if sys.platform == 'win32' else 'tar.gz'}"
        archive = engine_dir / archive_name
        download(f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/{archive_name}",
                 archive, f"the engine ({variant})")
        if archive_name.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(engine_dir)
        else:
            with tarfile.open(archive) as t:
                t.extractall(engine_dir, filter="tar")  # keeps the archive's symlinks to shared libraries
        archive.unlink()
        done_marker.touch()
    server_name = "llama-server.exe" if sys.platform == "win32" else "llama-server"
    found = next(engine_dir.rglob(server_name), None)
    if found is None:
        raise RuntimeError(f"{server_name} not found in the downloaded engine ({engine_dir})")
    return found


def ensure_model(model_uri: str, cache_dir: Path) -> Path:
    url = resolve_model_url(model_uri)
    model_path = cache_dir / "models" / Path(urllib.request.urlparse(url).path).name
    if not model_path.exists():
        model_path.parent.mkdir(parents=True, exist_ok=True)
        download(url, model_path, "the model")
    return model_path


def server_env(bin_dir: Path) -> dict:
    """Library search path so the server finds the shared libraries shipped next to it."""
    env = dict(os.environ)
    for var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        env[var] = os.pathsep.join(filter(None, [str(bin_dir), env.get(var)]))
    return env


def pick_device(server: Path, env: dict) -> str | None:
    """With several GPUs (e.g. integrated Intel next to NVIDIA), prefers the dedicated one:
    llama.cpp would otherwise split the model across both."""
    try:
        out = subprocess.run([str(server), "--list-devices"], cwd=server.parent, env=env,
                             capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    devices = re.findall(r"^\s*(\S+): (.+?) \(\d+ MiB", out.stdout + out.stderr, re.MULTILINE)
    if len(devices) < 2:
        return None
    integrated = re.compile(r"intel|llvmpipe|swiftshader|microsoft basic", re.IGNORECASE)
    return next((dev for dev, name in devices if not integrated.search(name)), devices[0][0])


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerTokenizer:
    """The model's own tokenizer through llama-server, in the shape `fit_prompt` expects
    (the Hugging Face tokenizer interface: `tokenizer(text, add_special_tokens=False).input_ids`, `decode`)."""

    class _Encoding:
        def __init__(self, input_ids: list[int]):
            self.input_ids = input_ids

    def __init__(self, engine: "Engine"):
        self.engine = engine

    def __call__(self, text: str, add_special_tokens: bool = False) -> "_Encoding":
        return self._Encoding(self.engine.post("/tokenize", {"content": text, "add_special": add_special_tokens})["tokens"])

    def decode(self, tokens: list[int]) -> str:
        return self.engine.post("/detokenize", {"tokens": tokens})["content"]


class Engine:
    """Starts llama-server with the model on entering a `with` block and stops it on leaving."""

    def __init__(self, model_path: str | None, model_uri: str, cache_dir: Path = DEFAULT_CACHE_DIR,
                 use_gpu: bool = True):
        self.model_path = model_path
        self.model_uri = model_uri
        self.cache_dir = Path(cache_dir)
        self.use_gpu = use_gpu
        self.process: subprocess.Popen | None = None
        self.base_url: str | None = None

    def __enter__(self) -> "Engine":
        model = Path(self.model_path).expanduser().resolve() if self.model_path else ensure_model(self.model_uri, self.cache_dir)
        if not model.exists():
            raise FileNotFoundError(f"Model file not found: {model}")
        errors = []
        for variant, gpu in candidate_builds(self.use_gpu):
            try:
                self._start(ensure_engine(variant, self.cache_dir), model, gpu)
                return self
            except Exception as error:  # a GPU build can fail without working GPU drivers; CPU comes next
                errors.append(f"{variant}: {error}")
        raise RuntimeError("Couldn't start llama-server:\n" + "\n".join(errors))

    def _start(self, server: Path, model: Path, use_gpu: bool) -> None:
        env = server_env(server.parent)
        port = free_port()
        args = [str(server), "-m", str(model), "-c", str(CONTEXT_SIZE), "-np", "1",
                "--host", "127.0.0.1", "--port", str(port), "-ngl", "99" if use_gpu else "0"]
        device = pick_device(server, env) if use_gpu else None
        if device:
            args += ["--device", device]
        log = tempfile.TemporaryFile()
        process = subprocess.Popen(args, cwd=server.parent, env=env, stdout=log, stderr=subprocess.STDOUT)
        base_url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 180
        while not self._healthy(base_url):
            if process.poll() is not None:
                log.seek(0)
                tail = log.read().decode(errors="replace").strip().splitlines()[-8:]
                raise RuntimeError("llama-server exited while loading the model:\n" + "\n".join(tail))
            if time.monotonic() > deadline:
                process.kill()
                raise RuntimeError("llama-server didn't become ready within 3 minutes")
            time.sleep(0.3)
        self.process, self.base_url = process, base_url

    @staticmethod
    def _healthy(base_url: str) -> bool:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=2) as response:
                return json.load(response).get("status") == "ok"
        except OSError:
            return False

    def post(self, endpoint: str, body: dict) -> dict:
        request = urllib.request.Request(f"{self.base_url}{endpoint}", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)

    def generate(self, diff: str) -> str:
        """One-line commit message for an already-filtered diff."""
        content = self.post("/completion", {
            "prompt": fit_prompt(ServerTokenizer(self), diff, reserve_tokens=MAX_NEW_TOKENS),
            "n_predict": MAX_NEW_TOKENS,
            "temperature": 0,  # greedy, as in training evaluation
            "top_k": 1,
            "repeat_penalty": 1.0,  # no repeat penalty: training and evaluation never used one
            "stop": ["\n"],  # only the first line is kept anyway
        })["content"]
        return (content.strip().splitlines() or [""])[0].strip()

    def __exit__(self, *exc) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = self.base_url = None
