import json

from playwright.sync_api import sync_playwright

from issues_acceptance import Client, DATA, RECORD


record = json.loads(RECORD.read_text())
if record.get('browser') == 'passed':
    raise SystemExit('browser 已通过，复用记录。')
client = Client(8791)
canvas = client.get('/canvases/' + record['canvas_id'])
run = client.get('/runs/' + record['origin_run'])
target = run['placement']['object_id']
first_line = run['answer'].splitlines()[0]
errors = []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='chrome', headless=True)
    try:
        page = browser.new_page(viewport={'width': 1600, 'height': 1100})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:8791', wait_until='domcontentloaded')
        navigation = page.get_by_role('navigation', name='工作区导航')
        navigation.wait_for()
        button = navigation.get_by_role('button').filter(has_text=canvas['name'])
        button.wait_for()
        print('画布按钮：' + button.inner_text(), flush=True)
        button.click()
        page.wait_for_function("id => Array.from(document.querySelectorAll('[data-block-id]')).some(element => element.getAttribute('data-block-id') === id)", arg=target, timeout=30000)
        cards = page.locator('[data-block-id]').evaluate_all("elements => elements.map(element => ({id: element.getAttribute('data-block-id'), tag: element.tagName, text: element.innerText}))")
        selected = [card for card in cards if card['id'] == target]
        page.screenshot(path=str(DATA / 'canvas.png'), full_page=True)
        (DATA / 'browser.json').write_text(json.dumps({'target': selected, 'page_errors': errors, 'canvas_id': canvas['id']}, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'target': selected}, ensure_ascii=False), flush=True)
        (DATA / 'page.html').write_text(page.content())
        assert selected and first_line in selected[0]['text'], selected
        assert not errors, errors
    finally:
        browser.close()
record['browser'] = 'passed'
RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print('browser: passed', flush=True)
