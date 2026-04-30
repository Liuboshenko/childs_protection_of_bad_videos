/*
 * Content Shield — content.js
 *
 * Извлечение channel ID:
 *  - Прямая загрузка: URL / мета-теги / inline scripts / DOM
 *  - SPA-навигация: постоянный хук в page world (INJECT_HOOK через background)
 *    хук слушает yt-page-data-updated и диспатчит CustomEvent "__shield_cid"
 *
 * Блокировка: background.js делает chrome.tabs.update — YouTube SPA не перебьёт.
 */

(function () {
  "use strict";

  // Логгер: активен только если SHIELD_CONFIG.debug === true (см. config.js)
  const log = (...a) => { if (typeof SHIELD_CONFIG !== "undefined" && SHIELD_CONFIG.debug) console.log("[Shield]", ...a); };

  let shortsBlocked  = false;
  let pageBlocked    = false;
  let lastCheckedUrl = "";
  let navId = 0;
  let pendingShieldCid = null; // сохраняет ID от __shield_cid пока pageBlocked = true

  // ── Безопасная отправка сообщений ────────────────────────────────────
  // Перехватывает "Extension context invalidated" когда расширение
  // перезагружают при открытой вкладке YouTube.

  function send(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) { if (cb) cb(null); return; }
        if (cb) cb(resp);
      });
    } catch (_) {
      if (cb) cb(null);
    }
  }

  // ── Конфиг ───────────────────────────────────────────────────────────

  function fetchConfig(cb) {
    send({ type: "GET_CONFIG" }, (resp) => {
      if (resp) shortsBlocked = !!resp.block_all_shorts;
      if (cb) cb();
    });
  }

  function maybeRedirectHome() {
    if (location.pathname === "/" && !location.search) {
      send({ type: "MAYBE_REDIRECT_HOME" });
      return true;
    }
    return false;
  }

  // ── Очистка поисковой строки после редиректа расширения ──────────────

  function clearSearchBarIfShieldRedirect() {
    if (location.hash !== "#shield-redirect") return;
    history.replaceState(null, "", location.pathname + location.search);
    log("shield redirect — scheduling search bar clears");

    // YouTube устанавливает значение инпута асинхронно через Polymer.
    // Очищаем в нескольких временных точках: до и после инициализации YouTube.
    [50, 200, 500, 900, 1500, 2500, 4000].forEach((delay) => {
      setTimeout(() => {
        document
          .querySelectorAll("input#search, input[name='search_query']")
          .forEach((el) => { if (el.value) el.value = ""; });
      }, delay);
    });
  }

  // ── Извлечение channel ID (sync) ─────────────────────────────────────

  function channelIdFromUrl(url) {
    const m = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
    return m ? m[1] : null;
  }

  function channelIdFromMeta() {
    const el = document.querySelector('meta[itemprop="channelId"]');
    if (el?.content) return el.content;
    const link = document.querySelector('link[rel="canonical"]');
    if (link) {
      const m = link.href.match(/\/channel\/(UC[\w-]{22})/);
      if (m) return m[1];
    }
    return null;
  }

  function channelIdFromScripts() {
    const currentVideoId = /^\/watch/.test(location.pathname)
      ? new URLSearchParams(location.search).get('v')
      : null;

    for (const s of document.querySelectorAll("script")) {
      const t = s.textContent;
      if (!t || t.length < 100) continue;
      if (currentVideoId !== null) {
        if (t.includes("ytInitialPlayerResponse") || t.includes("videoDetails")) {
          const vdIdx = t.indexOf('"videoDetails"');
          if (vdIdx === -1) continue;
          const slice = t.substring(vdIdx, Math.min(vdIdx + 1500, t.length));
          // При SPA-навигации <script> теги НЕ обновляются — в них остаётся
          // ytInitialPlayerResponse предыдущего видео. Проверяем videoId чтобы
          // не взять channelId из устаревших данных.
          if (!slice.includes(`"videoId":"${currentVideoId}"`) &&
              !slice.includes(`"videoId": "${currentVideoId}"`)) continue;
          const m = slice.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/);
          if (m) return m[1];
        }
      } else {
        const m = t.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function channelIdFromOwnerDom() {
    if (/^\/watch/.test(location.pathname)) {
      const currentVideoId = new URLSearchParams(location.search).get('v');
      if (currentVideoId) {
        // ytd-watch-flexy[video-id] обновляется YouTube'ом когда DOM переключается
        // на новое видео. Если атрибут есть но не совпадает — DOM ещё показывает
        // предыдущее видео, возвращаем null чтобы не взять чужой channel ID.
        const flexy = document.querySelector('ytd-watch-flexy');
        const domVideoId = flexy?.getAttribute('video-id');
        if (domVideoId && domVideoId !== currentVideoId) return null;
      }
    }

    const linkSelectors = [
      'ytd-video-owner-renderer a[href*="/channel/"]',
      '#owner a[href*="/channel/"]',
      'ytd-channel-name a[href*="/channel/"]',
      'ytd-video-secondary-info-renderer a[href*="/channel/"]',
      'ytd-c4-tabbed-header-renderer a[href*="/channel/"]',
    ];
    for (const sel of linkSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = (el.getAttribute("href") || "").match(/\/channel\/(UC[\w-]{22})/);
        if (m) return m[1];
      }
    }
    const scanSelectors = [
      "ytd-video-owner-renderer", "#owner",
      "ytd-watch-metadata", "ytd-video-secondary-info-renderer",
    ];
    for (const sel of scanSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const m = el.innerHTML.match(/\/channel\/(UC[\w-]{22})/);
      if (m) return m[1];
    }
    return null;
  }

  // ── Блокировка — редирект через background.tabs.update ───────────────

  function blockIfNeeded(channelId) {
    if (!channelId || pageBlocked) return;
    log("blockIfNeeded →", channelId);
    pageBlocked = true;
    lastCheckedUrl = location.href;
    send(
      { type: "CHECK_AND_BLOCK", channelId, url: location.href },
      (resp) => {
        if (!resp?.blocked) {
          pageBlocked = false;
          // lastCheckedUrl НЕ сбрасываем — иначе MutationObserver создаёт бесконечный цикл.
          // Правильные ретраи обеспечивает videoId-проверка в channelIdFromScripts():
          // при устаревших скриптах она вернёт null → DOM-извлечение сработает когда страница загрузится.
          if (pendingShieldCid) {
            const cid = pendingShieldCid;
            pendingShieldCid = null;
            blockIfNeeded(cid);
          }
        } else {
          log("blocked →", resp.name);
        }
      }
    );
  }

  // ── Хук из page world → channelId при SPA-навигации ─────────────────

  document.addEventListener("__shield_cid", (e) => {
    log("__shield_cid →", e.detail);
    if (pageBlocked) {
      // Сохраняем ID пока blockIfNeeded ждёт ответа от background
      pendingShieldCid = e.detail || null;
      return;
    }
    blockIfNeeded(e.detail || null);
  });

  // ── Проверка при прямой загрузке / резервная ─────────────────────────

  function isChannelOrVideoPage() {
    const p = location.pathname;
    return (
      /^\/channel\//.test(p) ||
      /^\/c\//.test(p) ||
      /^\/@/.test(p) ||
      /^\/watch/.test(p)
    );
  }

  function isShortsUrl() {
    return /\/shorts(\/|$)/.test(location.pathname);
  }

  function checkCurrentPage() {
    log("checkCurrentPage →", location.pathname);
    if (pageBlocked) return;

    if (shortsBlocked && isShortsUrl()) {
      pageBlocked = true;
      send({ type: "BLOCK_TAB", name: "YouTube Shorts", url: location.href, isShorts: true });
      return;
    }

    if (!isChannelOrVideoPage()) return;
    if (location.href === lastCheckedUrl) return;

    const channelId =
      channelIdFromUrl(location.href) ||
      channelIdFromMeta() ||
      channelIdFromScripts() ||
      channelIdFromOwnerDom();

    log("sync extraction →", channelId ?? "null");
    if (channelId) blockIfNeeded(channelId);
  }

  // ── Фильтрация ленты и рекомендаций ─────────────────────────────────

  function filterFeed() {
    if (pageBlocked) return;

    if (shortsBlocked) {
      document.querySelectorAll(
        "ytd-reel-shelf-renderer, ytd-reel-item-renderer"
      ).forEach((el) => {
        if (!el.dataset.shieldShortsHidden) {
          el.style.display = "none";
          el.dataset.shieldShortsHidden = "1";
          el.dataset.shieldChecked = "1";
        }
      });
    }

    const selectors = [
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-reel-item-renderer",
    ];

    const items = document.querySelectorAll(selectors.join(","));
    if (!items.length) return;

    const toCheck = new Map();

    items.forEach((item) => {
      if (item.dataset.shieldChecked) return;

      const links = item.querySelectorAll('a[href*="/channel/"], a[href*="/@"]');
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const m = href.match(/\/channel\/(UC[\w-]{22})/);
        if (m) { toCheck.set(item, m[1]); break; }
      }

      if (!toCheck.has(item)) {
        const m = item.innerHTML.match(/\/channel\/(UC[\w-]{22})/);
        if (m) toCheck.set(item, m[1]);
      }
    });

    if (!toCheck.size) return;

    const ids = [...new Set(toCheck.values())];

    send({ type: "CHECK_BATCH", ids }, (resp) => {
      if (!resp) return;
      const blocked = resp.blocked || {};
      toCheck.forEach((channelId, el) => {
        el.dataset.shieldChecked = "1";
        if (blocked[channelId.toLowerCase()]) el.style.display = "none";
      });
    });
  }

  function revealShorts() {
    document.querySelectorAll("[data-shield-shorts-hidden]").forEach((el) => {
      el.style.display = "";
      delete el.dataset.shieldShortsHidden;
      delete el.dataset.shieldChecked;
    });
  }

  // ── SPA-навигация YouTube ────────────────────────────────────────────

  function onNavigate() {
    log("navigate →", location.href);
    clearSearchBarIfShieldRedirect();
    pageBlocked    = false;
    lastCheckedUrl = "";
    const myId = ++navId;

    fetchConfig(() => {
      if (navId !== myId) return;
      if (maybeRedirectHome()) return;

      [0, 500, 1500].forEach((delay) => {
        setTimeout(() => {
          if (navId !== myId || pageBlocked) return;
          checkCurrentPage();
        }, delay);
      });
    });
  }

  document.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("yt-navigate-start", () => {
    pageBlocked    = false;
    lastCheckedUrl = "";
  });

  const origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    setTimeout(onNavigate, 200);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    setTimeout(onNavigate, 200);
  };

  window.addEventListener("popstate", () => setTimeout(onNavigate, 200));

  // ── CONFIG_UPDATED от popup ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "CONFIG_UPDATED") return;
    const prev = shortsBlocked;
    shortsBlocked = !!msg.block_all_shorts;

    if (prev && !shortsBlocked) {
      revealShorts();
    } else if (!prev && shortsBlocked) {
      filterFeed();
      if (isShortsUrl() && !pageBlocked) {
        pageBlocked = true;
        send({ type: "BLOCK_TAB", name: "YouTube Shorts", url: location.href, isShorts: true });
      }
    }
  });

  // ── MutationObserver ─────────────────────────────────────────────────

  let filterTimer = null;

  function scheduleFilter() {
    if (filterTimer) return;
    filterTimer = setTimeout(() => {
      filterTimer = null;
      filterFeed();
    }, 500);
  }

  const observer = new MutationObserver((mutations) => {
    if (pageBlocked) return;
    for (const mut of mutations) {
      if (mut.addedNodes.length > 0) {
        scheduleFilter();
        if (!lastCheckedUrl) checkCurrentPage();
        break;
      }
    }
  });

  // ── Запуск ───────────────────────────────────────────────────────────

  function init() {
    log("init →", location.href);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    send({ type: "INJECT_HOOK" });

    fetchConfig(() => {
      if (maybeRedirectHome()) return;
      checkCurrentPage();
      setTimeout(filterFeed, 1000);
      setTimeout(filterFeed, 3000);
    });
  }

  // Проверяем хэш немедленно при document_start — до DOMContentLoaded,
  // пока YouTube ещё не успел выполнить свой код и изменить location.hash.
  clearSearchBarIfShieldRedirect();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
