# caldav-mcp — Technical Requirements

## Цель

Легковесный MCP-сервер на Deno/TypeScript для CalDAV (события + задачи). Работает без npm/node_modules, без внешних MCP-прокси, без ебани с патчами. Просто запустил — работает.

---

## Транспорт

### stdio (основной) — для OpenCode/Claude Desktop/Cursor
- MCP protocol по stdio (JSON-RPC 2.0)
- Отвечает на `tools/list`, `tools/call`
- Standard MCP lifecycle: `initialize` → `tools/list` → `tools/call` → shutdown

### HTTP (опционально) — для OpenWebUI/n8n
- Express/Katana/либой сервер на порту из env PORT (default 3000)
- SSE-эндпоинт `/mcp` для MCP-over-SSE
- Bearer token авторизация из env `MCP_BEARER_TOKEN`
- Rate limiting: 100 req/min

---

## Философия — AI-first, а не API-first

Этот сервер для ИИ, а не для людей. Люди могут пощелкать по кнопкам, ИИ — нет.
Поэтому:

1. **calendarUrl опционален везде.** Если не указан — шерстим все календари сами.
   ИИ не должен делать N запросов чтобы получить все задачи. Он делает 1 запрос — получает всё.
2. **Ответы — с суммаризацией.** `query_todos` возвращает не просто список, а:
   - Общее количество
   - Разбивку по статусам (NEEDS-ACTION / IN-PROCESS / COMPLETED)
   - По приоритетам (high/medium/low)
   - Просроченные (overdue)
   - Сами объекты (с summary, priority, status, due, url)
3. **Нет лишних сущностей.** `list_todos` и `query_todos` — одно и то же.
   `query_todos` без параметров возвращает всё. С параметрами — фильтрует.
4. **Быстро.** 170 задач — ничто. Один REPORT на календарь (14 штук), конкурентно.
   Даже с XML-парсингом это < 1 секунды.

---

## CalDAV протокол

Используем **прямые HTTP-запросы** к CalDAV-серверу (Radicale), без tsdav.
CalDAV — это просто HTTP с XML-телами. Нехуй тащить библиотеку, которая не работает.

### Методы HTTP
- `PROPFIND` — получение коллекций (календари, свойства)
- `REPORT` с `calendar-query` — поиск событий/задач с фильтрацией по типу
- `PUT` — создание/обновление iCal-объектов
- `DELETE` — удаление

### XML тела
Все XML-запросы генерировать руками через `XMLSerializer` или собирать строкой.
Schema: `urn:ietf:params:xml:ns:caldav`, `DAV:`

### Аутентификация
- Basic Auth: `Authorization: Basic base64(user:pass)`
- Из env: `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD`

### VTODO фильтрация
**Критично:** `calendar-query` REPORT должен включать фильтр по компоненту.
Без фильтра tsdav и подобные либы по умолчанию шлют `comp-filter name="VEVENT"`.
А надо слать:
```xml
<C:filter>
  <C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VTODO"/>
  </C:comp-filter>
</C:filter>
```
Тогда сервер вернет только VTODO, а не всё подряд.

Для VEVENT аналогично, но `name="VEVENT"`.

А если надо и то и другое — убрать вложенный `comp-filter` или слать два запроса конкурентно.

### Кверка по всем календарям
Самый частый сценарий: "дай все мои задачи". Делаем:
1. PROPFIND на `CALDAV_URL` чтобы получить список календарей
2. Для каждого календаря с нужным `supported-calendar-component-set` — REPORT calendar-query
3. ВСЕ запросы параллельно (`Promise.all`)
4. Склеиваем результаты, сортируем по priority/status/due

---

### iCal форматирование (RFC 5545)
- **Content line length:** макс 75 октетов. Длинные строки (SUMMARY, DESCRIPTION) фолдить:
  ```
  DESCRIPTION:Это очень длинное описание которое не влезает
    в 75 символов и должно быть разбито на несколько строк
  ```
  Каждая продолженная строка начинается с пробела.
- Экранирование: `\\` `\;` `\,` `\n`
- Обязательные поля VTODO: `UID`, `DTSTAMP`, `SUMMARY`, `STATUS`
- Обязательные поля VEVENT: `UID`, `DTSTAMP`, `SUMMARY`, `DTSTART`
- Времена в UTC с суффиксом `Z`

### Парсинг iCal на выходе
При чтении (list/query) — парсим iCal в JSON и отдаем ИИ структурированные данные, не сырой iCal.
Поля: `summary`, `description`, `status`, `priority`, `due`, `completed`, `percentComplete`, `url`, `etag`, `calendarName`.

---

## MCP Tools — полный список

### Календари
| Tool | Описание | Вход |
|------|----------|------|
| `list_calendars` | Список календарей с компонентами и цветом | — |
| `make_calendar` | Создать новый календарь | `displayName`, `components[]`, `color?`, `description?` |

### Задачи (VTODO) — приоритет
| Tool | Описание | Вход |
|------|----------|------|
| `query_todos` | **Главный.** Ищет задачи по всем календарям (или одному). Возвращает суммаризацию + список. Фильтры: status, priority, dueBefore, dueAfter, text, calendarUrl. Без фильтров — все задачи. | Все поля опциональны |
| `get_todo` | Одна задача по URL | `url` |
| `create_todo` | Создать задачу | `calendarUrl`, `summary`, `description?`, `due?`, `priority?`, `status?`, `percentComplete?` |
| `update_todo` | Обновить поля | `url`, `etag`, поля |
| `delete_todo` | Удалить | `url`, `etag` |

### События (VEVENT)
| Tool | Описание | Вход |
|------|----------|------|
| `query_events` | **Главный.** Ищет события по всем календарям (или одному). Фильтры: dateFrom, dateTo, text, calendarUrl. Без фильтров — все события. | Все поля опциональны |
| `get_event` | Одно событие по URL | `url` |
| `create_event` | Создать событие | `calendarUrl`, `summary`, `start`, `end`, `description?`, `location?` |
| `update_event` | Обновить поля | `url`, `etag`, поля |
| `delete_event` | Удалить | `url`, `etag` |

### Примеры query-запросов
```
query_todos({})                                → все 170 задач со статистикой
query_todos({status: "NEEDS-ACTION"})           → только невыполненные
query_todos({priority: {min: 1, max: 3}})       → высокоприоритетные (1-3)
query_todos({status: "NEEDS-ACTION", priority: {min: 1, max: 3}})  → важные невыполненные
query_todos({dueBefore: new Date().toISOString()})  → просроченные
query_todos({text: "upwork"})                   → поиск по тексту в summary/description
query_events({dateFrom: "...", dateTo: "..."})  → события в диапазоне
query_events({text: "meeting"})                 → события с "meeting"
```

### Формат ответа для query_todos
```json
{
  "total": 170,
  "byStatus": {"NEEDS-ACTION": 45, "IN-PROCESS": 12, "COMPLETED": 108, "CANCELLED": 5},
  "byPriority": {"high": 8, "medium": 30, "low": 24, "none": 108},
  "overdue": 3,
  "todos": [
    {
      "summary": "Publish website",
      "status": "NEEDS-ACTION",
      "priority": 2,
      "due": "2026-06-20T09:00:00Z",
      "calendarName": "AntonShubin.com",
      "url": "http://...",
      "etag": "\"...\""
    }
  ]
}
```
Поле `todos` содержит до 200 объектов (хватит с головой). Если больше — в `truncated: true` и количество. ИИ может потом сделать `query_todos` с более узким фильтром.

### Формат ответа для query_events
```json
{
  "total": 42,
  "upcoming": 5,
  "events": [
    {
      "summary": "30 min meeting with Artem",
      "start": "2026-06-20T13:00:00Z",
      "end": "2026-06-20T13:30:00Z",
      "location": "Google Meet",
      "calendarName": "Main Calendar",
      "url": "http://..."
    }
  ]
}
```

---

## Конфигурация (env)

```env
CALDAV_URL=http://hl-radicale:5232          # Внутренний Docker URL
CALDAV_USERNAME=spy4x
CALDAV_PASSWORD=...

# HTTP транспорт (опционально)
PORT=3000
MCP_BEARER_TOKEN=mcpo-local

# Логирование
LOG_LEVEL=info                               # debug | info | warn | error
```

## Структура проекта

```
caldav-mcp/
├── main.ts                 # Точка входа — парсит аргументы, запускает stdio или HTTP
├── mcp.ts                 # MCP protocol handler (JSON-RPC, tools/list, tools/call)
├── caldav/
│   ├── client.ts          # HTTP-клиент для CalDAV (PROPFIND, REPORT, PUT, DELETE)
│   ├── xml.ts             # Формирование XML тел запросов
│   ├── types.ts           # Типы: Calendar, Event, Todo
│   ├── ical.ts            # Формирование/парсинг iCal (RFC 5545), line folding
│   └── query.ts           # Логика "запросить все календари" + параллельные запросы + агрегация
├── tools/
│   ├── calendars.ts       # list_calendars, make_calendar
│   ├── events.ts          # query_events, get_event, create/update/delete
│   ├── todos.ts           # query_todos, get_todo, create/update/delete
│   └── index.ts           # Регистрация всех tools
├── env.ts                 # Чтение env с дефолтами
├── Dockerfile              # Multistage: build → distroless runtime
├── compose.yml             # Для деплоя в homelab stack
├── deno.jsonc
└── README.md
```

---

## Критерии готовности (DoD)

1. [x] `list_calendars` — показывает все 15 календарей с компонентами и ctag
2. [x] `query_todos({})` — возвращает все 438 задач с суммаризацией (byStatus, byPriority, overdue)
3. [x] `query_todos({status: "NEEDS-ACTION", priority: {min:1, max:3}})` — только важные невыполненные (14 задач)
4. [x] `query_todos({text: "..."})` — поиск по тексту в summary/description
5. [x] `query_todos({dueBefore: "..."})` — просроченные задачи (11 найдено)
6. [x] `create_todo` с summary, description, priority, status, due — создается, читается с ETag
7. [x] `update_todo` — обновление полей по url+etag
8. [x] `delete_todo` — удаление по url+etag
9. [x] `query_events` — все события (5), фильтры dateFrom/dateTo/text работают
10. [x] `create_event` + delete — создание и удаление событий
11. [x] stdio транспорт: MCP lifecycle работает (initialize → tools/list → tools/call)
12. [x] HTTP транспорт: работает напрямую (MCP POST /mcp), без mcpo
13. [x] Нет npm/node_modules, одна команда: `deno run -A main.ts`
14. [x] Длинные описания сохраняются корректно (iCal folding RFC 5545 — тест 200 символов)

---

## FAQ / Пояснения

### Dockerfile + compose.yml
Будут сразу. Dockerfile — multistage: сначала `deno compile` в бинарник, потом distroless scratch.
compose.yml — подключается к proxy сети, пробрасывает env, лимиты 128M/0.25 CPU (бинарник легкий).

### make_calendar
Добавим. Полезно когда ИИ хочет создать отдельный калаендарик под проект:
```
make_calendar({displayName: "Project Luna", components: ["VTODO"], color: "#FF542B"})
```

### WebDAV — что это
**WebDAV** (RFC 4918) — это HTTP-расширение которое позволяет читать/писать/искать файлы на сервере через HTTP.
PROPFIND, PROPPATCH, MKCOL, MOVE, COPY — это всё WebDAV методы.

**CalDAV** (RFC 4791) — это WebDAV + календари. Добавляет REPORT с calendar-query,
типы VEVENT/VTODO/VJOURNAL, iCalendar формат.

**CardDAV** (RFC 6352) — это WebDAV + контакты. Добавляет addressbook-query, vCard формат.

То есть WebDAV — это фундамент. CalDAV/CardDAV — надстройки.
Наш сервер использует WebDAV методы (PROPFIND, REPORT, PUT, DELETE) но по CalDAV-схемам.

Так что "WebDAV sync не нужен" в том смысле что мы не делаем файловый менеджер. Только календари/задачи.

### Многопользовательность
В текущем контексте: MCP-сервер подключается к ОДНОМУ CalDAV-серверу с ОДНИМ логином/паролем.

Radicale (наш CalDAV сервер) сам многопользовательский — у него есть spy4x, galina и т.д.
Но MCP-сервер видит только то, что видит пользователь spy4x.

**Как сделать многопользовательским:**
- MCP-сервер принимает credentials от ИИ-клиента
- При каждом запросе логинится в Radicale под нужным юзером
- ИЛИ хранит сессию — один раз залогинился, работает

**Зачем:**
- Если кто-то еще захочет спрашивать "мои задачи" через OpenWebUI
- Но сейчас это не нужно — у тебя один аккаунт, все задачи твои

**Когда понадобится:**
- Когда второй пользователь захочет подключиться
- Тогда добавляем env: `CALDAV_AUTH_MODE=session` и endpoint `/login`
- Либо просто второй экземпляр MCP-сервера для другого пользователя
- **Сейчас: один юзер, все просто.**

### Best Practices — какие соблюдаем

**MCP Protocol:**
- Правильный lifecycle: initialize → готовность → tools/list → tools/call → shutdown
- Корректные JSON-RPC 2.0 ответы (id, result, error)
- Progress notifications для долгих операций (если > 2 сек)
- Resource-friendly: закрываем соединения, не течем

**CalDAV/RFC:**
- CORRECT `calendar-query` с `comp-filter` (не как tsdav — по дефолту VEVENT)
- iCal line folding по RFC 5545 (75 октетов)
- Правильные ETag для update/delete (If-Match)
- Конкурентные запросы (Promise.all) не блокируют друг друга

**Deno/TypeScript:**
- Типы — строгие, без `any`
- Deno std/http для HTTP-транспорта
- Deno std/parseCli для аргументов
- fetch() для CalDAV запросов (встроен в Deno)
- Deno.test() — будут тесты

**Безопасность:**
- Пароль только из env, не в лог, не в ответы
- iCal экранирование (sanitize) при создании — предотвратить инъекции
- Bearer token для HTTP транспорта
- Rate limiting на HTTP

---

## Что не нужно (out of scope)

- CardDAV (контакты) — потом, если понадобится
- OAuth2 — только Basic Auth, без гугл-календарей
- "WebDAV sync" в смысле файловый менеджер — не надо
- Многопользовательность пока — один юзер, один экземпляр
- OpenAPI spec generation — OpenWebUI подключается через mcpo, тот сам конвертит MCP → OpenAPI
