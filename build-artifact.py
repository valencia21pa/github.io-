#!/usr/bin/env python3
"""index.html + style.css + data/*.js + app.js を 1 ファイルにまとめる。
claude.ai のアーティファクト用（doctype/head/body なしの断片）と、
単体配布用の完全な HTML（--full）の両方を出せる。"""
import re, sys, pathlib, base64, json

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "style.css").read_text(encoding="utf-8")
scripts = "\n".join((root / f).read_text(encoding="utf-8")
                    for f in ["data/characters.js", "data/aba.js", "data/drills.js", "data/frames.js", "data/puddle-seed.js", "app.js"])

title = re.search(r"<title>(.*?)</title>", html).group(1)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', html).group(0)
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'<script src="[^"]*"></script>\s*', "", body)
# ヒーロー画像をインライン化（アーティファクトは外部画像を読めない）
hero = root / ("assets/hero-small.jpg" if "--small-hero" in sys.argv else "assets/hero.jpg")
if hero.exists():
    body = body.replace('src="assets/hero.jpg"', 'src="data:image/jpeg;base64,' + base64.b64encode(hero.read_bytes()).decode() + '"')

# SDキャラを data URI で埋め込む（--sd-dir <dir> に webp/png があれば）
sd_js = ""
if "--sd-dir" in sys.argv:
    d = pathlib.Path(sys.argv[sys.argv.index("--sd-dir") + 1]); imgs = {}
    for f in sorted(d.iterdir()):
        if f.suffix in (".webp", ".png"):
            mime = "image/webp" if f.suffix == ".webp" else "image/png"
            imgs[f.stem] = f"data:{mime};base64," + base64.b64encode(f.read_bytes()).decode()
    sd_js = "const SD_IMAGES = " + json.dumps(imgs) + ";\n"
scripts = sd_js + scripts

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
