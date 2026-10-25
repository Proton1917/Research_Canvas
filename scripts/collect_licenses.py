import argparse
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def notice_file(path):
    name = path.name.upper()
    if name in {"LICENSE", "LICENCE", "COPYING", "NOTICE", "COPYRIGHT"}:
        return True
    if name.endswith(".LICENSE.TXT"):
        return True
    return name.startswith(("LICENSE.", "LICENSE-", "LICENSE_", "LICENCE.", "COPYING.", "NOTICE.", "COPYRIGHT.")) and path.suffix.lower() not in {".js", ".ts", ".json", ".map"}


def section(name, version, license_name, authors, files):
    lines = [f"\n{'=' * 72}\n{name} {version}\n许可声明：{license_name}\n"]
    if authors:
        lines.append("作者信息：" + json.dumps(authors, ensure_ascii=False) + "\n")
    for label, text in files:
        lines.append(f"\n--- {label} ---\n{text}\n")
    return "".join(lines)


def frontend():
    packages = {}
    notices = []
    for directory, folders, filenames in os.walk(ROOT / "node_modules"):
        folders[:] = [name for name in folders if name not in {".cache", ".git"}]
        path = Path(directory)
        if "package.json" in filenames:
            metadata = json.loads((path / "package.json").read_text(encoding="utf-8-sig"))
            if metadata.get("name") and metadata.get("version"):
                packages[path] = (metadata, [])
        notices.extend(path / name for name in filenames if notice_file(Path(name)))
    for path in notices:
        owner = next((parent for parent in path.parents if parent in packages), None)
        if owner is not None:
            packages[owner][1].append((path.relative_to(owner).as_posix(), path.read_text(encoding="utf-8-sig")))
    entries = {}
    for metadata, files in packages.values():
        key = (metadata["name"], metadata["version"])
        value = section(*key, metadata.get("license", metadata.get("licenses", "见分发材料")), metadata.get("author", metadata.get("contributors")), sorted(files))
        if key not in entries or len(value) > len(entries[key]):
            entries[key] = value
    return "前端构建依赖\n" + "".join(entries[key] for key in sorted(entries))


def rust():
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1", "--locked"], cwd=ROOT, text=True, encoding="utf-8"))
    result = ["Rust 构建依赖\n"]
    for package in sorted(metadata["packages"], key=lambda item: (item["name"], item["version"])):
        if package["source"] is None:
            continue
        directory = Path(package["manifest_path"]).parent
        files = [(path.name, path.read_text(encoding="utf-8-sig")) for path in sorted(directory.iterdir()) if path.is_file() and notice_file(path)]
        if package.get("license_file"):
            path = directory / package["license_file"]
            if path.name not in {name for name, _ in files}:
                files.append((path.name, path.read_text(encoding="utf-8-sig")))
        result.append(section(package["name"], package["version"], package.get("license") or "见随附许可文件", package.get("authors"), files))
    return "".join(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["frontend", "rust"])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text({"frontend": frontend, "rust": rust}[args.kind](), encoding="utf-8")
    print(args.output)
