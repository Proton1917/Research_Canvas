import json
from pathlib import Path
import sys
import tempfile

from provider_settings_acceptance import MODEL, ROOT, Service

sys.path.insert(0, str(ROOT / 'scripts'))
from release_smoke import verify_provider_settings


def verify(service):
    initial = service.request('GET', '/settings/provider')
    connection = {key: initial[key] for key in ('protocol', 'base_url')}
    catalog = service.request('GET', '/models')
    assert catalog['directory_error'] is None
    assert catalog['models'][0]['available'] is True

    def save(**changes):
        current = service.request('GET', '/settings/provider')
        return service.request('PUT', '/settings/provider', json={
            'protocol': current['protocol'], 'base_url': current['base_url'],
            'default_model': current['default_model'], 'expected_revision': current['revision'], **changes,
        })

    manual = 'research-canvas/manual-model'
    saved = save(allowed_models=[MODEL, manual], vision_models=[MODEL, manual, 'disabled-model'])
    assert saved['vision_models'] == [MODEL, manual]
    inherited = save()
    assert inherited['allowed_models'] == [MODEL, manual] and inherited['vision_models'] == [MODEL, manual]
    catalog = service.request('GET', '/models')
    assert [(model['id'], model['available']) for model in catalog['models']] == [(MODEL, True), (manual, False)]
    assert catalog['directory_error'] is None
    saved = save(allowed_models=[MODEL])
    assert saved['vision_models'] == [MODEL]
    assert service.request('GET', '/capabilities')['vision_models'] == [MODEL]
    saved = save(allowed_models=[], vision_models=[])
    assert saved['allowed_models'] == [MODEL] and saved['vision_models'] == []

    # 本地关闭端口产生真实连接失败，目录保留已启用的模型。
    offline = 'http://127.0.0.1:1/v1'
    save(base_url=offline, api_key='')
    failure = service.request('POST', '/settings/provider/test', 502, json={**connection, 'base_url': offline})
    assert failure['error']['details']['kind'] == 'connection'
    assert '无法连接' in failure['error']['message']
    assert failure['error']['details']['original']
    catalog = service.request('GET', '/models')
    assert catalog['models'][0]['id'] == MODEL and catalog['models'][0]['available'] is None
    assert catalog['directory_error']['details']['kind'] == 'connection'
    assert service.request('GET', '/health')['credential_source'] == 'none'

    # 实际 Research Canvas 的未知路径返回 404，用于验证接口地址提示。
    endpoint_error = service.request('POST', '/settings/provider/test', 502, json={
        **connection, 'base_url': service.base + '/missing-provider',
    })
    assert endpoint_error['error']['details']['kind'] == 'endpoint'
    assert endpoint_error['error']['details']['upstream_status'] == 404

    verify_provider_settings(service.base.removesuffix('/api'), service.config_path)
    saved = service.request('GET', '/settings/provider')
    service.stop()
    service.start()
    assert service.request('GET', '/settings/provider') == saved

    # 用初始配置的正确客户端标记恢复 Router 连接。
    save(**connection, headers=service.initial['headers'])
    assert service.request('GET', '/health')['credential_source'] == 'headers'
    restored = service.request('GET', '/models')
    assert restored['models'][0]['available'] is True and restored['directory_error'] is None
    return {
        'status': 'passed', 'checks': ['omitted_lists_preserved', 'explicit_empty_lists',
            'vision_enabled_intersection', 'directory_present_and_missing', 'offline_enabled_models',
            'connection_and_http_404_messages', 'credential_source', 'provider_settings_smoke',
            'restart_persistence', 'restored_directory'],
        'offline_error': failure['error'], 'endpoint_error': endpoint_error['error'],
    }


def main():
    parent = ROOT / '.runtime/provider-catalog'
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='run-', dir=parent))
    service = Service(directory)
    try:
        service.start()
        result = verify(service)
        (directory / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'directory': str(directory), **result}, ensure_ascii=False, indent=2))
    finally:
        service.stop()


if __name__ == '__main__':
    main()
