import argparse
import io
import json
from pathlib import Path
import time
import uuid
import zipfile

import requests


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / ".runtime" / "backend-handoff-acceptance.json"


def request(args, method, path, expected=200, **kwargs):
    response = requests.request(method, args.base + path, timeout=60, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text[:1500])
    return response.json() if response.content else None


def save(record):
    saved = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    saved.update(record)
    RECORD.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")


def recovery(args, record):
    runs = request(args, "GET", f"/workspaces/{args.workspace}/runs")
    failed = [run for run in runs if run["status"] == "failed" and "模型画布操作格式无效" in (run["error"] or "") and run["answer"].startswith("```json")]
    assert len(failed) == 3, [(run["id"], run["error"]) for run in failed]
    recovered = []
    for original in failed:
        run = request(args, "POST", f"/runs/{original['id']}/recover-canvas-proposal")
        assert run["status"] == "succeeded" and run["canvas_proposal_id"] and run["error"] is None
        assert run["usage"] == original["usage"] and run["model_used"] == original["model_used"]
        proposal = request(args, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
        assert proposal["status"] == "pending" and proposal["actions"]
        recovered.append({"run_id": run["id"], "proposal_id": proposal["id"], "model_used": run["model_used"]})
        record["recovered_runs"] = recovered
        save(record)
    record["recovery"] = "passed"
    save(record)


def structured(args, record):
    original = request(args, "GET", "/runs/a5bf3128-9db8-461b-bc54-01ebdea01ed9")
    run = request(args, "POST", f"/workspaces/{args.workspace}/runs", 202, json={"context_id": original["context_id"]})
    record["structured_run_id"] = run["id"]
    save(record)
    print(f"结构化运行开始：{run['id']}", flush=True)
    deadline = time.monotonic() + 210
    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
        time.sleep(1)
        run = request(args, "GET", f"/runs/{run['id']}")
    assert run["status"] == "succeeded", run
    assert run["context_id"] == original["context_id"] and run["usage"]["finish_reason"] == "tool_use"
    proposal = request(args, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
    assert proposal["actions"] and proposal["status"] == "pending"
    record["structured_proposal_id"] = proposal["id"]
    record["structured"] = "passed"
    save(record)


def endpoints(args, record):
    original = request(args, "GET", "/contexts/36e3bfd4-681f-4058-946c-bb3cd7fb80ac")
    selected = original["scenes"][-1]
    fragments = [item for item in selected["objects"] if item["kind"] == "fragment"]
    thought = next(source for source in original["sources"] if source["anchor_id"] is None)
    canvas = request(args, "POST", f"/workspaces/{args.workspace}/canvases", 201, json={"name": "片段与自由想法端点验证"})
    instance_id = str(uuid.uuid4())
    fragment = fragments[0]
    layout = fragment["bounds"]
    projection = {"workspace_id": args.workspace, "canvas_id": canvas["id"], "canvas_revision": canvas["revision"], "entry": "selection", "viewport": {"zoom": 1, "center_x": 0, "center_y": 0}, "objects": [
        {"instance_id": fragment["id"], "kind": "fragment", "ref": {"type": "anchor", "anchor_id": fragment["anchor_id"], "document_id": fragment["document_id"], "version": fragment["version"]}, "title": fragment["label"], "text": "", "formulas": [], "layout": {**layout, "rotate": 0}, "parent_ids": [], "child_ids": []},
        {"instance_id": instance_id, "kind": "idea", "ref": {"type": "editor", "flavour": "affine:note"}, "title": "沿路径传递的结构联系", "text": thought["content"], "formulas": [], "layout": {"x": 500, "y": 100, "width": 500, "height": 240, "rotate": 0}, "parent_ids": [], "child_ids": []},
    ]}
    materials = [{"key": f"locate:{fragment['id']}", "group": "locate", "objectId": fragment["id"], "include": True, "legacy": None}, {"key": f"idea:{instance_id}", "group": "body", "objectId": instance_id, "include": True, "legacy": None}]
    context = request(args, "POST", f"/workspaces/{args.workspace}/scene-contexts", 201, json={"question": "保留片段实例与自由想法，准备核查结构联系。", "projection": projection, "materials": materials})
    preserved = next(item for item in context["scenes"][-1]["objects"] if item["id"] == fragment["id"])
    assert preserved["anchor_id"] == fragment["anchor_id"] and preserved["bounds"] == fragment["bounds"]
    assert preserved["read_scope"] == "reference" and context["sources"] == []
    source_ref = {"type": "anchor", "id": fragment["anchor_id"]}
    target_ref = {"type": "canvas_object", "context_id": context["id"], "canvas_id": canvas["id"], "instance_id": instance_id}
    claim = {"status": "candidate", "conditions": "需要明确两端对象及保留运算", "counterexamples": "尚待检索和核查", "sources": [], "missing_proof": "工作区缺少 Connes–Kreimer 原始文献及对应运算的证明。", "next_validation": "补充文献，逐项核对乘法、余积及成立条件。"}
    relation = request(args, "POST", f"/workspaces/{args.workspace}/relations", 201, json={"source_ref": source_ref, "target_ref": target_ref, "kind": "research", "label": "片段与自由想法的候选联系", "claim": claim})
    assert relation["source_ref"] == source_ref and relation["target_ref"] == target_ref
    updated = request(args, "PATCH", f"/relations/{relation['id']}", json={"expected_claim_revision": relation["claim"]["revision"], "claim": {**relation["claim"], "next_validation": "先补充 Connes–Kreimer 原始文献，再核对余积和重整化条件。"}})
    saved = request(args, "GET", f"/relations/{relation['id']}")
    assert saved["claim"]["missing_proof"] == claim["missing_proof"] and saved["claim"]["next_validation"] == updated["claim"]["next_validation"]
    between = request(args, "POST", f"/workspaces/{args.workspace}/relations", 201, json={"source_ref": source_ref, "target_ref": {"type": "anchor", "id": fragments[1]["anchor_id"]}, "label": "两个精确片段的候选对应"})
    assert between["source_id"] != between["target_id"]
    record.update(endpoint_relation_id=relation["id"], fragment_relation_id=between["id"], endpoint_context_id=context["id"], endpoint_canvas_id=canvas["id"], endpoints="passed")
    save(record)


def archive(args, record):
    assert args.restore_base, "需要独立恢复服务"
    exported = request(args, "GET", f"/workspaces/{args.workspace}/export")
    assert exported["format_version"] == 3
    response = requests.post(args.restore_base + "/workspaces/import", json=exported, timeout=60)
    assert response.status_code == 201, response.text[:1000]
    restored = requests.get(args.restore_base + f"/workspaces/{args.workspace}/export", timeout=60).json()
    assert restored == exported
    response = requests.get(args.base + f"/workspaces/{args.workspace}/export.zip", timeout=60)
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        svg = package.read("relations.svg").decode("utf-8")
        assert "画布想法" in svg and "选段" in svg
        assert json.loads(package.read("workspace.json")) == exported
    record["archive"] = "passed"
    save(record)


def typed_actions(args, record):
    summary = request(args, "GET", f"/workspaces/{args.workspace}")
    manual = next(relation for relation in summary["relations"] if relation["label"] == "片段与自由想法的候选联系")
    previous = request(args, "GET", f"/contexts/{manual['target_ref']['context_id']}")
    canvas = request(args, "GET", f"/canvases/{manual['target_ref']['canvas_id']}")
    objects = previous["scenes"][-1]["objects"]
    fragment = next(item for item in objects if item["anchor_id"])
    fragment["read_scope"] = "excerpt"
    thought = next(item for item in objects if item["kind"] == "idea")
    question = f"仅提出一条连接这两个已有对象的候选关系：source_kind 使用 anchor，source_id 使用 {fragment['anchor_id']}；target_kind 使用 scene，target_id 使用 {thought['id']}。工作区缺少 Connes–Kreimer 原始文献，请在 missing_proof 记录缺口，在 next_validation 列出核对定义与运算的方法。其他操作数组为空。"
    context = request(args, "POST", f"/workspaces/{args.workspace}/scene-contexts", 201, json={"question": question, "mode": "canvas", "canvas_id": canvas["id"], "expected_revision": canvas["revision"], "objects": objects, "write_scope": {"allow_create": True}})
    run = request(args, "POST", f"/workspaces/{args.workspace}/runs", 202, json={"context_id": context["id"]})
    record["typed_run_id"] = run["id"]
    save(record)
    print(f"类型化端点运行开始：{run['id']}", flush=True)
    deadline = time.monotonic() + 210
    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
        time.sleep(1)
        run = request(args, "GET", f"/runs/{run['id']}")
    assert run["status"] == "succeeded", run
    proposal = request(args, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
    assert len(proposal["actions"]) == 1 and proposal["actions"][0]["type"] == "create_relation"
    applied = request(args, "POST", f"/canvas-proposals/{proposal['id']}/apply", json={"expected_revision": proposal["revision"], "expected_canvas_revision": canvas["revision"]})
    relation = applied["relations"][0]
    assert relation["source_ref"] == {"type": "anchor", "id": fragment["anchor_id"]}
    assert relation["target_ref"]["instance_id"] == thought["id"]
    assert relation["claim"]["status"] == "candidate" and relation["claim"]["missing_proof"] and relation["claim"]["next_validation"]
    reverted = request(args, "POST", f"/canvas-proposals/{proposal['id']}/revert", json={"expected_revision": applied["proposal"]["revision"], "expected_canvas_revision": applied["canvas"]["revision"]})
    assert relation["id"] in reverted["removed_relation_ids"]
    record["typed_proposal_id"] = proposal["id"]
    record["typed_actions"] = "passed"
    save(record)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["recovery", "structured", "endpoints", "typed_actions", "archive"])
    parser.add_argument("--base", default="http://127.0.0.1:8790/api")
    parser.add_argument("--workspace", default="1fe35cee-4840-4d4b-aa45-f1a2b390fba9")
    parser.add_argument("--restore-base")
    args = parser.parse_args()
    record = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    if record.get(args.phase) == "passed":
        raise SystemExit(f"{args.phase} 已通过，复用已有结果。")
    {"recovery": recovery, "structured": structured, "endpoints": endpoints, "typed_actions": typed_actions, "archive": archive}[args.phase](args, record)
    print(f"{args.phase}: passed", flush=True)
