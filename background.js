/*
 * Content Shield — background.js
 *
 * Хранит чёрный список channel ID и флаг блокировки Shorts в chrome.storage.local.
 * Отвечает на запросы от content.js и popup.html.
 */

importScripts("config.js");

// Логгер: активен только если SHIELD_CONFIG.debug === true
const log = (...a) => { if (SHIELD_CONFIG.debug) console.log("[Shield BG]", ...a); };

let blockedChannels = new Map(); // id (lowercase) → name
let blockAllShorts  = true;
let searchList      = []; // {num_entry, weight, request}[]
let searchFromList  = true;

// ── Загрузка конфига из storage ──────────────────────────────

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["blacklist", "block_all_shorts", "search_list", "search_from_list"],
      async (result) => {
        const data = result.blacklist;
        blockedChannels.clear();
        if (data && Array.isArray(data.channels)) {
          for (const ch of data.channels) {
            blockedChannels.set(ch.id.toLowerCase(), ch.name || ch.id);
          }
        }

        if (result.block_all_shorts === undefined) {
          blockAllShorts = true;
          chrome.storage.local.set({ block_all_shorts: true });
        } else {
          blockAllShorts = !!result.block_all_shorts;
        }

        const sl = result.search_list;
        searchList = (sl && Array.isArray(sl.search_list)) ? sl.search_list : [];

        if (result.search_from_list === undefined) {
          searchFromList = true;
          chrome.storage.local.set({ search_from_list: true });
        } else {
          searchFromList = !!result.search_from_list;
        }

        // Если список пуст — загружаем дефолтный бандлированный файл
        if (!searchList.length) {
          try {
            const resp = await fetch(chrome.runtime.getURL("searching_list.json"));
            const defaultData = await resp.json();
            if (defaultData && Array.isArray(defaultData.search_list)) {
              searchList = defaultData.search_list;
              chrome.storage.local.set({ search_list: defaultData });
              log("default search list loaded:", searchList.length);
            }
          } catch (e) {
            log("default search list fetch error:", e);
          }
        }

        log("config loaded → channels:", blockedChannels.size,
            "| shorts:", blockAllShorts,
            "| searchList:", searchList.length,
            "| searchFromList:", searchFromList);
        resolve();
      }
    );
  });
}

loadConfig();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.blacklist)        loadConfig();
  if (changes.block_all_shorts) blockAllShorts = !!changes.block_all_shorts.newValue;
  if (changes.search_list) {
    const sl = changes.search_list.newValue;
    searchList = (sl && Array.isArray(sl.search_list)) ? sl.search_list : [];
  }
  if (changes.search_from_list) searchFromList = !!changes.search_from_list.newValue;
});

// ── Взвешенный случайный выбор из search_list ────────────────

function weightedRandom(list) {
  const total = list.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of list) {
    r -= (e.weight || 1);
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

// ── Проверка channel ID ─────────────────────────────────────

function checkChannel(channelId) {
  if (!channelId) return null;
  const id = channelId.toLowerCase();
  return blockedChannels.has(id) ? blockedChannels.get(id) : null;
}

// ── Перехват прямой навигации (до загрузки страницы) ─────────

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;

    // Редирект главной страницы YouTube на целевой поиск
    if (searchFromList && searchList.length > 0) {
      try {
        const u = new URL(details.url);
        if (/youtube\.com$/i.test(u.hostname) && u.pathname === "/" && !u.search) {
          const entry = weightedRandom(searchList);
          const searchUrl =
            "https://www.youtube.com/results?search_query=" +
            encodeURIComponent(entry.request) + "#shield-redirect";
          chrome.tabs.update(details.tabId, { url: searchUrl });
          log("search redirect →", entry.request);
          return;
        }
      } catch (_) {}
    }

    if (blockAllShorts && /youtube\.com\/shorts(\/|$)/i.test(details.url)) {
      const blockUrl =
        chrome.runtime.getURL("blocked.html") +
        "?name=" + encodeURIComponent("YouTube Shorts") +
        "&type=shorts";
      chrome.tabs.update(details.tabId, { url: blockUrl });
      logBlock("YouTube Shorts", details.url);
      return;
    }

    const m = details.url.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
    if (!m) return;
    const name = checkChannel(m[1]);
    if (name) {
      const blockUrl =
        chrome.runtime.getURL("blocked.html") +
        "?name=" + encodeURIComponent(name);
      chrome.tabs.update(details.tabId, { url: blockUrl });
      logBlock(name, details.url);
    }
  },
  { url: [{ hostSuffix: "youtube.com" }] }
);

// ── Лог блокировок ──────────────────────────────────────────

function logBlock(channelName, url) {
  const entry = { time: new Date().toISOString(), channel: channelName, url: url || "" };
  chrome.storage.local.get("blockLog", (r) => {
    const log = r.blockLog || [];
    log.push(entry);
    if (log.length > 500) log.splice(0, log.length - 500);
    chrome.storage.local.set({ blockLog: log });
  });
}

// ── Уведомление вкладок YouTube ─────────────────────────────

function notifyYoutubeTabs(payload) {
  chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, payload, () => {
        if (chrome.runtime.lastError) { /* вкладка без content script */ }
      });
    }
  });
}

// ── Единый обработчик сообщений ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "CHECK") {
    const name = checkChannel(msg.channelId);
    sendResponse({ blocked: !!name, name });
    return true;
  }

  // Проверка канала + редирект на blocked.html через tabs.update
  if (msg.type === "CHECK_AND_BLOCK") {
    const name = checkChannel(msg.channelId);
    log("CHECK_AND_BLOCK →", msg.channelId, "| blocked:", !!name);
    if (!name) { sendResponse({ blocked: false }); return true; }
    logBlock(name, msg.url);
    const blockUrl =
      chrome.runtime.getURL("blocked.html") +
      "?name=" + encodeURIComponent(name);
    if (sender.tab?.id) chrome.tabs.update(sender.tab.id, { url: blockUrl });
    sendResponse({ blocked: true, name });
    return true;
  }

  // Прямой редирект на blocked.html (шортсы из content script)
  if (msg.type === "BLOCK_TAB") {
    if (!sender.tab?.id) { sendResponse({ ok: false }); return true; }
    logBlock(msg.name, msg.url);
    const blockUrl =
      chrome.runtime.getURL("blocked.html") +
      "?name=" + encodeURIComponent(msg.name) +
      (msg.isShorts ? "&type=shorts" : "");
    chrome.tabs.update(sender.tab.id, { url: blockUrl });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CHECK_BATCH") {
    const results = {};
    for (const id of (msg.ids || [])) {
      const name = checkChannel(id);
      if (name) results[id.toLowerCase()] = name;
    }
    sendResponse({ blocked: results });
    return true;
  }

  if (msg.type === "LOG_BLOCK") {
    logBlock(msg.name, msg.url);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "IMPORT") {
    try {
      const data = JSON.parse(msg.json);
      if (!data.channels || !Array.isArray(data.channels)) {
        sendResponse({ ok: false, error: "Нет массива channels в JSON" });
        return true;
      }
      const shortsFlag = !!data.block_all_shorts;
      chrome.storage.local.set({ blacklist: data, block_all_shorts: shortsFlag }, () => {
        blockedChannels.clear();
        for (const ch of data.channels) {
          blockedChannels.set(ch.id.toLowerCase(), ch.name || ch.id);
        }
        blockAllShorts = shortsFlag;
        notifyYoutubeTabs({ type: "CONFIG_UPDATED", block_all_shorts: blockAllShorts });
        sendResponse({ ok: true, count: data.channels.length, block_all_shorts: shortsFlag });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  if (msg.type === "GET_CONFIG") {
    sendResponse({ block_all_shorts: blockAllShorts, search_from_list: searchFromList });
    return true;
  }

  if (msg.type === "IMPORT_SEARCH_LIST") {
    try {
      const data = JSON.parse(msg.json);
      if (!data.search_list || !Array.isArray(data.search_list)) {
        sendResponse({ ok: false, error: 'Нет массива "search_list" в JSON' });
        return true;
      }
      chrome.storage.local.set({ search_list: data }, () => {
        searchList = data.search_list;
        sendResponse({ ok: true, count: data.search_list.length });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  if (msg.type === "TOGGLE_SEARCH_LIST") {
    searchFromList = !!msg.value;
    chrome.storage.local.set({ search_from_list: searchFromList }, () => {
      notifyYoutubeTabs({ type: "CONFIG_UPDATED", block_all_shorts: blockAllShorts, search_from_list: searchFromList });
      sendResponse({ ok: true, value: searchFromList });
    });
    return true;
  }

  if (msg.type === "MAYBE_REDIRECT_HOME") {
    if (searchFromList && searchList.length > 0 && sender.tab?.id) {
      const entry = weightedRandom(searchList);
      const searchUrl =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(entry.request) + "#shield-redirect";
      chrome.tabs.update(sender.tab.id, { url: searchUrl });
      log("SPA home redirect →", entry.request);
      sendResponse({ redirected: true, query: entry.request });
    } else {
      sendResponse({ redirected: false });
    }
    return true;
  }

  // Установка постоянного хука в page world для SPA-навигации.
  // Хук читает ytInitialPlayerResponse и диспатчит __shield_cid CustomEvent.
  if (msg.type === "INJECT_HOOK") {
    const tabId = sender.tab?.id;
    log("INJECT_HOOK → tabId:", tabId);
    if (!tabId) { sendResponse({ ok: false }); return true; }
    chrome.scripting.executeScript(
      {
        target: { tabId },
        world: "MAIN",
        func: () => {
          if (window.__shieldHooked) return;
          window.__shieldHooked = true;

          let lastReported = null;

          function reportChannel() {
            try {
              let id = null;

              // Приоритет 1: YouTube player API — всегда отражает текущее видео,
              // обновляется при SPA-навигации независимо от глобальных переменных.
              const player = document.querySelector('#movie_player');
              if (typeof player?.getPlayerResponse === 'function') {
                id = player.getPlayerResponse()?.videoDetails?.channelId || null;
              }

              // Приоритет 2: JS-свойство ytd-watch-flexy (Polymer data binding)
              if (!id) {
                const flexy = document.querySelector('ytd-watch-flexy');
                id = flexy?.playerData?.videoDetails?.channelId || null;
              }

              // Приоритет 3: глобальная переменная (только при первоначальной загрузке)
              if (!id) {
                id = window.ytInitialPlayerResponse?.videoDetails?.channelId || null;
              }

              if (id && id !== lastReported) {
                lastReported = id;
                document.dispatchEvent(new CustomEvent("__shield_cid", { detail: id }));
              }
            } catch (e) {}
          }

          function reportChannelWithRetry() {
            [0, 150, 500, 1200, 2500].forEach(ms => setTimeout(reportChannel, ms));
          }

          document.addEventListener("yt-navigate-start", () => { lastReported = null; });

          reportChannel();
          document.addEventListener("yt-page-data-updated", reportChannelWithRetry);
        },
      },
      () => { sendResponse({ ok: !chrome.runtime.lastError }); }
    );
    return true;
  }

  if (msg.type === "TOGGLE_SHORTS") {
    blockAllShorts = !!msg.value;
    chrome.storage.local.set({ block_all_shorts: blockAllShorts }, () => {
      notifyYoutubeTabs({ type: "CONFIG_UPDATED", block_all_shorts: blockAllShorts, search_from_list: searchFromList });
      sendResponse({ ok: true, value: blockAllShorts });
    });
    return true;
  }

  if (msg.type === "STATS") {
    chrome.storage.local.get("blockLog", (r) => {
      sendResponse({
        channels: blockedChannels.size,
        blocked: (r.blockLog || []).length,
        recent: (r.blockLog || []).slice(-20).reverse(),
        block_all_shorts: blockAllShorts,
        search_from_list: searchFromList,
        search_list_count: searchList.length,
      });
    });
    return true;
  }

  return true;
});
