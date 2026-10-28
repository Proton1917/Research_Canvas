import argparse
import io
import json
from pathlib import Path
import sqlite3

from pptx import Presentation

from project_import_acceptance import Client


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.runtime/import-followup'


def upload_limit(client):
    record = json.loads((DATA / 'versions.json').read_text())
    workspace, project = record['workspace'], record['project']
    data = (ROOT / '.runtime/project-import/inputs/research.ppt').read_bytes()
    before = client.get('/workspaces/' + workspace)
    manifest = {'files': [{'field': '0', 'path': 'oversize/research.ppt'}]}
    result = client.request('POST', f'/projects/{project}/imports', expected=413, files=[
        ('manifest', (None, json.dumps(manifest), 'application/json')),
        ('0', ('research.ppt', data, 'application/vnd.ms-powerpoint')),
    ])
    assert result['error']['code'] == 'upload_too_large'
    ordinary = client.request('POST', f'/workspaces/{workspace}/imports', expected=413,
                              files={'file': ('research.ppt', data, 'application/vnd.ms-powerpoint')})
    assert ordinary['error']['code'] == 'upload_too_large'
    assert client.get('/workspaces/' + workspace) == before
    small = client.batch(project, [('limits/discussion.txt', (ROOT / 'config/prompts/discussion.txt').read_bytes(), None)])['results'][0]
    assert small['status'] == 'imported'
    result = {'project_status': 413, 'ordinary_status': 413, 'code': result['error']['code'],
              'workspace_preserved': True, 'next_upload': small['status'], 'source_bytes': len(data)}
    (DATA / 'upload-limit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8801)
    parser.add_argument('--evidence', type=Path, default=ROOT / 'tmp/project-import-ui/ui.sqlite3')
    parser.add_argument('--upload-limit', action='store_true')
    args = parser.parse_args()
    client = Client(args.port)
    if args.upload_limit:
        upload_limit(client)
        return
    # 使用浏览器验收保存的原件、编辑器投影与选段。
    with sqlite3.connect(f'file:{args.evidence}?mode=ro', uri=True) as evidence:
        evidence.row_factory = sqlite3.Row
        anchor = dict(evidence.execute('SELECT * FROM anchors LIMIT 1').fetchone())
        original = evidence.execute('SELECT a.data FROM documents d JOIN assets a ON a.id=json_extract(d.metadata,\'$.source_asset_id\') WHERE d.id=?', [anchor['document_id']]).fetchone()[0]
        projection = json.loads(evidence.execute('SELECT content FROM document_versions WHERE document_id=? AND version=?', [anchor['document_id'], anchor['version']]).fetchone()[0])

    presentation = Presentation(io.BytesIO(original))
    paragraph = (ROOT / 'docs/project-import.md').read_text().splitlines()[2]
    presentation.slides[0].notes_slide.notes_text_frame.text += '\n' + paragraph
    buffer = io.BytesIO()
    presentation.save(buffer)
    updated_source = buffer.getvalue()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'research.pptx').write_bytes(updated_source)

    workspace = client.post('/workspaces', {'name': '导入版本与历史片段验证'}, 201)['id']
    project = client.post(f'/workspaces/{workspace}/projects', {'name': 'research-inputs'}, 201)['id']
    first = client.batch(project, [('office/research.pptx', original, None)])['results'][0]
    document_id = first['entry']['document_id']
    saved = client.request('PATCH', '/documents/' + document_id, json={
        'expected_version': 1, 'change_kind': 'editor_initialization', 'content': projection,
    })
    assert saved['current_version'] == 2
    versions = client.get(f'/documents/{document_id}/versions')
    assert versions[-1]['reason'] == 'editor-initialize'
    selected = client.post(f'/workspaces/{workspace}/anchors', {
        'document_id': document_id, 'version': 2, 'block_id': anchor['block_id'],
        'quote': anchor['quote'], 'start_utf16': anchor['start_utf16'],
    }, 201)
    frozen = client.post(f'/workspaces/{workspace}/contexts', {
        'question': '读取演示文稿中选中的产品能力说明。', 'anchor_ids': [selected['id']],
    }, 201)
    explicit_stale = client.batch(project, [('office/research.pptx', updated_source, 1)])['results'][0]
    assert explicit_stale['status'] == 'conflict'
    updated = client.batch(project, [('office/research.pptx', updated_source, None)])['results'][0]
    assert updated['status'] == 'updated' and updated['entry']['imported_version'] == 3
    assert client.get(f'/documents/{document_id}/versions/2')['content'] == projection
    assert client.get('/contexts/' + frozen['id'])['sources'] == frozen['sources']
    assert frozen['sources'][0]['content'] == anchor['quote']
    client.request('PATCH', '/documents/' + document_id, expected=409, json={
        'expected_version': 2, 'title': '演示文稿研究笔记',
    })
    client.request('PATCH', '/documents/' + document_id, json={
        'expected_version': 3, 'title': '演示文稿研究笔记',
    })
    conflict = client.batch(project, [('office/research.pptx', original, None)])['results'][0]
    assert conflict['status'] == 'conflict'
    assert client.get('/documents/' + document_id)['title'] == '演示文稿研究笔记'
    accepted = client.batch(project, [('office/research.pptx', original, 4)])['results'][0]
    assert accepted['status'] == 'updated' and accepted['entry']['imported_version'] == 5

    ordinary = client.request('POST', f'/workspaces/{workspace}/imports', 201,
                              files={'file': ('research.pptx', original, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')})['document']
    initialized = client.request('PATCH', '/documents/' + ordinary['id'], json={
        'expected_version': 1, 'change_kind': 'editor_initialization', 'content': projection,
    })
    assert initialized['current_version'] == 2
    invalid = client.request('PATCH', '/documents/' + ordinary['id'], expected=422, json={
        'expected_version': 2, 'change_kind': 'editor_initialization', 'title': '演示文稿研究笔记', 'content': projection,
    })
    assert invalid['error']['code'] == 'invalid_input'
    record = {'workspace': workspace, 'project': project, 'document': document_id,
              'initialization_version': 2, 'reimport_version': 3, 'confirmed_overwrite_version': 5,
              'historical_anchor': selected['id'], 'historical_context': frozen['id'],
              'initialization_reimport': 'passed', 'frozen_source': 'passed',
              'explicit_stale_import': 'passed', 'stale_document_save': 'passed',
              'human_edit_conflict': 'passed', 'ordinary_initialization': 'passed'}
    (DATA / 'versions.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
