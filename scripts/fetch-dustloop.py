#!/usr/bin/env python3
"""Dustloop の Cargo API から GGST の全キャラのフレームデータを取得して
data/frames.js の FRAME_DATA に埋め込む。

使い方:
  python3 scripts/fetch-dustloop.py            # 取得して埋め込み
  python3 scripts/fetch-dustloop.py --from x.json  # 保存済み JSON から埋め込み（オフライン）

キャラ名の照合は data/characters.js の en フィールド（Dustloop の chara 名）で行う。
"""
import json, re, sys, pathlib, urllib.request, urllib.parse, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://www.dustloop.com/wiki/api.php"
FIELDS = "chara,name,input,startup,active,recovery,onBlock,onHit,guard,level"

def fetch_all():
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "action": "cargoquery", "tables": "MoveData_GGST", "fields": FIELDS,
            "limit": 500, "offset": offset, "format": "json"})
        with urllib.request.urlopen(API + "?" + q, timeout=60) as r:
            data = json.load(r)
        page = [x["title"] for x in data.get("cargoquery", [])]
        rows += page
        if len(page) < 500:
            return rows
        offset += 500

def strip(v):
    # Dustloop は一部フィールドに HTML を含むことがある
    return html.unescape(re.sub(r"<[^>]+>", "", str(v or ""))).strip()

def main():
    if "--from" in sys.argv:
        src = json.load(open(sys.argv[sys.argv.index("--from") + 1], encoding="utf-8"))
        rows = [x["title"] for x in src["cargoquery"]] if "cargoquery" in src else src
    else:
        rows = fetch_all()
    chars = (ROOT / "data/characters.js").read_text(encoding="utf-8")
    # "Asuka R#" / "Asuka R", "Bedman?" / "Bedman" のような表記揺れを吸収する
    key = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    by_en = {key(en): cid for cid, en in re.findall(r'id: "([^"]+)", en: "([^"]+)"', chars)}
    # 既に埋め込み済みのデータは残す（ページごとの取り込みに対応）
    fr0 = (ROOT / "data/frames.js").read_text(encoding="utf-8")
    m0 = re.search(r"const FRAME_DATA = (\{\}|\{.*?\n\});", fr0, re.S)
    out = json.loads(m0.group(1)) if m0 else {}
    # 同じ技（name+input）は上書き、無いものは追加。ページ境界でキャラが分断されても欠けない
    unknown = set()
    for r in rows:
        cid = by_en.get(key(strip(r.get("chara"))))
        if not cid:
            unknown.add(strip(r.get("chara"))); continue
        mv = {k: strip(r.get(k)) for k in
              ["name", "input", "startup", "active", "recovery", "onBlock", "onHit", "guard", "level"]}
        lst = out.setdefault(cid, [])
        i = next((i for i, m in enumerate(lst) if (m["name"], m["input"]) == (mv["name"], mv["input"])), None)
        if i is None: lst.append(mv)
        else: lst[i] = mv
    body = json.dumps(out, ensure_ascii=False, indent=1)
    fr = re.sub(r"const FRAME_DATA = (\{\}|\{.*?\n\});",
                lambda _: "const FRAME_DATA = " + body + ";", fr0, count=1, flags=re.S)
    (ROOT / "data/frames.js").write_text(fr, encoding="utf-8")
    print(f"{len(rows)} rows → {len(out)} chars:", ", ".join(sorted(out)))
    if unknown:
        print("unmatched chara names:", ", ".join(sorted(unknown)))

if __name__ == "__main__":
    main()
