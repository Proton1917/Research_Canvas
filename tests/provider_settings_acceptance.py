import json
import os
from pathlib import Path
import socket
import subprocess
import time

import requests
import toml


ROOT = Path(__file__).resolve().parents[1]
MODEL = 'cc/gemini-3.8-flash-high'


class Service:
    def __init__(self, directory):
        self.directory = directory
        self.config_path = directory / 'server.toml'
        config = toml.load(ROOT / 'config/server.toml')
        with socket.socket() as port:
            port.bind(('127.0.0.1', 0))
            config['port'] = port.getsockname()[1]
        config['database'] = str(directory / 'research.sqlite3')
        config['provider']['default_model'] = MODEL
        config['provider']['allowed_models'] = [MODEL]
        config['provider']['vision_models'] = [MODEL]
        self.base = f'http://127.0.0.1:{config["port"]}/api'
        config['allowed_origins'] = [self.base.removesuffix('/api')]
        self.config_path.write_text(toml.dumps(config))
        self.initial = config['provider']
        self.process = None
        self.log = None

    def start(self):
        self.log = (self.directory / 'server.log').open('a')
        self.process = subprocess.Popen([str(ROOT / '.runtime/bin/research-canvas')], cwd=ROOT,
                                        env={**os.environ, 'RC_CONFIG': str(self.config_path), 'TMPDIR': str(self.directory)},
                                        stdout=self.log, stderr=self.log)
        for _ in range(100):
            assert self.process.poll() is None, '服务启动失败，详情见 server.log'
            try:
                if requests.get(self.base + '/health', timeout=1).ok:
                    return
            except requests.ConnectionError:
                pass
            time.sleep(0.1)
        raise TimeoutError('服务启动超时')

    def stop(self):
        if self.process is not None:
            self.process.terminate()
            self.process.wait(timeout=20)
            self.log.close()
            self.process = None

    def request(self, method, path, expected=200, **kwargs):
        response = requests.request(method, self.base + path, timeout=210, **kwargs)
        assert response.status_code == expected, (path, response.status_code, response.text[:600])
        return response.json()

    def wait_run(self, run):
        deadline = time.monotonic() + 210
        while time.monotonic() < deadline:
            current = self.request('GET', '/runs/' + run['id'])
            if current['status'] not in {'queued', 'running'}:
                assert current['status'] == 'succeeded', current.get('error')
                assert current['answer'].strip() and current['document_id']
                return current
            time.sleep(0.5)
        raise TimeoutError('模型运行超时')


def verify(service):
    initial = service.request('GET', '/settings/provider')
    assert initial['revision'] == 0 and 'api_key' not in initial and 'headers' not in initial
    initial_catalog = service.request('GET', '/models')
    assert [model['id'] for model in initial_catalog['models']] == [MODEL]
    marker = next(value.removeprefix('Bearer ') for name, value in service.initial['headers'].items() if name.lower() == 'authorization')
    connection = {'protocol': 'chat_completions', 'base_url': service.initial['base_url'], 'api_key': marker}
    tested = service.request('POST', '/settings/provider/test', json={**connection, 'model': MODEL})
    assert tested['connected'] and tested['model_available']
    assert service.request('GET', '/settings/provider') == initial
    assert not service.config_path.with_suffix('.local.toml').exists()

    saved = service.request('PUT', '/settings/provider', json={**connection, 'expected_revision': 0, 'default_model': MODEL, 'vision_models': [MODEL]})
    assert saved['api_key_configured'] and saved['credential_source'] == 'saved'
    assert saved['allowed_models'] == [MODEL] and marker not in json.dumps(saved)
    local_file = service.config_path.with_suffix('.local.toml')
    assert toml.load(local_file)['provider']['api_key'] == marker
    if os.name == 'posix':
        assert local_file.stat().st_mode & 0o777 == 0o600
    stale = service.request('PUT', '/settings/provider', expected=409, json={**connection, 'expected_revision': 0, 'default_model': MODEL})
    assert stale['error']['code'] == 'settings_conflict'

    # 使用实际连接失败验证测试结果与配置保存相互独立。
    offline = {'protocol': 'chat_completions', 'base_url': 'http://127.0.0.1:1/v1'}
    failure = service.request('POST', '/settings/provider/test', expected=502, json=offline)
    assert failure['error']['code'] == 'provider_error'
    assert service.request('GET', '/settings/provider') == saved
    offline_saved = service.request('PUT', '/settings/provider', json={**offline, 'expected_revision': saved['revision'], 'default_model': MODEL})
    assert not offline_saved['api_key_configured'] and offline_saved['credential_source'] == 'none'
    offline_catalog = service.request('GET', '/models')
    assert offline_catalog['models'][0]['available'] is None
    assert offline_catalog['directory_error']['code'] == 'provider_error'
    saved = service.request('PUT', '/settings/provider', json={**connection, 'expected_revision': offline_saved['revision'], 'default_model': MODEL, 'vision_models': [MODEL]})
    assert service.request('GET', '/capabilities')['vision_models'] == [MODEL]

    service.stop()
    service.start()
    assert service.request('GET', '/settings/provider') == saved
    workspace = service.request('POST', '/workspaces', 201, json={'name': 'API 设置与协议接入验收'})
    with (ROOT / 'README.md').open('rb') as file:
        imported = service.request('POST', f'/workspaces/{workspace["id"]}/imports', 201, files={'file': ('README.md', file, 'text/markdown')})
    context = service.request('POST', f'/workspaces/{workspace["id"]}/contexts', 201, json={
        'question': '根据材料，用一句话说明 Research Canvas 的工作对象，并标注来源编号。',
        'document_ids': [imported['document']['id']],
    })
    chat = service.request('POST', f'/workspaces/{workspace["id"]}/runs', 202, json={'context_id': context['id'], 'model': MODEL})
    messages = {**connection, 'protocol': 'anthropic_messages', 'expected_revision': saved['revision'], 'default_model': MODEL, 'vision_models': [MODEL]}
    switched = service.request('PUT', '/settings/provider', json=messages)
    chat_result = service.wait_run(chat)
    tested = service.request('POST', '/settings/provider/test', json={'protocol': 'anthropic_messages', 'base_url': connection['base_url'], 'model': MODEL})
    assert tested['model_available']
    anthropic = service.request('POST', f'/workspaces/{workspace["id"]}/runs', 202, json={'context_id': context['id'], 'model': MODEL})
    anthropic_result = service.wait_run(anthropic)
    assert service.request('GET', '/health')['default_model'] == MODEL
    archive = service.request('GET', f'/workspaces/{workspace["id"]}/export')
    assert marker not in json.dumps(archive)
    preserved = service.request('PUT', '/settings/provider', json={
        'protocol': 'anthropic_messages', 'base_url': connection['base_url'],
        'expected_revision': switched['revision'], 'default_model': MODEL,
    })
    assert preserved['api_key_configured']
    cleared = service.request('PUT', '/settings/provider', json={
        'protocol': 'anthropic_messages', 'base_url': connection['base_url'], 'api_key': '',
        'expected_revision': preserved['revision'], 'default_model': MODEL,
    })
    assert not cleared['api_key_configured'] and toml.load(local_file)['provider'].get('api_key') is None
    result = {'workspace': workspace['id'], 'connection_test': 'passed', 'save_and_restart': 'passed',
              'settings_conflict': 'passed', 'offline_error_and_cache_change': 'passed',
              'credential_keep_clear_and_export': 'passed', 'configured_model': MODEL,
              'chat_completions': {'run': chat_result['id'], 'model_used': chat_result['model_used'], 'answer': chat_result['answer']},
              'anthropic_messages': {'run': anthropic_result['id'], 'model_used': anthropic_result['model_used'], 'answer': anthropic_result['answer']}}
    (service.directory / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


def main():
    directory = ROOT / '.runtime/provider-settings'
    directory.mkdir(parents=True, exist_ok=True)
    service = Service(directory)
    try:
        service.start()
        verify(service)
    finally:
        service.stop()


if __name__ == '__main__':
    main()
