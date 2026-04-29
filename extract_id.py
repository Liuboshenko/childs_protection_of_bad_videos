#!/usr/bin/env python3
"""
Извлечение YouTube channel ID из ссылки.

Использование:
    python3 extract_id.py "https://www.youtube.com/@SomeChannel"
    python3 extract_id.py "https://www.youtube.com/channel/UCxxxxx"
    python3 extract_id.py "https://youtu.be/VIDEO_ID"
"""

import sys
import re
import urllib.request


def fetch(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_channel_id(url):
    """Вернуть (channel_id, channel_name) или (None, None)."""

    # 1) Прямая ссылка /channel/UCxxxx
    m = re.search(r"youtube\.com/channel/(UC[\w-]{22})", url)
    if m:
        return m.group(1), None

    # 2) Ссылка /@handle, /c/name, /user/name — нужно загрузить страницу
    if re.search(r"youtube\.com/(@[\w.-]+|c/[\w.-]+|user/[\w.-]+)", url):
        html = fetch(url)
        # ищем channelId в JSON/мета-тегах
        for pat in [
            r'"channelId"\s*:\s*"(UC[\w-]{22})"',
            r'"externalId"\s*:\s*"(UC[\w-]{22})"',
            r'<meta\s+itemprop="channelId"\s+content="(UC[\w-]{22})"',
        ]:
            ch = re.search(pat, html)
            if ch:
                # имя канала
                nm = re.search(r'"name"\s*:\s*"([^"]+)"', html)
                name = nm.group(1) if nm else None
                return ch.group(1), name
        return None, None

    # 3) Ссылка на видео youtu.be/xxx или youtube.com/watch?v=xxx
    #    загружаем страницу и берём channelId автора видео
    if "youtu.be/" in url or "watch" in url:
        html = fetch(url)
        ch = re.search(r'"channelId"\s*:\s*"(UC[\w-]{22})"', html)
        if ch:
            nm = re.search(r'"ownerChannelName"\s*:\s*"([^"]+)"', html)
            name = nm.group(1) if nm else None
            return ch.group(1), name
        return None, None

    return None, None


def main():
    if len(sys.argv) < 2:
        print("Использование: python3 extract_id.py <youtube_url>")
        sys.exit(1)

    url = sys.argv[1]
    print(f"URL: {url}")

    try:
        cid, name = extract_channel_id(url)
    except Exception as e:
        print(f"Ошибка: {e}")
        sys.exit(1)

    if cid:
        print(f"Channel ID: {cid}")
        if name:
            print(f"Имя канала: {name}")
        print(f"\nДля добавления в black_list.json:")
        print(f'{{"id": "{cid}", "name": "{name or ""}", "reason": ""}}')
    else:
        print("Не удалось извлечь channel ID.")
        sys.exit(1)


if __name__ == "__main__":
    main()
