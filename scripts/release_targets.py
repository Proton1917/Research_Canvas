import argparse
import json


TARGETS = [
    {"platform": "windows-x64", "runner": "windows-2022", "target": "x86_64-pc-windows-msvc", "executable": "research-canvas.exe", "extension": "zip", "rustflags": "-C target-feature=+crt-static"},
    {"platform": "macos-arm64", "runner": "macos-15", "target": "aarch64-apple-darwin", "executable": "research-canvas", "extension": "zip", "rustflags": ""},
    {"platform": "macos-x64", "runner": "macos-15-intel", "target": "x86_64-apple-darwin", "executable": "research-canvas", "extension": "zip", "rustflags": ""},
    {"platform": "linux-x64", "runner": "ubuntu-22.04", "target": "x86_64-unknown-linux-gnu", "executable": "research-canvas", "extension": "tar.gz", "rustflags": ""},
]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("platforms", choices=["all", "macos"])
    args = parser.parse_args()
    targets = TARGETS if args.platforms == "all" else [target for target in TARGETS if target["platform"].startswith("macos-")]
    print("targets=" + json.dumps(targets, separators=(",", ":")))
