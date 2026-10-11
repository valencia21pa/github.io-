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
const DEFAULT_STATE = () => ({ mine: "aba", opp: "sol", custom: [], pairs: {}, log: [], frames: {} });
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
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  if (showMark) {
    const m = document.getElementById("savedMark");
    m.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => m.classList.remove("show"), 1200);
  }
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

// 戦績 = 旧手動カウント + 試合ログ
function record(mine, opp) {
  const d = state.pairs[pairKeyOf(mine, opp)] || { wins: 0, losses: 0 };
  let w = d.wins || 0, l = d.losses || 0;
  for (const g of state.log) if (g.mine === mine && g.opp === opp) (g.result === "W" ? w++ : l++);
  return { w, l, games: w + l, rate: w + l ? w / (w + l) : -1 };
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
    <h2>相手：${esc(opp.name)}</h2>
    <div class="tags">${(opp.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    <p class="core">${esc(g.core)}</p>
    <div class="row between" style="margin:6px 0 2px"><h3 style="margin:0">対策の基本</h3><button class="small" id="guideToggle">すべて開く</button></div>
    ${sections}`;
}
function renderMatchup() {
  const opp = charById(state.opp), mine = charById(state.mine);
  $("oppInfo").innerHTML = renderGuide(opp);

  // 自キャラがアバの時だけ、アバ視点のメモを出す
  const aba = state.mine === "aba" && ABA_NOTES[state.opp];
  $("abaInfo").classList.toggle("hidden", !aba);
  if (aba) {
    $("abaInfo").innerHTML = `
      <h2>アバで ${esc(opp.name)} と戦う時</h2>
      <dl class="kv">
        <dt>立ち回り方針</dt><dd>${esc(aba.plan)}</dd>
        <dt>JRゲージ運用</dt><dd>${esc(aba.gauge)}</dd>
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
function renderFrames() {
  const opp = charById(state.opp);
  $("framesTitle").textContent = `${opp.name} のフレームデータ`;
  const km = KEY_MOVES[opp.id] || [];
  $("keyMoves").innerHTML = km.length ? `<h3>まず警戒する技</h3><div class="tags">${km.map(m => `<span class="tag neutral">${esc(m)}</span>`).join("")}</div>` : "";
  const rows = framesFor(opp.id);
  if (!rows.length) {
    $("framesBody").innerHTML = `<p class="muted" style="margin-top:12px">数値データは未取り込みです。「データ管理」タブから Dustloop の JSON を読み込むと、ここに発生・硬直差などの表が出ます。</p>`;
    return;
  }
  const fmtAdv = v => {
    if (v === "" || v == null) return "<span class='muted'>—</span>";
    const n = parseInt(v, 10);
    if (isNaN(n)) return esc(v);
    return `<span class="${n >= 0 ? "win" : (n <= -5 ? "lose" : "")}">${n > 0 ? "+" + n : n}</span>`;
  };
  $("framesBody").innerHTML = `
    <p class="muted">ガード後 −5 以下は赤字（確反が狙えることが多い）。詳しい注記は Dustloop を参照。</p>
    <div class="table-wrap"><table>
      <thead><tr><th>技</th><th>入力</th><th class="num">発生</th><th class="num">持続</th><th class="num">硬直</th><th class="num">ガード後</th><th class="num">ヒット後</th><th>ガード</th><th>Lv</th></tr></thead>
      <tbody>${rows.map(m => `<tr>
        <td>${esc(m.name)}</td><td>${esc(m.input)}</td>
        <td class="num">${esc(m.startup)}</td><td class="num">${esc(m.active)}</td><td class="num">${esc(m.recovery)}</td>
        <td class="num">${fmtAdv(m.onBlock)}</td><td class="num">${fmtAdv(m.onHit)}</td>
        <td>${esc(m.guard)}</td><td>${esc(m.level)}</td></tr>`).join("")}</tbody>
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
  const base = COMMON_DRILLS.map((t, i) => ({ id: "c" + i, ...norm(t) }))
    .concat((CHAR_DRILLS[oppId] || []).map((t, i) => ({ id: "k" + i, ...norm(t) })));
  return base.concat(d.customDrills.map((t, i) => ({ id: "u" + i, title: t, custom: true })));
}
function drillProgress(mine, opp) {
  const d = state.pairs[pairKeyOf(mine, opp)];
  const items = drillsFor(opp, d || { customDrills: [] });
  const done = d ? items.filter(it => d.drills && d.drills[it.id]).length : 0;
  return { done, total: items.length };
}
function renderDrills() {
  const opp = charById(state.opp), d = pairData();
  $("drillsTitle").textContent = `${opp.name} 対策の練習メニュー`;
  const items = drillsFor(opp.id, d);
  const done = items.filter(it => d.drills[it.id]).length;
  $("drillsBar").style.width = items.length ? (done / items.length * 100) + "%" : "0";
  $("drillsList").innerHTML = items.map(it => `
    <li class="${d.drills[it.id] ? "done" : ""}">
      <input type="checkbox" id="dr-${it.id}" data-drill="${it.id}" ${d.drills[it.id] ? "checked" : ""}>
      <div class="drill">
        <label for="dr-${it.id}">${esc(it.title)}</label>
        ${it.record ? `<dl class="drill-steps">
          <dt>記録</dt><dd>${esc(it.record)}</dd>
          <dt>やる</dt><dd>${esc(it.action)}</dd>
          <dt>合格</dt><dd>${esc(it.pass)}</dd>
        </dl>` : ""}
      </div>
      ${it.custom ? `<button class="small" data-deldrill="${it.id.slice(1)}">×</button>` : ""}
    </li>`).join("");
}

// ---- 試合ログ ----
let logDraft = { result: null, causes: new Set() };
function renderLogForm() {
  $("logPair").textContent = `${charById(state.mine).name} vs ${charById(state.opp).name}（上のセレクトで変更）`;
  if (!$("logDate").value) $("logDate").value = today();
  document.querySelectorAll(".result-btns button").forEach(b => b.classList.toggle("on", b.dataset.res === logDraft.result));
  $("causeChips").innerHTML = CAUSES.map(c => `<button data-cause="${esc(c)}" class="${logDraft.causes.has(c) ? "on" : ""}">${esc(c)}</button>`).join("");
}
function renderLogTable() {
  const rows = state.log.slice().reverse().slice(0, 50);
  $("logBody").innerHTML = rows.length ? rows.map(g => `
    <tr class="log-row">
      <td>${esc(g.date)}</td><td>${esc(charById(g.mine).name)}</td><td>${esc(charById(g.opp).name)}</td>
      <td class="${g.result === "W" ? "win" : "lose"}"><b>${g.result === "W" ? "勝" : "負"}</b></td>
      <td class="causes">${(g.causes || []).map(esc).join("、")}</td>
      <td class="muted">${esc(g.memo || "")}</td>
      <td><button class="small" data-dellog="${esc(g.id)}">×</button></td>
    </tr>`).join("") : "<tr><td colspan='7' class='muted'>まだ記録がありません</td></tr>";
}
function addGame(result, causes = [], memo = "", date = today()) {
  state.log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, mine: state.mine, opp: state.opp, result, causes, memo });
  save(true);
}

// ---- 分析 ----
function renderAnalysis() {
  const scope = $("anaScope").value;
  const games = state.log.filter(g => scope === "all" || (g.mine === state.mine && (scope === "mine" || g.opp === state.opp)));
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
      <div class="muted">${streak ? `${streak}連${streakType === "W" ? "勝" : "敗"}中` : ""}</div></div>`;

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
      <td>${esc(r.c.name)}</td>
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
  renderFramesStatus();
}

// ---- タブ ----
const TABS = ["matchup", "frames", "drills", "log", "analysis", "list", "system", "data"];
let currentTab = "matchup";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  for (const t of TABS) $("tab-" + t).classList.toggle("hidden", t !== name);
  renderTab(name);
}
function renderTab(name) {
  ({ matchup: renderMatchup, frames: renderFrames, drills: renderDrills, log: () => { renderLogForm(); renderLogTable(); },
     analysis: renderAnalysis, list: renderList, data: renderCustom, system: () => {} })[name]();
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

// 練習
$("drillsList").addEventListener("change", e => {
  const id = e.target.dataset.drill; if (!id) return;
  const d = pairData(); if (e.target.checked) d.drills[id] = true; else delete d.drills[id];
  save(true); renderDrills();
});
$("drillsList").addEventListener("click", e => {
  const i = e.target.dataset.deldrill; if (i == null) return;
  const d = pairData(); d.customDrills.splice(+i, 1);
  // 以降のカスタム項目のチェック状態がずれるので詰め直す
  const keep = {}; for (const k in d.drills) if (!k.startsWith("u")) keep[k] = true;
  d.drills = keep; save(true); renderDrills();
});
$("addDrill").addEventListener("click", () => {
  const t = $("newDrill").value.trim(); if (!t) return;
  pairData().customDrills.push(t); $("newDrill").value = ""; save(true); renderDrills();
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
  addGame(logDraft.result, [...logDraft.causes], $("logMemo").value.trim(), $("logDate").value || today());
  logDraft = { result: null, causes: new Set() }; $("logMemo").value = "";
  $("logMsg").textContent = "記録しました"; setTimeout(() => $("logMsg").textContent = "", 1500);
  renderLogForm(); renderLogTable();
});
$("logBody").addEventListener("click", e => {
  const id = e.target.dataset.dellog; if (!id || !armed(e.target, "削除？")) return;
  state.log = state.log.filter(g => g.id !== id); save(true); renderLogTable();
});

// 分析
$("anaScope").addEventListener("change", renderAnalysis);

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
  state.pairs = {}; state.log = []; save(); renderAll();
});

load();
renderAll();
