import argparse
import json
from pathlib import Path
import re
import time

import requests


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / ".runtime" / "latex-acceptance.json"
WORKSPACE = "1fe35cee-4840-4d4b-aa45-f1a2b390fba9"
PROPOSAL = "8f2b66e1-5eb4-4785-9edb-553fbe168207"


def request(base, method, path, expected=200, **kwargs):
    response = requests.request(method, base + path, timeout=60, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text[:1400])
    return response.json()


def save(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")


def recorded(args, record):
    archive = request(args.source_base, "GET", f"/workspaces/{WORKSPACE}/export")
    before = next(proposal for proposal in archive["canvas_proposals"] if proposal["id"] == PROPOSAL)
    assert re.search(r"\\{2}leftrightarrow", before["answer"])
    request(args.base, "POST", "/workspaces/import", 201, json=archive)
    after = request(args.base, "GET", f"/canvas-proposals/{PROPOSAL}")
    run = request(args.base, "GET", f"/runs/{before['run_id']}")
    assert after["answer"] == run["answer"]
    assert not re.search(r"\\{2,}[A-Za-z]", after["answer"])
    assert re.search(r"(?<!\\)\\leftrightarrow", after["answer"])
    assert after["actions"] == before["actions"]
    record.update(workspace_id=WORKSPACE, old_proposal_id=PROPOSAL, old_run_id=before["run_id"], old_context_id=before["context_id"], before_answer=before["answer"], after_answer=after["answer"], original_raw_response=before["raw_response"], recorded="passed")
    save(record)


def fresh(args, record):
    original = request(args.base, "GET", f"/contexts/{record['old_context_id']}")
    scene = original["scenes"][-1]
    canvas = request(args.base, "GET", f"/canvases/{scene['canvas_id']}")
    objects = [item for item in scene["objects"] if item["kind"] in {"document", "fragment", "idea", "discussion"}]
    context = request(args.base, "POST", f"/workspaces/{WORKSPACE}/scene-contexts", 201, json={"question": "请用 A、B 表示选中的两端研究对象，创建一张 note，说明二者的联系仍为候选。在分析正文和文稿中分别使用带 leftrightarrow 命令的行内公式表示候选对应，明确 A、B 的含义。文稿另附一个 latex 代码块展示该公式原始写法。按指定写入区域放置，只创建这一张文稿。", "mode": "canvas", "canvas_id": canvas["id"], "expected_revision": canvas["revision"], "objects": objects, "write_scope": scene["write_scope"]})
    run = request(args.base, "POST", f"/workspaces/{WORKSPACE}/runs", 202, json={"context_id": context["id"]})
    record["fresh_run_id"] = run["id"]
    save(record)
    print(f"公式输出运行开始：{run['id']}", flush=True)
    deadline = time.monotonic() + 210
    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
        time.sleep(1)
        run = request(args.base, "GET", f"/runs/{run['id']}")
    assert run["status"] == "succeeded", run
    proposal = request(args.base, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
    assert len(proposal["actions"]) == 1 and proposal["actions"][0]["type"] == "create_document"
    archive = request(args.base, "GET", f"/workspaces/{WORKSPACE}/export")
    old = next(item for item in archive["canvas_proposals"] if item["id"] == PROPOSAL)
    assert old["raw_response"] == record["original_raw_response"] and old["answer"] == record["before_answer"]
    stored = next(item for item in archive["canvas_proposals"] if item["id"] == proposal["id"])
    record.update(fresh_proposal=proposal, fresh_raw_response=stored["raw_response"], fresh_run=run, fresh="passed")
    save(record)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["recorded", "fresh"])
    parser.add_argument("--base", default="http://127.0.0.1:8792/api")
    parser.add_argument("--source-base", default="http://127.0.0.1:8790/api")
    args = parser.parse_args()
    record = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    if record.get(args.phase) == "passed":
        raise SystemExit(f"{args.phase} 已通过，复用已有结果。")
    {"recorded": recorded, "fresh": fresh}[args.phase](args, record)
    print(f"{args.phase}: passed", flush=True)
