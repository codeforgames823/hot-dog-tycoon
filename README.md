# 🌭 Hot Dog Tycoon — From Bun to Boardroom

A web-based life sim where you play as a hot dog hustling through the city, climbing the corporate ladder from street vendor all the way to **Wiener Tycoon**.

> **▶️ Play it live:** https://codeforgames823.github.io/hot-dog-tycoon/

## ✨ Features

- **Side-scrolling pixel-art city** with 16 explorable buildings
- **Walk into any building** and you enter a fully **3D interior** (perspective floor, themed back walls, interactive station pedestals)
- **12-tier career ladder** from Unemployed Wiener → Wiener Tycoon
- **Stat management** — money, energy, hunger, mood, XP
- **Day/night cycle** with an in-game clock
- **Multiple income loops:** street cart, corporate job, factory shifts (with passive income from automation), stocks, casino gambling, art sales
- **Stocks & investments** — Frank Inc, Bun Co, Kraft & Co with random-walk pricing
- **Casino** — slots, blackjack, roulette, high-roller table
- **Education** — classes & MBA boost your XP gain and salary
- **Mansion** — endgame luxury home with butler, pool, parties
- **localStorage save/load** — auto-saves every 10s, "Continue Save" button on intro
- **Leaderboard** — local on every device, plus optional global leaderboard via the `server/` API

## 🎮 Controls

| Key | Action |
|---|---|
| `A` `D` / `←` `→` | Walk |
| `W` / `Space` / `↑` | Enter building |
| `E` | Interact with the nearest station inside |
| `Esc` | Exit building |
| 💾 button (bottom right) | Save now |
| 🔄 button | Reset & start fresh |

## 🛠️ Architecture

```
hot-dog-tycoon/   →  static frontend  → GitHub Pages
  index.html
  style.css
  game.js

server/           →  Node.js + Express API → Azure Container App
  server.js
  schema.sql
  Dockerfile
                  →  Postgres (shared Azure)
```

The frontend works **with or without** the backend:
- No backend → leaderboard falls back to **local** (per-device).
- With backend → adds a **global** leaderboard tab.

## 🚀 Run locally

```bash
# 1) Frontend (any static server works)
cd hot-dog-tycoon
python -m http.server 9091
# open http://localhost:9091

# 2) Backend (optional, only for global leaderboard)
cd server
cp .env.example .env       # fill in PG creds
npm install
npm run init-db
npm run dev
# In the browser console:
#   localStorage.setItem('hdt_api', 'http://localhost:8080')
# then refresh.
```

## 🌐 Deploying

- **Frontend** → GitHub Pages serves the `hot-dog-tycoon/` folder automatically (configured in repo Settings → Pages, source: `main` branch, `/hot-dog-tycoon` folder).
- **Backend** → see [`server/README.md`](server/README.md) for the Azure Container Apps recipe (zero-downtime via revisions, with rollback instructions).

## 📁 Project layout

```
.
├── README.md                  ← you are here
├── hot-dog-tycoon/            ← static game (deployed to GitHub Pages)
│   ├── index.html
│   ├── style.css
│   └── game.js
└── server/                    ← leaderboard API (deploys to Azure Container Apps)
    ├── server.js
    ├── schema.sql
    ├── init-db.js
    ├── Dockerfile
    ├── .env.example
    └── README.md
```

## 📜 License

MIT — go forth and prosper, frankfurter.
