import argparse
import json
from pathlib import Path
import time

import requests


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / ".runtime" / "canvas-acceptance.json"
QUOTES = ["删除视觉连线绝不能自动删除研究结论。", "先处理全局关系误删风险、自动保存一致性、来源锚点漂移。"]


def request(base, method, path, expected=200, **kwargs):
    response = requests.request(method, base + path, timeout=210, **kwargs)
    assert response.status_code == expected, (method, path, response.status_code, response.text[:1400])
    return response.json() if response.content else None


def save(record):
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")


def generate(base, workspace_id, context_id):
    run = request(base, "POST", f"/workspaces/{workspace_id}/runs", 202, json={"context_id": context_id})
    print(f"模型运行开始：{run['id']}", flush=True)
    deadline = time.monotonic() + 210
    while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
        time.sleep(1)
        run = request(base, "GET", f"/runs/{run['id']}")
    assert run["status"] == "succeeded", run
    assert run["answer"] and "gemini-3.8-flash" in run["model_used"].lower(), run
    return run


def anchor(base, workspace_id, document, quote):
    block = next(block for block in document["content"]["blocks"] if quote in block["text"])
    offset = len(block["text"].split(quote, 1)[0].encode("utf-16-le")) // 2
    return request(base, "POST", f"/workspaces/{workspace_id}/anchors", 201, json={"document_id": document["id"], "version": document["current_version"], "block_id": block["id"], "quote": quote, "start_utf16": offset})


def contexts(args, record):
    base = args.base
    capabilities = request(base, "GET", "/capabilities")
    assert capabilities["frozen_inheritance"] and capabilities["scene_context"] == 1
    response = requests.get(base + "/unknown-canvas-route", timeout=10)
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"
    workspace = request(base, "POST", "/workspaces", 201, json={"name": "Research Canvas 画布共创后端联调"})
    workspace_id = workspace["id"]
    with args.source.open("rb") as source:
        imported = request(base, "POST", f"/workspaces/{workspace_id}/imports", 201, files={"file": (args.source.name, source, "application/pdf")})
    document = imported["document"]
    anchors = [anchor(base, workspace_id, document, quote) for quote in QUOTES]
    context = request(base, "POST", f"/workspaces/{workspace_id}/contexts", 201, json={"question": "根据这两个选段，说明画布连线删除与保存一致性各自需要保证什么。保留来源编号。", "anchor_ids": [item["id"] for item in anchors]})
    assert [source["content"] for source in context["sources"]] == QUOTES
    run = generate(base, workspace_id, context["id"])
    changed = json.loads(json.dumps(document["content"]))
    changed["blocks"][0]["text"] = document["title"] + "\n" + changed["blocks"][0]["text"]
    current = request(base, "PATCH", f"/documents/{document['id']}", json={"expected_version": document["current_version"], "content": changed})
    branch = request(base, "POST", f"/workspaces/{workspace_id}/contexts", 201, json={"question": "继续分析这两项要求之间的联系。", "document_ids": [run["document_id"]]})
    inherited = [source for source in branch["sources"] if source["document_id"] == document["id"]]
    assert [source["content"] for source in inherited] == QUOTES
    assert all(source["version"] == 1 and source["anchor_id"] for source in inherited)
    merge = request(base, "POST", f"/workspaces/{workspace_id}/contexts", 201, json={"question": "合并这些讨论材料，列出仍待核查的实现问题。", "inherit_context_ids": [context["id"], branch["id"]]})
    assert len([source for source in merge["sources"] if source["document_id"] == document["id"]]) == 2
    assert request(base, "GET", f"/contexts/{branch['id']}")["messages"] == branch["messages"]
    record.update(workspace_id=workspace_id, document_id=document["id"], current_version=current["current_version"], anchor_ids=[item["id"] for item in anchors], context_id=context["id"], discussion_run=run, branch_context_id=branch["id"], contexts="passed")
    save(record)


def proposals(args, record):
    base = args.base
    workspace_id = record["workspace_id"]
    canvas = request(base, "POST", f"/workspaces/{workspace_id}/canvases", 201, json={"name": "画布协作要求与证据"})
    objects = [{"id": record["document_id"], "document_id": record["document_id"], "x": 0, "y": 0, "width": 480, "height": 300}]
    canvas = request(base, "PUT", f"/canvases/{canvas['id']}", json={"expected_revision": canvas["revision"], "name": canvas["name"], "objects": objects})
    selected = [{"id": f"excerpt-{index}", "kind": "fragment", "bounds": {"x": index * 500, "y": 0, "width": 480, "height": 200}, "document_id": record["document_id"], "version": 1, "anchor_id": anchor_id, "read_scope": "excerpt"} for index, anchor_id in enumerate(record["anchor_ids"])]
    selected.append({"id": "research-idea", "kind": "idea", "bounds": {"x": 1000, "y": 0, "width": 320, "height": 200}, "text": "自由联想可以先只是一条线；正式化时才出现结构化的学科桥。", "read_scope": "inline"})
    payload = {"question": "在所选材料下方创建两个 note 框，分别讨论支持证据和可能的反例。用一条候选研究关系连接这两个新框，标明成立条件。依据产品材料分析软件行为，保留来源编号。", "mode": "canvas", "canvas_id": canvas["id"], "expected_revision": canvas["revision"], "objects": selected, "write_scope": {"allow_create": True, "bounds": {"x": 0, "y": 250, "width": 1800, "height": 1500}}}
    context = request(base, "POST", f"/workspaces/{workspace_id}/scene-contexts", 201, json=payload)
    assert [source["content"] for source in context["sources"]] == QUOTES
    assert context["scenes"][-1]["objects"][-1]["text"] == selected[-1]["text"]
    run = generate(base, workspace_id, context["id"])
    proposal = request(base, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
    assert sum(action["type"] == "create_document" for action in proposal["actions"]) == 2, proposal
    assert any(action["type"] == "create_relation" for action in proposal["actions"]), proposal
    # 保存期间的布局变化使旧预览过期，确认现有提案后可继续应用。
    moved = request(base, "PUT", f"/canvases/{canvas['id']}", json={"expected_revision": canvas["revision"], "name": canvas["name"], "objects": objects})
    request(base, "POST", f"/canvas-proposals/{proposal['id']}/apply", 409, json={"expected_revision": proposal["revision"], "expected_canvas_revision": canvas["revision"]})
    proposal = request(base, "PATCH", f"/canvas-proposals/{proposal['id']}", json={"expected_revision": proposal["revision"], "expected_canvas_revision": moved["revision"], "actions": proposal["actions"]})
    apply_input = {"expected_revision": proposal["revision"], "expected_canvas_revision": moved["revision"]}
    applied = request(base, "POST", f"/canvas-proposals/{proposal['id']}/apply", json=apply_input)
    repeated = request(base, "POST", f"/canvas-proposals/{proposal['id']}/apply", json=apply_input)
    assert repeated["transaction_id"] == applied["transaction_id"] and repeated["canvas"]["revision"] == applied["canvas"]["revision"]
    assert len(applied["documents"]) == 2 and len(applied["relations"]) >= 1
    relation = applied["relations"][0]
    assert relation["claim"]["status"] == "candidate"
    assert request(base, "GET", f"/canvases/{canvas['id']}")["objects"] == applied["canvas"]["objects"]
    reverted = request(base, "POST", f"/canvas-proposals/{proposal['id']}/revert", json={"expected_revision": applied["proposal"]["revision"], "expected_canvas_revision": applied["canvas"]["revision"]})
    assert reverted["canvas"]["objects"] == objects
    summary = request(base, "GET", f"/workspaces/{workspace_id}")
    assert all(document["id"] not in reverted["removed_document_ids"] for document in summary["documents"])
    assert all(item["id"] != relation["id"] for item in summary["relations"])
    record.update(canvas_id=canvas["id"], canvas_run=run, canvas_proposal_id=proposal["id"], canvas_transaction_id=applied["transaction_id"], proposals="passed")
    save(record)


def reviews(args, record):
    base = args.base
    workspace_id = record["workspace_id"]
    relation = request(base, "POST", f"/workspaces/{workspace_id}/relations", 201, json={"source_id": record["document_id"], "target_id": record["discussion_run"]["document_id"], "label": "画布删除行为与研究结论的分离", "claim": {"status": "candidate", "conditions": "删除操作针对视觉实例", "counterexamples": "视觉删除触发全局研究关系删除", "sources": [], "mapping": "视觉实例对应展示，研究关系对应待研究的联系", "preserved_operations": ["刷新后保留研究关系"]}})
    document = request(base, "GET", f"/documents/{record['document_id']}")
    source = anchor(base, workspace_id, document, QUOTES[0])
    review = {"expected_claim_revision": relation["claim"]["revision"], "status": "supported", "evidence": [{"document_id": document["id"], "version": document["current_version"], "anchor_id": source["id"], "role": "support", "note": QUOTES[0]}], "reason": "用户提供的产品共识明确要求删除视觉线后保留研究结论。", "confirmed": True}
    request(base, "POST", f"/relations/{relation['id']}/review", 422, json={**review, "confirmed": False})
    approved = request(base, "POST", f"/relations/{relation['id']}/review", json=review)
    assert approved["claim"]["status"] == "supported" and not approved["claim"]["review_required"]
    request(base, "POST", f"/relations/{relation['id']}/review", 409, json=review)
    content = json.loads(json.dumps(document["content"]))
    content["blocks"][0]["text"] = QUOTES[0] + "\n" + content["blocks"][0]["text"]
    request(base, "PATCH", f"/documents/{document['id']}", json={"expected_version": document["current_version"], "content": content})
    stale = request(base, "GET", f"/relations/{relation['id']}")
    assert stale["claim"]["review_required"] and stale["claim"]["reviews"] == approved["claim"]["reviews"]
    record.update(review_relation_id=relation["id"], reviews="passed")
    save(record)


def projection(args, record):
    base = args.base
    workspace_id = record["workspace_id"]
    canvas = request(base, "GET", f"/canvases/{record['canvas_id']}")
    document = request(base, "GET", f"/documents/{record['document_id']}")
    instance = canvas["objects"][0]
    projected = {"workspace_id": workspace_id, "canvas_id": canvas["id"], "canvas_revision": canvas["revision"], "entry": "selection", "viewport": {"zoom": 1, "center_x": 0, "center_y": 0}, "objects": [{"instance_id": instance["id"], "kind": "document", "flavour": "affine:embed-synced-doc", "ref": {"type": "document", "document_id": document["id"], "version": document["current_version"], "kind": "pdf"}, "title": document["title"], "text": "", "formulas": [], "layout": {**{key: instance[key] for key in ["x", "y", "width", "height"]}, "rotate": 0}, "parent_ids": [], "child_ids": [], "via": None}]}
    materials = [{"key": f"locate:{instance['id']}", "group": "locate", "objectId": instance["id"], "include": True, "legacy": None}, {"key": f"doc:{document['id']}", "group": "body", "objectId": instance["id"], "include": False, "legacy": {"document_id": document["id"]}}, {"key": f"anchor:{record['anchor_ids'][0]}", "group": "body", "objectId": instance["id"], "include": True, "legacy": {"anchor_id": record["anchor_ids"][0]}}]
    result = request(base, "POST", f"/workspaces/{workspace_id}/scene-contexts", 201, json={"question": "查看该选段的研究关系要求。", "projection": projected, "materials": materials})
    assert len(result["sources"]) == 1 and result["sources"][0]["content"] == QUOTES[0]
    assert result["sources"][0]["anchor_id"] == record["anchor_ids"][0]
    assert result["scenes"][-1]["objects"][0]["text"] == ""
    materials[2]["include"] = False
    locating = request(base, "POST", f"/workspaces/{workspace_id}/scene-contexts", 201, json={"question": "描述所选卡片的位置。", "projection": projected, "materials": materials})
    assert locating["sources"] == [] and locating["scenes"][-1]["objects"][0]["read_scope"] == "reference"
    record["projection"] = "passed"
    save(record)


def archive(args, record):
    assert args.restore_base, "归档恢复需要独立服务地址"
    workspace_id = record["workspace_id"]
    exported = request(args.base, "GET", f"/workspaces/{workspace_id}/export")
    assert exported["format_version"] == 2 and len(exported["canvas_proposals"]) == 1
    restored = request(args.restore_base, "POST", "/workspaces/import", 201, json=exported)
    assert restored["id"] == workspace_id
    assert request(args.restore_base, "GET", f"/workspaces/{workspace_id}/export") == exported
    record["archive"] = "passed"
    save(record)


def undo_evidence(args, record):
    base = args.base
    workspace_id = record["workspace_id"]
    canvas = request(base, "GET", f"/canvases/{record['canvas_id']}")
    context = request(base, "POST", f"/workspaces/{workspace_id}/scene-contexts", 201, json={"question": "创建一个 note 框，摘录视觉连线与研究关系分离的支持证据，保留来源编号。", "mode": "canvas", "canvas_id": canvas["id"], "expected_revision": canvas["revision"], "objects": [{"id": canvas["objects"][0]["id"], "kind": "fragment", "bounds": {"x": 0, "y": 0, "width": 480, "height": 300}, "document_id": record["document_id"], "version": 1, "anchor_id": record["anchor_ids"][0], "read_scope": "excerpt"}], "write_scope": {"allow_create": True}})
    run = generate(base, workspace_id, context["id"])
    record["undo_evidence_run"] = run
    save(record)
    proposal = request(base, "GET", f"/canvas-proposals/{run['canvas_proposal_id']}")
    applied = request(base, "POST", f"/canvas-proposals/{proposal['id']}/apply", json={"expected_revision": proposal["revision"], "expected_canvas_revision": canvas["revision"]})
    evidence_document = applied["documents"][0]
    relation = request(base, "POST", f"/workspaces/{workspace_id}/relations", 201, json={"source_id": record["document_id"], "target_id": record["discussion_run"]["document_id"], "label": "视觉线删除的证据核查", "claim": {"status": "candidate", "conditions": "删除作用于视觉实例", "counterexamples": "删除视觉线时丢失研究关系", "sources": []}})
    request(base, "POST", f"/relations/{relation['id']}/review", json={"expected_claim_revision": relation["claim"]["revision"], "status": "supported", "evidence": [{"document_id": evidence_document["id"], "version": evidence_document["current_version"], "role": "support", "note": "生成的摘录保留产品原文依据"}], "reason": "根据产品材料核查删除行为。", "confirmed": True})
    revert_input = {"expected_revision": applied["proposal"]["revision"], "expected_canvas_revision": applied["canvas"]["revision"]}
    conflict = request(base, "POST", f"/canvas-proposals/{proposal['id']}/revert", 409, json=revert_input)
    assert conflict["error"]["code"] == "dependent_changes"
    request(base, "DELETE", f"/relations/{relation['id']}", 204)
    reverted = request(base, "POST", f"/canvas-proposals/{proposal['id']}/revert", json=revert_input)
    assert evidence_document["id"] in reverted["removed_document_ids"]
    record["undo_evidence"] = "passed"
    save(record)


def archive_scope(args, record):
    assert args.restore_base, "归档验证需要独立服务地址"
    exported = request(args.base, "GET", f"/workspaces/{record['workspace_id']}/export")
    existing = request(args.restore_base, "POST", "/workspaces/import", 409, json=exported)
    assert existing["error"]["code"] == "workspace_exists"
    other = request(args.base, "POST", "/workspaces", 201, json={"name": "归档工作区归属验证"})
    foreign_canvas = request(args.base, "POST", f"/workspaces/{other['id']}/canvases", 201, json={"name": "独立画布"})
    exported["canvas_proposals"][0]["application"]["before_canvas"] = foreign_canvas
    invalid = request(args.restore_base, "POST", "/workspaces/import", 422, json=exported)
    assert "画布归属" in invalid["error"]["message"]
    record["archive_scope"] = "passed"
    save(record)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["contexts", "proposals", "reviews", "projection", "archive", "undo_evidence", "archive_scope"])
    parser.add_argument("--base", default="http://127.0.0.1:8789/api")
    parser.add_argument("--restore-base")
    parser.add_argument("--source", type=Path, default=ROOT / "docs" / "Research_Canvas_conversation_2026-10-25.pdf")
    args = parser.parse_args()
    record = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    if record.get(args.phase) == "passed":
        raise SystemExit(f"{args.phase} 已通过，复用现有结果。")
    {"contexts": contexts, "proposals": proposals, "reviews": reviews, "projection": projection, "archive": archive, "undo_evidence": undo_evidence, "archive_scope": archive_scope}[args.phase](args, record)
    print(f"{args.phase}: passed", flush=True)
