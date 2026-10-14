/* Клиент «Последней карты»: рисует стол и отправляет ходы на сервер через Socket.IO */
(function () {
"use strict";

/* ---------- утилиты ---------- */
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = s => String(s || "").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿<>]/g, "").trim().slice(0, 14);
const $ = id => document.getElementById(id);
let toastT = null;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }

/* ---------- карты ---------- */
const COLORS = ["r", "y", "g", "b"];
const CNAME = { r: "красная", y: "жёлтая", g: "зелёная", b: "синяя" };
const CNAME2 = { r: "красный", y: "жёлтый", g: "зелёный", b: "синий" };
const CVAR = { r: "var(--red)", y: "var(--yel)", g: "var(--grn)", b: "var(--blu)" };
const SYM = { S: "⊘", R: "⇄", D: "+2" };
function canPlay(card, top, col) { if (!card || !top) return false; if (card[0] === "w") return true; return card[0] === col || card[1] === top[1]; }
function cardName(c) {
  if (c === "wW") return "Заказ цвета"; if (c === "wF") return "+4";
  const v = { S: "Пропуск", R: "Разворот", D: "+2" }[c[1]];
  return CNAME[c[0]] + " " + (v || c[1]);
}
function cardHTML(c, o) {
  o = o || {};
  const tag = o.btn ? "button" : "div";
  const attrs = (o.attrs || "") + (o.btn ? ' type="button"' : "") + ' aria-label="' + esc(c === "back" ? "Колода" : cardName(c)) + '"';
  const cls = "card " + (o.cls || "");
  if (c === "back") return `<${tag} class="${cls} back"${attrs}><span class="big">◆</span></${tag}>`;
  if (c[0] === "w") {
    const t = c[1] === "F" ? "+4" : "";
    return `<${tag} class="${cls} c-w"${attrs}>${t ? `<span class="ix">${t}</span><span class="ix b">${t}</span>` : ""}<span class="disc"><span>${t}</span></span></${tag}>`;
  }
  const v = c[1], lab = SYM[v] || v, sym = v === "S" || v === "R" ? " sym" : "";
  return `<${tag} class="${cls} c-${c[0]}"${attrs}><span class="ix${sym}">${lab}</span><span class="big${sym}">${lab}</span><span class="ix b${sym}">${lab}</span></${tag}>`;
}

/* ---------- кто я ---------- */
let myPid = LS.get("lk.pid");
if (!myPid || !/^[a-z0-9]{6,40}$/i.test(myPid)) { myPid = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); LS.set("lk.pid", myPid); }
let myName = clean(LS.get("lk.name")) || "Игрок " + (10 + Math.floor(Math.random() * 89));

/* ---------- страница открыта без сервера ---------- */
if (typeof io !== "function") {
  $("screen").innerHTML = `<section class="box" style="max-width:640px">
    <h2>Сервер не запущен</h2>
    <p class="note">Эту страницу нельзя открыть двойным щелчком по файлу: игре нужен сервер, который раздаёт карты и связывает игроков.</p>
    <ol class="note" style="padding-left:20px;display:flex;flex-direction:column;gap:6px;margin:0">
      <li>Установите Node.js (версия LTS) с сайта nodejs.org.</li>
      <li>Откройте папку <b>uno-online</b>, где лежит файл <b>package.json</b>, щёлкните по адресной строке проводника, введите <b>cmd</b> и нажмите Enter.</li>
      <li>В чёрном окне введите <b>npm install</b>, затем <b>npm start</b>. Окно не закрывайте.</li>
      <li>Откройте в браузере <b>http://localhost:3000</b>.</li>
    </ol></section>`;
  return;
}

/* ---------- состояние ---------- */
const socket = io();
let connected = false, screen = "home", view = null, code = null, pending = false, pick = null, rooms = [], lastTop = "";
let sel = []; // выбранные карты (номера в руке) для хода несколькими одинаковыми
const urlRoom = (new URLSearchParams(location.search).get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

socket.on("connect", () => {
  connected = true;
  // после обновления страницы или обрыва связи возвращаемся в свою комнату
  const back = code || (urlRoom && LS.get("lk.room") === urlRoom ? urlRoom : null);
  if (back) joinRoom(back, true);
  render();
});
socket.on("disconnect", () => { connected = false; render(); });
socket.on("rooms", l => { rooms = Array.isArray(l) ? l : []; if (screen === "home") { const r = $("rooms"); if (r) r.innerHTML = roomsHTML(); } });
socket.on("state", v => {
  if (!code || !v || v.code !== code) return;
  if (!view || v.seq !== view.seq) sel = [];
  view = v; pending = false; render();
});
socket.on("kicked", () => { goHome(); toast("Вас убрали из комнаты"); });

function setUrl(c) {
  try { const u = new URL(location.href); if (c) u.searchParams.set("room", c); else u.searchParams.delete("room"); history.replaceState(null, "", u); } catch (e) {}
}
const inviteLink = () => location.origin + location.pathname + "?room=" + code;

function createRoom(solo) {
  socket.emit("create", { pid: myPid, nm: myName, solo: !!solo }, r => {
    if (!r || !r.ok) return toast((r && r.err) || "Не удалось создать комнату");
    enter(r.code);
  });
}
function joinRoom(c, quiet) {
  socket.emit("join", { code: c, pid: myPid, nm: myName }, r => {
    if (!r || !r.ok) {
      toast((r && r.err) || "Не удалось войти");
      LS.del("lk.room");
      if (code === c || quiet) goHome();
      return;
    }
    enter(r.code);
  });
}
function enter(c) { if (code !== c) view = null; code = c; screen = "game"; LS.set("lk.room", c); setUrl(c); render(); }
function goHome() { code = null; view = null; pick = null; screen = "home"; LS.del("lk.room"); setUrl(null); render(); }
function send(t, extra) {
  if (!connected) return toast("Нет связи с сервером");
  pending = true;
  socket.emit("act", Object.assign({ t }, extra || {}));
  render();
}
function saveName() { const n = clean(($("nm") || {}).value); if (n) { myName = n; LS.set("lk.name", n); } }

/* ---------- отрисовка ---------- */
function render() {
  $("net").hidden = connected;
  if (screen === "home") renderHome(); else renderGame();
  renderOverlay();
}

function renderHome() {
  const focusId = document.activeElement && document.activeElement.id;
  const prevCode = ($("code") || {}).value;
  const prevNm = ($("nm") || {}).value;
  const dis = connected ? "" : "disabled";
  $("screen").innerHTML = `
  <div class="home">
    <section class="box">
      <h2>Ваше имя</h2>
      <label class="f" for="nm">Так вас увидят другие игроки<input class="t" id="nm" maxlength="14" autocomplete="nickname" value="${esc(prevNm != null ? prevNm : myName)}"></label>
      <button class="btn y" data-act="create" ${dis}>Создать комнату</button>
      <button class="btn ghost" data-act="solo" ${dis}>Тренировка с ботами</button>
    </section>
    <section class="box">
      <h2>Войти к друзьям</h2>
      <label class="f" for="code">Код комнаты из 4 символов<input class="t code" id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(prevCode != null ? prevCode : urlRoom)}"></label>
      <button class="btn g" data-act="join" ${dis}>Войти</button>
      ${urlRoom ? `<p class="note">Вас пригласили в комнату <b>${esc(urlRoom)}</b>. Введите имя и нажмите «Войти».</p>` : ""}
      <h2 style="margin-top:6px">Открытые комнаты</h2>
      <div class="rooms" id="rooms">${roomsHTML()}</div>
    </section>
    <section class="box wide">
      <h2>Как играть</h2>
      <ul class="rules">
        <li>${cardHTML("b7", { cls: "mini" })}<span><b>Совпадение.</b> Кладите карту того же цвета или с тем же числом либо знаком.</span></li>
        <li>${cardHTML("rS", { cls: "mini" })}<span><b>Пропуск и разворот.</b> Следующий игрок пропускает ход; разворот меняет направление.</span></li>
        <li>${cardHTML("gD", { cls: "mini" })}<span><b>+2 и +4.</b> Следующий берёт карты и пропускает ход. Стопки не складываются.</span></li>
        <li>${cardHTML("wW", { cls: "mini" })}<span><b>Заказ цвета.</b> Кладётся на что угодно, вы выбираете цвет.</span></li>
        <li>${cardHTML("back", { cls: "mini" })}<span><b>Нечем ходить?</b> Возьмите карту из колоды. Если подходит — можно сразу сыграть её.</span></li>
        <li>${cardHTML("g5", { cls: "mini" })}<span><b>Одинаковые разом.</b> Есть несколько карт с тем же числом или знаком — выберите их и положите за один ход.</span></li>
        <li>${cardHTML("yR", { cls: "mini" })}<span><b>«Уно!»</b> Осталась одна карта — появится кнопка «Уно!», жмите её. Не успели — соперник поймает, и вы возьмёте 2.</span></li>
      </ul>
    </section>
  </div>`;
  if (focusId) { const el = $(focusId); if (el) { el.focus(); try { const l = el.value.length; el.setSelectionRange(l, l); } catch (e) {} } }
}
function roomsHTML() {
  if (!rooms.length) return `<p class="note">Пока никто не открыл комнату. Создайте свою и отправьте друзьям ссылку.</p>`;
  return rooms.map(o => {
    const c = String(o.code).replace(/[^A-Z0-9]/g, "").slice(0, 4);
    return `<div class="roomrow"><b>${esc(c)}</b><span>${esc(clean(o.nm) || "Игрок")} · ${o.n | 0} игр. · ${o.ph === "play" ? "идёт игра" : "ждут игроков"}</span><button class="btn sm g" data-act="joincode" data-code="${esc(c)}" ${connected ? "" : "disabled"}>Войти</button></div>`;
  }).join("");
}

function seatsHTML(v, lobby) {
  const amHost = v.host === myPid;
  return `<div class="seats">${v.pl.map((p, k) => {
    const off = !p.on;
    const turn = !lobby && v.ph === "play" && k === v.tu;
    const tags = [
      p.b ? '<span class="tag">бот</span>' : "",
      p.id === v.host && !v.solo ? '<span class="tag">хост</span>' : "",
      !lobby && p.n === 1 && v.ph === "play" ? '<span class="tag uno">1 карта</span>' : "",
      off ? '<span class="tag off">не в сети</span>' : "",
    ].join(" ");
    const kick = lobby && amHost && p.id !== myPid ? `<button class="x" data-act="kick" data-id="${esc(p.id)}" aria-label="Убрать ${esc(p.nm)}">×</button>` : "";
    return `<div class="seat ${turn ? "turn" : ""} ${p.id === myPid ? "me" : ""} ${off ? "off" : ""}">${lobby ? "" : '<span class="stack" aria-hidden="true"><i></i><i></i></span>'}<span class="info"><span class="nm">${esc(p.nm)}</span><span class="meta">${lobby ? "" : p.n + " карт · "}побед: ${p.w | 0}</span></span>${tags}${kick}</div>`;
  }).join("")}</div>`;
}

function renderGame() {
  const v = view;
  const bar = `<div class="bar">
    ${v && v.solo ? '<div class="codechip">Тренировка</div>' : `<div class="codechip">Комната <b>${esc(code)}</b></div><button class="btn sm y" data-act="invite">Пригласить</button>`}
    <span class="grow"></span><button class="btn sm ghost" data-act="leave">Выйти</button></div>`;
  if (!v) { $("screen").innerHTML = bar + `<div class="lobby"><div class="spin"></div><p>Подключаемся к комнате ${esc(code)}…</p></div>`; return; }

  const me = v.pl.find(p => p.id === myPid);
  const amHost = v.host === myPid;
  if (v.ph === "lobby") {
    $("screen").innerHTML = bar + `
    <div class="lobby">
      <p>Код комнаты</p><p class="bigcode">${esc(code)}</p>
      <p>Отправьте друзьям ссылку — она откроет игру сразу в этой комнате. Или пусть введут код на главной странице. Игроков: ${v.pl.length} из 10.</p>
      <div class="linkbox"><input class="t" id="invlink" readonly value="${esc(inviteLink())}" aria-label="Ссылка-приглашение"><button class="btn y" data-act="invite">Копировать</button></div>
      ${seatsHTML(v, true)}
      ${amHost
        ? `<div class="acts"><button class="btn ghost" data-act="addbot" ${v.pl.length >= 10 ? "disabled" : ""}>+ Бот</button><button class="btn y" data-act="start" ${v.pl.length < 2 ? "disabled" : ""}>Начать игру</button></div>${v.pl.length < 2 ? '<p class="note">Нужно минимум 2 игрока — позовите друга или добавьте бота.</p>' : ""}`
        : `<p class="note">${me ? "Вы за столом. Ждём, пока хост начнёт игру." : "Стол заполнен — вы сядете в следующей партии."}</p>`}
    </div>`;
    return;
  }

  const hand = v.hand || [];
  const turnP = v.pl[v.tu];
  const myTurn = v.ph === "play" && turnP && turnP.id === myPid;
  const top = v.top;
  const popTop = top !== lastTop; lastTop = top;
  const uvP = v.uv && v.pl.find(p => p.id === v.uv);
  const canCatch = v.ph === "play" && uvP && v.uv !== myPid && me;
  const showUno = v.ph === "play" && me && v.uv === myPid; // «Уно!» — только когда осталась одна карта
  if (!myTurn) sel = [];
  const selVal = sel.length ? hand[sel[0]][1] : null;
  let status, hint = "";
  if (v.ph === "end") { const w = v.pl.find(p => p.id === v.win); status = w ? (w.id === myPid ? "Вы победили!" : w.nm + " побеждает") : "Партия окончена"; }
  else if (showUno) { status = "Жмите «Уно!»"; hint = "У вас осталась одна карта — успейте, пока вас не поймали"; }
  else if (myTurn && sel.length) { status = "Выбрано карт: " + sel.length; hint = "Добавьте ещё одинаковые карты или нажмите «Положить»"; }
  else if (myTurn) { status = "Ваш ход"; hint = v.drew ? "Взятая карта подходит — сыграйте её или пасуйте" : "Сыграйте подсвеченную карту или возьмите из колоды"; }
  else { status = "Ходит " + (turnP ? turnP.nm : "…"); if (turnP && !turnP.on) hint = "Игрок не в сети — через несколько секунд за него сходит бот"; }
  if (!me) hint = "Вы смотрите игру и сядете за стол в следующей партии.";

  $("screen").innerHTML = bar + `
    ${seatsHTML(v, false)}
    <div class="table" style="--cur:${CVAR[v.col] || "transparent"}">
      <span class="dir ${v.dir < 0 ? "ccw" : ""}" title="Направление хода">↻</span>
      <div class="pile">
        <button class="drawbtn ${myTurn && !v.drew && !pending ? "can" : ""}" data-act="draw" ${myTurn && !v.drew && !pending ? "" : "disabled"} aria-label="Взять карту из колоды">${cardHTML("back")}</button>
        <small>колода · ${v.dc | 0}</small>
      </div>
      <div class="pile">
        <div class="disc-wrap">${top ? cardHTML(top, { cls: popTop ? "pop" : "" }) : ""}</div>
        <span class="curcol"><i></i>${esc(CNAME2[v.col] || "")} цвет</span>
      </div>
    </div>
    <div class="status ${myTurn ? "mine" : ""}" role="status">${esc(status)}</div>
    <div class="hint">${esc(hint)}</div>
    <div class="acts">
      ${myTurn && v.drew ? `<button class="btn" data-act="pass" ${pending ? "disabled" : ""}>Пас</button>` : ""}
      ${myTurn && sel.length ? `<button class="btn y" data-act="playsel" ${pending ? "disabled" : ""}>Положить ${sel.length > 1 ? sel.length + " карты" : "карту"}</button><button class="btn ghost" data-act="clearsel">Отмена</button>` : ""}
      ${showUno ? `<button class="btn uno pulse" data-act="uno" ${pending ? "disabled" : ""}>Уно!</button>` : ""}
      ${canCatch ? `<button class="btn y" data-act="catch">Поймать ${esc(uvP.nm)}!</button>` : ""}
    </div>
    ${me ? `<div class="handwrap"><div class="handhead"><span>Ваши карты</span><span>${hand.length}</span></div>
      <div class="hand ${myTurn ? "myturn" : ""} ${pending ? "busy" : ""}">${hand.map((c, k) => {
        const n = sel.indexOf(k);
        let cls = "";
        if (n >= 0) cls = "sel";
        else if (sel.length) cls = c[0] !== "w" && c[1] === selVal ? "ok" : "";
        else if (myTurn && canPlay(c, top, v.col) && (!v.drew || k === hand.length - 1)) cls = "ok";
        const badge = n >= 0 && sel.length > 1 ? `<span class="ord">${n + 1}</span>` : "";
        return cardHTML(c, { btn: true, cls, attrs: ` data-act="card" data-i="${k}"` }).replace(/<\/button>$/, badge + "</button>");
      }).join("")}</div></div>` : ""}
    <ul class="log">${v.log.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

function plural(n) { const a = n % 10, b = n % 100; if (a === 1 && b !== 11) return "победа"; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "победы"; return "побед"; }

function renderOverlay() {
  const o = $("overlay");
  if (screen !== "game" || !view) { o.innerHTML = ""; return; }
  if (pick) {
    o.innerHTML = `<div class="ov"><div class="sheet" role="dialog" aria-label="Выбор цвета"><h3>Выберите цвет</h3><div class="swatches">${COLORS.map(c => `<button class="sw" style="background:${CVAR[c]}" data-act="pickcol" data-c="${c}">${CNAME2[c]}</button>`).join("")}</div><button class="btn ghost" data-act="cancelpick">Отмена</button></div></div>`;
    return;
  }
  if (view.ph === "end") {
    const w = view.pl.find(p => p.id === view.win);
    const sc = view.pl.slice().sort((a, b) => b.w - a.w);
    const amHost = view.host === myPid;
    const hostOff = !(view.pl.find(p => p.id === view.host) || {}).on;
    o.innerHTML = `<div class="ov"><div class="sheet"><h3>${w ? (w.id === myPid ? "Вы победили!" : esc(w.nm) + " побеждает!") : "Партия окончена"}</h3>
      <ul class="score">${sc.map(p => `<li class="${p.id === view.win ? "win" : ""}"><span>${esc(p.nm)}${p.id === myPid ? " (вы)" : ""}</span><b>${p.w | 0} ${plural(p.w | 0)}</b></li>`).join("")}</ul>
      ${amHost || hostOff ? `<button class="btn y" data-act="again">Ещё партию</button><button class="btn ghost" data-act="tolobby">В лобби</button>` : `<p class="note">Ждём, пока хост начнёт новую партию.</p>`}
      <button class="btn ghost" data-act="leave">Выйти из комнаты</button></div></div>`;
    return;
  }
  o.innerHTML = "";
}

/* ---------- события ---------- */
document.addEventListener("input", e => {
  if (e.target.id === "nm") { const n = clean(e.target.value); if (n) { myName = n; LS.set("lk.name", n); } }
  if (e.target.id === "code") e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "code") { const b = document.querySelector('[data-act="join"]'); if (b) b.click(); }
  if (e.key === "Escape" && pick) { pick = null; renderOverlay(); }
});

let leaveArmed = null;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  switch (a) {
    case "create": saveName(); createRoom(false); break;
    case "solo": saveName(); createRoom(true); break;
    case "join": case "joincode": {
      const c = (a === "join" ? ($("code") || {}).value : b.dataset.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length !== 4) return toast("Введите код из 4 символов");
      saveName(); joinRoom(c, false); break;
    }
    case "invite": {
      const link = inviteLink();
      const fallback = () => { const i = $("invlink"); if (i) { i.focus(); i.select(); } toast("Ссылка: " + link); };
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        navigator.share({ title: "Последняя карта", text: "Заходи играть! Код комнаты " + code, url: link }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована — отправьте её друзьям"), fallback);
      } else fallback();
      break;
    }
    case "leave": {
      if (view && view.ph === "play" && leaveArmed !== b) {
        leaveArmed = b; b.textContent = "Точно выйти?";
        setTimeout(() => { if (leaveArmed === b) { leaveArmed = null; if (b.isConnected) b.textContent = "Выйти"; } }, 3000);
        return;
      }
      leaveArmed = null;
      socket.emit("leave"); goHome(); break;
    }
    case "addbot": case "start": case "again": case "tolobby": case "draw": case "pass": case "uno": case "catch":
      send(a); break;
    case "kick": send("kick", { id: b.dataset.id }); break;
    case "card": {
      const v = view; if (!v || !v.hand) return;
      const h = v.hand, k = +b.dataset.i, c = h[k];
      const myTurn = v.ph === "play" && v.pl[v.tu] && v.pl[v.tu].id === myPid;
      const shake = () => { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); };
      if (!myTurn) { shake(); toast("Сейчас не ваш ход"); return; }
      // уже выбраны карты: добавляем/убираем одинаковые
      if (sel.length) {
        const n = sel.indexOf(k);
        if (n === 0) { sel = []; render(); return; }               // сняли первую — выбор сбрасывается
        if (n > 0) { sel.splice(n, 1); render(); return; }
        if (c[0] !== "w" && c[1] === h[sel[0]][1]) { sel.push(k); render(); return; }
        if (!canPlay(c, v.top, v.col)) { shake(); return; }
        sel = [];                                                    // другая подходящая карта — начинаем заново
      }
      if (!canPlay(c, v.top, v.col) || (v.drew && k !== h.length - 1)) { shake(); return; }
      const twins = c[0] !== "w" && !v.drew && h.some((x, j) => j !== k && x[0] !== "w" && x[1] === c[1]);
      if (twins) { sel = [k]; render(); return; }                    // есть такие же — даём выбрать ещё
      playCards([k]); break;
    }
    case "playsel": playCards(sel.slice()); break;
    case "clearsel": sel = []; render(); break;
    case "pickcol": { if (!pick) return; const p = pick; pick = null; sel = []; send("play", { list: p.list, col: b.dataset.c }); break; }
    case "cancelpick": pick = null; renderOverlay(); break;
  }
});

/** Положить карты по номерам в руке; для чёрной карты сначала спрашиваем цвет */
function playCards(ks) {
  const h = view && view.hand; if (!h || !ks.length) return;
  const list = ks.map(k => ({ i: k, c: h[k] }));
  if (list[list.length - 1].c[0] === "w") {
    pick = { list }; renderOverlay();
    const f = document.querySelector(".sw"); if (f) f.focus();
    return;
  }
  sel = [];
  send("play", { list });
}

render();
})();