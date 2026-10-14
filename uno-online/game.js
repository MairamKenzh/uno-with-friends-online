"use strict";
/*
 * Игровая логика «Последней карты» (правила Уно).
 * Сервер хранит полное состояние; каждому игроку отправляется только его рука.
 *
 * Карта кодируется двумя символами: цвет + значение.
 *   цвет:  r — красный, y — жёлтый, g — зелёный, b — синий, w — чёрная (дикая)
 *   значение: 0–9, S — пропуск, R — разворот, D — +2, W — заказ цвета, F — +4
 */

const COLORS = ["r", "y", "g", "b"];
const CNAME = { r: "красная", y: "жёлтая", g: "зелёная", b: "синяя" };
const CNAME2 = { r: "красный", y: "жёлтый", g: "зелёный", b: "синий" };
const BOT_NAMES = ["Бот Буран", "Бот Кедр", "Бот Луна", "Бот Сокол", "Бот Искра", "Бот Тень", "Бот Ёж", "Бот Гром", "Бот Мята"];
const MAX_PLAYERS = 10;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Колода из 108 карт */
function newDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push(c + "0");
    for (const v of "123456789SRD") d.push(c + v, c + v);
  }
  for (let i = 0; i < 4; i++) d.push("wW", "wF");
  return shuffle(d);
}

function canPlay(card, top, col) {
  if (!card || !top) return false;
  if (card[0] === "w") return true;
  return card[0] === col || card[1] === top[1];
}

function cardName(c) {
  if (c === "wW") return "«Заказ цвета»";
  if (c === "wF") return "«+4»";
  const v = { S: "«Пропуск»", R: "«Разворот»", D: "«+2»" }[c[1]];
  return v ? CNAME[c[0]] + " " + v : CNAME[c[0]] + " " + c[1];
}

let botSeq = 0;

class Game {
  constructor(code, hostPid) {
    this.code = code;
    this.host = hostPid;
    this.ph = "lobby"; // lobby | play | end
    this.pl = [];      // {id, nm, bot, left, hand, w, uno}
    this.watch = new Map(); // зрители, ждущие следующей партии: pid -> имя
    this.deck = [];
    this.disc = [];
    this.col = "r";
    this.tu = 0;
    this.dir = 1;
    this.drew = false;
    this.uv = null;  // кто положил предпоследнюю карту без «Уно!» и может быть пойман
    this.win = null;
    this.log = [];
    this.seq = 0;
    this.solo = false;
  }

  addLog(s) {
    this.log.push(String(s).slice(0, 80));
    while (this.log.length > 4) this.log.shift();
  }
  idx(pid) { return this.pl.findIndex(p => p.id === pid); }
  nextIdx(k) { const n = this.pl.length; return (((this.tu + this.dir * k) % n) + n) % n; }
  advance(k) { this.tu = this.nextIdx(k); this.drew = false; }

  drawTo(i, n) {
    const P = this.pl[i];
    for (let k = 0; k < n; k++) {
      if (!this.deck.length) {
        const top = this.disc.pop();
        this.deck = shuffle(this.disc);
        this.disc = [top];
        if (!this.deck.length) break;
      }
      P.hand.push(this.deck.pop());
    }
  }

  /** Игрок входит в комнату. Возвращает "player" или "watch". */
  join(pid, nm) {
    const P = this.pl.find(p => p.id === pid);
    if (P) {
      P.nm = nm;
      if (P.left) { P.left = false; P.bot = false; }
      return "player";
    }
    if (this.ph === "lobby" && this.pl.length < MAX_PLAYERS) {
      this.pl.push({ id: pid, nm, bot: false, left: false, hand: [], w: 0, uno: false });
      this.watch.delete(pid);
      return "player";
    }
    this.watch.set(pid, nm);
    return "watch";
  }

  /** Игрок сам вышел (или пропал из лобби). */
  leave(pid) {
    this.watch.delete(pid);
    const i = this.idx(pid);
    if (i >= 0) {
      const P = this.pl[i];
      if (this.ph === "play") {
        P.bot = true; P.left = true;
        this.addLog(P.nm + " вышел — за него доигрывает бот");
      } else {
        this.pl.splice(i, 1);
        if (this.tu >= this.pl.length) this.tu = 0;
      }
    }
    if (pid === this.host) {
      const next = this.pl.find(p => !p.bot);
      this.host = next ? next.id : null;
    }
  }

  humans() { return this.pl.filter(p => !p.bot).length + this.watch.size; }

  addBot() {
    if (this.pl.length >= MAX_PLAYERS) return false;
    const used = new Set(this.pl.map(p => p.nm));
    const nm = BOT_NAMES.find(n => !used.has(n)) || "Бот " + this.pl.length;
    this.pl.push({ id: "bot" + (++botSeq), nm, bot: true, left: false, hand: [], w: 0, uno: false });
    return true;
  }

  /** Зрители садятся за стол, ушедшие игроки убираются. */
  tidy() {
    this.pl = this.pl.filter(p => !p.left);
    for (const [pid, nm] of this.watch) {
      if (this.pl.length >= MAX_PLAYERS) break;
      this.pl.push({ id: pid, nm, bot: false, left: false, hand: [], w: 0, uno: false });
      this.watch.delete(pid);
    }
  }

  startRound() {
    this.tidy();
    if (this.pl.length < 2) return false;
    this.deck = newDeck();
    this.disc = [];
    this.pl.forEach(P => { P.hand = []; P.uno = false; });
    for (let k = 0; k < 7; k++) this.pl.forEach((P, i) => this.drawTo(i, 1));
    let c;
    for (;;) { // первая карта в сброс — обычная цифра
      c = this.deck.pop();
      if (c[0] !== "w" && !"SRD".includes(c[1])) break;
      this.deck.unshift(c);
    }
    this.disc = [c];
    this.col = c[0];
    this.dir = 1;
    this.drew = false;
    this.uv = null;
    this.win = null;
    this.ph = "play";
    this.tu = Math.floor(Math.random() * this.pl.length);
    this.log = [];
    this.addLog("Раздано по 7 карт. Первым ходит " + this.pl[this.tu].nm);
    return true;
  }

  /** Применить действие игрока. Возвращает true, если состояние изменилось. */
  apply(pid, a) {
    if (!a || typeof a.t !== "string") return false;
    const i = this.idx(pid);
    const P = this.pl[i];
    const isHost = pid === this.host;

    switch (a.t) {
      case "addbot":
        return isHost && this.ph === "lobby" && this.addBot();
      case "kick": {
        if (!isHost || this.ph !== "lobby" || a.id === pid) return false;
        const k = this.idx(String(a.id));
        if (k < 0) return false;
        this.pl.splice(k, 1);
        return true;
      }
      case "start":
      case "again":
        if (!isHost || this.ph === "play") return false;
        return this.startRound();
      case "tolobby":
        if (!isHost || this.ph !== "end") return false;
        this.ph = "lobby";
        this.tidy();
        this.pl.forEach(p => { p.hand = []; });
        this.log = [];
        return true;
    }

    if (this.ph !== "play" || i < 0) return false;
    const top = this.disc[this.disc.length - 1];

    switch (a.t) {
      case "play": {
        if (i !== this.tu) return false;
        const h = P.hand, k = a.i | 0, c = h[k];
        if (c !== a.c || !canPlay(c, top, this.col)) return false;
        if (this.drew && k !== h.length - 1) return false; // после взятия можно сыграть только взятую
        if (c[0] === "w" && !COLORS.includes(a.col)) return false;
        this.uv = null;
        h.splice(k, 1);
        this.disc.push(c);
        this.col = c[0] === "w" ? a.col : c[0];
        this.addLog(P.nm + ": " + cardName(c) + (c[0] === "w" ? " → " + CNAME2[a.col] : ""));
        if (h.length === 0) {
          this.win = P.id; P.w++; this.ph = "end"; P.uno = false;
          this.addLog(P.nm + " выигрывает партию!");
          return true;
        }
        if (h.length === 1 && !P.uno) this.uv = P.id;
        if (h.length === 1 && P.uno) this.addLog(P.nm + ": «Уно!»");
        P.uno = false;
        const n = this.pl.length, v = c[1];
        let step = 1;
        if (v === "R") { this.dir *= -1; if (n === 2) step = 2; }
        if (v === "S") step = 2;
        if (v === "D" || v === "F") {
          const t = this.nextIdx(1), m = v === "D" ? 2 : 4;
          this.drawTo(t, m);
          this.pl[t].uno = false;
          this.addLog(this.pl[t].nm + " берёт " + m + " и пропускает ход");
          step = 2;
        }
        this.advance(step);
        return true;
      }
      case "draw": {
        if (i !== this.tu || this.drew) return false;
        this.uv = null; P.uno = false;
        this.drawTo(i, 1);
        const c = P.hand[P.hand.length - 1];
        if (canPlay(c, top, this.col)) { this.drew = true; this.addLog(P.nm + " берёт карту"); }
        else { this.addLog(P.nm + " берёт карту и пасует"); this.advance(1); }
        return true;
      }
      case "pass":
        if (i !== this.tu || !this.drew) return false;
        this.addLog(P.nm + " пасует");
        this.advance(1);
        return true;
      case "uno":
        if (P.hand.length > 2 || (P.uno && this.uv !== pid)) return false;
        if (this.uv === pid) { this.uv = null; this.addLog(P.nm + ": «Уно!»"); }
        else P.uno = true;
        return true;
      case "catch": {
        if (!this.uv || this.uv === pid) return false;
        const t = this.idx(this.uv);
        this.uv = null;
        if (t < 0) return false;
        this.drawTo(t, 2);
        this.addLog(P.nm + " ловит " + this.pl[t].nm + " без «Уно!» — +2 карты");
        return true;
      }
    }
    return false;
  }

  pickCol(h) {
    const cnt = { r: 0, y: 0, g: 0, b: 0 };
    h.forEach(c => { if (c[0] !== "w") cnt[c[0]]++; });
    let best = COLORS[Math.floor(Math.random() * 4)], m = 0;
    for (const c of COLORS) if (cnt[c] > m) { m = cnt[c]; best = c; }
    return best;
  }

  /** Ход бота (или автоход за отключившегося игрока) */
  botMove() {
    const P = this.pl[this.tu], h = P.hand, top = this.disc[this.disc.length - 1];
    if (this.drew) {
      const k = h.length - 1, c = h[k];
      if (canPlay(c, top, this.col)) return this.apply(P.id, { t: "play", i: k, c, col: this.pickCol(h.slice(0, k)) });
      return this.apply(P.id, { t: "pass" });
    }
    const threat = this.pl[this.nextIdx(1)].hand.length <= 2;
    let best = -1, bs = -1e9;
    h.forEach((c, k) => {
      if (!canPlay(c, top, this.col)) return;
      let s;
      if (c[0] === "w") s = c[1] === "F" ? (threat ? 60 : -30) : -20;
      else {
        s = Number(c[1]) || 0;
        if ("SRD".includes(c[1])) s += threat ? 45 : 6;
        if (c[0] === this.col) s += 8;
      }
      s += Math.random() * 3;
      if (s > bs) { bs = s; best = k; }
    });
    if (best < 0) return this.apply(P.id, { t: "draw" });
    if (h.length === 2 && (P.bot ? Math.random() < 0.85 : true)) P.uno = true;
    return this.apply(P.id, { t: "play", i: best, c: h[best], col: this.pickCol(h.filter((_, k) => k !== best)) });
  }

  /** Состояние для конкретного игрока: чужие руки скрыты. */
  view(pid, online) {
    const me = this.pl.find(p => p.id === pid);
    return {
      code: this.code, host: this.host, ph: this.ph, seq: this.seq, solo: this.solo,
      top: this.disc[this.disc.length - 1] || null, col: this.col, tu: this.tu, dir: this.dir,
      drew: this.drew, uv: this.uv, win: this.win, dc: this.deck.length, log: this.log,
      watchers: this.watch.size,
      pl: this.pl.map(p => ({ id: p.id, nm: p.nm, b: p.bot ? 1 : 0, w: p.w, n: p.hand.length, u: p.uno ? 1 : 0, on: p.bot || online.has(p.id) ? 1 : 0 })),
      hand: me ? me.hand : null,
    };
  }
}

module.exports = { Game, canPlay, COLORS, MAX_PLAYERS };
