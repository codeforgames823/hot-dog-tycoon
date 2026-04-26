// Hot Dog Tycoon — Leaderboard API
// Node.js + Express + Postgres
//
// Env vars:
//   PORT                 (default 8080)
//   PGHOST               Postgres host
//   PGPORT               Postgres port (default 5432)
//   PGDATABASE           Database name
//   PGUSER               Database user
//   PGPASSWORD           Database password
//   PGSSL                "true" to require SSL (Azure: true)
//   ALLOWED_ORIGINS      Comma-separated CORS origins (e.g. https://you.github.io)
//   LEADERBOARD_LIMIT    Max rows to return (default 20)
//   LEADERBOARD_TABLE    Table name (default hdt_leaderboard)

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pg from 'pg';

const {
  PORT = 8080,
  ALLOWED_ORIGINS = '*',
  LEADERBOARD_LIMIT = 20,
  LEADERBOARD_TABLE = 'hdt_leaderboard',
  PGSSL = 'false',
} = process.env;

// ----- Postgres pool -----
const pool = new pg.Pool({
  ssl: PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('Postgres pool error:', err));

// ----- App -----
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

const allowed = ALLOWED_ORIGINS === '*'
  ? true
  : ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowed,
  methods: ['GET', 'POST'],
  credentials: false,
}));

// Rate limit submissions (10 per IP per 5 min)
const submitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again later.' },
});

// ----- Routes -----
app.get('/', (_req, res) => {
  res.json({ name: 'hot-dog-tycoon-api', status: 'ok' });
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'degraded', db: 'down', error: e.message });
  }
});

// GET /api/leaderboard - top N by fewest days then highest networth
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const q = `
      SELECT name, career, days, networth, created_at
      FROM ${LEADERBOARD_TABLE}
      ORDER BY days ASC, networth DESC, created_at ASC
      LIMIT $1
    `;
    const { rows } = await pool.query(q, [Number(LEADERBOARD_LIMIT)]);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/leaderboard failed:', e);
    res.status(500).json({ error: 'Could not load leaderboard' });
  }
});

// POST /api/leaderboard - submit a new score
app.post('/api/leaderboard', submitLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 24);
    const career = String(body.career || '').trim().slice(0, 40);
    const days = Math.max(1, Math.min(99999, parseInt(body.days, 10) || 0));
    const networth = Math.max(0, Math.min(1_000_000_000, parseInt(body.networth, 10) || 0));

    if (!name || !career || !days) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    const q = `
      INSERT INTO ${LEADERBOARD_TABLE} (name, career, days, networth, ip_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, career, days, networth, created_at
    `;
    const ipHash = hashIp(req.ip);
    const { rows } = await pool.query(q, [name, career, days, networth, ipHash]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('POST /api/leaderboard failed:', e);
    res.status(500).json({ error: 'Could not submit score' });
  }
});

// Light-touch IP hash (avoid storing raw IPs)
function hashIp(ip) {
  if (!ip) return null;
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = ((h << 5) - h) + ip.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

app.listen(PORT, () => {
  console.log(`hot-dog-tycoon-api listening on :${PORT}`);
});
