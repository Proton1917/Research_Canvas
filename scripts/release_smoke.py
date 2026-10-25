import argparse
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import platform as runtime_platform
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
import urllib.error
import urllib.request
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".runtime/python"))
import tomli_w


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and attributes.get("src"):
            self.paths.append(attributes["src"])
        if tag == "link" and attributes.get("rel") == "stylesheet":
            self.paths.append(attributes["href"])


def http(base, method, path, payload=None, content_type=None, expected=200):
    headers = {}
    if payload is not None and not isinstance(payload, bytes):
        payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(base + path, data=payload, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == expected, (path, response.status)
        data = response.read()
        return json.loads(data) if response.headers.get("Content-Type", "").startswith("application/json") else data


def import_file(base, workspace_id, path, media_type):
    boundary = "research-canvas-" + uuid.uuid4().hex
    name = path.name
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {media_type}\r\n\r\n').encode("utf-8") + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode("ascii")
    return http(base, "POST", f"/api/workspaces/{workspace_id}/imports", body, f"multipart/form-data; boundary={boundary}", 201)


def verify(path, platform):
    temporary_root = ROOT / "tmp/release-smoke"
    temporary_root.mkdir(parents=True, exist_ok=True)
    log = ROOT / ".runtime/logs" / f"release-{platform}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="安装验证 ", dir=temporary_root) as temporary:
        directory = Path(temporary)
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as archive:
                archive.extractall(directory)
                if os.name != "nt":
                    for item in archive.infolist():
                        if not item.is_dir():
                            (directory / item.filename).chmod(item.external_attr >> 16 & 0o777 or 0o644)
        else:
            with tarfile.open(path) as archive:
                archive.extractall(directory, filter="data")
        bundle, = [item for item in directory.iterdir() if item.is_dir()]
        source_commit = (bundle / "SOURCE_COMMIT").read_text(encoding="utf-8").strip()
        version = (bundle / "VERSION").read_text(encoding="utf-8").strip()
        assert not (bundle / "config/server.toml").exists()
        assert (bundle / "licenses/DEPENDENCIES.txt").stat().st_size > 0
        settings = tomllib.loads((bundle / "config/server.example.toml").read_text(encoding="utf-8"))
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        settings["port"] = port
        settings["allowed_origins"] = [f"http://127.0.0.1:{port}"]
        configuration = directory / "smoke.toml"
        configuration.write_text(tomli_w.dumps(settings), encoding="utf-8")
        environment = {**os.environ, "RC_CONFIG": str(configuration), "TMPDIR": str(directory)}
        command = ["cmd.exe", "/d", "/c", "start.cmd"] if os.name == "nt" else ["bash", "start.sh"]
        with log.open("wb") as stream:
            process = subprocess.Popen(command, cwd=bundle, env=environment, stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
            try:
                base = f"http://127.0.0.1:{port}"
                deadline = time.monotonic() + 30
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(log.read_text(encoding="utf-8", errors="replace"))
                    try:
                        health = http(base, "GET", "/api/health")
                        break
                    except urllib.error.URLError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.2)
                assert health["database"] == "ready"
                assert (bundle / "config/server.toml").exists()
                html = http(base, "GET", "/").decode("utf-8")
                assert "Research Canvas" in html
                assets = Assets()
                assets.feed(html)
                assert assets.paths
                for asset in assets.paths:
                    assert http(base, "GET", asset)
                capabilities = http(base, "GET", "/api/capabilities")
                assert capabilities["canvas_proposals"] == 2 and capabilities["relation_endpoints"] == 1
                workspace = http(base, "POST", "/api/workspaces", {"name": "Research Canvas 安装验证"}, expected=201)
                imported = import_file(base, workspace["id"], bundle / "INSTALL.md", "text/markdown")
                assert imported["document"]["content"]["blocks"][0]["text"] == (bundle / "INSTALL.md").read_bytes().decode("utf-8")
                pdf = import_file(base, workspace["id"], ROOT / "docs/Research_Canvas_conversation_2026-10-25.pdf", "application/pdf")
                assert len(pdf["document"]["content"]["blocks"]) == 7
                assert "Research Canvas" in "\n".join(block["text"] for block in pdf["document"]["content"]["blocks"])
                exported = http(base, "GET", f"/api/workspaces/{workspace['id']}/export")
                assert len(exported["documents"]) == 2 and exported["format_version"] == 3
                archive = http(base, "GET", f"/api/workspaces/{workspace['id']}/export.zip")
                with zipfile.ZipFile(io.BytesIO(archive)) as saved:
                    assert json.loads(saved.read("workspace.json")) == exported
                process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGTERM)
                process.communicate(input=b"Y\r\n" if os.name == "nt" else None, timeout=20)
                assert "Research Canvas 后端已停止" in log.read_text(encoding="utf-8", errors="replace")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
    record = ROOT / ".runtime/releases" / f"verification-{platform}.json"
    record.write_text(json.dumps({"platform": platform, "runtime": runtime_platform.platform(), "version": version, "source_commit": source_commit, "archive": path.name, "status": "passed", "checks": ["launcher", "configuration", "web_assets", "capabilities", "markdown_import", "pdf_import", "json_export", "zip_export", "graceful_shutdown"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(record)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--platform", required=True)
    args = parser.parse_args()
    verify(args.archive.resolve(), args.platform)
