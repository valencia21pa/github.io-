#!/usr/bin/env python3
"""index.html + style.css + data/*.js + app.js を 1 ファイルにまとめる。
claude.ai のアーティファクト用（doctype/head/body なしの断片）と、
単体配布用の完全な HTML（--full）の両方を出せる。"""
import re, sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "style.css").read_text(encoding="utf-8")
scripts = "\n".join((root / f).read_text(encoding="utf-8")
                    for f in ["data/characters.js", "data/aba.js", "data/drills.js", "data/frames.js", "app.js"])

title = re.search(r"<title>(.*?)</title>", html).group(1)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', html).group(0)
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'<script src="[^"]*"></script>\s*', "", body)

head = f"<title>{title}</title>\n{fonts}\n<style>\n{css}</style>\n"
tail = f"<script>\n{scripts}\n</script>\n"

full = "--full" in sys.argv
out = pathlib.Path(sys.argv[-1]) if len(sys.argv) > 1 and not sys.argv[-1].startswith("--") else None
if full:
    page = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + head + "</head>\n<body>" + body + tail + "</body>\n</html>\n")
else:
    page = head + body + tail
(out or sys.stdout).write_text(page, encoding="utf-8") if out else sys.stdout.write(page)
