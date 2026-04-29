// popup.js — Content Shield popup logic

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
    if (chrome.runtime.lastError || !r || !r.ok) {
      // Откатываем состояние при ошибке
      toggle.checked = !toggle.checked;
    }
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
