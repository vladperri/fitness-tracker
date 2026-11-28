# Моя Audi A6 C7

Журнал обслуговування, нагадування й каталог запчастин для Audi A6 C7 2.0 TFSI quattro (2015, ринок США).
Стиль — дизайн-система A6 Luce: темний бордо, сітка 4/8 px, усе натискне ≥ 44 px.

## Що де лежить

```
audi/
  public/               ← це й публікується на Firebase Hosting
    index.html          екрани й вікно «Що купити» (одна сторінка, маршрути — справжні адреси)
    css/app.css         стилі (токени A6 Luce + окремий блок для каталогу)
    js/info.js          довідник замін: що і де міняти, що купити, номери, інтервали регламенту
    js/app.js           логіка екранів
    js/catalog.js       схеми кріплень у каталозі
    js/fb.js            вхід через Google і Firestore
    js/config.js        конфіг Firebase (той самий проєкт, що й трекери)
  firebase.json         хостинг на окремому сайті vlad-audi-a6, будь-яка адреса віддає index.html
  firestore.rules.audi  блок правил для розділу audi — додається вручну в консолі
  tests/                перевірка в браузері з моком Firebase
```

## Сторінки

| Адреса | Що там |
|---|---|
| `/` | Головна: пробіг і км до заміни мастила, нагадування (якщо є), наступне планове ТО, 3 останні записи |
| `/planned-to` | Усі планові ТО: що, де, коли наступна заміна, інтервал і його джерело; інтервал мастила в двигуні |
| `/records` | Журнал записів із фільтрами |
| `/create-fix`, `/create-fix?id=…` | Новий запис / редагування |
| `/create-reminder`, `/create-reminder?id=…` | Нове нагадування / редагування, «виконано», видалення |
| `/car`, `/catalog` | Дані з наклейки, каталог запчастин |
| `/profile` | Хто увійшов, резервна копія, підвантажити дані, вихід |

Кнопка «+» (головна, записи, планові ТО) відкриває вибір: нагадування чи запис.
Старі адреси з `#` (`#records`, `#s-oil`…) перенаправляються на нові.

## Дані

Firestore, проєкт `fitness-tracker-7ef81`, окремий розділ:

```
audi/{uid}/records/{id}     записи журналу
audi/{uid}/reminders/{id}   нагадування
audi/{uid}/settings/main    інтервал заміни мастила в двигуні
```

Трекери (`users`, `workouts`, …) і медкартка (`medkartka`) цей розділ не бачать і не чіпають.
Резервна копія: Головна → Обліковий запис → «Зберегти резервну копію» / «Відновити з файлу».

## Перший запуск (один раз)

1. **Сайт хостингу.** Firebase Console → Hosting → *Add another site* → ID `vlad-audi-a6`.
   Якщо ID зайнятий, візьміть інший і поміняйте `"site"` у `firebase.json`.
2. **Домен для входу.** Authentication → Settings → *Authorized domains* → додайте `vlad-audi-a6.web.app`.
3. **Правила Firestore.** Firestore Database → Rules → вставте блок із `firestore.rules.audi`
   **всередину** наявного `match /databases/{database}/documents { … }` і натисніть *Publish*.
   Наявні правила трекерів і медкартки не видаляйте.
4. **Деплой** вручну (на Mac, з цієї папки) — або автоматично, див. нижче:
   ```
   cd audi
   npx firebase-tools login
   npx firebase-tools deploy --only hosting
   ```
5. Відкрийте https://vlad-audi-a6.web.app → «Увійти через Google» → Обліковий запис → «Відновити з файлу»
   і виберіть `audi-a6-backup-….json`, щоб перенести записи зі старої версії.

Далі після змін достатньо кроку 4. `firebase.json` деплоїть лише хостинг: правила Firestore звідси не перезаписуються.

## Автодеплой через GitHub Actions

`.github/workflows/audi-deploy.yml` у корені репозиторію: після кожного пушу в гілку `audi-a6`, що зачіпає `audi/`,
GitHub проганяє `tests/run.py`, і якщо все зелене — деплоїть хостинг на https://vlad-audi-a6.web.app.
Запустити вручну: GitHub → Actions → «audi — тести й деплой» → *Run workflow*.
Перед деплоєм workflow пише `public/version.json` (коміт і час) і ставить той самий коміт у `<meta name="app-version">` в `index.html`.
У Профілі видно «Версія сайту: abc1234 · дата»; якщо відкрита сторінка старша за сервер — «Вийшла нова», і кнопка «Оновити застосунок» підсвічується.
Кнопка завантажує свіжі копії файлів сайту в обхід кешу браузера й перезавантажує сторінку; дані Firestore не чіпає.

Потрібен секрет `FIREBASE_SERVICE_ACCOUNT_FITNESS_TRACKER_7EF81` (один раз). Без нього тести йдуть, а деплой пропускається.

**Варіант А — з Mac (сервісний акаунт лише з правами на хостинг):**
```
cd ~/fitness-tracker/audi && git pull
npx firebase-tools init hosting:github
```
Репозиторій — `vladperri/fitness-tracker`. На питання про build-скрипт і про деплой після злиття PR відповідайте **No**:
робочий процес уже є. Команда сама створить сервісний акаунт і додасть секрет у GitHub.
Файли, які вона запише в `audi/.github/`, не потрібні (вони в `.gitignore`).

**Варіант Б — через браузер:** Firebase Console → ⚙ Project settings → Service accounts → *Generate new private key*.
GitHub → репозиторій → Settings → Secrets and variables → Actions → *New repository secret*:
ім'я `FIREBASE_SERVICE_ACCOUNT_FITNESS_TRACKER_7EF81`, значення — увесь вміст завантаженого JSON. Сам файл потім видаліть.
Цей ключ має ширші права (Admin SDK), тож варіант А безпечніший.

## Локально

```
cd audi && npx serve -s public     # -s: будь-яка адреса віддає index.html, як на Firebase
```
Вхід через Google на `localhost` працює, якщо `localhost` є в Authorized domains (є за замовчуванням).

## Тести

```
cd audi
pip install playwright && python -m playwright install chromium
python tests/run.py     # 197 перевірок: сторінки й маршрути, «+», регламент, вікно «Що купити», вхід/вихід, імпорт/експорт,
                        # переповнення 320–1440 px, тач-цілі ≥ 44 px, вертикальний ритм 4 px
```
