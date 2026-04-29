# Content Shield

Расширение Chrome для родительского контроля YouTube.  
Блокирует видео и каналы из чёрного списка, а также YouTube Shorts.

---

## Развёртывание в браузере

### 1. Загрузка расширения

1. Открыть в Chrome: `chrome://extensions`
2. Включить переключатель **«Режим разработчика»** (правый верхний угол)
3. Нажать **«Загрузить распакованное»**
4. Выбрать папку `content-shield-ext`

Расширение появится в списке. Иконка щита появится на панели инструментов.

### 2. Импорт чёрного списка

1. Кликнуть на иконку расширения → откроется попап
2. Нажать кнопку **«Загрузить JSON»** и выбрать файл `black_list.json`
3. Дождаться сообщения «Загружено: N каналов»

> Список сохраняется в `chrome.storage.local` и переживает перезапуск браузера.

### 3. Перезагрузка после изменений

При изменении любого файла расширения:

```
chrome://extensions → Content Shield → кнопка ↺
```

После перезагрузки **обязательно перезагрузить уже открытые вкладки YouTube**.

---

## Управление логированием

Система логирования управляется флагом в файле **`config.js`**:

```js
var SHIELD_CONFIG = {
  debug: false,  // ← сюда
};
```

| Значение | Поведение |
|----------|-----------|
| `false`  | Логи выключены (режим продакшн) |
| `true`   | Подробные логи во всех контекстах |

### Где смотреть логи

**Content script** (логи вкладки YouTube):
- Открыть вкладку YouTube → `F12` → вкладка **Console**
- Фильтр: `[Shield]`

**Background / Service Worker** (логи блокировщика):
- `chrome://extensions` → Content Shield → **«Inspect views: Service Worker»**
- Фильтр: `[Shield BG]`

### Что логируется при `debug: true`

| Лог | Значение |
|-----|----------|
| `init → url` | Content script загружен на странице |
| `navigate → url` | SPA-переход YouTube |
| `checkCurrentPage → path` | Запущена синхронная проверка |
| `sync extraction → ID` | Channel ID найден sync-методами |
| `__shield_cid → ID` | Channel ID от хука (SPA-навигация) |
| `blockIfNeeded → ID` | Отправляется запрос блокировки |
| `blocked → name` | Background подтвердил блокировку |
| `[Shield BG] config loaded` | Каналов/флаг Shorts загружено |
| `[Shield BG] CHECK_AND_BLOCK` | Проверка канала в базе |
| `[Shield BG] INJECT_HOOK` | Установка page-world хука |

---

## Структура файлов

```
content-shield-ext/
├── manifest.json      — конфиг расширения (MV3)
├── config.js          — флаг debug и другие настройки
├── background.js      — service worker: хранит список, блокирует через tabs.update
├── content.js         — content script: детектирует channel ID, триггерит блокировку
├── popup.html/js      — интерфейс: статистика, импорт списка, тоггл Shorts
├── blocked.html/js    — страница-заглушка (показывается вместо заблокированного контента)
├── black_list.json    — чёрный список каналов (импортируется через попап)
└── extract_id.py      — утилита для получения channel ID по URL видео
```

---

## Получение channel ID

Для добавления нового канала в чёрный список:

```bash
python3 extract_id.py https://www.youtube.com/watch?v=VIDEO_ID
```

Вывод:
```
Channel ID: UCxxxxxxxxxxxxxxxxxxxxxxxxx
{"id": "UCxxxxxxxxxxxxxxxxxxxxxxxxx", "name": "", "reason": ""}
```

Скопировать строку JSON в `black_list.json` → секция `channels` → импортировать через попап.

---

## Как работает блокировка

```
Прямая навигация (/channel/UCxxx, /shorts/)
  └─ webNavigation.onBeforeNavigate → chrome.tabs.update → blocked.html

SPA-переход (клик на видео из поиска/рекомендаций)
  └─ page-world хук слушает yt-page-data-updated
     → читает ytInitialPlayerResponse.videoDetails.channelId
     → CustomEvent "__shield_cid"
     → content.js CHECK_AND_BLOCK → background chrome.tabs.update → blocked.html

Прямая загрузка видео по URL
  └─ content.js читает channelId из inline <script> тегов
     → CHECK_AND_BLOCK → background chrome.tabs.update → blocked.html
```
