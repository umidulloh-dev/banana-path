# Задача для агента: сделать «Путь к банану» живым сайтом 24/7

## Что это
`public/index.html` — учебное приложение в стиле Duolingo (роадмап Node.js/TypeScript, уроки, генерируемые AI, проверка кода, чат с ментором, XP, серия дней). Сейчас оно написано под хостинг claude.ai и использует три платформенные функции, которых **нет вне claude.ai**:

| В коде сейчас | Что это делает | Чем заменить |
|---|---|---|
| `window.claude.use("sample")` → `sample(input, {onText, signal})` | Стриминговый ответ Claude (чат, ревью) | `POST /api/ai/chat` на бэкенде → Anthropic API со стримингом (SSE) |
| `sample.json(prompt, opts)` | Ответ Claude, распарсенный как JSON (генерация урока, проверка кода) | `POST /api/ai/json` → Anthropic API, парсинг и валидация (zod) на сервере |
| `window.claude.use("db")` + `use("user")` → `db.doc("data/users/<id>/progress")` | Сохранение прогресса пользователя | `GET/PUT /api/progress` → PostgreSQL |

Весь остальной фронтенд (карта, уроки, анимации, конфетти, звуки, тема) работает сам по себе и не требует изменений.

## Стек
- Бэкенд: **NestJS + TypeScript** (это часть роадмапа владельца, код должен быть учебно-чистым)
- БД: **PostgreSQL** + Prisma
- AI: официальный SDK `@anthropic-ai/sdk`, модель задаётся через env (`ANTHROPIC_MODEL`)
- Фронт: оставить `public/index.html` как статику (отдаёт NestJS через `ServeStaticModule`)
- Деплой: **Railway** (сервис + Postgres), Dockerfile, GitHub Actions (lint, test, build)

## Что сделать
1. **Проект NestJS** в `server/`: модули `ai`, `progress`, `auth`, `prisma`. Статика из `public/`.
2. **Auth**: сайт личный. Простой логин по паролю из env (`APP_PASSWORD`) → JWT в httpOnly cookie. Все `/api/*` закрыты guard'ом. (Опционально позже: Telegram Login.)
3. **AI-эндпоинты** (ключ `ANTHROPIC_API_KEY` только на сервере, никогда во фронте):
   - `POST /api/ai/chat` — body `{ messages: {role, content}[] }`, ответ — SSE-стрим текста. Поддержать отмену (клиент закрыл соединение → abort запроса к Anthropic).
   - `POST /api/ai/json` — body `{ prompt: string }`, ответ — JSON. Если модель вернула мусор — вырезать JSON из текста (как делает `sample.json`: весь ответ → блок в ```…``` → от первой `{`/`[` до последней `}`/`]`), иначе 422.
   - Кэш генерации уроков: одинаковый prompt → ответ из таблицы/Redis на 24 часа (сейчас так работает `cache: { gcTime: 86400000 }`).
   - Rate limit на AI-эндпоинты (например, 30 запросов в 10 минут) — защита от счёта на API.
4. **Progress**: таблица `Progress { userId, data Json, updatedAt }`. `GET /api/progress` и `PUT /api/progress` (тело — весь объект состояния `S` из фронта).
5. **Фронт** — минимальные правки в `index.html`:
   - Написать маленький адаптер `window.claude = { use }`, который отдаёт объекты с той же формой API, но ходит в наш бэкенд. Тогда остальной код не трогаем. Требования к адаптеру:
     - `sample(input, {onText, signal, cache})` → fetch `/api/ai/chat` со стримингом, `onText({text, delta})` где `text` — весь ответ на текущий момент; `input` может быть строкой или массивом `{role, content}`; на abort — reject `{code:"cancelled"}`; на ошибки — reject `{code, message}` (коды: `rate_limited`, `upstream_error`, `invalid_json`).
     - `sample.json(prompt, opts)` → `/api/ai/json`.
     - `db.doc(path)` → объект с `get()` (возвращает `{exists, data()}`) и `set(obj)` через `/api/progress`.
     - `user.id()` → id из `/api/me`.
   - Добавить экран логина (если `/api/me` вернул 401).
6. **Деплой**: Dockerfile (multi-stage), `docker-compose.yml` для локальной разработки (api + postgres), Railway, `.env.example`, миграции Prisma при старте.
7. **README на английском**: описание, скриншот, схема архитектуры, как запустить локально, CI-бейдж. Это портфолио-проект.

## Env
```
DATABASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
APP_PASSWORD=
JWT_SECRET=
PORT=3000
```

## Правила
- Ключ Anthropic и пароль — только в env, `.env` в `.gitignore`.
- Код строго типизирован, без `any`.
- Unit-тесты на парсер JSON и rate limit, e2e на `/api/progress`.
- Не переписывать дизайн и логику уроков во фронте без просьбы владельца.
