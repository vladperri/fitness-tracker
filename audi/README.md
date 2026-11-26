# Моя Audi A6 C7

Журнал обслуговування, нагадування й каталог запчастин для Audi A6 C7 2.0 TFSI quattro (2015, ринок США).
Стиль — дизайн-система A6 Luce: темний бордо, сітка 4/8 px, усе натискне ≥ 44 px.

## Що де лежить

```
audi/
  public/               ← це й публікується на Firebase Hosting
    index.html          екрани: Головна, Записи, Нагадування, Авто, Каталог; вікно «Що купити»
    css/app.css         стилі (токени A6 Luce + окремий блок для каталогу)
    js/info.js          довідник замін: що і де міняти, що купити, номери деталей
    js/app.js           логіка екранів
    js/catalog.js       схеми кріплень у каталозі
    js/fb.js            вхід через Google і Firestore
    js/config.js        конфіг Firebase (той самий проєкт, що й трекери)
  firebase.json         хостинг на окремому сайті vlad-audi-a6, щоб не зачепити трекери
  firestore.rules.audi  блок правил для розділу audi — додається вручну в консолі
  tests/                перевірка в браузері з моком Firebase
```

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
4. **Деплой** (на Mac, з цієї папки):
   ```
   cd audi
   npx firebase-tools login
   npx firebase-tools deploy --only hosting
   ```
5. Відкрийте https://vlad-audi-a6.web.app → «Увійти через Google» → Обліковий запис → «Відновити з файлу»
   і виберіть `audi-a6-backup-….json`, щоб перенести записи зі старої версії.

Далі після змін достатньо кроку 4. `firebase.json` деплоїть лише хостинг: правила Firestore звідси не перезаписуються.

## Локально

```
cd audi/public && python3 -m http.server 8080    # http://localhost:8080
```
Вхід через Google на `localhost` працює, якщо `localhost` є в Authorized domains (є за замовчуванням).

## Тести

```
cd audi
pip install playwright && python -m playwright install chromium
python tests/run.py     # 140 перевірок: функції, вікно «Що купити», вхід/вихід, імпорт/експорт,
                        # переповнення 320–1440 px, тач-цілі ≥ 44 px, вертикальний ритм 4 px
```
