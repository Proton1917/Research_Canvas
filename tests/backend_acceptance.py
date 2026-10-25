import argparse
import base64
import io
import json
from pathlib import Path
import time
import zipfile

import requests


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / ".runtime" / "backend-acceptance.json"
SOURCE = ROOT / "docs" / "research_canvas_open_source_review_2026-10-24 (1)(1).pdf"
BASE = "http://127.0.0.1:8787/api"
TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


def request(method, path, *, expected=200, base=BASE, **kwargs):
    response = requests.request(method, base + path, timeout=210, **kwargs)
    if response.status_code != expected:
        raise AssertionError(f"{method} {path}: {response.status_code} {response.text[:1200]}")
    return response


def save(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")


def core(record):
    health = request("GET", "/health").json()
    assert health["database"] == "ready"
    workspace = request("POST", "/workspaces", expected=201, json={"name": "Research Canvas 开源项目调研"}).json()
    workspace_id = workspace["id"]
    with SOURCE.open("rb") as stream:
        imported = request("POST", f"/workspaces/{workspace_id}/imports", expected=201, files={"file": (SOURCE.name, stream, "application/pdf")}).json()
    document = imported["document"]
    assert len(document["content"]["blocks"]) == 4
    assert [block["page"] for block in document["content"]["blocks"]] == [1, 2, 3, 4]
    quote = "Research Canvas 应当以无限画布作为工作空间。"
    block = next(block for block in document["content"]["blocks"] if quote in block["text"])
    start = len(block["text"].split(quote, 1)[0].encode("utf-16-le")) // 2
    anchor = request("POST", f"/workspaces/{workspace_id}/anchors", expected=201, json={"document_id": document["id"], "version": 1, "block_id": block["id"], "quote": quote, "start_utf16": start}).json()
    assert request("GET", f"/anchors/{anchor['id']}/resolve").json()["status"] == "exact"

    notes = []
    for title in ["内容与位置分离", "修订后仍可追踪批注"]:
        page = document["content"]["blocks"][3]
        line = next(line.strip() for line in page["text"].splitlines() if title in line)
        note = request("POST", f"/workspaces/{workspace_id}/documents", expected=201, json={"title": title, "kind": "note", "content": {"blocks": [{"id": title, "text": line, "page": 4}]}, "metadata": {"source_document_id": document["id"], "source_version": 1}}).json()
        notes.append(note)
    first = request("POST", f"/workspaces/{workspace_id}/relations", expected=201, json={"source_id": document["id"], "target_id": notes[0]["id"], "kind": "reference", "include_in_context": True}).json()
    second = request("POST", f"/workspaces/{workspace_id}/relations", expected=201, json={"source_id": notes[0]["id"], "target_id": notes[1]["id"], "kind": "association", "include_in_context": True}).json()
    free_relation = request("POST", f"/workspaces/{workspace_id}/relations", expected=201, json={"source_id": notes[1]["id"], "target_id": document["id"], "label": "研究关联"}).json()
    request("PATCH", f"/relations/{free_relation['id']}", expected=422, json={"include_in_context": True})
    preview = request("POST", f"/workspaces/{workspace_id}/contexts", expected=201, json={"document_ids": [notes[0]["id"], notes[1]["id"]], "anchor_ids": [anchor["id"]], "question": "根据来源资料，用两句话说明内容与位置分离如何支持修订后的批注追踪，并标出来源编号。", "mode": "relation"}).json()
    assert preview["ordered_document_ids"] == [document["id"], notes[0]["id"], notes[1]["id"]]
    assert request("GET", f"/contexts/{preview['id']}").json()["messages"] == preview["messages"]

    canvas = request("POST", f"/workspaces/{workspace_id}/canvases", expected=201, json={"name": "研究对象与讨论关系"}).json()
    objects = [{"id": item["id"], "document_id": item["id"], "x": index * 360, "y": 80, "width": 320, "height": 240} for index, item in enumerate([document, *notes])]
    canvas = request("PUT", f"/canvases/{canvas['id']}", json={"expected_revision": 1, "name": canvas["name"], "objects": objects, "editor_state": None}).json()
    assert canvas["revision"] == 2
    duplicate_view = request("POST", f"/workspaces/{workspace_id}/canvases", expected=201, json={"name": "文稿来源"}).json()
    request("PUT", f"/canvases/{duplicate_view['id']}", json={"expected_revision": 1, "name": duplicate_view["name"], "objects": objects[:1]})

    original_content = document["content"]
    shifted = json.loads(json.dumps(original_content))
    selected = next(item for item in shifted["blocks"] if item["id"] == block["id"])
    selected["text"] = document["title"] + "\n\n" + selected["text"]
    edited = request("PATCH", f"/documents/{document['id']}", json={"expected_version": 1, "content": shifted}).json()
    assert request("GET", f"/anchors/{anchor['id']}/resolve").json()["status"] == "relocated"
    selected["text"] = selected["text"].replace(quote, "面向科研人员的无限画布、长文批注、AI 共创与跨学科关系探索", 1)
    changed = request("PATCH", f"/documents/{document['id']}", json={"expected_version": edited["current_version"], "content": shifted}).json()
    assert request("GET", f"/anchors/{anchor['id']}/resolve").json()["status"] == "changed"
    restored = request("POST", f"/documents/{document['id']}/restore", json={"expected_version": changed["current_version"], "version": 1}).json()
    assert restored["content"] == original_content
    request("PATCH", f"/documents/{document['id']}", expected=409, json={"expected_version": 1, "title": document["title"]})
    assert len(request("GET", f"/documents/{document['id']}/versions").json()) == 4
    assert any(item["document_id"] == document["id"] for item in request("GET", f"/workspaces/{workspace_id}/search", params={"q": "BlockSuite"}).json())
    request("POST", "/workspaces", expected=403, headers={"Origin": "https://example.com"}, json={"name": workspace["name"]})
    models = request("GET", "/models").json()
    assert models["models"] and models["default_model"]
    record.update({"workspace_id": workspace_id, "document_id": document["id"], "anchor_id": anchor["id"], "preview_id": preview["id"], "note_ids": [note["id"] for note in notes], "relation_ids": [first["id"], second["id"], free_relation["id"]], "canvas_id": canvas["id"], "asset_id": imported["asset"]["id"], "default_model": models["default_model"], "core": "passed"})
    save(record)
    print(json.dumps({"core": "passed", "workspace_id": workspace_id, "model_count": len(models["models"])}, ensure_ascii=False), flush=True)


def completed_run(run_id):
    started = time.monotonic()
    with requests.get(BASE + f"/runs/{run_id}/events", stream=True, timeout=210) as response:
        response.raise_for_status()
        assert response.headers["Content-Type"].startswith("text/event-stream")
        chunks = []
        first_chunk_seconds = None
        for chunk in response.iter_content(chunk_size=None):
            if first_chunk_seconds is None:
                first_chunk_seconds = time.monotonic() - started
            chunks.append(chunk)
    run = request("GET", f"/runs/{run_id}").json()
    (ROOT / ".runtime" / "logs" / f"run-{run_id}.sse").write_bytes(b"".join(chunks))
    assert run["status"] == "succeeded", run
    assert run["answer"].strip() and run["model_used"]
    return run, {"first_chunk_seconds": first_chunk_seconds, "chunks": len(chunks), "elapsed_seconds": time.monotonic() - started}


def models(record):
    workspace_id = record["workspace_id"]
    if "discussion_run" not in record:
        run = request("POST", f"/workspaces/{workspace_id}/runs", expected=202, json={"context_id": record["preview_id"], "max_output_tokens": 800}).json()
        run, streaming = completed_run(run["id"])
        assert run["document_id"]
        generated = request("GET", f"/documents/{run['document_id']}").json()
        assert generated["kind"] == "discussion"
        assert generated["metadata"]["context_id"] == record["preview_id"]
        record.update({"discussion_run": run, "streaming": streaming})
        save(record)
        print(json.dumps({"discussion": "passed", "model_used": run["model_used"], "streaming": streaming}, ensure_ascii=False), flush=True)

    preview = request("POST", f"/workspaces/{workspace_id}/contexts", expected=201, json={"mode": "rewrite", "question": "将选段改写为直接说明产品设计的陈述句，去掉应当一词，保留无限画布和工作空间的含义。", "anchor_ids": [record["anchor_id"]]}).json()
    rewrite = request("POST", f"/workspaces/{workspace_id}/runs", expected=202, json={"context_id": preview["id"], "max_output_tokens": 4096}).json()
    rewrite, _ = completed_run(rewrite["id"])
    proposal = request("GET", f"/proposals/{rewrite['proposal_id']}").json()
    before = request("GET", f"/documents/{record['document_id']}").json()
    applied = request("POST", f"/proposals/{proposal['id']}/apply", json={"expected_version": before["current_version"]}).json()
    assert applied["proposal"]["status"] == "applied"
    assert proposal["replacement"] in "\n".join(block["text"] for block in applied["document"]["content"]["blocks"])
    reverted = request("POST", f"/proposals/{proposal['id']}/revert", json={"expected_version": applied["document"]["current_version"]}).json()
    assert reverted["document"]["content"] == before["content"]
    assert reverted["proposal"]["status"] == "reverted"
    record.update({"rewrite_run": rewrite, "proposal_id": proposal["id"], "models": "passed"})
    save(record)
    print(json.dumps({"rewrite": "passed", "model_used": rewrite["model_used"], "proposal_id": proposal["id"]}, ensure_ascii=False), flush=True)


def cancellation(record):
    run = request("POST", f"/workspaces/{record['workspace_id']}/runs", expected=202, json={"context_id": record["preview_id"], "max_output_tokens": 800}).json()
    request("POST", f"/runs/{run['id']}/cancel")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = request("GET", f"/runs/{run['id']}").json()
        if result["status"] in TERMINAL:
            break
        time.sleep(0.1)
    assert result["status"] == "cancelled", result
    record["cancellation"] = "passed"
    record["cancelled_run_id"] = run["id"]
    save(record)
    print("cancellation: passed", flush=True)


def export(record):
    workspace_id = record["workspace_id"]
    archive = request("GET", f"/workspaces/{workspace_id}/export").json()
    asset = next(asset for asset in archive["assets"] if asset["id"] == record["asset_id"])
    assert base64.b64decode(asset["data_base64"]) == SOURCE.read_bytes()
    archive_bytes = request("GET", f"/workspaces/{workspace_id}/export.zip").content
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as package:
        saved = json.loads(package.read("workspace.json"))
        assert saved == archive
        assert package.read("relations.svg").startswith(b"<svg")
        assert f"documents/{record['document_id']}.md" in package.namelist()
    (ROOT / ".runtime" / "research-canvas-export.zip").write_bytes(archive_bytes)
    request("POST", "/workspaces/import", expected=409, json=archive)
    restored = request("POST", "/workspaces/import", expected=201, base="http://127.0.0.1:8788/api", json=archive).json()
    assert restored["id"] == workspace_id
    readback = request("GET", f"/workspaces/{workspace_id}/export", base="http://127.0.0.1:8788/api").json()
    assert readback == archive
    record["export"] = "passed"
    save(record)
    print(json.dumps({"export": "passed", "documents": len(archive["documents"]), "versions": len(archive["versions"]), "zip_bytes": len(archive_bytes)}, ensure_ascii=False), flush=True)


def router(record):
    workspace_id = record["workspace_id"]
    context = request("POST", f"/workspaces/{workspace_id}/contexts", expected=201, json={"question": "请用一句话复述选段，保留其含义。", "anchor_ids": [record["anchor_id"]]}).json()
    request("POST", f"/workspaces/{workspace_id}/runs", expected=422, json={"context_id": context["id"], "model": "openrouter/auto"})
    run = request("POST", f"/workspaces/{workspace_id}/runs", expected=202, json={"context_id": context["id"]}).json()
    assert run["model"] == "cc/gemini-3.8-flash-high"
    run, streaming = completed_run(run["id"])
    assert "gemini-3.8-flash" in run["model_used"].lower(), run
    record["router"] = "passed"
    record["router_run"] = run
    record["router_streaming"] = streaming
    save(record)
    print(json.dumps({"router": "passed", "model_used": run["model_used"], "usage": run["usage"], "streaming": streaming}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["core", "models", "cancellation", "export", "router"])
    phase = parser.parse_args().phase
    record = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    if record.get(phase) == "passed":
        raise SystemExit(f"{phase} 已通过；相关条件未变化时复用既有结果。")
    {"core": core, "models": models, "cancellation": cancellation, "export": export, "router": router}[phase](record)
