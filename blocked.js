const p = new URLSearchParams(location.search);
const name = p.get("name");
const type = p.get("type");

if (name) {
  const tag = document.getElementById("channelTag");
  tag.textContent = "🚫 " + name;
  tag.style.display = "inline-block";
}

if (type === "shorts") {
  document.getElementById("title").textContent = "Shorts пока закрыты! 🌟";
  document.getElementById("subtitle").innerHTML =
    "YouTube Shorts закрыт с заботой о тебе.<br>Лучше посмотри что-нибудь доброе и полезное!";
}

// Floating particles
const GLYPHS = ["⭐","🌟","✨","💫","🌈","🎈","💎","🌸","🦋","🎉","🌻","🎀","🍀","🐣","🏆"];
for (let i = 0; i < 22; i++) {
  const el = document.createElement("span");
  el.className = "particle";
  el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  el.style.left      = Math.random() * 100 + "vw";
  el.style.fontSize  = (11 + Math.random() * 22) + "px";
  el.style.animationDuration = (6 + Math.random() * 12) + "s";
  el.style.animationDelay   = (Math.random() * 10) + "s";
  document.body.appendChild(el);
}
