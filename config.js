// ═══════════════════════════════════════════════════════════════
//  Content Shield — конфигурация
//
//  Формат: JavaScript (поддерживает комментарии, грузится в оба
//  контекста: content script и background service worker).
//
//  После изменения любого параметра:
//    chrome://extensions → Content Shield → кнопка ↺ (перезагрузить)
// ═══════════════════════════════════════════════════════════════

/* global var — доступна в content.js и background.js без import */
// eslint-disable-next-line no-var
var SHIELD_CONFIG = {

  // ── Логирование ────────────────────────────────────────────
  //
  //  false  — логи выключены (режим продакшн, без шума в консоли)
  //  true   — подробные логи:
  //             • вкладка YouTube → F12 → Console: логи content script
  //             • chrome://extensions → Service Worker → Inspect: логи background
  //
  debug: true,

};
