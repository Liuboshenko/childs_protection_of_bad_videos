// popup.js — Content Shield popup logic

function setBlacklistIndicator(channelCount) {
  const status = document.getElementById("blStatus");
  const text   = document.getElementById("blText");
  if (channelCount > 0) {
    status.className = "bl-status loaded";
    text.textContent = "✓ Чёрный список активен · " + channelCount + " каналов";
  } else {
    status.className = "bl-status empty";
    text.textContent = "↑ Чёрный список не загружен";
  }
}

function setSearchListIndicator(count) {
  const status = document.getElementById("slStatus");
  const text   = document.getElementById("slText");
  if (count > 0) {
    status.className = "bl-status loaded";
    text.textContent = "✓ Список поиска активен · " + count + " запросов";
  } else {
    status.className = "bl-status empty";
    text.textContent = "↑ Список поиска не загружен";
  }
}

function loadStats() {
  chrome.runtime.sendMessage({ type: "STATS" }, (r) => {
    if (chrome.runtime.lastError) {
      console.error("[popup] STATS error:", chrome.runtime.lastError.message);
      return;
    }
    if (!r) return;

    document.getElementById("nCh").textContent = r.channels;
    document.getElementById("nBl").textContent = r.blocked;
    document.getElementById("shortsToggle").checked = !!r.block_all_shorts;
    document.getElementById("searchToggle").checked = !!r.search_from_list;
    setBlacklistIndicator(r.channels);
    setSearchListIndicator(r.search_list_count || 0);

    const el = document.getElementById("log");
    if (!r.recent || r.recent.length === 0) {
      el.innerHTML = '<div class="le" style="color:#475569">Нет записей</div>';
    } else {
      el.innerHTML = r.recent
        .map((e) => {
          const t = new Date(e.time).toLocaleString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          });
          return '<div class="le">' + t + " — " + e.channel + "</div>";
        })
        .join("");
    }
  });
}

loadStats();

// Переключатель блокировки Shorts
document.getElementById("shortsToggle").addEventListener("change", (e) => {
  const toggle = e.target;
  toggle.disabled = true;
  chrome.runtime.sendMessage({ type: "TOGGLE_SHORTS", value: toggle.checked }, (r) => {
    toggle.disabled = false;
    if (chrome.runtime.lastError || !r || !r.ok) toggle.checked = !toggle.checked;
  });
});

// Переключатель поиска по детскому списку
document.getElementById("searchToggle").addEventListener("change", (e) => {
  const toggle = e.target;
  toggle.disabled = true;
  chrome.runtime.sendMessage({ type: "TOGGLE_SEARCH_LIST", value: toggle.checked }, (r) => {
    toggle.disabled = false;
    if (chrome.runtime.lastError || !r || !r.ok) toggle.checked = !toggle.checked;
  });
});

// Импорт чёрного списка
document.getElementById("f").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const msg = document.getElementById("msg");
  msg.className = "msg";
  msg.style.display = "block";
  msg.style.background = "#1e293b";
  msg.style.color = "#94a3b8";
  msg.textContent = "Загрузка...";

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    try {
      const parsed = JSON.parse(text);
      if (!parsed.channels) {
        msg.className = "msg err";
        msg.textContent = 'Ошибка: в JSON нет поля "channels"';
        return;
      }
    } catch (parseErr) {
      msg.className = "msg err";
      msg.textContent = "Ошибка JSON: " + parseErr.message;
      return;
    }
    chrome.runtime.sendMessage({ type: "IMPORT", json: text }, (r) => {
      if (chrome.runtime.lastError) {
        msg.className = "msg err";
        msg.textContent = "Ошибка: " + chrome.runtime.lastError.message;
        return;
      }
      if (r && r.ok) {
        msg.className = "msg ok";
        msg.textContent = "Загружено: " + r.count + " каналов";
        setBlacklistIndicator(r.count);
        setTimeout(loadStats, 500);
      } else {
        msg.className = "msg err";
        msg.textContent = "Ошибка: " + (r ? r.error : "нет ответа от background");
      }
    });
  };
  reader.onerror = () => {
    msg.className = "msg err";
    msg.textContent = "Не удалось прочитать файл";
  };
  reader.readAsText(file);
});

// Импорт списка поиска
document.getElementById("sf").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const smsg = document.getElementById("smsg");
  smsg.className = "msg";
  smsg.style.display = "block";
  smsg.style.background = "#1e293b";
  smsg.style.color = "#94a3b8";
  smsg.textContent = "Загрузка...";

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    try {
      const parsed = JSON.parse(text);
      if (!parsed.search_list || !Array.isArray(parsed.search_list)) {
        smsg.className = "msg err";
        smsg.textContent = 'Ошибка: в JSON нет массива "search_list"';
        return;
      }
    } catch (parseErr) {
      smsg.className = "msg err";
      smsg.textContent = "Ошибка JSON: " + parseErr.message;
      return;
    }
    chrome.runtime.sendMessage({ type: "IMPORT_SEARCH_LIST", json: text }, (r) => {
      if (chrome.runtime.lastError) {
        smsg.className = "msg err";
        smsg.textContent = "Ошибка: " + chrome.runtime.lastError.message;
        return;
      }
      if (r && r.ok) {
        smsg.className = "msg ok";
        smsg.textContent = "Загружено: " + r.count + " запросов";
        setSearchListIndicator(r.count);
        setTimeout(loadStats, 500);
      } else {
        smsg.className = "msg err";
        smsg.textContent = "Ошибка: " + (r ? r.error : "нет ответа от background");
      }
    });
  };
  reader.onerror = () => {
    smsg.className = "msg err";
    smsg.textContent = "Не удалось прочитать файл";
  };
  reader.readAsText(file);
});
