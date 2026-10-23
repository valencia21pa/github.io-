// ---- 定数 ----
const NOTE_FIELDS = [
  { key: "neutral", label: "立ち回り", ph: "距離ごとの振る技、相手の牽制への対応など" },
  { key: "punish",  label: "確定反撃", ph: "例：〇〇ガード後 → 近S始動" },
  { key: "danger",  label: "警戒する技・連携", ph: "相手が多用する技、分からん殺しなど" },
  { key: "oki",     label: "起き攻め・防御", ph: "相手の起き攻めの択、自分が通しやすい起き攻め" },
  { key: "memo",    label: "その他メモ", ph: "ランクマで気づいたことなど" },
];

// 負け・ピンチの原因タグ
const CAUSES = [
  "対空できず", "投げ抜け失敗", "固めから抜けられず", "確反を逃した", "起き攻めで負け",
  "中下段ガードミス", "表裏ガードミス", "バーストを読まれた", "無駄な暴れ", "距離管理ミス",
  "飛び道具に負け", "壁際で崩された", "ゲージ管理ミス", "コンボミス", "分からん殺し",
];

const DL_URL = 'https://www.dustloop.com/wiki/api.php?action=cargoquery&tables=MoveData_GGST&fields=chara,name,input,startup,active,recovery,onBlock,onHit,guard,level&where=chara%3D%22A.B.A%22&limit=500&format=json';

const STORE_KEY = "ggst-matchup-v1";
const DEFAULT_STATE = () => ({ mine: "aba", opp: "sol", custom: [], pairs: {}, log: [], frames: {}, puddle: [], puddleMeta: {}, globalDrills: [], globalChecks: {} });

// Puddle Farm のキャラ略号 → このツールの id
const PUDDLE_CODES = { SO: "sol", KY: "ky", MA: "may", AX: "axl", CH: "chipp", PO: "potemkin", FA: "faust", MI: "millia", ZA: "zato", RA: "ramlethal", LE: "leo", NA: "nagoriyuki", GI: "giovanna", AN: "anji", IN: "ino", GO: "goldlewis", JC: "jacko", HA: "chaos", BA: "baiken", TE: "testament", BI: "bridget", SI: "sin", BE: "bedman", AS: "asuka", JN: "johnny", EL: "elphelt", AB: "aba", SL: "slayer", DI: "dizzy", VE: "venom", UN: "unika", LU: "lucy", JA: "jam", RK: "roboky" };
const PUDDLE_ID = (code) => PUDDLE_CODES[code] || null;
let state = DEFAULT_STATE();

// ---- 保存・読み込み ----
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = Object.assign(DEFAULT_STATE(), JSON.parse(raw));
  } catch (e) { /* ストレージ不可の環境ではメモリのみで動作 */ }
  // 旧バージョンの手動カウント(wins/losses)はそのまま「過去分」として集計に含める
}
let savedTimer;
function save(showMark) {
  state.updatedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  cloudQueue();
  if (showMark) {
    const m = document.getElementById("savedMark");
    m.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => m.classList.remove("show"), 1200);
  }
}

// ---- クラウド保存（アーティファクトの db）----
// ブラウザ内保存（localStorage）はアプリ側の都合で消えることがあるので、
// アーティファクト上では db にも同じ内容を保存し、起動時に新しい方を採用する
const SYNC_KEYS = ["mine", "opp", "custom", "pairs", "log", "puddle", "puddleMeta", "globalDrills", "globalChecks", "updatedAt"];
let cloudDoc = null, cloudTimer = null, cloudBusy = false, cloudDirty = false, cloudState = "off";
function setCloud(s, msg) { cloudState = s; const el = $("cloudStatus"); if (el) { el.textContent = msg; el.className = "muted cloud " + s; } }
function pickSync(src) { const o = {}; for (const k of SYNC_KEYS) if (src[k] !== undefined) o[k] = src[k]; return o; }
function cloudQueue() {
  if (!cloudDoc) return;
  cloudDirty = true; clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudFlush, 1200);
}
async function cloudFlush() {
  if (!cloudDoc || cloudBusy || !cloudDirty) return;
  cloudBusy = true; cloudDirty = false;
  try { await cloudDoc.set(pickSync(state)); setCloud("ok", "クラウド保存：同期済み " + new Date().toLocaleTimeString()); }
  catch (e) { cloudDirty = true; setCloud("err", "クラウド保存：失敗（" + (e?.code || e?.message || e) + "）。ブラウザ内には保存されています"); }
  cloudBusy = false;
  if (cloudDirty) cloudQueue();
}
// 2つの保存内容を結合する。newer の値を優先し、ログ（id）・練習項目（title）・メモは older にしか無い分も残す
function mergeStates(older, newer) {
  const out = Object.assign({}, older, newer);
  const byKey = (a, b, key) => { const m = new Map(); for (const x of a || []) m.set(key(x), x); for (const x of b || []) m.set(key(x), x); return [...m.values()]; };
  out.log = byKey(older.log, newer.log, g => g.id).sort((x, y) => (x.date || "").localeCompare(y.date || ""));
  out.globalDrills = byKey(older.globalDrills, newer.globalDrills, d => d.title);
  out.globalChecks = Object.assign({}, older.globalChecks, newer.globalChecks);
  out.custom = byKey(older.custom, newer.custom, c => c.id);
  out.puddle = (newer.puddle || []).length ? newer.puddle : (older.puddle || []);
  out.puddleMeta = (newer.puddle || []).length ? newer.puddleMeta : (older.puddleMeta || {});
  out.pairs = Object.assign({}, older.pairs);
  for (const [k, p] of Object.entries(newer.pairs || {})) {
    const o = out.pairs[k] || {};
    out.pairs[k] = Object.assign({}, o, p, {
      notes: Object.assign({}, o.notes, p.notes),
      drills: Object.assign({}, o.drills, p.drills),
      customDrills: byKey(o.customDrills, p.customDrills, d => d.title),
    });
  }
  return out;
}
async function cloudInit() {
  if (!window.claude?.use) { setCloud("off", "クラウド保存：この表示では使えません（ブラウザ内のみ）"); return; }
  const db = await claude.use("db");
  if (!db) { setCloud("off", "クラウド保存：利用不可（ブラウザ内のみ）"); return; }
  try {
    cloudDoc = db.doc("user/state");
    const snap = await cloudDoc.get();
    const remote = snap.exists ? snap.data() : null;
    if (remote) {
      // ローカルとクラウドを結合する（新しい方を優先しつつ、ログ・練習項目・メモは両方の分を残す）。
      // 片方が空でも、もう片方のデータを消さない
      const localNewer = (state.updatedAt || 0) > (remote.updatedAt || 0);
      const before = JSON.stringify(pickSync(remote));
      const merged = localNewer ? mergeStates(pickSync(remote), pickSync(state)) : mergeStates(pickSync(state), pickSync(remote));
      merged.updatedAt = Math.max(state.updatedAt || 0, remote.updatedAt || 0);
      Object.assign(state, merged);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
      renderAll();
      setCloud("ok", "クラウド保存：読み込み済み（" + state.log.length + " 件のログ）");
      if (JSON.stringify(pickSync(state)) !== before) { cloudDirty = true; await cloudFlush(); }
    } else if (state.log.length || Object.keys(state.pairs).length || (state.puddle || []).length) {
      cloudDirty = true; await cloudFlush();
    } else {
      setCloud("ok", "クラウド保存：有効（まだデータなし）");
    }
    // 他の端末からの更新を反映
    cloudDoc.onSnapshot(s => {
      if (!s.exists || s.hasPendingWrites) return;
      const r = s.data();
      if ((r.updatedAt || 0) > (state.updatedAt || 0) + 50) {
        Object.assign(state, pickSync(r));
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
        renderAll(); setCloud("ok", "クラウド保存：他の端末の更新を反映 " + new Date().toLocaleTimeString());
      }
    }, () => {});
  } catch (e) { setCloud("err", "クラウド保存：接続できません（" + (e?.code || e?.message || e) + "）"); }
}

// ---- ユーティリティ ----
const allChars = () => BASE_CHARS.concat(state.custom);
const charById = id => allChars().find(c => c.id === id) || allChars()[0];
const pairKeyOf = (m, o) => m + "__" + o;
const pairKey = () => pairKeyOf(state.mine, state.opp);
function pairData(key = pairKey()) {
  if (!state.pairs[key]) state.pairs[key] = { diff: 0, wins: 0, losses: 0, notes: {}, drills: {}, customDrills: [] };
  const d = state.pairs[key];
  d.drills = d.drills || {}; d.customDrills = d.customDrills || []; d.notes = d.notes || {};
  return d;
}
// SDキャラ画像（assets/sd/<id>.png）。アーティファクト版はビルド時に data URI に置換される
const SD_IDS = new Set(["sol","ky","may","axl","chipp","potemkin","faust","millia","zato","ramlethal","leo","nagoriyuki","giovanna","anji","ino","goldlewis","jacko","chaos","baiken","testament","bridget","sin","bedman","asuka","johnny","elphelt","aba","slayer","dizzy","venom","unika","lucy","jam","roboky"]);
const SD_DATA = typeof SD_IMAGES !== "undefined" ? SD_IMAGES : null;
const sdSrc = id => SD_DATA ? (SD_DATA[id] || "") : (SD_IDS.has(id) ? `assets/sd/${id}.png` : "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const $ = id => document.getElementById(id);
// アーティファクト等では confirm/alert が表示されないので、ボタン自体を2段階にする
function armed(btn, label = "もう一度押すと実行") {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; return true; }
  btn.dataset.orig = btn.textContent; btn.dataset.armed = "1"; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3000);
  return false;
}
function notify(id, msg, ms = 4000) { const el = $(id); if (!el) return; el.textContent = msg; clearTimeout(el._t); el._t = setTimeout(() => el.textContent = "", ms); }

// Puddle Farm のセット（1セット＝先に2本取った方が勝ち。1-1 などの引き分けは除外）を試合ログと同じ形に
function puddleGames() {
  return (state.puddle || []).filter(s => s.oppId && s.result !== "D").map(s => ({
    id: "pf_" + s.time, date: s.time.slice(0, 10), mine: s.mine || "aba", opp: s.oppId, result: s.result,
    causes: [], memo: "", source: "puddle", rating: s.rating, oppRating: s.oppRating, change: s.change, oppName: s.oppName, score: s.score,
  }));
}
// 手入力ログ + Puddle Farm を時系列で
function allGames() {
  return state.log.map(g => ({ ...g, source: g.source || "manual" })).concat(puddleGames())
    .sort((x, y) => (x.date + (x.time || "")).localeCompare(y.date + (y.time || "")));
}
// 戦績 = 旧手動カウント + 試合ログ + Puddle Farm
function record(mine, opp) {
  const d = state.pairs[pairKeyOf(mine, opp)] || { wins: 0, losses: 0 };
  let w = d.wins || 0, l = d.losses || 0;
  for (const g of allGames()) if (g.mine === mine && g.opp === opp) (g.result === "W" ? w++ : l++);
  return { w, l, games: w + l, rate: w + l ? w / (w + l) : -1 };
}

// ---- Puddle Farm 取り込み ----
// 対応形式: (a) プレイヤーページを「名前を付けて保存」した .mht / .html、(b) ページ全体をコピーしたテキスト、
//           (c) このツールが書き出した JSON 配列 [{time, result, char, rating, opp_rating, change, opp_name}]
function parsePuddle(text) {
  let rows = [];
  try { const j = JSON.parse(text); if (Array.isArray(j)) rows = j; } catch (_) {}
  if (!rows.length) {
    let t = text;
    if (/<html|<div|<body/i.test(t)) {
      t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n");
      const ta = document.createElement("textarea"); ta.innerHTML = t; t = ta.value;
    }
    // .mht は quoted-printable (=3D, 行末 =) と \uXXXX を含むことがある
    t = t.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    t = t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const L = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (let i = 1; i < L.length; i++) {
      if (L[i] === "Time" && L[i + 2] === "Rating" && L[i + 4] === "Result" && L[i + 6] === "Char") {
        rows.push({ opp_name: L[i - 1], time: L[i + 1], rating: parseInt(L[i + 3]), result: L[i + 5], char: L[i + 7],
          opp_rating: parseInt(L[i + 9]), change: L[i + 10] === "Change" ? parseInt(L[i + 11].replace("+", "")) : null });
        i += 11;
      }
    }
  }
  const out = [];
  for (const r of rows) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(r.result || "").trim()); if (!m || !r.time) continue;
    const a = +m[1], b = +m[2];
    out.push({ time: String(r.time).replace("T", " ").slice(0, 19), score: `${a}-${b}`, result: a > b ? "W" : a < b ? "L" : "D",
      char: r.char, oppId: PUDDLE_ID(r.char), rating: +r.rating || null, oppRating: +r.opp_rating || null,
      change: r.change == null || isNaN(+r.change) ? null : +r.change, oppName: r.opp_name || "", mine: state.mine });
  }
  return out;
}
function importPuddle(text) {
  const rows = parsePuddle(text);
  if (!rows.length) throw new Error("Puddle Farm の対戦履歴が見つかりませんでした（プレイヤーページの保存ファイルか、ページ全体をコピーした文字列を貼ってください）");
  const have = new Set((state.puddle || []).map(s => s.time));
  const added = rows.filter(r => !have.has(r.time));
  state.puddle = (state.puddle || []).concat(added).sort((x, y) => x.time.localeCompare(y.time));
  const unknown = [...new Set(rows.filter(r => !r.oppId).map(r => r.char))];
  const latest = state.puddle[state.puddle.length - 1];
  state.puddleMeta = { lastRating: latest?.rating, lastTime: latest?.time, count: state.puddle.length };
  return { added: added.length, total: state.puddle.length, unknown };
}
function renderPuddleStatus() {
  const n = (state.puddle || []).length, m = state.puddleMeta || {};
  $("puddleStatus").textContent = n ? `取り込み済み：${n} セット（最新 ${m.lastTime || ""}、${m.lastRating ? m.lastRating + " RP" : ""}）` : "取り込み済みのセットはありません";
}

// ---- セレクト ----
function fillSelects() {
  for (const id of ["mine", "opp"]) {
    const sel = $(id);
    sel.innerHTML = allChars().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    sel.value = state[id];
    if (sel.value !== state[id]) state[id] = sel.value;
  }
}

// ---- 対策タブ ----
const GUIDE_SECTIONS = [
  { key: "roundstart", label: "開幕", icon: "開" },
  { key: "neutral", label: "立ち回り", icon: "↔" },
  { key: "moves",   label: "要注意技と対処", icon: "!" },
  { key: "defense", label: "固め・崩しへの防御", icon: "盾" },
  { key: "oki",     label: "相手の起き攻め", icon: "起" },
  { key: "punish",  label: "確定反撃を狙う場面", icon: "反" },
  { key: "corner",  label: "壁際・状況別", icon: "壁" },
  { key: "dont",    label: "やってはいけないこと", icon: "×" },
];
function renderGuide(opp) {
  const g = opp.guide;
  if (!g) {
    return `<h2>相手：${esc(opp.name)}</h2>
      <div class="tags">${(opp.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      <ul class="tips">${(opp.tips || []).map(t => `<li>${esc(t)}</li>`).join("") || "<li class='muted'>まだ情報がありません。下のメモ欄に書き込んでください。</li>"}</ul>`;
  }
  const sections = GUIDE_SECTIONS.filter(s => (g[s.key] || []).length).map((s, i) => `
    <details class="guide" ${i < 2 ? "open" : ""}>
      <summary><span class="g-icon ${s.key}">${s.icon}</span>${s.label}<span class="muted g-count">${g[s.key].length}</span></summary>
      <ul class="tips">${g[s.key].map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    </details>`).join("");
  return `
    <div class="opp-head">
      ${sdSrc(opp.id) ? `<img class="sd" src="${sdSrc(opp.id)}" alt="">` : ""}
      <div class="opp-head-text">
        <h2>相手：${esc(opp.name)}</h2>
        <div class="tags">${(opp.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
    </div>
    <p class="core">${esc(g.core)}</p>
    <div class="row between" style="margin:6px 0 2px"><h3 style="margin:0">対策の基本</h3><button class="small" id="guideToggle">すべて開く</button></div>
    ${sections}`;
}
function renderMatchup() {
  const opp = charById(state.opp), mine = charById(state.mine);
  $("oppInfo").innerHTML = renderGuide(opp);

  // 自キャラがアバの時だけ、アバ視点のメモを出す
  const aba = state.mine === "aba" && ABA_NOTES[state.opp];
  $("abaInfo").classList.toggle("hidden", !aba && state.mine === "aba");
  if (state.mine !== "aba") {
    $("abaInfo").innerHTML = `
      <h2>${esc(mine.name)} で使う時の注意</h2>
      <p>上の対策文はアバで戦う前提で書いています。相手の技の性質・ガード方向・「何をされたら何をする」はそのまま使えますが、確反の技名（近S・2Pなど）や「無敵技が無い」といった自分側の話はアバのものです。</p>
      <p>${esc(mine.name)}で反撃できるかは、<b>フレームタブの「${esc(mine.name)}の反撃」列</b>で確認してください（フレームデータから自動計算。届くかは距離次第）。</p>`;
  } else if (aba) {
    $("abaInfo").innerHTML = `
      <h2>アバで ${esc(opp.name)} と戦う時</h2>
      <dl class="kv">
        <dt>立ち回り方針</dt><dd>${esc(aba.plan)}</dd>
        <dt>憤嫉ゲージ運用</dt><dd>${esc(aba.gauge)}</dd>
        <dt>注意点</dt><dd>${esc(aba.watch)}</dd>
      </dl>`;
  }
  $("pairTitle").textContent = `${mine.name} 側の ${opp.name} 対策メモ`;

  const d = pairData();
  $("stars").innerHTML = [1, 2, 3, 4, 5]
    .map(n => `<button data-star="${n}" class="${n <= d.diff ? "on" : ""}" aria-label="難易度${n}">★</button>`).join("");
  const r = record(state.mine, state.opp);
  $("wins").textContent = r.w;
  $("losses").textContent = r.l;
  $("rate").textContent = r.games ? `勝率 ${Math.round(r.rate * 100)}%（${r.games}戦）` : "";

  $("noteFields").innerHTML = NOTE_FIELDS.map(f => `
    <label class="note-field"><span>${f.label}</span>
      <textarea data-note="${f.key}" placeholder="${esc(f.ph)}">${esc(d.notes[f.key] || "")}</textarea>
    </label>`).join("");
}

// ---- フレームタブ ----
function framesFor(id) {
  const c = charById(id);
  return (state.frames[id] || FRAME_DATA[id] || []);
}
// 日本語の技名（wikiwiki.jp/ggst-memo のフレーム表から。JP_NAMES[キャラ][Dustloop入力]）
const jpName = (cid, m) => (typeof JP_NAMES !== "undefined" && JP_NAMES[cid] && JP_NAMES[cid][m.input]) || "";
// フレームタブの絞り込み状態（タブ切り替えでも保持）
let frameFilter = { q: "", punish: false, specials: false, sort: "" };
const advNum = v => { const n = parseInt(String(v ?? "").replace(/^[^\d+-]*/, ""), 10); return isNaN(n) ? null : n; };
// 自キャラの反撃候補（地上の通常技・必殺技・覚醒必殺技のうち、発生が数値で取れるもの）
const startupNum = v => {
  const t = String(v ?? "").replace(/\(.*?\)/g, "");
  const m = t.match(/^\s*(\d+)(?:\s*\+\s*(\d+))?/);
  return m ? (+m[1]) + (m[2] ? +m[2] : 0) : null;
};
function punishersFor(cid) {
  return framesFor(cid).filter(m => {
    const i = m.input || "";
    if (/^j\.|^66$|6D or 4D|^5D$|5\[D\]|236D|236\[D\]|During|~|^\[/.test(i)) return false;
    if (/^(2|5|6|c\.|f\.)/.test(i) && !/\d{3}/.test(i)) return true;        // 地上の通常技・特殊技
    return /^(236|214|623|632146|214214|236236)[PKSH]/.test(i);                // 地上の必殺技・覚醒必殺技
  }).map(m => ({ m, s: startupNum(m.startup) })).filter(x => x.s);
}
function punishCell(onBlock, cid, list) {
  const adv = advNum(onBlock);
  if (adv === null || adv > -1) return "<span class='muted'>—</span>";
  const fits = list.filter(x => x.s <= -adv);
  if (!fits.length) return "<span class='muted'>なし</span>";
  const nm = x => jpName(cid, x.m) || x.m.input;
  const by = inp => fits.find(x => x.m.input === inp);
  const main = ["c.S", "2K", "5K", "2P", "5P"].map(by).find(Boolean) || fits.reduce((a, b) => (b.s < a.s ? b : a));
  const heavy = ["5H", "2H"].map(by).filter(Boolean);
  let out = `${esc(nm(main))}<span class="muted">(${main.s}F)</span>`;
  if (heavy.length) out += `<div class="muted small">${heavy.map(x => esc(nm(x)) + "(" + x.s + "F)").join("・")}も間に合う</div>`;
  return out;
}
function renderFrames() {
  const opp = charById(state.opp);
  $("framesTitle").textContent = `${opp.name} のフレームデータ`;
  const km = KEY_MOVES[opp.id] || [];
  $("keyMoves").innerHTML = km.length ? `<h3>まず警戒する技</h3><div class="tags">${km.map(m => `<span class="tag neutral">${esc(m)}</span>`).join("")}</div>` : "";
  const all = framesFor(opp.id);
  if (!all.length) {
    $("framesBody").innerHTML = `<p class="muted" style="margin-top:12px">数値データは未取り込みです。「データ管理」タブから Dustloop の JSON を読み込むと、ここに発生・硬直差などの表が出ます。</p>`;
    return;
  }
  const f = frameFilter, q = f.q.trim().toLowerCase();
  const myPun = punishersFor(state.mine);
  let rows = all.filter(m =>
    (!q || (m.name + " " + m.input + " " + (jpName(opp.id, m) || "")).toLowerCase().includes(q)) &&
    (!f.punish || (advNum(m.onBlock) ?? 0) <= -5) &&
    (!f.specials || m.name));
  if (f.sort === "block") rows = rows.slice().sort((a, b) => (advNum(a.onBlock) ?? 99) - (advNum(b.onBlock) ?? 99));
  if (f.sort === "startup") rows = rows.slice().sort((a, b) => (advNum(a.startup) ?? 999) - (advNum(b.startup) ?? 999));
  const fmtAdv = v => {
    if (v === "" || v == null) return "<span class='muted'>—</span>";
    const n = advNum(v);
    if (n === null) return esc(v);
    const cls = n >= 0 ? "win" : (n <= -5 ? "lose" : "");
    return `<span class="${cls}" title="${esc(v)}">${esc(v)}</span>`;
  };
  $("framesBody").innerHTML = `
    <div class="row frame-tools">
      <label class="field">技名・入力で検索<input type="search" id="frameQ" value="${esc(f.q)}" placeholder="例：236S / Viper / 2D"></label>
      <label class="chk"><input type="checkbox" id="framePunish" ${f.punish ? "checked" : ""}>確反あり（ガード後 −5 以下）だけ</label>
      <label class="chk"><input type="checkbox" id="frameSpecials" ${f.specials ? "checked" : ""}>必殺技・特殊技だけ</label>
      <label class="field narrow">並び順
        <select id="frameSort">
          <option value="" ${f.sort === "" ? "selected" : ""}>Dustloop順</option>
          <option value="block" ${f.sort === "block" ? "selected" : ""}>ガード後が不利な順</option>
          <option value="startup" ${f.sort === "startup" ? "selected" : ""}>発生が早い順</option>
        </select>
      </label>
    </div>
    <p class="muted">${rows.length} / ${all.length} 技。ガード後 −5 以下は赤字（−5/−6 は 2P・5P 級、−7 以下で近S・2K 始動、−10 以下で最大）。[ ] は溜め版、( IAD ) は低空時の値。「${esc(charById(state.mine).name)}の反撃」は発生がガード後の不利以内に収まる技（近S→2K→5K→2P→5P の順で間に合う物。5H・2Hが間に合えば併記）。リーチは考慮していないので、届くかは距離次第。</p>
    <div class="table-wrap"><table>
      <thead><tr><th>技</th><th>入力</th><th class="num">発生</th><th class="num">持続</th><th class="num">硬直</th><th class="num">ガード後</th><th class="num">ヒット後</th><th>ガード</th><th>Lv</th><th>${esc(charById(state.mine).name)}の反撃</th></tr></thead>
      <tbody>${rows.map(m => `<tr>
        <td>${jpName(opp.id, m) ? `${esc(jpName(opp.id, m))}${m.name ? `<div class="muted small">${esc(m.name)}</div>` : ""}` : esc(m.name)}</td><td>${esc(m.input)}</td>
        <td class="num">${esc(m.startup)}</td><td class="num">${esc(m.active)}</td><td class="num">${esc(m.recovery)}</td>
        <td class="num">${fmtAdv(m.onBlock)}</td><td class="num">${fmtAdv(m.onHit)}</td>
        <td>${esc(m.guard)}</td><td>${esc(m.level)}</td><td>${punishCell(m.onBlock, state.mine, myPun)}</td></tr>`).join("") || "<tr><td colspan='10' class='muted'>該当なし</td></tr>"}</tbody>
    </table></div>`;
}

// Dustloop Cargo API の JSON を { charId: [moves] } に変換
function importDustloop(json) {
  const items = json.cargoquery ? json.cargoquery.map(x => x.title) : (Array.isArray(json) ? json : null);
  if (!items) throw new Error("Dustloop の cargoquery 形式ではありません");
  const byEn = {};
  for (const c of allChars()) if (c.en) byEn[c.en.toLowerCase()] = c.id;
  const added = {}, unknown = new Set();
  for (const it of items) {
    const id = byEn[String(it.chara || "").toLowerCase()];
    if (!id) { if (it.chara) unknown.add(it.chara); continue; }
    (added[id] = added[id] || []).push({
      name: it.name || "", input: it.input || "", startup: it.startup || "", active: it.active || "",
      recovery: it.recovery || "", onBlock: it.onBlock || "", onHit: it.onHit || "", guard: it.guard || "", level: it.level || "",
    });
  }
  for (const id in added) state.frames[id] = added[id];
  return { chars: Object.keys(added).map(id => charById(id).name), count: items.length, unknown: [...unknown] };
}
function renderFramesStatus() {
  const ids = Object.keys(state.frames);
  $("framesStatus").textContent = ids.length
    ? `取り込み済み：${ids.map(id => charById(id).name).join("、")}`
    : "取り込み済みのフレームデータはありません";
}

// ---- 練習タブ ----
const norm = (t) => typeof t === "string" ? { title: t } : t;
function drillsFor(oppId, d) {
  // 並び: 動画分析から追加 → キャラ固有 → 自分で追加 → 共通（折りたたみ）
  const custom = d.customDrills.map((t, i) => ({ id: "u" + i, ...norm(t), custom: true }));
  const fromAnalysis = custom.filter(x => x.from), own = custom.filter(x => !x.from);
  const char = (CHAR_DRILLS[oppId] || []).map((t, i) => ({ id: "k" + i, ...norm(t) }));
  const common = COMMON_DRILLS.map((t, i) => ({ id: "c" + i, ...norm(t), common: true }));
  return fromAnalysis.concat(char, own, common);
}
// 進捗は共通項目を除いて数える
function drillProgress(mine, opp) {
  const d = state.pairs[pairKeyOf(mine, opp)];
  const items = drillsFor(opp, d || { customDrills: [] }).filter(it => !it.common);
  const done = d ? items.filter(it => d.drills && d.drills[it.id]).length : 0;
  return { done, total: items.length };
}
const fmtAdded = v => v ? v.slice(5).replace("-", "/") : "";
function drillItem(it, d) {
  const meta = [it.from ? `<span class="tag neutral">${esc(it.from)}</span>` : "", it.added ? `<span class="muted small">追加 ${esc(fmtAdded(it.added))}</span>` : ""].filter(Boolean).join(" ");
  return `
    <li class="${d.drills[it.id] ? "done" : ""}">
      <input type="checkbox" id="dr-${it.id}" data-drill="${it.id}" ${d.drills[it.id] ? "checked" : ""}>
      <div class="drill">
        <label for="dr-${it.id}">${esc(it.title)}${meta ? " " + meta : ""}</label>
        ${it.record ? `<dl class="drill-steps">
          <dt>記録</dt><dd>${esc(it.record)}</dd>
          <dt>やる</dt><dd>${esc(it.action)}</dd>
          <dt>合格</dt><dd>${esc(it.pass)}</dd>
        </dl>` : ""}
      </div>
      ${it.custom ? `<button class="small" data-deldrill="${it.id.slice(1)}">×</button>` : ""}
    </li>`;
}
// 全キャラ共通の自分の課題（どの相手でも上に出る）
function renderGlobalDrills() {
  const g = state.globalDrills || [], ch = state.globalChecks || {};
  const box = $("globalDrills");
  if (!g.length) { box.innerHTML = ""; return; }
  const done = g.filter((_, i) => ch["g" + i]).length;
  box.innerHTML = `
    <div class="row between"><h3 style="margin:0">自分の課題（全キャラ共通）</h3><span class="muted">${done} / ${g.length}</span></div>
    <ul class="checklist">${g.map((t, i) => drillItem({ id: "g" + i, ...norm(t) }, { drills: ch })).join("")}</ul>`;
}
function renderDrills() {
  renderGlobalDrills();
  const opp = charById(state.opp), d = pairData();
  $("drillsTitle").textContent = `${opp.name} 対策の練習メニュー`;
  const all = drillsFor(opp.id, d);
  const main = all.filter(it => !it.common), common = all.filter(it => it.common);
  const done = main.filter(it => d.drills[it.id]).length;
  $("drillsBar").style.width = main.length ? (done / main.length * 100) + "%" : "0";
  $("drillsCount").textContent = `${done} / ${main.length}`;
  $("drillsList").innerHTML = main.map(it => drillItem(it, d)).join("") || "<li class='muted'>このキャラ固有の練習はまだありません</li>";
  const cdone = common.filter(it => d.drills[it.id]).length;
  $("commonDrills").innerHTML = `
    <details class="guide">
      <summary><span class="g-icon">共</span>どのキャラにも効く基礎練習<span class="muted g-count">${cdone}/${common.length}</span></summary>
      <ul class="checklist">${common.map(it => drillItem(it, d)).join("")}</ul>
    </details>`;
}

// ---- 試合ログ ----
let logDraft = { result: null, causes: new Set(), editId: null };
function renderLogForm() {
  const ed = logDraft.editId ? state.log.find(g => g.id === logDraft.editId) : null;
  $("logFormTitle").textContent = ed ? "記録を編集" : "試合を記録";
  $("logPair").textContent = ed
    ? `${charById(ed.mine).name} vs ${charById(ed.opp).name}（${ed.date} の記録を編集中）`
    : `${charById(state.mine).name} vs ${charById(state.opp).name}（上のセレクトで変更）`;
  $("logSave").textContent = ed ? "更新する" : "記録する";
  $("logCancel").hidden = !ed;
  if (!$("logDate").value) $("logDate").value = today();
  document.querySelectorAll(".result-btns button").forEach(b => b.classList.toggle("on", b.dataset.res === logDraft.result));
  $("causeChips").innerHTML = CAUSES.map(c => `<button data-cause="${esc(c)}" class="${logDraft.causes.has(c) ? "on" : ""}">${esc(c)}</button>`).join("");
}
function renderLogTable() {
  const rows = allGames().reverse().slice(0, 80);
  $("logBody").innerHTML = rows.length ? rows.map(g => `
    <tr class="log-row">
      <td>${esc(g.date)}${g.source === "puddle" ? " <span class='tag neutral' title='Puddle Farm'>PF</span>" : ""}</td><td>${esc(charById(g.mine).name)}</td><td>${esc(charById(g.opp).name)}</td>
      <td class="${g.result === "W" ? "win" : "lose"}"><b>${g.result === "W" ? "勝" : "負"}</b>${g.score ? ` <small class="muted">${esc(g.score)}</small>` : ""}</td>
      <td class="causes">${g.source === "puddle" ? `<span class="muted">${esc(g.oppName)} ${g.oppRating ? g.oppRating.toLocaleString() + "RP" : ""} ${g.change != null ? (g.change >= 0 ? "+" : "") + g.change : ""}</span>` : (g.causes || []).map(esc).join("、")}</td>
      <td class="muted">${esc(g.memo || "")}</td>
      <td class="nowrap">${g.video ? `<button class="small" data-openvid="${esc(g.video)}">▶動画</button> ` : ""}${g.source === "puddle" ? "" : `<button class="small" data-editlog="${esc(g.id)}">編集</button> <button class="small" data-dellog="${esc(g.id)}">×</button>`}</td>
    </tr>`).join("") : "<tr><td colspan='7' class='muted'>まだ記録がありません</td></tr>";
}
function addGame(result, causes = [], memo = "", date = today()) {
  state.log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, mine: state.mine, opp: state.opp, result, causes, memo });
  save(true);
}

// ---- 分析 ----
function renderAnalysis() {
  const scope = $("anaScope").value, src = $("anaSource").value;
  const games = allGames().filter(g => (src === "all" || g.source === src) && (scope === "all" || (g.mine === state.mine && (scope === "mine" || g.opp === state.opp))));
  const w = games.filter(g => g.result === "W").length, l = games.length - w;
  const recent = games.slice(-20);
  const rw = recent.filter(g => g.result === "W").length;
  let streak = 0, streakType = null;
  for (let i = games.length - 1; i >= 0; i--) {
    if (streakType === null) streakType = games[i].result;
    if (games[i].result !== streakType) break;
    streak++;
  }
  $("anaSummary").innerHTML = `
    <div><div class="muted">試合数</div><div style="font-size:1.6rem;font-weight:700">${games.length}</div><div class="muted"><span class="win">${w}勝</span> / <span class="lose">${l}敗</span></div></div>
    <div><div class="muted">勝率</div><div style="font-size:1.6rem;font-weight:700">${games.length ? Math.round(w / games.length * 100) + "%" : "—"}</div><div class="muted">直近20戦 ${recent.length ? Math.round(rw / recent.length * 100) + "%" : "—"}</div></div>
    <div><div class="muted">直近の流れ（右が最新）</div><div class="streak">${recent.map(g => `<span class="${g.result === "W" ? "w" : "l"}" title="${esc(g.date)} vs ${esc(charById(g.opp).name)}"></span>`).join("")}</div>
      <div class="muted">${streak ? `${streak}連${streakType === "W" ? "勝" : "敗"}中` : ""}</div></div>`
    + renderRpStats(games);

  // 原因集計（負け試合のみでなく、原因タグが付いた全試合）
  const cc = {};
  for (const g of games) for (const c of (g.causes || [])) cc[c] = (cc[c] || 0) + 1;
  const causeRows = Object.entries(cc).sort((a, b) => b[1] - a[1]);
  const maxC = causeRows[0]?.[1] || 1;
  $("anaCauses").innerHTML = causeRows.length ? causeRows.map(([c, n]) => `
    <div class="bar-row"><span>${esc(c)}</span><div class="bar"><div style="width:${n / maxC * 100}%"></div></div><span class="n">${n}</span></div>`).join("")
    + `<p class="muted" style="margin-top:8px">上位の原因が、次にトレモで練習すべきこと。</p>`
    : "<p class='muted'>原因タグ付きの記録がまだありません</p>";

  // 相手キャラ別
  const oc = {};
  for (const g of games) { const o = oc[g.opp] = oc[g.opp] || { w: 0, l: 0 }; g.result === "W" ? o.w++ : o.l++; }
  const oppRows = Object.entries(oc).map(([id, o]) => ({ id, ...o, n: o.w + o.l, rate: o.w / (o.w + o.l) })).sort((a, b) => a.rate - b.rate || b.n - a.n);
  $("anaOpps").innerHTML = oppRows.length ? oppRows.map(o => `
    <div class="bar-row"><span>${esc(charById(o.id).name)}</span><div class="bar"><div style="width:${o.rate * 100}%;background:${o.rate >= .5 ? "var(--win)" : "var(--lose)"}"></div></div><span class="n">${Math.round(o.rate * 100)}%<br><small>${o.n}戦</small></span></div>`).join("")
    + `<p class="muted" style="margin-top:8px">勝率の低い順。苦手キャラから対策メモを埋めよう。</p>`
    : "<p class='muted'>記録がまだありません</p>";
}

// Puddle Farm 由来のセットがあれば、RP の推移・格上/格下の勝率を出す
function renderRpStats(games) {
  const pf = games.filter(g => g.source === "puddle" && g.rating);
  if (!pf.length) return "";
  const up = pf.filter(g => g.oppRating > g.rating + 1000), down = pf.filter(g => g.oppRating < g.rating - 1000), even = pf.filter(g => !up.includes(g) && !down.includes(g));
  const wr = arr => arr.length ? Math.round(arr.filter(g => g.result === "W").length / arr.length * 100) + "%" : "—";
  const net = pf.reduce((n, g) => n + (g.change || 0), 0);
  const first = pf[0], last = pf[pf.length - 1];
  return `
    <div><div class="muted">RP（Puddle Farm）</div><div style="font-size:1.6rem;font-weight:700">${last.rating.toLocaleString()}</div>
      <div class="muted">${first.rating.toLocaleString()} → 期間内 ${net >= 0 ? "+" : ""}${net}</div></div>
    <div><div class="muted">相手のRP差で見た勝率</div>
      <div class="kv" style="font-size:.88rem"><dt>格上（+1000〜）</dt><dd>${wr(up)}（${up.length}戦）</dd><dt>同格</dt><dd>${wr(even)}（${even.length}戦）</dd><dt>格下（−1000〜）</dt><dd>${wr(down)}（${down.length}戦）</dd></div></div>`;
}

// ---- 一覧タブ ----
let sortKey = "name", sortDir = 1;
function renderList() {
  const mine = charById(state.mine);
  $("listTitle").textContent = `${mine.name} の対キャラ一覧`;
  const rows = allChars().map((c, i) => {
    const d = state.pairs[pairKeyOf(state.mine, c.id)] || { diff: 0, notes: {} };
    const r = record(state.mine, c.id), p = drillProgress(state.mine, c.id);
    return { c, i, d, r, p, pr: p.total ? p.done / p.total : 0 };
  });
  rows.sort((a, b) => {
    const v = { name: a.i - b.i, diff: a.d.diff - b.d.diff, games: a.r.games - b.r.games, rate: a.r.rate - b.r.rate, drills: a.pr - b.pr }[sortKey];
    return v * sortDir;
  });
  $("listBody").innerHTML = rows.map(r => `
    <tr class="clickable" data-go="${esc(r.c.id)}">
      <td class="name-cell">${sdSrc(r.c.id) ? `<img class="sd-mini" src="${sdSrc(r.c.id)}" alt="">` : ""}${esc(r.c.name)}</td>
      <td>${r.d.diff ? "★".repeat(r.d.diff) : "<span class='muted'>—</span>"}</td>
      <td class="num">${r.r.games || "<span class='muted'>0</span>"}</td>
      <td class="num">${r.r.games ? Math.round(r.r.rate * 100) + "%" : "<span class='muted'>—</span>"}</td>
      <td class="num">${r.p.done}/${r.p.total}</td>
      <td class="muted">${esc((r.d.notes?.neutral || "").slice(0, 40))}</td>
    </tr>`).join("");
}

// ---- データ管理 ----
function renderCustom() {
  $("customList").innerHTML = state.custom.length
    ? state.custom.map(c => `<span class="tag">${esc(c.name)} <button data-del="${esc(c.id)}" style="padding:0 4px;border:none;background:none;color:inherit">×</button></span>`).join("")
    : "<span class='muted'>追加したキャラはありません</span>";
  $("dlUrl").textContent = DL_URL;
  renderFramesStatus(); renderPuddleStatus();
}

// ---- 動画 ----
// db の videos コレクション: { asset, title, mine, opp, date, kind: "self"|"ref", summary, markers:[{t,label,kind}] }
// kind: good(良い動き) / bad(失点・ミス) / info
let videos = [], vidCurrent = null, assetsNs2 = null;
const fmtSec = s => { s = Math.max(0, +s || 0); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
async function videosInit() {
  if (!window.claude?.use) { $("vidStatus").textContent = "この表示では動画を読み込めません（アーティファクトとして開いてください）"; return; }
  const db = await claude.use("db");
  assetsNs2 = await claude.use("assets");
  $("vidUploadCard").hidden = !assetsNs2;
  if (!db) { $("vidStatus").textContent = "動画を読み込めません（ログインが必要です）"; return; }
  try {
    db.collection("videos").onSnapshot(snap => {
      videos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (y.date || "").localeCompare(x.date || "") || (x.title || "").localeCompare(y.title || ""));
      if (currentTab === "videos") renderVideos();
      if (currentTab === "log") renderLogTable();
    }, () => { $("vidStatus").textContent = "動画一覧を読み込めませんでした"; });
  } catch (e) { $("vidStatus").textContent = "動画一覧を読み込めませんでした"; }
}
function renderVideos() {
  const only = $("vidOnlyOpp").checked;
  const list = videos.filter(v => !only || v.opp === state.opp || v.kind === "ref");
  $("vidStatus").textContent = videos.length ? `${list.length} 本` : "動画はまだありません。チャットに送ってもらえれば分析と一緒に追加します。";
  $("vidList").innerHTML = list.map(v => `
    <li class="${vidCurrent === v.id ? "on" : ""}" data-vid="${esc(v.id)}">
      ${v.opp && sdSrc(v.opp) ? `<img class="sd-mini" src="${sdSrc(v.opp)}" alt="">` : ""}
      <div><b>${esc(v.title || "動画")}</b><div class="muted small">${esc(v.date || "")}${v.kind === "ref" ? " ・参考" : ""}${v.result ? " ・" + (v.result === "W" ? "勝ち" : "負け") : ""}</div></div>
    </li>`).join("");
  if (!vidCurrent && list.length) selectVideo(list[0].id, false);
  else if (vidCurrent) renderVideoInfo();
}
function selectVideo(id, play) {
  const v = videos.find(x => x.id === id); if (!v) return;
  vidCurrent = id;
  const p = $("vidPlayer"), src = "/_blob/" + v.asset;
  if (p.getAttribute("src") !== src) p.setAttribute("src", src);
  document.querySelectorAll("#vidList li").forEach(li => li.classList.toggle("on", li.dataset.vid === id));
  renderVideoInfo();
  if (play) p.play().catch(() => {});
}
function renderVideoInfo() {
  const v = videos.find(x => x.id === vidCurrent); if (!v) { $("vidInfo").innerHTML = ""; return; }
  const mk = (v.markers || []).slice().sort((x, y) => x.t - y.t);
  $("vidInfo").innerHTML = `
    <h3>${esc(v.title || "")}</h3>
    ${v.summary ? `<p class="core">${esc(v.summary)}</p>` : ""}
    ${mk.length ? `<div class="muted small">タップでその場面へ</div><ul class="markers">${mk.map(m => `
      <li><button class="small mk ${esc(m.kind || "info")}" data-seek="${m.t}">${fmtSec(m.t)}</button><span>${esc(m.label)}</span></li>`).join("")}</ul>` : ""}`;
}
$("vidList").addEventListener("click", e => { const li = e.target.closest("li[data-vid]"); if (li) selectVideo(li.dataset.vid, true); });
$("vidInfo").addEventListener("click", e => {
  const t = e.target.dataset.seek; if (t == null) return;
  const p = $("vidPlayer"); p.currentTime = +t; p.play().catch(() => {});
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("vidOnlyOpp").addEventListener("change", renderVideos);
$("logBody").addEventListener("click", e => {
  const id = e.target.dataset.openvid; if (!id) return;
  showTab("videos"); selectVideo(id, true);
});
$("vidUpload").addEventListener("click", async () => {
  const f = $("vidFile").files[0];
  if (!f) { $("vidMsg").textContent = "ファイルを選んでください"; return; }
  if (f.size > 20 * 1048576) { $("vidMsg").textContent = "20MB を超えています。動画シュリンクで小さくしてください"; return; }
  if (!assetsNs2) return;
  $("vidUpload").disabled = true; $("vidMsg").textContent = "アップロード中…";
  try {
    const type = /webm$/i.test(f.name) ? "video/webm" : "video/mp4";
    const res = await assetsNs2.upload(f, { type });
    const db = await claude.use("db");
    await db.collection("videos").add({ asset: res.id, title: $("vidTitle").value.trim() || f.name, mine: state.mine, opp: state.opp, date: today(), kind: "self", markers: [] });
    $("vidMsg").textContent = "追加しました"; $("vidTitle").value = ""; $("vidFile").value = "";
  } catch (err) {
    $("vidMsg").textContent = err?.code === "too_large" ? "20MB を超えています" : err?.code === "quota_or_state" ? "保管庫がいっぱいです" : "追加できませんでした：" + (err?.message || err?.code || err);
  }
  $("vidUpload").disabled = false;
});

// ---- タブ ----
const TABS = ["matchup", "frames", "drills", "log", "analysis", "videos", "list", "data"];
let currentTab = "matchup";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  for (const t of TABS) $("tab-" + t).classList.toggle("hidden", t !== name);
  renderTab(name);
}
function renderTab(name) {
  ({ matchup: renderMatchup, frames: renderFrames, drills: renderDrills, log: () => { renderLogForm(); renderLogTable(); },
     analysis: renderAnalysis, videos: renderVideos, list: renderList, data: renderCustom })[name]();
}
function renderAll() { fillSelects(); renderTab(currentTab); }

// ---- イベント ----
$("mine").addEventListener("change", e => { state.mine = e.target.value; save(); renderAll(); });
$("opp").addEventListener("change", e => { state.opp = e.target.value; save(); renderAll(); });
$("swap").addEventListener("click", () => { [state.mine, state.opp] = [state.opp, state.mine]; save(); renderAll(); });
document.querySelector(".tabs").addEventListener("click", e => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

// 対策
$("oppInfo").addEventListener("click", e => {
  if (e.target.id !== "guideToggle") return;
  const ds = document.querySelectorAll("#oppInfo details.guide");
  const open = [...ds].some(d => !d.open);
  ds.forEach(d => d.open = open);
  e.target.textContent = open ? "すべて閉じる" : "すべて開く";
});
$("stars").addEventListener("click", e => {
  const n = +e.target.dataset.star; if (!n) return;
  const d = pairData(); d.diff = d.diff === n ? 0 : n; save(true); renderMatchup();
});
document.querySelector(".record").addEventListener("click", e => {
  const r = e.target.dataset.quick; if (!r) return;
  addGame(r); renderMatchup();
});
let typeTimer;
$("noteFields").addEventListener("input", e => {
  const k = e.target.dataset.note; if (!k) return;
  pairData().notes[k] = e.target.value;
  clearTimeout(typeTimer); typeTimer = setTimeout(() => save(true), 400);
});

// フレーム
$("framesBody").addEventListener("input", e => {
  if (e.target.id === "frameQ") {
    frameFilter.q = e.target.value;
    clearTimeout(frameFilter._t); frameFilter._t = setTimeout(() => { const pos = e.target.selectionStart; renderFrames(); const q = $("frameQ"); q.focus(); q.setSelectionRange(pos, pos); }, 250);
  }
});
$("framesBody").addEventListener("change", e => {
  if (e.target.id === "framePunish") { frameFilter.punish = e.target.checked; renderFrames(); }
  if (e.target.id === "frameSpecials") { frameFilter.specials = e.target.checked; renderFrames(); }
  if (e.target.id === "frameSort") { frameFilter.sort = e.target.value; renderFrames(); }
});

// 練習
$("tab-drills").addEventListener("change", e => {
  const id = e.target.dataset.drill; if (!id) return;
  if (id.startsWith("g")) {
    state.globalChecks = state.globalChecks || {};
    if (e.target.checked) state.globalChecks[id] = true; else delete state.globalChecks[id];
    save(true); renderDrills(); return;
  }
  const d = pairData(); if (e.target.checked) d.drills[id] = true; else delete d.drills[id];
  save(true); renderDrills();
});
$("tab-drills").addEventListener("click", e => {
  const i = e.target.dataset.deldrill; if (i == null) return;
  const d = pairData(); d.customDrills.splice(+i, 1);
  // 以降のカスタム項目のチェック状態がずれるので詰め直す
  const keep = {}; for (const k in d.drills) if (!k.startsWith("u")) keep[k] = true;
  d.drills = keep; save(true); renderDrills();
});
$("addDrill").addEventListener("click", () => {
  const t = $("newDrill").value.trim(); if (!t) return;
  pairData().customDrills.push({ title: t, added: today() }); $("newDrill").value = ""; save(true); renderDrills();
});
$("drillsReset").addEventListener("click", () => { pairData().drills = {}; save(true); renderDrills(); });

// 試合ログ
document.querySelector(".result-btns").addEventListener("click", e => {
  const r = e.target.dataset.res; if (!r) return; logDraft.result = r; renderLogForm();
});
$("causeChips").addEventListener("click", e => {
  const c = e.target.dataset.cause; if (!c) return;
  logDraft.causes.has(c) ? logDraft.causes.delete(c) : logDraft.causes.add(c); renderLogForm();
});
$("logSave").addEventListener("click", () => {
  if (!logDraft.result) { $("logMsg").textContent = "結果（勝ち／負け）を選んでください"; return; }
  if (logDraft.editId) {
    const g = state.log.find(x => x.id === logDraft.editId);
    if (g) { g.result = logDraft.result; g.causes = [...logDraft.causes]; g.memo = $("logMemo").value.trim(); g.date = $("logDate").value || g.date; save(true); }
    $("logMsg").textContent = "更新しました";
  } else {
    addGame(logDraft.result, [...logDraft.causes], $("logMemo").value.trim(), $("logDate").value || today());
    $("logMsg").textContent = "記録しました";
  }
  logDraft = { result: null, causes: new Set(), editId: null }; $("logMemo").value = ""; $("logDate").value = today();
  setTimeout(() => $("logMsg").textContent = "", 1500);
  renderLogForm(); renderLogTable();
});
$("logCancel").addEventListener("click", () => {
  logDraft = { result: null, causes: new Set(), editId: null }; $("logMemo").value = ""; $("logDate").value = today(); renderLogForm();
});
$("logBody").addEventListener("click", e => {
  const eid = e.target.dataset.editlog;
  if (eid) {
    const g = state.log.find(x => x.id === eid); if (!g) return;
    logDraft = { result: g.result, causes: new Set(g.causes || []), editId: eid };
    $("logMemo").value = g.memo || ""; $("logDate").value = g.date;
    renderLogForm(); $("logFormTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const id = e.target.dataset.dellog; if (!id || !armed(e.target, "削除？")) return;
  state.log = state.log.filter(g => g.id !== id); save(true); renderLogTable();
});

// 分析
$("anaScope").addEventListener("change", renderAnalysis);
$("anaSource").addEventListener("change", renderAnalysis);

// Puddle Farm
$("importPuddleFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const res = importPuddle(await f.text()); save(); renderPuddleStatus(); notify("puddleMsg", `${res.added} セットを追加（合計 ${res.total}）` + (res.unknown.length ? ` ／ 未対応の略号：${res.unknown.join(", ")}` : ""), 8000); }
  catch (err) { notify("puddleMsg", err.message, 8000); }
  e.target.value = "";
});
$("importPuddleText").addEventListener("click", () => {
  try { const res = importPuddle($("puddleText").value); save(); renderPuddleStatus(); $("puddleText").value = ""; notify("puddleMsg", `${res.added} セットを追加（合計 ${res.total}）` + (res.unknown.length ? ` ／ 未対応の略号：${res.unknown.join(", ")}` : ""), 8000); }
  catch (err) { notify("puddleMsg", err.message, 8000); }
});
$("clearPuddle").addEventListener("click", e => { if (!armed(e.target)) return; state.puddle = []; state.puddleMeta = {}; save(); renderPuddleStatus(); });

// 一覧
document.querySelector("#tab-list thead").addEventListener("click", e => {
  const k = e.target.dataset.sort; if (!k) return;
  sortDir = sortKey === k ? -sortDir : (k === "name" ? 1 : -1); sortKey = k; renderList();
});
$("listBody").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-go]"); if (!tr) return;
  state.opp = tr.dataset.go; save(); fillSelects(); showTab("matchup");
});

// データ管理
$("exportBtn").addEventListener("click", () => {
  const json = JSON.stringify(state, null, 2);
  $("exportBox").hidden = false; $("exportText").value = json;
  $("exportText").select(); notify("exportMsg", "下のJSONをコピーして保存してください");
});
$("copyExport").addEventListener("click", () => {
  const t = $("exportText");
  navigator.clipboard.writeText(t.value).then(() => notify("exportMsg", "コピーしました")).catch(() => { t.select(); notify("exportMsg", "選択したのでコピーしてください"); });
});
$("importText").addEventListener("click", () => {
  try {
    const data = JSON.parse($("exportText").value);
    if (!data || typeof data.pairs !== "object") throw new Error("形式が違います");
    state = Object.assign(DEFAULT_STATE(), data); save(); renderAll(); notify("exportMsg", "読み込みました");
  } catch (err) { notify("exportMsg", "読み込みに失敗しました：" + err.message); }
});
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data.pairs !== "object") throw new Error("形式が違います");
    state = Object.assign(DEFAULT_STATE(), data);
    save(); renderAll(); notify("exportMsg", "読み込みました");
  } catch (err) { notify("exportMsg", "読み込みに失敗しました：" + err.message); }
  e.target.value = "";
});
$("importFrames").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const res = importDustloop(JSON.parse(await f.text()));
    save(); renderFramesStatus();
    notify("framesMsg", `${res.count} 件を読み込み、${res.chars.length} キャラ分を保存しました：${res.chars.join("、") || "（該当なし）"}`
      + (res.unknown.length ? ` ／ 未対応のキャラ名：${res.unknown.join(", ")}（Dustloop表記を設定したカスタムキャラで対応できます）` : ""), 8000);
  } catch (err) { notify("framesMsg", "読み込みに失敗しました：" + err.message); }
  e.target.value = "";
});
$("clearFrames").addEventListener("click", e => {
  if (!armed(e.target)) return;
  state.frames = {}; save(); renderFramesStatus();
});
$("addChar").addEventListener("click", () => {
  const name = $("newName").value.trim(); if (!name) return;
  const tags = $("newTags").value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
  state.custom.push({ id: "custom_" + Date.now(), name, en: $("newEn").value.trim(), tags, tips: [] });
  $("newName").value = ""; $("newTags").value = ""; $("newEn").value = "";
  save(); renderAll();
});
$("customList").addEventListener("click", e => {
  const id = e.target.dataset.del; if (!id || !armed(e.target, "削除？")) return;
  state.custom = state.custom.filter(c => c.id !== id);
  save(); renderAll();
});
$("resetBtn").addEventListener("click", e => {
  if (!armed(e.target, "本当に削除する（もう一度押す）")) return;
  state.pairs = {}; state.log = []; state.puddle = []; state.puddleMeta = {}; save(); renderAll();
});

load();
// 同梱の Puddle Farm 履歴を初回だけ取り込む（必ず load() の後。前に置くと保存内容を上書きしてしまう）
if (!(state.puddle || []).length && typeof PUDDLE_SEED !== "undefined" && PUDDLE_SEED.length) {
  try { importPuddle(JSON.stringify(PUDDLE_SEED)); state.updatedAt = 0; localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}
renderAll();
cloudInit();
videosInit();
