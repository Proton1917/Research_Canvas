import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import time

import requests
import toml


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.runtime/issues'
RECORD = DATA / 'acceptance.json'
NODE = ROOT / '.runtime/toolchain/node_modules/.bin/node'
MODEL = 'cc/gemini-3.8-flash-high'


def save(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')


class Client:
    def __init__(self, port):
        self.base = f'http://127.0.0.1:{port}/api'

    def request(self, method, path, expected=200, **kwargs):
        response = requests.request(method, self.base + path, timeout=60, **kwargs)
        assert response.status_code == expected, (path, response.status_code, response.text[:1500])
        return response.json() if response.content else None

    def get(self, path):
        return self.request('GET', path)

    def post(self, path, body, expected=200):
        return self.request('POST', path, expected, json=body)

    def upload(self, workspace, path, name, media_type):
        with (DATA / name).open('rb') as stream:
            return self.request('POST', f'/workspaces/{workspace}/{path}', 201, files={'file': (name, stream, media_type)})


@contextmanager
def service(name='main', port=8791, provider=None):
    config = toml.load(ROOT / 'config/server.toml')
    config.update(port=port, database=str(DATA / f'{name}.sqlite3'), temporary_directory=str(DATA / 'extract'))
    config['allowed_origins'] = [f'http://127.0.0.1:{port}', 'http://127.0.0.1:5173']
    config['provider'].update(provider or {})
    path = DATA / f'{name}.toml'
    path.write_text(toml.dumps(config))
    with (DATA / f'{name}.log').open('a') as log:
        process = subprocess.Popen([str(ROOT / '.runtime/bin/research-canvas')], cwd=ROOT, env={**os.environ, 'RC_CONFIG': str(path)}, stdout=log, stderr=log)
        try:
            client = Client(port)
            for _ in range(100):
                assert process.poll() is None, f'服务退出：{name}.log'
                try:
                    response = requests.get(client.base + '/health', timeout=1)
                    if response.ok:
                        break
                except requests.ConnectionError:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError('服务启动超时')
            yield client
        finally:
            process.terminate()
            process.wait(timeout=20)


def finish(client, run):
    deadline = time.monotonic() + 200
    while run['status'] in {'queued', 'running'} and time.monotonic() < deadline:
        time.sleep(0.5)
        run = client.get('/runs/' + run['id'])
    assert run['status'] == 'succeeded', run
    print(f"运行成功 {run['id']} {run['model_used']}", flush=True)
    return run


def start(client, workspace, context):
    return client.post(f'/workspaces/{workspace}/runs', {'context_id': context['id'], 'model': MODEL}, 202)


def canvas_save(canvas):
    return {'expected_revision': canvas['revision'], 'name': canvas['name'], 'objects': canvas['objects'], 'editor_state': canvas['editor_state']}


def blocks(canvas):
    return json.loads(subprocess.check_output([str(NODE), str(ROOT / 'tests/canvas_snapshot.mjs')], input=json.dumps(canvas).encode(), cwd=ROOT))


def scene(client, record, question, mode='discussion', visuals=None):
    canvas = client.get('/canvases/' + record['canvas_id'])
    source = next(item for item in canvas['objects'] if item['id'] == record['card_id'])
    document = client.get('/documents/' + source['document_id'])
    return client.post(f"/workspaces/{record['workspace_id']}/scene-contexts", {
        'question': question, 'mode': mode, 'canvas_id': canvas['id'], 'expected_revision': canvas['revision'],
        'objects': [{'id': source['id'], 'kind': 'document', 'document_id': document['id'], 'version': document['current_version'],
                     'read_scope': 'reference' if visuals else 'full', 'bounds': {key: source[key] for key in ['x', 'y', 'width', 'height']}}],
        'visuals': visuals or [],
        'write_scope': {'allow_create': mode == 'canvas', 'object_ids': [], 'bounds': {'x': 1100, 'y': 0, 'width': 800, 'height': 600}},
    }, 201)


def prepare(client, record):
    subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-scale-to', '1400', '-png', str(ROOT / 'docs/Research_Canvas_Issues_2026-10-26.pdf'), str(DATA / 'source')], check=True)
    workspace = client.post('/workspaces', {'name': '异步归位与截图验收'}, 201)
    workspace = workspace['id']
    with (ROOT / 'docs/Research_Canvas_Issues_2026-10-26.pdf').open('rb') as stream:
        imported = client.request('POST', f'/workspaces/{workspace}/imports', 201, files={'file': ('问题清单.pdf', stream, 'application/pdf')})
    document = imported['document']
    canvas = client.post(f'/workspaces/{workspace}/canvases', {'name': '原始提问画布'}, 201)
    other = client.post(f'/workspaces/{workspace}/canvases', {'name': '切换后的画布'}, 201)
    card_id = 'issues-source'
    canvas['objects'] = [{'id': card_id, 'document_id': document['id'], 'x': 0, 'y': 0, 'width': 500, 'height': 360}]
    canvas = client.request('PUT', '/canvases/' + canvas['id'], json=canvas_save(canvas))
    record.update(workspace_id=workspace, document_id=document['id'], canvas_id=canvas['id'], other_canvas_id=other['id'], card_id=card_id)
    record['prepare'] = 'passed'
    save(record)


def placement(client, record):
    workspace = record['workspace_id']
    context = scene(client, record, '根据材料概括异步运行的原位归属问题及其验收要求，使用三句话。')
    assert context['origin']['canvas_id'] == record['canvas_id']
    run = start(client, workspace, context)
    record['origin_run'] = run['id']
    save(record)
    assert run['origin'] == context['origin']
    canvas = client.get('/canvases/' + record['canvas_id'])
    canvas['name'] = '原始提问画布：运行期间已编辑'
    current = client.request('PUT', '/canvases/' + canvas['id'], json=canvas_save(canvas))
    other = client.get('/canvases/' + record['other_canvas_id'])
    run = finish(client, run)
    rejected = client.post(f"/runs/{run['id']}/place", {'expected_canvas_revision': canvas['revision']}, 409)
    assert rejected['error']['code'] == 'version_conflict'
    assert client.get('/runs/' + run['id'])['placement'] is None
    relations = client.get('/workspaces/' + workspace)['relations']
    with ThreadPoolExecutor(2) as pool:
        placed = list(pool.map(lambda _: client.post(f"/runs/{run['id']}/place", {'expected_canvas_revision': current['revision']}), range(2)))
    assert placed[0] == placed[1]
    placed = placed[0]
    assert placed['canvas']['revision'] == current['revision'] + 1
    assert placed['run']['origin'] == context['origin']
    assert client.get('/canvases/' + other['id']) == other
    assert client.get('/workspaces/' + workspace)['relations'] == relations
    raw = blocks(placed['canvas'])
    target = placed['run']['placement']['object_id']
    assert raw[target]['prop:pageId'] == run['document_id']
    assert json.loads(raw[target]['prop:xywh']) == [1100, 0, 800, 600]
    views = placed['canvas']['editor_state']['link_views']
    assert len(views) == 1
    assert all(view['source_instance'] == record['card_id'] and view['target_instance'] == target and view['relation_id'] is None for view in views.values())
    record.update(placement='passed', origin_context=context['id'], placed_revision=placed['canvas']['revision'])
    save(record)


def assets(client, record):
    workspace = record['workspace_id']
    if not record.get('assets_upload'):
        count = len(client.get('/workspaces/' + workspace)['documents'])
        unused = client.upload(workspace, 'visual-assets', 'source.png', 'image/png')
        used = client.upload(workspace, 'visual-assets', 'source.png', 'image/png')
        assert len(client.get('/workspaces/' + workspace)['documents']) == count
        client.request('DELETE', f"/workspaces/{workspace}/visual-assets/{unused['id']}", 204)
        client.request('GET', '/assets/' + unused['id'], 404)
        context = scene(client, record, '读取图片中的优先级总览，列出 P0 两项和 P1-04 的事项名称。', visuals=[{'asset_id': used['id'], 'object_ids': [record['card_id']]}])
        assert context['sources'] == []
        denied = client.request('DELETE', f"/workspaces/{workspace}/visual-assets/{used['id']}", 409)
        assert denied['error']['code'] == 'asset_in_use'
        listing = client.get(f'/workspaces/{workspace}/visual-assets')
        assert listing[0]['references'][0]['id'] == context['id']
        record.update(assets_upload='passed', visual_context=context['id'], screenshot_asset=used['id'])
        save(record)
    if not record.get('visual_run'):
        run = start(client, workspace, client.get('/contexts/' + record['visual_context']))
        record['visual_run'] = run['id']
        save(record)
    run = finish(client, client.get('/runs/' + record['visual_run']))
    assert 'P0' in run['answer'] and 'P1-04' in run['answer'] and '截取选区图片' in run['answer'], run['answer']
    image = client.upload(workspace, 'imports', 'source.png', 'image/png')
    canvas = client.get('/canvases/' + record['canvas_id'])
    image_context = client.post(f'/workspaces/{workspace}/scene-contexts', {
        'question': '读取图片中 P0-01 的事项名称。', 'canvas_id': canvas['id'], 'expected_revision': canvas['revision'],
        'objects': [{'id': image['document']['id'], 'kind': 'image', 'document_id': image['document']['id'], 'version': 1, 'read_scope': 'reference'}],
        'visuals': [{'asset_id': image['asset']['id'], 'object_ids': [image['document']['id']]}],
    }, 201)
    assert image_context['sources'] == []
    image_run = finish(client, start(client, workspace, image_context))
    assert '画布' in image_run['answer'] and ('原位' in image_run['answer'] or '归位' in image_run['answer']), image_run['answer']
    record.update(assets='passed', image_context=image_context['id'], image_run=image_run['id'])
    save(record)


def proposals(client, record):
    workspace = record['workspace_id']
    context = scene(client, record, '根据问题清单，仅创建一个 note 卡片，总结异步归位要求。位置 x=1100 y=0，宽420高280。只提交这一项 create_document 操作。', 'canvas')
    run = finish(client, start(client, workspace, context))
    proposal = client.get('/canvas-proposals/' + run['canvas_proposal_id'])
    assert len(proposal['actions']) == 1 and proposal['actions'][0]['type'] == 'create_document'
    canvas = client.get('/canvases/' + record['canvas_id'])
    drafts = []
    for x in [100, 200]:
        edited = json.loads(subprocess.check_output([str(NODE), str(ROOT / 'tests/canvas_edit.mjs')], input=json.dumps({'canvas': canvas, 'object_id': record['card_id'], 'bounds': [x, 0, 500, 360]}).encode(), cwd=ROOT))
        drafts.append(canvas_save(edited))
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda draft: requests.put(client.base + '/canvases/' + canvas['id'], json=draft, timeout=30), drafts))
    assert sorted(response.status_code for response in responses) == [200, 409]
    client.post(f"/canvas-proposals/{proposal['id']}/apply", {'expected_revision': proposal['revision'], 'expected_canvas_revision': canvas['revision']}, 409)
    current = client.get('/canvases/' + canvas['id'])
    with ThreadPoolExecutor(2) as pool:
        edits = list(pool.map(lambda _: requests.patch(client.base + '/canvas-proposals/' + proposal['id'], json={'expected_revision': proposal['revision'], 'expected_canvas_revision': current['revision'], 'actions': proposal['actions']}, timeout=30), range(2)))
    assert sorted(response.status_code for response in edits) == [200, 409]
    proposal = next(response.json() for response in edits if response.status_code == 200)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: client.post(f"/canvas-proposals/{proposal['id']}/apply", {'expected_revision': proposal['revision'], 'expected_canvas_revision': current['revision']}), range(2)))
    assert results[0] == results[1]
    applied = results[0]
    document = applied['documents'][0]
    other = client.get('/canvases/' + record['other_canvas_id'])
    other['objects'] = [{'id': 'proposal-reference', 'document_id': document['id'], 'x': 0, 'y': 0, 'width': 420, 'height': 280}]
    client.request('PUT', '/canvases/' + other['id'], json=canvas_save(other))
    dependent = client.post(f"/canvas-proposals/{proposal['id']}/revert", {'expected_revision': applied['proposal']['revision'], 'expected_canvas_revision': applied['canvas']['revision']}, 409)
    assert dependent['error']['code'] == 'dependent_changes'
    assert client.get('/canvases/' + canvas['id']) == applied['canvas']
    assert client.get('/documents/' + document['id']) == document
    raw = blocks(applied['canvas'])
    new_card = applied['proposal']['id_map'][proposal['actions'][0]['key'] + ':object']
    assert raw[new_card]['prop:pageId'] == document['id']
    record.update(proposals='passed', proposal_id=proposal['id'])
    save(record)


def branches(client, record):
    workspace = record['workspace_id']
    document = client.get('/documents/' + record['document_id'])
    paragraph = document['content']['blocks'][1]
    anchor = client.post(f'/workspaces/{workspace}/anchors', {'document_id': document['id'], 'version': document['current_version'], 'block_id': paragraph['id'], 'quote': paragraph['text']}, 201)
    parent = client.post(f'/workspaces/{workspace}/contexts', {'question': '分析这段异步运行与原位协作要求。', 'anchor_ids': [anchor['id']]}, 201)
    contexts = [client.post(f'/workspaces/{workspace}/contexts', {'question': question, 'inherit_context_ids': [parent['id']]}, 201) for question in ['用一句话说明跨画布归位的验收结果。', '用一句话说明冻结期间修改选择的验收结果。']]
    runs = [start(client, workspace, context) for context in contexts]
    runs = [finish(client, run) for run in runs]
    updated = client.request('PATCH', '/documents/' + document['id'], json={'expected_version': document['current_version'], 'title': '问题清单与修复建议：分支验收'})
    merged = client.post(f'/workspaces/{workspace}/contexts', {'question': '综合两个分支的验收要求，用两句话回答。', 'document_ids': [run['document_id'] for run in runs]}, 201)
    sources = [source for source in merged['sources'] if source['document_id'] == document['id']]
    assert len(sources) == 1 and sources[0]['anchor_id'] == anchor['id']
    assert sources[0]['content'] == paragraph['text'] and sources[0]['version'] < updated['current_version']
    assert merged['origin'] is None
    merged_run = finish(client, start(client, workspace, merged))
    assert merged_run['origin'] is None
    record.update(branches='passed', merged_context=merged['id'], merged_run=merged_run['id'], branch_runs=[run['id'] for run in runs])
    save(record)


def image_errors(record):
    exported = json.loads((DATA / 'archive.json').read_text())
    with service('errors', 8792, {'vision_models': []}) as client:
        client.post('/workspaces/import', exported, 201)
        before = client.get(f"/workspaces/{record['workspace_id']}/runs")
        error = client.post(f"/workspaces/{record['workspace_id']}/runs", {'context_id': record['image_context']}, 422)
        assert error['error']['code'] == 'vision_unsupported', error
        assert client.get(f"/workspaces/{record['workspace_id']}/runs") == before
    with service('errors', 8792, {'max_input_image_bytes': 1}) as client:
        error = client.post(f"/workspaces/{record['workspace_id']}/runs", {'context_id': record['image_context']}, 422)
        assert error['error']['code'] == 'image_budget_exceeded', error
        assert error['error']['details']['image_bytes'] > 1
        assert client.get('/contexts/' + record['image_context']) == next(context for context in exported['contexts'] if context['id'] == record['image_context'])
    record['image_errors'] = 'passed'
    save(record)


def absent_source(client, record):
    run = client.get('/runs/' + record['image_run'])
    canvas = client.get('/canvases/' + record['canvas_id'])
    assert all(source not in {item['id'] for item in canvas['objects']} for source in run['origin']['source_ids'])
    before_views = canvas['editor_state']['link_views']
    placed = client.post(f"/runs/{run['id']}/place", {'expected_canvas_revision': canvas['revision'], 'bounds': {'x': 1100, 'y': 700, 'width': 420, 'height': 280}})
    assert placed['canvas']['editor_state']['link_views'] == before_views
    target = placed['run']['placement']['object_id']
    assert blocks(placed['canvas'])[target]['prop:pageId'] == run['document_id']
    record['absent_source'] = 'passed'
    save(record)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'placement', 'assets', 'proposals', 'branches', 'archive', 'image_errors', 'absent_source', 'restart'])
    phase = parser.parse_args().phase
    DATA.mkdir(parents=True, exist_ok=True)
    record = json.loads(RECORD.read_text()) if RECORD.exists() else {}
    if record.get(phase) == 'passed':
        raise SystemExit(phase + ' 已通过，复用记录。')
    if phase == 'image_errors':
        image_errors(record)
    else:
        with service() as client:
            if phase == 'archive':
                archive = client.get(f"/workspaces/{record['workspace_id']}/export")
                (DATA / 'archive.json').write_text(json.dumps(archive, ensure_ascii=False))
                with service('restore', 8793) as restored:
                    restored.post('/workspaces/import', archive, 201)
                    assert restored.get(f"/workspaces/{record['workspace_id']}/export") == archive
                record[phase] = 'passed'
                save(record)
            elif phase == 'restart':
                run = client.get('/runs/' + record['origin_run'])
                assert run['origin']['canvas_id'] == record['canvas_id'] and run['placement']['canvas_revision'] == record['placed_revision']
                assert client.get('/contexts/' + record['merged_context'])['sources'][0]['anchor_id']
                record[phase] = 'passed'
                save(record)
            else:
                globals()[phase](client, record)
    print(phase + ': passed', flush=True)


if __name__ == '__main__':
    main()
