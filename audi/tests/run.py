"""Перевірка застосунку «Моя Audi A6 C7» у справжньому браузері.

Запуск (з папки audi):  pip install playwright && python -m playwright install chromium
                         python tests/run.py
js/fb.js підміняється на tests/mock-fb.js, тож Firebase не потрібен.
Сервер віддає index.html на будь-який шлях, як Firebase Hosting із rewrites.
Шрифти (Inter, Inter Tight, IBM Plex Mono) беруться з @fontsource, шлях — змінна FONTSOURCE,
щоб метрики тексту були однакові на будь-якій машині й у GitHub Actions.
"""
import json, os, re, sys, threading, functools, http.server, socketserver, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.abspath(os.path.join(HERE, '..', 'public'))
MOCK = open(os.path.join(HERE, 'mock-fb.js'), encoding='utf-8').read()
FONTS = os.environ.get('FONTSOURCE', '/tmp/fonts/node_modules/@fontsource')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
# Дати в тестах відносні до «сьогодні» (нагадування «скоро», прострочення), тож годинник браузера фіксуємо.
TODAY = '2026-11-26T12:00:00'

class Spa(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            self.path = '/index.html'
        return super().send_head()
socketserver.ThreadingTCPServer.daemon_threads = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Spa, directory=PUBLIC))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORT
NAV = [0]
def url(mode, path='/', query='', hash=''):
    NAV[0] += 1  # новий query щоразу = повне перезавантаження зі свіжим моком
    return BASE + path + '?mock=%s&n=%d%s%s' % (mode, NAV[0], ('&' + query) if query else '', hash)

results = []
def check(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  → ' + str(info)))

def font_css():
    faces = []
    for fam, pkg, ws in [('Inter', 'inter', (400, 500, 600, 700)), ('Inter Tight', 'inter-tight', (200, 300, 500, 700)), ('IBM Plex Mono', 'ibm-plex-mono', (400, 600))]:
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

def open_app(ctx, mode='in', path='/', query='', hash='', w=390, h=844):
    page = ctx.new_page()
    page.set_viewport_size({'width': w, 'height': h})
    errs = setup(page)
    page.clock.set_fixed_time(TODAY)
    page.goto(url(mode, path, query, hash))
    page.wait_for_function('document.fonts.status === "loaded"')
    page.wait_for_timeout(250)
    return page, errs

GRID_JS = r'''
(sel) => {
  const root = document.querySelector(sel); if (!root) return {missing: true};
  const R = root.getBoundingClientRect(); const bad = []; let n = 0;
  for (const el of root.querySelectorAll('div,section,article,li,button,a.btn,a.mlink,a.icon-btn,label,input,select,h1,h2,h3,p,dl,ul,.ytext,.item-text')) {
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
  const q = ['button', 'a.btn', 'a.mlink', 'a.icon-btn', 'input:not([type=checkbox]):not(.vh)', 'select'].map(s => sel + ' ' + s).join(',') + ', .tabs a, #fab-wrap button, #fab-wrap a';
  for (const el of document.querySelectorAll(q)) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) out.push([el.tagName, (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), Math.round(r.width), Math.round(r.height)]);
  }
  return out;
}'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME) if os.path.exists(CHROME) else p.chromium.launch()
    ctx = b.new_context(permissions=['clipboard-read', 'clipboard-write'], accept_downloads=True)

    # --- головна, увійшли ---
    page, errs = open_app(ctx, 'in')
    t = lambda s: page.locator(s).first.inner_text().strip()
    path = lambda: page.evaluate('location.pathname')
    check('home: title', t('#hero-title') == 'Готова до дороги', t('#hero-title'))
    check('home: no oil text above car', page.locator('#hero-sub').is_hidden())
    check('home: no stat tiles', page.locator('.tile, .tiles').count() == 0)
    check('home: no «Додати запис» in hero', page.locator('#home .btn:has-text("Додати")').count() == 0)
    check('home: oil left', t('#st-oil') == '7 636' and t('#st-oil-unit') == 'км', t('#st-oil'))
    check('home: km', t('#st-km') == '188 054', t('#st-km'))
    check('home: reminders block shown', page.locator('#h-rem-box').is_visible() and page.locator('#h-rem a.mlink').count() == 1)
    check('home: reminder links to edit page', page.locator('#h-rem a.mlink').get_attribute('href') == '/create-reminder?id=m1')
    check('home: one next planned item', page.locator('#h-next .yrow').count() == 1)
    check('home: next = front diff', 'Мастило в передньому редукторі' in t('#h-next'), t('#h-next'))
    check('home: 3 last records', page.locator('#h-last .mrow').count() == 3)
    order = page.evaluate("[...document.querySelectorAll('#home .home-grid > section:not([hidden]) h2')].map(h => h.textContent)")
    check('home: block order', order == ['Нагадування', 'Наступне планове ТО', 'Останні записи'], order)
    check('nav: 5 tabs, profile, no reminders tab', page.locator('.tabs a').count() == 5 and page.locator('.tabs a[href="/profile"]').count() == 1 and page.locator('.tabs a:has-text("Нагадування")').count() == 0)
    check('fab: visible', page.locator('#fab').is_visible())
    ui_text = page.evaluate("[...document.querySelectorAll('main [data-view]:not(#catalog)')].map(e=>e.textContent).join(' ')")
    check('ui: advice uses «мастило»', len(re.findall(r'\S*[Мм]асл\S*', ui_text)) <= 2, re.findall(r'\S*[Мм]асл\S*', ui_text))

    # --- вікно «Що купити» з наступного ТО ---
    page.locator('#h-next [data-info]').click(); page.wait_for_timeout(100)
    check('info: open', page.evaluate("document.getElementById('info').open") and t('#info-title') == 'Мастило в передньому редукторі')
    page.locator('#info-buy [data-code="G 052 145 S2"]').click(); page.wait_for_timeout(150)
    check('info: copy', page.evaluate('navigator.clipboard.readText()') == 'G 052 145 S2')
    page.keyboard.press('Escape'); page.wait_for_timeout(100)
    check('info: Esc closes, focus back', not page.evaluate("document.getElementById('info').open") and page.evaluate("document.activeElement.getAttribute('data-info')") == 'front_diff')
    page.locator('#h-next [data-info]').click(); page.wait_for_timeout(80)
    page.locator('#info-log').click(); page.wait_for_timeout(250)
    check('log: /create-fix with preset', path() == '/create-fix' and page.locator('#rec-form [name=title]').input_value() == 'Заміна: мастило в передньому редукторі' and page.locator('#rec-form input[value=front_diff]').is_checked())
    check('log: fab hidden on form page', page.locator('#fab-wrap').is_hidden())
    page.locator('#rec-form [name=km]').fill('188300')
    page.locator('#rec-submit').click(); page.wait_for_timeout(250)
    w = page.evaluate('window.__writes')[-1]
    check('log: saved', w[0] == 'set' and w[2]['svc'] == ['front_diff'] and w[2]['km'] == 188300, w)
    check('log: back on /records with 6 cards', path() == '/records' and page.locator('#rec-list .rec').count() == 6)
    page.locator('.tabs a[href="/"]').click(); page.wait_for_timeout(150)
    check('log: next planned moved on', 'Мастило в задньому редукторі' in t('#h-next'), t('#h-next'))

    # --- кнопка «+»: нагадування ---
    page.locator('#fab').click(); page.wait_for_timeout(80)
    check('fab: menu', page.locator('#fab-menu').is_visible() and page.locator('#fab').get_attribute('aria-expanded') == 'true' and page.locator('#fab-menu a').count() == 2)
    page.keyboard.press('Escape'); page.wait_for_timeout(50)
    check('fab: Esc closes', page.locator('#fab-menu').is_hidden())
    page.locator('#fab').click(); page.locator('#fab-menu a[href="/create-reminder"]').click(); page.wait_for_timeout(200)
    check('fab → /create-reminder', path() == '/create-reminder' and t('#rem-title') == 'Нове нагадування' and page.locator('#rem-del').is_hidden())
    page.locator('#rem-form [name=title]').fill('Заміна мастила в редукторах'); page.locator('#rem-form [name=date]').fill('2026-12-10')
    page.locator('#rem-submit').click(); page.wait_for_timeout(250)
    check('reminder: saved, back home', path() == '/' and page.locator('#h-rem a.mlink').count() == 2 and 'Заміна мастила в редукторах' in t('#h-rem'))
    w = page.evaluate('window.__writes')[-1]
    check('reminder: new doc', w[1].startswith('reminders/m') and w[2]['done'] is False and w[2]['date'] == '2026-12-10', w)

    # --- редагування нагадування ---
    page.locator('#h-rem a[href="/create-reminder?id=m1"]').click(); page.wait_for_timeout(200)
    check('rem edit: filled', path() == '/create-reminder' and page.locator('#rem-form [name=title]').input_value() == 'Діагностика задньої підвіски' and page.locator('#rem-form [name=note]').input_value() == 'Шевчук' and t('#rem-title') == 'Редагувати нагадування')
    check('rem edit: done & delete shown', page.locator('#rem-done').is_visible() and page.locator('#rem-del').is_visible())
    page.locator('#rem-form [name=title]').fill('Діагностика задньої підвіски на СТО'); page.locator('#rem-submit').click(); page.wait_for_timeout(250)
    w = page.evaluate('window.__writes')[-1]
    check('rem edit: same id, fields kept', w[1] == 'reminders/m1' and w[2]['title'].endswith('на СТО') and w[2]['note'] == 'Шевчук' and w[2]['done'] is False and 'updatedAt' in w[2], w)
    page.locator('#h-rem a[href="/create-reminder?id=m1"]').click(); page.wait_for_timeout(200)
    page.locator('#rem-done').click(); page.wait_for_timeout(250)
    check('rem done: update + home', page.evaluate('window.__writes')[-1] == ['update', 'reminders/m1', {'done': True}] and path() == '/' and page.locator('#h-rem a.mlink').count() == 1)
    page.locator('#h-rem a.mlink').first.click(); page.wait_for_timeout(200)
    page.locator('#rem-del').click(); check('rem del: arms', t('#rem-del') == 'Точно видалити?')
    page.locator('#rem-del').click(); page.wait_for_timeout(250)
    check('rem del: no open reminders → block hidden', path() == '/' and page.locator('#h-rem-box').is_hidden())

    # --- записи: редагування з картки ---
    page.locator('.tabs a[href="/records"]').click(); page.wait_for_timeout(150)
    page.locator('[data-filter=repair]').click()
    check('records: filter repair', page.locator('#rec-list .rec').count() == 2)
    page.locator('[data-filter=all]').click()
    page.locator('#rec-list a[href="/create-fix?id=r20261119"]').click(); page.wait_for_timeout(200)
    rows = page.locator('#items-rows [data-row]')
    check('fix edit: filled', path() == '/create-fix' and t('#fix-title') == 'Редагувати запис' and rows.count() == 2)
    check('items: split into fields', rows.nth(0).locator('[data-k=n]').input_value() == 'Наконечник рульової тяги' and rows.nth(0).locator('[data-k=c]').input_value() == '35742 01'
          and rows.nth(0).locator('[data-k=p]').input_value() == '350' and rows.nth(0).locator('[data-k=s]').input_value() == 'Lemförder')
    check('items: sum hint', page.locator('#rec-form [name=total]').get_attribute('placeholder') == 'Сума рядків: 1\u00a0350\u00a0грн', page.locator('#rec-form [name=total]').get_attribute('placeholder'))
    page.locator('#item-add').click()
    check('items: add row', rows.count() == 3 and page.evaluate("document.activeElement.getAttribute('data-k')") == 'n' and t('#items-rows [data-row]:nth-child(3) [data-row-label]') == 'Рядок 3')
    rows.nth(2).locator('[data-k=c]').fill('35765 01'); page.locator('#rec-submit').click(); page.wait_for_timeout(150)
    check('items: name required', 'Вкажіть назву в рядку 3' in t('#rec-status'), t('#rec-status'))
    rows.nth(2).locator('[data-k=n]').fill('Сайлентблоки ×4'); rows.nth(2).locator('[data-k=p]').fill('3 200,50'); rows.nth(2).locator('[data-k=s]').fill('Lemförder')
    rows.nth(1).locator('[data-row-del]').click()
    check('items: delete row renumbers', rows.count() == 2 and t('#items-rows [data-row]:nth-child(2) [data-row-label]') == 'Рядок 2')
    page.locator('#rec-form [name=title]').fill('Передня підвіска'); page.locator('#rec-submit').click(); page.wait_for_timeout(250)
    w = page.evaluate('window.__writes')[-1]
    check('fix edit: same id, fields kept', w[1] == 'records/r20261119' and w[2]['title'] == 'Передня підвіска' and w[2]['total'] == 5250, w)
    check('items: saved structured', w[2]['items'] == [{'n': 'Наконечник рульової тяги', 'c': '35742 01', 'p': 350, 's': 'Lemförder'}, {'n': 'Сайлентблоки ×4', 'c': '35765 01', 'p': 3200.5, 's': 'Lemförder'}], w[2]['items'])
    check('records: kopecks shown', '3\u00a0200,50\u00a0грн' in t('#rec-list'))
    page.locator('#rec-list a[href="/create-fix?id=r20260624"]').click(); page.wait_for_timeout(200)
    check('items: text price kept in field', page.locator('#items-rows [data-row]').nth(1).locator('[data-k=p]').input_value() == '8 200 грн/л')
    page.locator('#rec-submit').click(); page.wait_for_timeout(250)
    w = page.evaluate('window.__writes')[-1]
    check('items: text price saved as pt', w[2]['items'][1] == {'n': 'Torsen', 'pt': '8 200 грн/л', 's': 'оригінал'}, w[2]['items'])
    d = page.locator('[data-del="records/r20261123"]'); d.click(); d.click(); page.wait_for_timeout(200)
    check('records: delete two-step', page.locator('#rec-list .rec').count() == 5)
    check('home flow: no errors', not errs, errs[:3])
    page.close()

    # --- планові ТО ---
    page, errs = open_app(ctx, 'in', '/planned-to')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('planned: direct load', page.locator('#planned').is_visible() and page.locator('.tabs a.on').get_attribute('data-tab') == 'home')
    rows = page.locator('#plan-list .yrow')
    check('planned: 11 rows', rows.count() == 11, rows.count())
    first = [rows.nth(i).locator('.ytitle').inner_text() for i in range(5)]
    check('planned: unknown first, in priority', first == ['Мастило в передньому редукторі', 'Мастило в задньому редукторі', 'Гальмівна рідина', 'Свічки запалювання', 'Охолоджувальна рідина двигуна'], first)
    atf = page.locator('#plan-list .yrow:has-text("Мастило в коробці передач")')
    check('planned: atf next due', 'Через 73 946 км або до 06.2034' in atf.inner_text(), atf.inner_text())
    check('planned: source shown', 'ZF' in atf.inner_text() and 'рекомендація' in page.locator('#plan-list .yrow:has-text("передньому")').inner_text())
    check('planned: ac without interval last', 'кондиціонера' in rows.nth(10).inner_text() and 'За станом' in rows.nth(10).inner_text())
    check('planned: oil card', t('#r-oil-km') == '7 636' and 'Пройдено 364' in page.locator('#r-oil-bar').get_attribute('aria-label'))
    page.locator('#oil-set [name=km]').fill('10000'); page.locator('#oil-set button').click(); page.wait_for_timeout(150)
    check('planned: interval saved', page.evaluate('window.__writes')[-1] == ['set', 'settings/main', {'oilIntervalKm': 10000, 'oilIntervalMonths': 12}])
    page.locator('#planned [data-back]').click(); page.wait_for_timeout(150)
    check('planned: back → home', page.evaluate('location.pathname') == '/')
    check('planned: no errors', not errs, errs[:3])
    page.close()

    # --- прямі адреси й старі посилання ---
    page, errs = open_app(ctx, 'in', '/create-fix', 'id=r20261119')
    page.wait_for_timeout(150)
    check('deep link: edit record loads after data', page.locator('#rec-form [name=title]').input_value() == 'Передня підвіска й розвал-сходження')
    page.goto(BASE + '/?mock=in&n=900#records'); page.wait_for_timeout(250)
    check('legacy #records → /records', page.evaluate('location.pathname') == '/records' and page.locator('#records').is_visible())
    page.goto(BASE + '/?mock=in&n=901#s-oil'); page.wait_for_timeout(250)
    check('legacy #s-oil → /catalog#s-oil', page.evaluate('location.pathname + location.hash') == '/catalog#s-oil' and page.locator('#catalog').is_visible())
    page.close()

    # --- профіль: експорт, вихід ---
    page, errs = open_app(ctx, 'in', '/profile')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('profile: who', t('#prof-name') == 'Vlad' and t('#prof-email') == 'vlad@example.com' and t('#prof-avatar') == 'V')
    check('profile: actions', all(page.locator(s).is_visible() for s in ('#acc-export', '#acc-import', '#acc-signout')) and page.locator('#acc-signin').is_hidden())
    check('profile: tab active', page.locator('.tabs a.on').get_attribute('href') == '/profile')
    check('version: hidden without version.json', page.locator('#prof-ver').is_hidden())
    with page.expect_download() as dl:
        page.locator('#acc-export').click()
    data = json.load(open(dl.value.path(), encoding='utf-8'))
    check('export: file', data['app'] == 'audi-a6' and len(data['records']) == 5 and len(data['reminders']) == 1)
    backup = os.path.join(tempfile.gettempdir(), 'audi-backup-test.json'); json.dump(data, open(backup, 'w', encoding='utf-8'), ensure_ascii=False)
    page.locator('#acc-signout').click(); page.wait_for_timeout(200)
    check('signout: profile shows sign-in', t('#prof-name') == 'Ви не увійшли' and page.locator('#acc-signin').is_visible() and page.evaluate('window.__unsubs') >= 3)
    check('profile: no errors', not errs, errs[:3])
    page.close()

    # --- версія сайту з version.json ---
    vctx = b.new_context(timezone_id='Europe/Kyiv')  # час версії показуємо по Києву
    page = vctx.new_page(); page.set_viewport_size({'width': 390, 'height': 844}); errs = setup(page)
    page.route('**/version.json', lambda r: r.fulfill(status=200, content_type='application/json',
        body='{"sha":"0e72acf1234567890","short":"0e72acf","time":"2026-11-28T11:30:00Z","run":3}'))
    page.goto(url('in', '/profile')); page.wait_for_timeout(400)
    v = page.locator('#prof-ver')
    check('version: shown in profile', v.is_visible() and v.inner_text() == 'Версія сайту: 0e72acf · 28.11.2026, 13:30', v.inner_text())
    check('refresh: button visible', page.locator('#app-refresh').is_visible() and 'btn-ghost' in page.locator('#app-refresh').get_attribute('class'))
    # оновлення: свіжі копії файлів в обхід кешу, перезавантаження, повідомлення
    # журнал fetch-ів у sessionStorage, щоб пережив перезавантаження
    page.evaluate("""() => { const f = window.fetch; window.fetch = (u, o) => {
        const log = JSON.parse(sessionStorage.getItem('fetchlog') || '[]'); log.push([String(u), (o && o.cache) || '']);
        sessionStorage.setItem('fetchlog', JSON.stringify(log)); return f(u, o); }; }""")
    with page.expect_navigation():
        page.locator('#app-refresh').click()
    page.wait_for_timeout(400)
    reqs = json.loads(page.evaluate("sessionStorage.getItem('fetchlog') || '[]'"))
    fresh = [u.replace(BASE, '') for u, c in reqs if c == 'reload']
    check('refresh: assets refetched bypassing cache', all(any(x in u for u in fresh) for x in ('/js/app.js', '/js/fb.js', '/js/config.js', '/css/app.css', '/profile', '/index.html')) and not any('version.json' in u for u in fresh), fresh)
    check('refresh: reloaded on profile with status', '/profile' in page.url and page.locator('#app-status').inner_text() == 'Застосунок оновлено.' and page.locator('#prof-name').inner_text() == 'Vlad', page.locator('#app-status').inner_text())
    page.reload(); page.wait_for_timeout(300)
    check('refresh: status not sticky', page.locator('#app-status').inner_text() == '')
    vctx.set_offline(True)
    page.locator('#app-refresh').click(); page.wait_for_timeout(200)
    check('refresh: offline keeps page', 'Немає з’єднання' in page.locator('#app-status').inner_text() and not page.locator('#app-refresh').is_disabled())
    vctx.set_offline(False)
    check('version: no errors', not errs, [e for e in errs if 'ERR_INTERNET_DISCONNECTED' not in e][:3] if errs else errs)
    page.close()

    # --- відкрита стара версія, на сервері нова ---
    page = vctx.new_page(); page.set_viewport_size({'width': 390, 'height': 844}); errs = setup(page)
    page.route('**/version.json', lambda r: r.fulfill(status=200, content_type='application/json',
        body='{"sha":"0e72acf1234567890","short":"0e72acf","time":"2026-11-28T11:30:00Z","run":3}'))
    OLD = open(os.path.join(PUBLIC, 'index.html'), encoding='utf-8').read().replace('name="app-version" content="dev"', 'name="app-version" content="1111111"')
    def old_html(r): r.fulfill(status=200, content_type='text/html; charset=utf-8', body=OLD)
    page.route(lambda u: '/profile?' in u, old_html)
    page.goto(url('in', '/profile')); page.wait_for_timeout(400)
    v = page.locator('#prof-ver')
    check('version: stale shows new one', v.inner_text() == 'Відкрита версія 1111111. Вийшла нова: 0e72acf · 28.11.2026, 13:30' and 'is-new' in v.get_attribute('class'), v.inner_text())
    check('version: stale highlights button', 'btn-primary' in page.locator('#app-refresh').get_attribute('class'))
    page.close(); vctx.close()

    # --- iPhone: відступ під статус-бар, навіть коли iOS віддає env(safe-area-inset-top)=0 ---
    IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    pad = lambda pg, sel: pg.evaluate("s => parseFloat(getComputedStyle(document.querySelector(s)).paddingTop)", sel)
    for name, vh, want in (('home screen app, full screen', 852, 24 + 59), ('Safari with toolbars', 759, 24)):
        ictx = b.new_context(user_agent=IOS, viewport={'width': 393, 'height': vh}, screen={'width': 393, 'height': 852})
        page = ictx.new_page(); errs = setup(page)
        page.goto(url('in', '/')); page.wait_for_timeout(300)
        hero, eyebrow = pad(page, '.hero-grid'), page.locator('.hero-head .eyebrow-s').bounding_box()
        page.goto(url('in', '/records')); page.wait_for_timeout(300)
        rec = pad(page, '[data-view="records"] .view-in')
        check('iphone top inset: ' + name, hero == want and rec == want and (vh != 852 or eyebrow['y'] >= 59), (hero, rec, eyebrow))
        check('iphone top inset: no errors (' + name + ')', not errs, errs[:3])
        ictx.close()

    # --- імпорт у порожню базу ---
    page, errs = open_app(ctx, 'empty', '/profile')
    t = lambda s: page.locator(s).first.inner_text().strip()
    page.locator('#acc-file').set_input_files(backup); page.wait_for_timeout(400)
    check('import: status', 'Підвантажено: 5 записів, 1 нагадування' in t('#acc-status'), t('#acc-status'))
    page.locator('.tabs a[href="/"]').click(); page.wait_for_timeout(200)
    check('import: home filled', t('#hero-title') == 'Готова до дороги' and page.locator('#h-last .mrow').count() == 3)
    check('import: no errors', not errs, errs[:3])
    page.close()

    # --- не увійшли ---
    page, errs = open_app(ctx, 'out')
    t = lambda s: page.locator(s).first.inner_text().strip()
    check('out: title + sign-in in hero', t('#hero-title') == 'Увійдіть, щоб відкрити журнал' and page.locator('.hero-signin').is_visible())
    check('out: fab hidden, reminders hidden', page.locator('#fab-wrap').is_hidden() and page.locator('#h-rem-box').is_hidden())
    page.locator('.hero-signin').click(); page.wait_for_timeout(300)
    check('out→in', t('#hero-title') == 'Готова до дороги' and page.locator('#fab').is_visible())
    check('out: no errors', not errs, errs[:3])
    page.close()

    page, errs = open_app(ctx, 'deny')
    check('deny: note', 'Немає доступу до бази' in page.locator('#db-note').inner_text())
    page.close()

    # --- каталог і авто ---
    page, errs = open_app(ctx, 'in', '/catalog')
    check('catalog: schemas', page.locator('#catalog').is_visible() and page.locator('#catalog .pfig svg').count() >= 10)
    btn = page.locator('#catalog .codebtn').first; code = btn.get_attribute('data-code'); btn.click(); page.wait_for_timeout(150)
    check('catalog: copy', page.evaluate('navigator.clipboard.readText()') == code)
    page.locator('.tabs a[href="/car"]').click(); page.wait_for_timeout(150)
    page.locator('#car [data-code]').click(); page.wait_for_timeout(150)
    check('car: VIN copy', page.evaluate('navigator.clipboard.readText()') == 'WAUGFAFC5FN016207')
    check('catalog/car: no errors', not errs, errs[:3])
    page.close()

    # --- верстка: переповнення, тач-цілі, сітка ---
    VIEWS = [('home', '/', ''), ('records', '/records', ''), ('planned', '/planned-to', ''), ('car', '/car', ''), ('catalog', '/catalog', ''),
             ('profile', '/profile', ''), ('fix', '/create-fix', 'id=r20261119'), ('remind', '/create-reminder', 'id=m1')]
    for wd in (320, 390, 768, 1024, 1280, 1440):
        for v, pth, q in VIEWS:
            page, errs = open_app(ctx, 'in', pth, q, '', wd, 900)
            ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check('layout %d %s: no overflow' % (wd, v), ov <= 0, ov)
            if v != 'catalog':
                small = page.evaluate(TAP_JS, '#' + v)
                check('layout %d %s: tap ≥44' % (wd, v), not small, small[:4])
            if wd in (390, 1280) and v != 'catalog':
                g = page.evaluate(GRID_JS, '#' + v)
                check('grid %d %s: 4px rhythm (%d boxes)' % (wd, v, g.get('n', 0)), g.get('count', 1) == 0, g.get('bad'))
            page.close()
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
