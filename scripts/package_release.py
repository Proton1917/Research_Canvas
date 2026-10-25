import argparse
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile

from collect_licenses import rust


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = ["windows-x64", "macos-arm64", "macos-x64", "linux-x64"]


def package(binary, platform):
    version = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    name = f"research-canvas-{version}-{platform}"
    output = ROOT / ".runtime" / "releases"
    staging = ROOT / "tmp" / "release-stage"
    output.mkdir(parents=True, exist_ok=True)
    staging.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    with tempfile.TemporaryDirectory(prefix=name + "-", dir=staging) as temporary:
        bundle = Path(temporary) / name
        bundle.mkdir()
        executable = bundle / ("research-canvas.exe" if platform == "windows-x64" else "research-canvas")
        shutil.copy2(binary, executable)
        executable.chmod(0o755)
        shutil.copytree(ROOT / "dist", bundle / "dist")
        (bundle / "config").mkdir()
        shutil.copy2(ROOT / "config/server.example.toml", bundle / "config/server.example.toml")
        shutil.copytree(ROOT / "config/prompts", bundle / "config/prompts")
        shutil.copy2(ROOT / "config/release/README.md", bundle / "README.md")
        shutil.copy2(ROOT / "docs/installation.md", bundle / "INSTALL.md")
        shutil.copy2(ROOT / "LICENSE", bundle / "LICENSE")
        (bundle / "VERSION").write_text(version + "\n", encoding="utf-8")
        (bundle / "SOURCE_COMMIT").write_text(commit + "\n", encoding="utf-8")
        launchers = ["start.cmd"] if platform == "windows-x64" else ["start.sh"]
        if platform.startswith("macos"):
            launchers.append("Start.command")
        for launcher in launchers:
            data = (ROOT / "config/release" / launcher).read_text(encoding="utf-8")
            (bundle / launcher).write_bytes(data.replace("\n", "\r\n").encode("utf-8") if launcher.endswith(".cmd") else data.encode("utf-8"))
            (bundle / launcher).chmod(0o755)
        licenses = bundle / "licenses"
        licenses.mkdir()
        shutil.copy2(ROOT / "config/release/LICENSES.md", licenses / "README.md")
        paths = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", "HEAD", "legal"], cwd=ROOT, text=True).splitlines()
        for path in paths:
            if path.endswith(".txt"):
                (licenses / Path(path).name).write_bytes(subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT))
        frontend = (ROOT / ".runtime/frontend-licenses.txt").read_text(encoding="utf-8")
        (licenses / "DEPENDENCIES.txt").write_text(rust() + "\n" + frontend, encoding="utf-8")
        if platform == "linux-x64":
            destination = output / f"{name}.tar.gz"
            with tarfile.open(destination, "w:gz") as archive:
                archive.add(bundle, arcname=name)
        else:
            destination = output / f"{name}.zip"
            with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in sorted(bundle.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(bundle.parent))
    print(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    args = parser.parse_args()
    package(args.binary.resolve(), args.platform)
