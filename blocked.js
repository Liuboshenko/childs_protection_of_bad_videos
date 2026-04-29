const p = new URLSearchParams(location.search);
document.getElementById("name").textContent = p.get("name") || "";

if (p.get("type") === "shorts") {
  document.getElementById("title").textContent = "Shorts заблокированы";
  document.getElementById("subtitle").textContent =
    "Просмотр YouTube Shorts заблокирован родительским контролем.";
}
