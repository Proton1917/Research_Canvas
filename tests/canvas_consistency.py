import argparse
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import subprocess
import time

import requests
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / '.runtime/canvas-consistency.json'
BASE = 'http://127.0.0.1:8791/api'
JS = (ROOT / 'tests/canvas_consistency_browser.js').read_text()


def request(method, path, expected=200, **kwargs):
    response = requests.request(method, BASE + path, timeout=60, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text[:1800])
    return response.json() if response.content else None


def save(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')


def run_model(record, context, label):
    run = request('POST', f"/workspaces/{record['workspace_id']}/runs", 202, json={'context_id': context['id']})
    record[label + '_run'] = run['id']
    save(record)
    print(f"{label}: {run['id']}", flush=True)
    deadline = time.monotonic() + 200
    while run['status'] in {'queued', 'running'} and time.monotonic() < deadline:
        time.sleep(0.5)
        run = request('GET', '/runs/' + run['id'])
    assert run['status'] == 'succeeded', run
    record[label + '_model'] = run['model_used']
    save(record)
    return run


def open_page(browser):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto('http://127.0.0.1:5173', wait_until='domcontentloaded')
    page.get_by_text('Research Canvas', exact=True).first.wait_for(timeout=60000)
    return page


def prepare(record):
    if not record.get('document_id'):
        workspace = request('POST', '/workspaces', 201, json={'name': '画布保存与上下文验证'})
        record['workspace_id'] = workspace['id']
        canvas = request('POST', f"/workspaces/{workspace['id']}/canvases", 201, json={'name': '保存一致性'})
        record['canvas_id'] = canvas['id']
        with (ROOT / 'docs/Research_Canvas_调整建议_2026-10-25.pdf').open('rb') as source:
            result = request('POST', f"/workspaces/{workspace['id']}/imports", 201, files={'file': ('调整建议.pdf', source, 'application/pdf')})
        document = result['document']
        record['document_id'] = document['id']
        record['quote'] = next(block['text'] for block in document['content']['blocks'] if '一次写入' in block['text'])
        save(record)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = open_page(browser)
        page.on('request', lambda request: (ROOT / '.runtime/canvas-save-request.json').write_text(request.post_data) if request.method == 'PUT' and '/canvases/' in request.url else None)
        record.update(page.evaluate(JS, {'op': 'prepare', 'record': record}))
        page.screenshot(path=str(ROOT / '.runtime/browser/consistency-initial.png'))
        browser.close()
    record['prepare'] = 'passed'
    save(record)


def scene_input(record, canvas, question, mode='canvas'):
    document = request('GET', '/documents/' + record['document_id'])
    blocks = json.loads(subprocess.check_output([str(ROOT / '.runtime/toolchain/node_modules/.bin/node'), str(ROOT / 'tests/canvas_snapshot.mjs')], input=json.dumps(canvas).encode(), cwd=ROOT))
    note_bounds = dict(zip(['x', 'y', 'width', 'height'], json.loads(blocks[record['note_id']]['prop:xywh'])))
    card = next(item for item in canvas['objects'] if item['id'] == record['card_id'])
    return {'question': question, 'mode': mode, 'canvas_id': canvas['id'], 'expected_revision': canvas['revision'], 'objects': [
        {'id': record['card_id'], 'kind': 'document', 'document_id': document['id'], 'version': document['current_version'], 'read_scope': 'full', 'bounds': {key: card[key] for key in ['x', 'y', 'width', 'height']}},
        {'id': record['note_id'], 'kind': 'idea', 'read_scope': 'inline', 'text': record['quote'], 'bounds': note_bounds},
    ], 'write_scope': {'allow_create': mode == 'canvas', 'object_ids': [record['note_id']] if mode == 'canvas' else []}}


def state(record):
    workspace = record['workspace_id']
    canvas = request('GET', '/canvases/' + record['canvas_id'])
    if record.get('applied'):
        record.setdefault('prior_attempts', []).append(record.pop('applied'))
        record.pop('state_proposal')
        save(record)
    if not record.get('state_proposal'):
        context = request('POST', f'/workspaces/{workspace}/scene-contexts', 201, json=scene_input(record, canvas, '根据产品材料创建两个 note 卡片，分别记录保存的一致性要求和失败后的恢复要求，并用一条候选联系连接两个新卡片。关系仅填两端和 label 即可，高级字段省略。再将所选自由想法框下移 80 像素。'))
        run = run_model(record, context, 'state')
        proposal = request('GET', '/canvas-proposals/' + run['canvas_proposal_id'])
        assert sum(action['type'] == 'create_document' for action in proposal['actions']) == 2
        assert any(action['type'] == 'create_relation' for action in proposal['actions'])
        assert any(action['type'] == 'move_object' for action in proposal['actions'])
        record['state_proposal'] = proposal['id']
        save(record)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = open_page(browser)
        proposal = request('GET', '/canvas-proposals/' + record['state_proposal'])
        original = page.evaluate(JS, {'op': 'read', 'record': record})
        canvas = request('GET', '/canvases/' + record['canvas_id'])
        if proposal['canvas_revision'] != canvas['revision']:
            proposal = request('PATCH', '/canvas-proposals/' + proposal['id'], json={'expected_revision': proposal['revision'], 'expected_canvas_revision': canvas['revision'], 'actions': proposal['actions']})
        record['baseline_canvas'] = canvas
        save(record)
        payload = {'expected_revision': proposal['revision'], 'expected_canvas_revision': canvas['revision']}
        if record.get('concurrent_save') != 'passed':
            update = {'expected_revision': canvas['revision'], 'name': canvas['name'], 'objects': canvas['objects'], 'editor_state': canvas['editor_state']}
            with ThreadPoolExecutor(2) as clients:
                results = list(clients.map(lambda _: requests.put(BASE + '/canvases/' + canvas['id'], json=update, timeout=30), range(2)))
            assert sorted(response.status_code for response in results) == [200, 409]
            record['save_http_ms'] = [response.elapsed.total_seconds() * 1000 for response in results]
            record['concurrent_save'] = 'passed'
            save(record)
        canvas = request('GET', '/canvases/' + canvas['id'])
        proposal = request('PATCH', '/canvas-proposals/' + proposal['id'], json={'expected_revision': proposal['revision'], 'expected_canvas_revision': canvas['revision'], 'actions': proposal['actions']})
        payload.update(expected_revision=proposal['revision'], expected_canvas_revision=canvas['revision'])
        connection = http.client.HTTPConnection('127.0.0.1', 8791, timeout=30)
        started = time.perf_counter()
        connection.request('POST', f"/api/canvas-proposals/{proposal['id']}/apply", body=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        response = connection.getresponse()
        assert response.status == 200, response.read().decode()
        connection.close()
        record['apply_http_ms'] = (time.perf_counter() - started) * 1000
        current = request('GET', '/canvas-proposals/' + proposal['id'])
        assert current['status'] == 'applied', current
        applied = request('POST', f"/canvas-proposals/{proposal['id']}/apply", json=payload)
        assert applied['transaction_id'] == current['transaction_id']
        assert request('GET', '/canvases/' + canvas['id']) == applied['canvas']
        record['response_loss_retry'] = 'passed'
        record['applied'] = applied
        save(record)
        page.reload(wait_until='domcontentloaded')
        visible = page.evaluate(JS, {'op': 'read', 'record': record})
        assert len(visible['objects']) == len(applied['canvas']['objects'])
        for action in proposal['actions']:
            if action['type'] == 'create_document':
                object_id = proposal['id_map'][action['key'] + ':object']
                assert visible['blocks'][object_id]['prop:pageId'] == proposal['id_map'][action['key']]
                assert json.loads(visible['blocks'][object_id]['prop:xywh']) == [action['bounds'][name] for name in ['x', 'y', 'width', 'height']]
        note = record['note_id']
        assert visible['blocks'][note]['sys:children'] == original['blocks'][note]['sys:children']
        for child in original['blocks'][note]['sys:children']:
            assert visible['blocks'][child] == original['blocks'][child]
        relation = applied['relations'][0]
        view = applied['canvas']['editor_state']['link_views'][relation['id'] + ':view']
        assert view['relation_id'] == relation['id']
        page.screenshot(path=str(ROOT / '.runtime/browser/consistency-applied.png'))
        latest = request('GET', '/canvases/' + canvas['id'])
        assert latest['revision'] == applied['canvas']['revision'], latest['revision']
        reverted = request('POST', f"/canvas-proposals/{proposal['id']}/revert", json={'expected_revision': applied['proposal']['revision'], 'expected_canvas_revision': applied['canvas']['revision']})
        assert reverted['canvas']['objects'] == canvas['objects']
        assert reverted['canvas']['editor_state'] == canvas['editor_state']
        browser.close()
    record['state'] = 'passed'
    save(record)


def freshness(record):
    workspace = record['workspace_id']
    document = request('GET', '/documents/' + record['document_id'])
    context = request('POST', f'/workspaces/{workspace}/contexts', 201, json={'question': '说明原位协作所需的保存条件。', 'document_ids': [document['id']]})
    updated = request('PATCH', '/documents/' + document['id'], json={'expected_version': document['current_version'], 'title': '产品定位与工程调整建议'})
    report = request('GET', f"/contexts/{context['id']}/freshness")
    assert not report['fresh'] and report['changes'][0]['current_version'] == updated['current_version']
    before = request('GET', f'/workspaces/{workspace}/runs')
    error = request('POST', f'/workspaces/{workspace}/runs', 409, json={'context_id': context['id']})
    assert error['error']['code'] == 'stale_context'
    assert request('GET', f'/workspaces/{workspace}/runs') == before
    historical = request('POST', f'/workspaces/{workspace}/contexts', 201, json={'question': '继续讨论引用时的材料。', 'inherit_context_ids': [context['id']]})
    assert historical['sources'] == context['sources']
    assert request('GET', f"/contexts/{historical['id']}/freshness")['fresh']
    fresh = request('POST', f'/workspaces/{workspace}/contexts', 201, json={'question': '说明原位协作所需的保存条件。', 'document_ids': [document['id']]})
    assert fresh['sources'][0]['version'] == updated['current_version']
    assert request('GET', '/contexts/' + context['id']) == context
    canvas = request('GET', '/canvases/' + record['canvas_id'])
    answering = request('POST', f'/workspaces/{workspace}/scene-contexts', 201, json=scene_input(record, canvas, '只用一句话解释产品的一次写入应保证什么。只提交 answer，不提出任何画布操作。'))
    run = run_model(record, answering, 'answer_only')
    assert run['document_id'] and run['canvas_proposal_id'] is None
    assert request('GET', '/documents/' + run['document_id'])['kind'] == 'discussion'
    record['freshness'] = 'passed'
    save(record)


def vision(record):
    workspace = record['workspace_id']
    with (ROOT / '.runtime/consistency-source.png').open('rb') as source:
        imported = request('POST', f'/workspaces/{workspace}/imports', 201, files={'file': ('调整建议第4页.png', source, 'image/png')})
    canvas = request('GET', '/canvases/' + record['canvas_id'])
    payload = scene_input(record, canvas, '读取选中图片的表格，逐字列出“关键验收用例”表的前四行动作和预期结果。', 'discussion')
    payload['objects'] = [{'id': imported['document']['id'], 'kind': 'image', 'read_scope': 'reference', 'document_id': imported['document']['id'], 'version': 1}]
    payload['visuals'] = [{'asset_id': imported['asset']['id'], 'object_ids': [imported['document']['id']]}]
    context = request('POST', f'/workspaces/{workspace}/scene-contexts', 201, json=payload)
    assert context['sources'] == [] and len(context['visuals']) == 1
    run = run_model(record, context, 'vision')
    assert '重复点击确认' in run['answer'] and '预览后修改原文' in run['answer'], run['answer']
    record['vision_answer'] = run['answer']
    record['vision'] = 'passed'
    save(record)


def archive(record):
    exported = request('GET', f"/workspaces/{record['workspace_id']}/export")
    response = requests.post('http://127.0.0.1:8792/api/workspaces/import', json=exported, timeout=60)
    assert response.status_code == 201, response.text
    restored = requests.get(f"http://127.0.0.1:8792/api/workspaces/{record['workspace_id']}/export", timeout=60).json()
    assert restored == exported
    record['archive'] = 'passed'
    save(record)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'state', 'freshness', 'vision', 'archive'])
    args = parser.parse_args()
    record = json.loads(RECORD.read_text()) if RECORD.exists() else {}
    if record.get(args.phase) == 'passed':
        raise SystemExit(args.phase + ' 已通过，复用结果。')
    globals()[args.phase](record)
    print(args.phase + ': passed', flush=True)
