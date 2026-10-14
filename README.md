# Last Card — Online Multiplayer Card Game

A real-time multiplayer card game based on the rules of **Uno**. Players join from any
device (phone, tablet or computer) through a link in the browser. No installation or
account is needed for players.

**Live demo:** https://uno-with-friends-online.onrender.com

---

## Table of Contents

1. [Features](#1-features)
2. [Technical Requirements](#2-technical-requirements)
3. [Tech Stack](#3-tech-stack)
4. [Architecture](#4-architecture)
5. [Project Structure](#5-project-structure)
6. [Installation and Local Run](#6-installation-and-local-run)
7. [Deployment](#7-deployment)
8. [How to Play](#8-how-to-play)
9. [Game Rules](#9-game-rules)
10. [Configuration](#10-configuration)
11. [Known Limitations](#11-known-limitations)

---

## 1. Features

- **Online multiplayer:** 2 to 10 players per room, each on their own device
- **Rooms with invite links:** every room has a 4-character code and a shareable link (`/?room=CODE`)
- **Open rooms list:** active rooms are shown on the home screen
- **Bots:** the host can add computer players; a solo practice mode plays against 2 bots
- **Reconnection:** a player who refreshes the page returns to their seat with the same cards
- **Auto-play for absent players:** if a player disconnects, a bot moves for them after a short delay
- **Spectators:** players who join during a round watch and take a seat in the next round
- **Multiple identical cards per turn:** play several cards with the same number or symbol at once
- **"Uno!" call and catch:** the button appears only when a player has one card left; opponents can catch a player who forgets
- **Score tracking:** wins are counted for each player across rounds
- **Responsive design:** works on screens from 360 px wide (phones) to desktop

---

## 2. Technical Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall allow a user to create a game room and receive a unique 4-character room code. |
| FR-2 | The system shall allow other users to join a room by code or by an invite link. |
| FR-3 | The system shall support 2–10 players in one room. |
| FR-4 | The host shall be able to add bots, remove players from the lobby and start the game. |
| FR-5 | The system shall deal 7 cards to each player from a standard 108-card deck. |
| FR-6 | The server shall validate every move according to the game rules and reject invalid moves. |
| FR-7 | A player shall be able to play one card or several cards of the same value in one turn. |
| FR-8 | A player shall be able to draw a card and, if it is playable, play it immediately or pass. |
| FR-9 | The "Uno!" button shall appear only when the player has exactly one card left. |
| FR-10 | Opponents shall be able to "catch" a player who did not press "Uno!"; that player draws 2 cards. |
| FR-11 | The system shall update the game state on all devices in real time. |
| FR-12 | A player who reconnects shall return to the same seat with the same hand. |
| FR-13 | If a player is offline during their turn, a bot shall make the move after 8 seconds. |
| FR-14 | The system shall show the winner and the score table at the end of each round. |

### 2.2 Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | A move shall reach all players in under 500 ms on a normal internet connection. |
| **Security / fairness** | Each player receives only their own cards; other players' hands are never sent to the client. All moves are checked on the server. |
| **Reliability** | The client reconnects automatically after a network drop. Empty rooms are removed after 30 minutes. |
| **Usability** | The interface is in Russian, works with touch and mouse, and has visible keyboard focus. |
| **Compatibility** | Works in current versions of Chrome, Edge, Firefox and Safari, on desktop and mobile. |
| **Scalability** | One server instance handles many rooms at once; all state is kept in memory. |
| **Maintainability** | Game rules (`game.js`) are separated from networking (`server.js`) and UI (`public/`). |

### 2.3 System Requirements

**Server (to run or host the game):**

| Item | Requirement |
|---|---|
| Runtime | Node.js **18 or newer** (tested on Node.js 24) |
| Package manager | npm (comes with Node.js) |
| Memory | 512 MB RAM is enough |
| Network | Open port (default `3000`); WebSocket support |
| OS | Windows, macOS or Linux |

**Client (to play):**

| Item | Requirement |
|---|---|
| Device | Any phone, tablet or computer |
| Browser | A modern browser with JavaScript and WebSocket support |
| Screen | 360 px wide or more |
| Internet | Any stable connection (Wi-Fi or mobile data) |

### 2.4 Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.21.2 | Web server that serves the game page |
| `socket.io` | ^4.8.1 | Real-time two-way connection between server and players |

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Real-time | Socket.IO (WebSocket with fallback) |
| Frontend | HTML5, CSS3, vanilla JavaScript (no framework) |
| Fonts | Google Fonts: Onest, Rubik Mono One |
| Hosting | Render (free web service) |
| Version control | Git, GitHub |

---

## 4. Architecture

The game uses a **client–server model with an authoritative server**.

```
  Player 1 (browser) ─┐
  Player 2 (browser) ─┼──  Socket.IO  ──►  Node.js server  ──►  Game state (in memory)
  Player N (browser) ─┘                    (rules check)        one Game object per room
```

1. A player performs an action (for example, plays a card). The client sends it to the server.
2. The server checks the move against the rules in `game.js`.
3. If the move is valid, the server updates the room state.
4. The server sends each player **their own view** of the state: the table, the number
   of cards each opponent holds, and only that player's hand.
5. Bots and timers also run on the server.

**Socket.IO events:**

| Direction | Event | Description |
|---|---|---|
| client → server | `create` | Create a room (optionally solo with bots) |
| client → server | `join` | Join a room by code |
| client → server | `act` | Game action: `play`, `draw`, `pass`, `uno`, `catch`, `start`, `addbot`, `kick`, `again`, `tolobby` |
| client → server | `leave` | Leave the room |
| server → client | `state` | Current game state for this player |
| server → client | `rooms` | List of open rooms |
| server → client | `kicked` | The player was removed from the room |

---

## 5. Project Structure

```
uno-online/
├── server.js        # Express + Socket.IO server: rooms, connections, bot timers
├── game.js          # Game logic: deck, rules, move validation, bots
├── package.json     # Dependencies and start script
├── .gitignore
├── README.md
└── public/          # Files served to the browser
    ├── index.html   # Page layout
    ├── style.css    # Styles and card design
    └── client.js    # UI rendering and communication with the server
```

---

## 6. Installation and Local Run

1. Install **Node.js** (LTS version) from https://nodejs.org
2. Clone the repository:
   ```bash
   git clone https://github.com/MairamKenzh/uno-with-friends-online.git
   cd uno-with-friends-online/uno-online
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open **http://localhost:3000** in a browser.

**Play over local Wi-Fi:** other devices on the same network can open
`http://<your-computer-IP>:3000` (find the IP with `ipconfig` on Windows).

> **Windows note:** if PowerShell blocks `npm`, use `npm.cmd install` and `npm.cmd start`,
> or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

> **Do not open `index.html` directly.** The page needs the running server.

---

## 7. Deployment

The game is deployed on **Render** as a free web service connected to this GitHub repository.

| Setting | Value |
|---|---|
| Service type | Web Service |
| Language | Node |
| Branch | `main` |
| Root Directory | `uno-online` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |

Every `git push` to `main` triggers a new deployment automatically.

---

## 8. How to Play

1. Open the game link, enter your name and click **Create room**.
2. Click **Invite** to copy the room link and send it to friends.
3. Friends open the link, enter their names and click **Join**.
4. The host clicks **Start game**. The host can also add bots with **+ Bot**.
5. On your turn, playable cards are highlighted. Tap a card to play it.
6. To play several identical cards, tap them one by one and press **Play N cards**.
7. When you have one card left, press **Uno!** quickly.

---

## 9. Game Rules

| Card | Effect |
|---|---|
| Number 0–9 | Play on the same color or the same number |
| **Skip** ⊘ | The next player misses a turn |
| **Reverse** ⇄ | The direction of play changes (with 2 players it works as Skip) |
| **+2** | The next player draws 2 cards and misses a turn |
| **Wild** | Can be played on any card; the player chooses the color |
| **Wild +4** | Choose a color; the next player draws 4 cards and misses a turn |

- Each player starts with 7 cards.
- If you cannot play, draw one card. If it fits, you may play it right away; otherwise the turn passes.
- **Same-value cards:** several cards with the same number or symbol can be played in one turn.
  The first card must match the pile; the last card sets the color.
  Effects add up: two +2 cards make the next player draw 4; two Skips skip two players.
- **Uno:** when you have one card left, press **Uno!**. If an opponent catches you first, you draw 2 cards.
- The first player to get rid of all cards wins the round.

---

## 10. Configuration

Constants at the top of `server.js`:

| Constant | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port (can be set with the `PORT` environment variable) |
| `BOT_DELAY` | 1300 ms | Bot "thinking" time |
| `OFFLINE_DELAY` | 8000 ms | Delay before a bot moves for a disconnected player |
| `AFK_DELAY` | 60000 ms | Auto-move if an online player does not move for a minute |
| `LOBBY_GRACE` | 20000 ms | Time to rejoin the lobby after a page refresh |
| `ROOM_TTL` | 30 min | Empty rooms are deleted after this time |

---

## 11. Known Limitations

- On the free Render plan the server sleeps after 15 minutes without visitors;
  the first visit after that takes about a minute.
- Game state is stored in memory, so rooms are reset when the server restarts.
- Stacking +2 / +4 on top of an opponent's +2 / +4 is not supported.

---

## License

MIT
