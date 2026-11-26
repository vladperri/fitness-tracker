"""Перевірка застосунку «Моя Audi A6 C7» у справжньому браузері.

Запуск (з папки audi):  pip install playwright && python -m playwright install chromium
                         python tests/run.py
js/fb.js підміняється на tests/mock-fb.js, тож Firebase не потрібен.
Шрифти Google, якщо мережа їх не віддає, беруться з node_modules/@fontsource (необов'язково).
"""
import json, os, re, sys, threading, functools, http.server, socketserver, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, '..', 'public')
MOCK = open(os.path.join(HERE, 'mock-fb.js'), encoding='utf-8').read()
FONTS = os.environ.get('FONTSOURCE', '/tmp/fonts/node_modules/@fontsource')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=PUBLIC))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % PORT
NAV = [0]
def url(mode, hash=''):
    NAV[0] += 1  # новий query щоразу = повне перезавантаження зі свіжим моком
    return BASE + 'index.html?mock=%s&n=%d%s' % (mode, NAV[0], hash)

results = []
def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  → ' + str(info)))

def font_css():
    faces = []
    for fam, pkg, ws in [('Inter Tight', 'inter-tight', (200, 300, 500, 700)), ('IBM Plex Mono', 'ibm-plex-mono', (400, 600))]:
        for w in ws:
            for sub in ('latin', 'cyrillic'):
                f = '%s/%s/files/%s-%s-%d-normal.woff2' % (FONTS, pkg, pkg, sub, w)
                if os.path.exists(f):
                    faces.append("@font-face{font-family:'%s';font-weight:%d;src:url(https://fonts.gstatic.com/local/%s)}" % (fam, w, os.path.basename(f) + '?' + pkg))
    return '\n'.join(faces)

def setup(page):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text else None)
    page.route('**/js/fb.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=MOCK))
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=font_css()))
    def gstatic(r):
        m = re.search(r'/local/([^?]+)\?(.+)$', r.request.url)
        if m:
            p = '%s/%s/files/%s' % (FONTS, m.group(2), m.group(1))
            if os.path.exists(p): return r.fulfill(status=200, content_type='font/woff2', body=open(p, 'rb').read())
        r.fulfill(status=404, body='')
    page.route('https://fonts.gstatic.com/**', gstatic)
    return errors

def open_app(ctx, mode='in', hash='', w=390, h=844):
    page = ctx.new_page()
    page.set_viewport_size({'width': w, 'height': h})
    errs = setup(page)
    page.goto(url(mode, hash))
    page.wait_for_function('document.fonts.status === "loaded"')
    page.wait_for_timeout(250)
    return page, errs

GRID_JS = r'''
(sel) => {
  const root = document.querySelector(sel); if (!root) return {missing: true};
  const R = root.getBoundingClientRect(); const bad = []; let n = 0;
  for (const el of root.querySelectorAll('div,section,article,li,button,a.btn,a.tile,a.more,label,input,select,h1,h2,h3,p,dl,ul,.ytext,.item-text')) {
    if (el.closest('svg,#catalog,dialog') || el.offsetParent === null) continue;
    const cs = getComputedStyle(el); if (cs.display === 'inline' || cs.position === 'absolute') continue;
    const r = el.getBoundingClientRect(); if (!r.height) continue; n++;
    const y = r.top - R.top; if (Math.abs(y / 4 - Math.round(y / 4)) > 0.02) bad.push([el.tagName + '.' + el.className, (el.textContent||'').trim().slice(0, 30), +y.toFixed(2)]);
  }
  return {n, bad: bad.slice(0, 12), count: bad.length};
}'''
TAP_JS = r'''
(sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel + ' button, ' + sel + ' a.btn, ' + sel + ' a.tile, ' + sel + ' a.more, ' + sel + ' input:not([type=checkbox]):not(.vh), ' + sel + ' select, .tabs a')) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || (r.width < 43.5)) out.push([el.tagName, (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), Math.round(r.width), Math.round(r.height)]);
  }
  return out;
}'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME) if os.path.exists(CHROME) else p.chromium.launch()
    ctx = b.new_context(permissions=['clipboard-read', 'clipboard-write'], accept_downloads=True)

    # --- головна, увійшли ---
    page, errs = open_app(ctx, 'in')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('home: title', t('#hero-title') == 'Готова до дороги', t('#hero-title'))
    check('home: sub mentions engine lube + km', 'мастила в двигуні' in t('#hero-sub') and '195 690 км' in t('#hero-sub'), t('#hero-sub'))
    check('home: oil left', t('#st-oil') == '7 636' and t('#st-oil-unit') == 'км', t('#st-oil'))
    check('home: km', t('#st-km') == '188 054', t('#st-km'))
    check('home: counts', t('#st-count') == '5' and t('#st-rem') == '1' and t('#st-miss') == '4', [t('#st-count'), t('#st-rem'), t('#st-miss')])
    rows = page.locator('#h-year .yrow')
    check('home: 10 yearly rows', rows.count() == 10, rows.count())
    first4 = [rows.nth(i).locator('.ytitle').inner_text() for i in range(4)]
    check('home: missing first', first4 == ['Мастило в передньому редукторі', 'Мастило в задньому редукторі', 'Гальмівна рідина', 'Охолоджувальна рідина двигуна'], first4)
    check('home: missing marked', page.locator('#h-year .yrow.miss').count() == 4)
    ui_text = page.evaluate("[...document.querySelectorAll('[data-view]:not(#catalog)')].map(e=>e.textContent).join(' ')")
    oil_words = re.findall(r'\S*[Мм]асл\S*', ui_text)
    check('ui: advice text uses «мастило» (only user data may say «масло»)', all(w for w in oil_words) and len(oil_words) <= 2, oil_words)
    check('home: year sub', '6 з 10' in t('#h-year-sub'), t('#h-year-sub'))
    check('home: last records', page.locator('#h-last .mrow').count() == 3)
    check('home: reminder', 'Діагностика задньої підвіски' in t('#h-rem'))
    check('home: account', 'vlad@example.com' in t('#acc-who') and page.locator('#acc-signout').is_visible())

    # --- вікно «Що купити» ---
    opener = page.locator('#h-year [data-info="front_diff"]')
    check('info: aria-label', opener.get_attribute('aria-label') == 'Що купити: мастило в передньому редукторі', opener.get_attribute('aria-label'))
    opener.click()
    page.wait_for_timeout(100)
    check('info: dialog open', page.evaluate("document.getElementById('info').open"))
    check('info: title', t('#info-title') == 'Мастило в передньому редукторі')
    check('info: buy rows', page.locator('#info-buy .buy-row').count() == 2)
    check('info: oil code', page.locator('#info-buy [data-code="G 052 145 S2"]').count() == 1)
    check('info: last fact', 'немає запису' in t('#info-facts'), t('#info-facts'))
    check('info: note', '2 л' in t('#info-note'))
    page.locator('#info-buy [data-code="G 052 145 S2"]').click()
    page.wait_for_timeout(150)
    check('info: copy', page.evaluate('navigator.clipboard.readText()') == 'G 052 145 S2')
    page.keyboard.press('Escape'); page.wait_for_timeout(100)
    check('info: Esc closes', not page.evaluate("document.getElementById('info').open"))
    check('info: focus returns', page.evaluate("document.activeElement && document.activeElement.getAttribute('data-info')") == 'front_diff')
    page.locator('#h-year [data-info="engine_oil"]').click(); page.wait_for_timeout(100)
    check('info: engine oil 3 rows', page.locator('#info-buy .buy-row').count() == 3)
    check('info: engine last fact', '06.11.2026' in t('#info-facts'), t('#info-facts'))
    check('info: catalog link', page.locator('#info-more').is_visible() and page.locator('#info-more').get_attribute('href') == '#s-oil')
    page.mouse.click(5, 5); page.wait_for_timeout(100)
    check('info: backdrop click closes', not page.evaluate("document.getElementById('info').open"))

    # --- записати заміну з вікна ---
    page.locator('#h-year [data-info="front_diff"]').click(); page.wait_for_timeout(80)
    page.locator('#info-log').click(); page.wait_for_timeout(300)
    check('log: on records', page.evaluate('location.hash') == '#records' and not page.locator('#rec-form').is_hidden())
    check('log: prefilled title', page.locator('#rec-form [name=title]').input_value() == 'Заміна: мастило в передньому редукторі')
    check('log: svc checked', page.locator('#rec-form input[value=front_diff]').is_checked())
    page.locator('#rec-form [name=km]').fill('188200')
    page.locator('#rec-form button[type=submit]').click(); page.wait_for_timeout(200)
    w = page.evaluate('window.__writes')
    check('log: saved', w and w[-1][0] == 'set' and w[-1][1].startswith('records/r') and w[-1][2]['svc'] == ['front_diff'] and w[-1][2]['km'] == 188200, w[-1:] if w else w)
    page.goto(url('in', '#home')); page.wait_for_timeout(300)
    check('log: (fresh store) still 4 missing', t('#st-miss') == '4')

    # --- записи ---
    page.goto(url('in', '#records')); page.wait_for_timeout(300)
    check('records: 5 cards', page.locator('#rec-list .rec').count() == 5)
    check('records: count text', t('#rec-count').startswith('5 записів'), t('#rec-count'))
    check('records: code button', page.locator('#rec-list [data-code="35742 01"]').count() == 1)
    check('records: meta with price', 'Lemförder · 350 грн' in t('#rec-list'), '')
    page.locator('[data-filter=repair]').click(); page.wait_for_timeout(50)
    check('records: filter repair', page.locator('#rec-list .rec').count() == 2)
    page.locator('[data-filter=all]').click()
    page.locator('[data-edit=r20261119]').click(); page.wait_for_timeout(150)
    check('edit: form filled', page.locator('#rec-form [name=title]').input_value() == 'Передня підвіска й розвал-сходження')
    check('edit: items text', '35742 01' in page.locator('#rec-form [name=items]').input_value())
    page.locator('#rec-form [name=title]').fill('Передня підвіска')
    page.locator('#rec-form button[type=submit]').click(); page.wait_for_timeout(200)
    w = page.evaluate('window.__writes')[-1]
    check('edit: same id, fields kept', w[1] == 'records/r20261119' and w[2]['title'] == 'Передня підвіска' and w[2]['total'] == 5250 and 'updatedAt' in w[2], w)
    d = page.locator('[data-del="records/r20261123"]')
    d.click(); check('delete: arms first', d.inner_text() == 'Точно видалити?')
    d.click(); page.wait_for_timeout(200)
    check('delete: removed', page.locator('#rec-list .rec').count() == 4)

    # --- нагадування ---
    page.goto(url('in', '#reminders')); page.wait_for_timeout(300)
    check('rem: big', t('#r-oil-km') == '7 636' and t('#r-oil-unit') == 'км залишилось', [t('#r-oil-km'), t('#r-oil-unit')])
    wpx = page.evaluate("parseFloat(document.querySelector('#r-oil-bar i').style.width)")
    check('rem: bar ~4.6%', 4 < wpx < 5, wpx)
    check('rem: bar ends', t('#r-oil-from') == '187 690 · заміна' and t('#r-oil-to') == '195 690 · наступна', [t('#r-oil-from'), t('#r-oil-to')])
    check('rem: bar aria', 'Пройдено 364' in page.locator('#r-oil-bar').get_attribute('aria-label'))
    check('rem: where list 11', page.locator('#where-list .wrow').count() == 11)
    check('rem: where last line', 'Остання заміна: 24.06.2026' in page.locator('#where-list .wrow').nth(4).inner_text())
    check('rem: my reminder', 'Діагностика задньої підвіски' in t('#rem-list'))
    page.locator('[data-rem-edit=m1]').click(); page.wait_for_timeout(150)
    check('rem edit: form filled', page.locator('#rem-form [name=title]').input_value() == 'Діагностика задньої підвіски' and page.locator('#rem-form [name=note]').input_value() == 'Шевчук' and t('#rem-form-title') == 'Редагувати нагадування')
    page.locator('#rem-form [name=title]').fill('Діагностика задньої підвіски на СТО')
    page.locator('#rem-form [name=date]').fill('2026-12-02')
    page.locator('#rem-form button[type=submit]').click(); page.wait_for_timeout(200)
    w = page.evaluate('window.__writes')[-1]
    check('rem edit: same id, fields kept', w[1] == 'reminders/m1' and w[2]['title'] == 'Діагностика задньої підвіски на СТО' and w[2]['date'] == '2026-12-02' and w[2]['done'] is False and w[2]['note'] == 'Шевчук' and 'updatedAt' in w[2], w)
    check('rem edit: form closed, list updated', page.locator('#rem-form').is_hidden() and 'на СТО' in t('#rem-list'))
    page.locator('[data-done=m1]').click(); page.wait_for_timeout(150)
    check('rem: done update', page.evaluate('window.__writes')[-1] == ['update', 'reminders/m1', {'done': True}])
    page.locator('#oil-set [name=km]').fill('10000'); page.locator('#oil-set button').click(); page.wait_for_timeout(150)
    check('rem: interval saved', page.evaluate('window.__writes')[-1] == ['set', 'settings/main', {'oilIntervalKm': 10000, 'oilIntervalMonths': 12}])
    page.locator('#rem-add-toggle').click()
    page.locator('#rem-form [name=title]').fill('Заміна мастила в редукторах'); page.locator('#rem-form button[type=submit]').click(); page.wait_for_timeout(150)
    check('rem: add', 'Заміна мастила в редукторах' in t('#rem-list'))

    # --- експорт ---
    page.goto(url('in', '#home')); page.wait_for_timeout(300)
    with page.expect_download() as dl:
        page.locator('#acc-export').click()
    data = json.load(open(dl.value.path(), encoding='utf-8'))
    check('export: file', data['app'] == 'audi-a6' and len(data['records']) == 5 and len(data['reminders']) == 1 and data['settings']['main']['oilIntervalKm'] == 8000)
    backup = os.path.join(tempfile.gettempdir(), 'audi-backup-test.json'); json.dump(data, open(backup, 'w', encoding='utf-8'), ensure_ascii=False)
    check('home: no console errors', not errs, errs[:3])
    page.close()

    # --- імпорт у порожню базу ---
    page, errs = open_app(ctx, 'empty')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('empty: title', t('#hero-title') == 'Почніть журнал')
    page.locator('#acc-file').set_input_files(backup); page.wait_for_timeout(400)
    check('import: status', 'Відновлено: 5 записів, 1 нагадування' in t('#acc-status'), t('#acc-status'))
    check('import: data shown', t('#st-count') == '5' and t('#hero-title') == 'Готова до дороги', [t('#st-count'), t('#hero-title')])
    check('import: no errors', not errs, errs[:3])
    page.close()

    # --- не увійшли ---
    page, errs = open_app(ctx, 'out')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('out: title', t('#hero-title') == 'Увійдіть, щоб відкрити журнал')
    check('out: cta', t('.hero-cta') == 'Увійти через Google')
    check('out: yearly rows still with info', page.locator('#h-year [data-info]').count() == 10)
    page.locator('#h-year [data-info=atf]').click(); page.wait_for_timeout(80)
    check('out: info works', t('#info-title') == 'Мастило в коробці передач' and 'після входу' in t('#info-facts'))
    page.keyboard.press('Escape')
    page.locator('.hero-cta').click(); page.wait_for_timeout(300)
    check('out→in: signed in', t('#hero-title') == 'Готова до дороги' and t('.hero-cta') == 'Додати запис')
    page.locator('#acc-signout').click(); page.wait_for_timeout(200)
    check('in→out: listeners closed', page.evaluate('window.__unsubs') >= 3 and t('#hero-title') == 'Увійдіть, щоб відкрити журнал')
    check('out: no errors', not errs, errs[:3])
    page.close()

    # --- немає доступу ---
    page, errs = open_app(ctx, 'deny')
    check('deny: note', 'Немає доступу до бази' in page.locator('#db-note').inner_text())
    page.close()

    # --- каталог і авто ---
    page, errs = open_app(ctx, 'in', '#catalog')
    check('catalog: visible', page.locator('#catalog').is_visible() and page.locator('#catalog .pfig svg').count() >= 10, page.locator('#catalog .pfig svg').count())
    btn = page.locator('#catalog .codebtn').first; code = btn.get_attribute('data-code'); btn.click(); page.wait_for_timeout(150)
    check('catalog: copy', page.evaluate('navigator.clipboard.readText()') == code)
    page.goto(url('in', '#s-oil')); page.wait_for_timeout(250)
    check('catalog: deep link', page.locator('#catalog').is_visible() and 'Мастило в двигуні' in page.locator('#s-oil').inner_text())
    page.goto(url('in', '#car')); page.wait_for_timeout(250)
    page.locator('#car [data-code]').click(); page.wait_for_timeout(150)
    check('car: VIN copy', page.evaluate('navigator.clipboard.readText()') == 'WAUGFAFC5FN016207')
    check('car: PR table rows', page.locator('#car .prtable tbody tr').count() >= 45)
    check('catalog/car: no errors', not errs, errs[:3])
    page.close()

    # --- верстка: переповнення, тач-цілі, сітка ---
    for w in (320, 390, 768, 1024, 1280, 1440):
        page, errs = open_app(ctx, 'in', '', w, 900)
        for v in ('home', 'records', 'reminders', 'car', 'catalog'):
            page.evaluate("v => location.hash = '#' + v", v); page.wait_for_timeout(120)
            ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check('layout %d %s: no overflow' % (w, v), ov <= 0, ov)
            if v != 'catalog':
                small = page.evaluate(TAP_JS, '#' + v)
                check('layout %d %s: tap ≥44' % (w, v), not small, small[:4])
            if w in (390, 1280) and v != 'catalog':
                g = page.evaluate(GRID_JS, '#' + v)
                check('grid %d %s: 4px rhythm (%d boxes)' % (w, v, g.get('n', 0)), g.get('count', 1) == 0, g.get('bad'))
        if w in (390, 1280):
            page.evaluate("location.hash = '#home'"); page.wait_for_timeout(150)
            page.screenshot(path=os.path.join(HERE, 'out', 'home-%d.png' % w), full_page=True) if os.path.isdir(os.path.join(HERE, 'out')) else None
        page.close()
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
