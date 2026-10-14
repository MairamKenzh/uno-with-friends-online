"use strict";
/*
 * Сервер «Последней карты».
 * Раздаёт страницу игры из папки public/ и держит игровые комнаты через Socket.IO.
 * Запуск:  npm install  →  npm start  →  http://localhost:3000
 */
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { Game } = require("./game");

const PORT = process.env.PORT || 3000;
const BOT_DELAY = 1300;        // бот думает 1.3 с
const OFFLINE_DELAY = 8000;    // за отключившегося игрока бот ходит через 8 с
const AFK_DELAY = 60000;       // если игрок в сети, но молчит минуту — ход делается за него
const LOBBY_GRACE = 20000;     // сколько ждать вернувшегося после обновления страницы в лобби
const ROOM_TTL = 30 * 60000;   // пустая комната удаляется через 30 минут

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4 });

/** code -> { g: Game, conns: Map(socketId -> pid), timers, last } */
const rooms = new Map();

const cleanName = s => String(s || "").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿<>]/g, "").trim().slice(0, 14) || "Игрок";
const cleanPid = s => (typeof s === "string" && /^[a-z0-9]{6,40}$/i.test(s) ? s : null);
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

function genCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (;;) {
    let s = "";
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(s)) return s;
  }
}

const online = R => new Set(R.conns.values());

/** Разослать каждому в комнате его версию состояния */
function broadcast(R) {
  R.last = Date.now();
  const on = online(R);
  for (const [sid, pid] of R.conns) {
    const s = io.sockets.sockets.get(sid);
    if (!s) { R.conns.delete(sid); continue; }
    if (R.g.idx(pid) < 0 && !R.g.watch.has(pid)) { // игрока убрали из комнаты
      s.emit("kicked");
      s.leave(R.g.code);
      s.data.code = null;
      R.conns.delete(sid);
      continue;
    }
    s.emit("state", R.g.view(pid, on));
  }
  schedule(R);
  listRooms();
}

function changed(R) { R.g.seq++; broadcast(R); }

/** Таймеры: ходы ботов, автоход за отсутствующих, ловля «Уно» ботами */
function schedule(R) {
  const g = R.g;
  if (g.ph !== "play") { clearTimeout(R.tTurn); clearTimeout(R.tCatch); R.turnKey = R.catchKey = ""; return; }
  const P = g.pl[g.tu];
  const away = !P.bot && !online(R).has(P.id);
  const key = g.seq + ":" + (P.bot ? "b" : away ? "a" : "h");
  if (key !== R.turnKey) {
    R.turnKey = key;
    clearTimeout(R.tTurn);
    const delay = P.bot ? BOT_DELAY : away ? (g.drew ? 2500 : OFFLINE_DELAY) : AFK_DELAY;
    const seq = g.seq;
    R.tTurn = setTimeout(() => {
      if (g.seq !== seq || g.ph !== "play") return;
      if (g.botMove()) changed(R);
    }, delay);
  }
  const ck = g.seq + ":" + g.uv;
  if (ck !== R.catchKey) {
    R.catchKey = ck;
    clearTimeout(R.tCatch);
    const v = g.uv && g.pl.find(p => p.id === g.uv);
    const bots = g.pl.filter(p => p.bot && p.id !== g.uv);
    if (v && !v.bot && bots.length && Math.random() < 0.5) {
      const seq = g.seq;
      R.tCatch = setTimeout(() => {
        if (g.seq !== seq || !g.uv) return;
        if (g.apply(bots[0].id, { t: "catch" })) changed(R);
      }, 900 + Math.random() * 900);
    }
  }
}

/** Список открытых комнат для главного экрана */
let lastList = "[]";
function listRooms() {
  const list = [];
  for (const R of rooms.values()) {
    if (R.g.solo || !R.conns.size || R.g.ph === "end") continue;
    const h = R.g.pl.find(p => p.id === R.g.host);
    list.push({ code: R.g.code, nm: h ? h.nm : "", n: R.g.pl.length, ph: R.g.ph });
  }
  const s = JSON.stringify(list.slice(0, 12));
  if (s !== lastList) { lastList = s; io.emit("rooms", list.slice(0, 12)); }
}

function attach(s, R, pid) {
  s.data.code = R.g.code;
  s.data.pid = pid;
  s.join(R.g.code);
  R.conns.set(s.id, pid);
}

function detach(s) {
  const R = rooms.get(s.data.code);
  s.data.code = null;
  if (!R) return null;
  R.conns.delete(s.id);
  return R;
}

io.on("connection", s => {
  s.emit("rooms", JSON.parse(lastList));

  s.on("create", (d, cb) => {
    if (typeof cb !== "function") return;
    const pid = cleanPid(d && d.pid);
    if (!pid) return cb({ ok: false, err: "Обновите страницу и попробуйте снова" });
    leaveCurrent(s, pid);
    const code = genCode();
    const g = new Game(code, pid);
    g.join(pid, cleanName(d.nm));
    if (d.solo) { g.solo = true; g.addBot(); g.addBot(); g.startRound(); }
    const R = { g, conns: new Map(), last: Date.now() };
    rooms.set(code, R);
    attach(s, R, pid);
    cb({ ok: true, code });
    broadcast(R);
  });

  s.on("join", (d, cb) => {
    if (typeof cb !== "function") return;
    const pid = cleanPid(d && d.pid);
    const code = cleanCode(d && d.code);
    const R = rooms.get(code);
    if (!pid) return cb({ ok: false, err: "Обновите страницу и попробуйте снова" });
    if (!R) return cb({ ok: false, err: "Комната " + code + " не найдена" });
    if (s.data.code !== code) leaveCurrent(s, pid);
    R.g.join(pid, cleanName(d.nm));
    if (!R.g.host) R.g.host = pid;
    attach(s, R, pid);
    cb({ ok: true, code });
    changed(R);
  });

  s.on("act", a => {
    const R = rooms.get(s.data.code);
    if (!R || !a || typeof a !== "object") return;
    const pid = s.data.pid;
    // Если хост пропал, кнопки хоста может нажать любой игрок — он становится хостом
    if (["start", "again", "tolobby", "addbot", "kick"].includes(a.t) && R.g.host !== pid && !online(R).has(R.g.host) && R.g.idx(pid) >= 0) R.g.host = pid;
    if (R.g.apply(pid, a)) changed(R);
    else s.emit("state", R.g.view(pid, online(R)));
  });

  s.on("leave", () => {
    const pid = s.data.pid;
    const R = detach(s);
    if (!R) return;
    s.leave(R.g.code);
    if (!online(R).has(pid)) R.g.leave(pid);
    changed(R);
  });

  s.on("disconnect", () => {
    const pid = s.data.pid;
    const R = detach(s);
    if (!R) return;
    broadcast(R);
    // В лобби отключившийся игрок освобождает место, если не вернулся за 20 с
    setTimeout(() => {
      if (rooms.get(R.g.code) !== R || online(R).has(pid)) return;
      if (R.g.ph === "lobby") { R.g.leave(pid); changed(R); }
    }, LOBBY_GRACE);
  });
});

function leaveCurrent(s, pid) {
  const R = detach(s);
  if (!R) return;
  s.leave(R.g.code);
  if (!online(R).has(pid)) { R.g.leave(pid); changed(R); }
}

// Уборка пустых комнат
setInterval(() => {
  const now = Date.now();
  for (const [code, R] of rooms) {
    if (!R.conns.size && now - R.last > ROOM_TTL) {
      clearTimeout(R.tTurn); clearTimeout(R.tCatch);
      rooms.delete(code);
    }
  }
  listRooms();
}, 60000);

server.listen(PORT, () => {
  console.log("«Последняя карта» запущена: http://localhost:" + PORT);
});
