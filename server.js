import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "shared-finance-dev-secret";
const dbPath = path.join(process.cwd(), "shared-finance.db");
const db = new DatabaseSync(dbPath);

const pagePool = [
  "user-home-1.html",
  "user-home-2.html",
  "user-home-3.html",
  "user-home-4.html",
  "user-home-5.html",
  "user-home-6.html",
  "user-home-7.html",
  "user-home-8.html",
  "user-home-9.html",
  "user-home-10.html"
];

const adminAllowlist = ["admin@sharedfinancehub.com", "owner@sharedfinancehub.com"];

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(process.cwd()));

function getNetworkAccessLinks() {
  return [{ label: "Localhost", url: `http://localhost:${PORT}/login.html` }];
}

function ensureUserPresenceColumns() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const names = new Set(columns.map((col) => String(col.name)));

  if (!names.has("last_sign_in_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_sign_in_at TEXT");
  }
  if (!names.has("last_sign_out_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_sign_out_at TEXT");
  }
  if (!names.has("last_seen_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT");
  }
  if (!names.has("is_online")) {
    db.exec("ALTER TABLE users ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0");
  }
}

function markUserSignedIn(userId) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE users SET is_online = 1, last_sign_in_at = ?, last_seen_at = ? WHERE id = ?"
  ).run(now, now, userId);
}

function markUserSeen(userId) {
  db.prepare("UPDATE users SET is_online = 1, last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), userId);
}

function markUserSignedOut(userId) {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE users SET is_online = 0, last_sign_out_at = ?, last_seen_at = ? WHERE id = ?"
  ).run(now, now, userId);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
      assigned_page TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_states (
      page_key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureUserPresenceColumns();

  ensureAdmin("admin@sharedfinancehub.com", "Admin@12345", "Platform Admin");
}

function ensureAdmin(email, password, name) {
  const existing = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
  if (existing) return;

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (email, password_hash, name, role, assigned_page, created_at) VALUES (?, ?, ?, 'admin', NULL, ?)"
  ).run(email, hash, name, new Date().toISOString());
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      assignedPage: user.assigned_page || null
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    markUserSeen(payload.sub);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminRequired(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ error: "Missing auth" });
  }

  const isAllowlisted = adminAllowlist.includes(String(req.auth.email || "").toLowerCase());
  if (req.auth.role !== "admin" || !isAllowlisted) {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

function getOrAssignPage(email) {
  const existing = db.prepare("SELECT assigned_page FROM users WHERE lower(email) = lower(?)").get(email);
  if (!existing) return null;
  if (existing.assigned_page) return existing.assigned_page;

  const usedRows = db.prepare("SELECT assigned_page FROM users WHERE assigned_page IS NOT NULL").all();
  const used = new Set(usedRows.map((row) => row.assigned_page));
  const available = pagePool.find((page) => !used.has(page));
  if (!available) return null;

  db.prepare("UPDATE users SET assigned_page = ? WHERE lower(email) = lower(?)").run(available, email);
  return available;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "shared-finance-api" });
});

app.post("/api/auth/signup", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  const name = String(req.body?.name || "").trim();

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (adminAllowlist.includes(email)) {
    return res.status(403).json({ error: "Admin email cannot be used for user signup" });
  }

  const existingEmail = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
  if (existingEmail) {
    return res.status(409).json({ error: "Email already exists" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (email, password_hash, name, role, assigned_page, created_at) VALUES (?, ?, ?, 'user', NULL, ?)"
  ).run(email, hash, name, createdAt);

  const assignedPage = getOrAssignPage(email);
  if (!assignedPage) {
    return res.status(503).json({ error: "No personal page available" });
  }

  const user = db.prepare("SELECT id, email, name, role, assigned_page FROM users WHERE lower(email) = lower(?)").get(email);
  markUserSignedIn(user.id);
  const token = signToken(user);
  return res.json({ token, user: { email: user.email, name: user.name, role: user.role, assignedPage: user.assigned_page } });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  if (!email || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  if (adminAllowlist.includes(email)) {
    return res.status(403).json({ error: "Use admin login for this account" });
  }

  const user = db.prepare("SELECT id, email, name, role, assigned_page, password_hash FROM users WHERE lower(email) = lower(?)").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const assignedPage = getOrAssignPage(email);
  if (!assignedPage) {
    return res.status(503).json({ error: "No personal page available" });
  }

  const fresh = db.prepare("SELECT id, email, name, role, assigned_page FROM users WHERE lower(email) = lower(?)").get(email);
  markUserSignedIn(fresh.id);
  const token = signToken(fresh);
  return res.json({ token, user: { email: fresh.email, name: fresh.name, role: fresh.role, assignedPage: fresh.assigned_page } });
});

app.post("/api/auth/admin-login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  if (!email || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const user = db.prepare("SELECT id, email, name, role, assigned_page, password_hash FROM users WHERE lower(email) = lower(?)").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  if (user.role !== "admin" || !adminAllowlist.includes(email)) {
    return res.status(403).json({ error: "Access denied for this account" });
  }

  markUserSignedIn(user.id);
  const token = signToken(user);
  return res.json({ token, user: { email: user.email, name: user.name, role: user.role, assignedPage: user.assigned_page } });
});

app.post("/api/auth/presence", authRequired, (req, res) => {
  markUserSeen(req.auth.sub);
  return res.json({ ok: true });
});

app.post("/api/auth/signout", authRequired, (req, res) => {
  markUserSignedOut(req.auth.sub);
  return res.json({ ok: true });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT id, email, name, role, assigned_page FROM users WHERE id = ?").get(req.auth.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: { email: user.email, name: user.name, role: user.role, assignedPage: user.assigned_page || null } });
});

app.get("/api/users/me/finance-state", authRequired, (req, res) => {
  const pageKey = String(req.query.pageKey || "").trim().toLowerCase();
  if (!pageKey) {
    return res.status(400).json({ error: "pageKey is required" });
  }

  const user = db.prepare("SELECT assigned_page FROM users WHERE id = ?").get(req.auth.sub);
  if (!user || !user.assigned_page) {
    return res.status(403).json({ error: "No assigned page" });
  }

  if (user.assigned_page.toLowerCase() !== pageKey) {
    return res.status(403).json({ error: "Forbidden for this page" });
  }

  const row = db.prepare("SELECT state_json FROM finance_states WHERE page_key = ?").get(pageKey);
  if (!row) {
    return res.json({ state: null });
  }

  try {
    return res.json({ state: JSON.parse(row.state_json) });
  } catch {
    return res.json({ state: null });
  }
});

app.put("/api/users/me/finance-state", authRequired, (req, res) => {
  const pageKey = String(req.query.pageKey || "").trim().toLowerCase();
  if (!pageKey) {
    return res.status(400).json({ error: "pageKey is required" });
  }

  const user = db.prepare("SELECT assigned_page FROM users WHERE id = ?").get(req.auth.sub);
  if (!user || !user.assigned_page) {
    return res.status(403).json({ error: "No assigned page" });
  }

  if (user.assigned_page.toLowerCase() !== pageKey) {
    return res.status(403).json({ error: "Forbidden for this page" });
  }

  const state = req.body?.state;
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "state object is required" });
  }

  const payload = JSON.stringify(state);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO finance_states (page_key, state_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(page_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(pageKey, payload, now);

  return res.json({ ok: true });
});

app.get("/api/admin/accounts", authRequired, adminRequired, (_req, res) => {
  const rows = db.prepare(
    "SELECT email, name, role, assigned_page, created_at, is_online, last_sign_in_at, last_sign_out_at, last_seen_at FROM users ORDER BY created_at DESC"
  ).all();
  return res.json({ accounts: rows });
});

app.get("/api/admin/database", authRequired, adminRequired, (_req, res) => {
  const users = db.prepare(
    "SELECT email, name, role, assigned_page, created_at, is_online, last_sign_in_at, last_sign_out_at, last_seen_at FROM users ORDER BY created_at DESC"
  ).all();
  const financeRows = db.prepare("SELECT page_key, state_json, updated_at FROM finance_states").all();
  const apiRows = db.prepare("SELECT cache_key, payload_json, updated_at FROM api_cache").all();

  const financeStates = {};
  financeRows.forEach((row) => {
    try {
      financeStates[row.page_key] = JSON.parse(row.state_json);
    } catch {
      financeStates[row.page_key] = null;
    }
  });

  const apiCache = {};
  apiRows.forEach((row) => {
    try {
      apiCache[row.cache_key] = JSON.parse(row.payload_json);
    } catch {
      apiCache[row.cache_key] = null;
    }
  });

  return res.json({
    version: 2,
    users,
    financeStates,
    apiCache
  });
});

app.delete("/api/admin/users/:email", authRequired, adminRequired, (req, res) => {
  const email = String(req.params.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const target = db.prepare("SELECT id, email, role, assigned_page FROM users WHERE lower(email) = lower(?)").get(email);
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }

  if (target.role === "admin") {
    return res.status(403).json({ error: "Admin account cannot be deleted" });
  }

  if (Number(target.id) === Number(req.auth.sub)) {
    return res.status(403).json({ error: "You cannot delete your own account" });
  }

  if (target.assigned_page) {
    db.prepare("DELETE FROM finance_states WHERE page_key = ?").run(String(target.assigned_page).toLowerCase());
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  return res.json({ ok: true, deletedEmail: target.email });
});

app.post("/api/admin/database/clear", authRequired, adminRequired, (_req, res) => {
  db.prepare("DELETE FROM finance_states").run();
  db.prepare("DELETE FROM api_cache").run();
  db.prepare("DELETE FROM users WHERE role = 'user'").run();
  return res.json({ ok: true });
});

app.put("/api/cache/:cacheKey", authRequired, (req, res) => {
  const cacheKey = String(req.params.cacheKey || "").trim();
  if (!cacheKey) return res.status(400).json({ error: "cacheKey required" });
  const payload = req.body?.payload;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "payload object required" });
  }

  db.prepare(
    `INSERT INTO api_cache (cache_key, payload_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
  ).run(cacheKey, JSON.stringify(payload), new Date().toISOString());

  return res.json({ ok: true });
});

app.get("/api/cache/:cacheKey", authRequired, (req, res) => {
  const cacheKey = String(req.params.cacheKey || "").trim();
  if (!cacheKey) return res.status(400).json({ error: "cacheKey required" });

  const row = db.prepare("SELECT payload_json FROM api_cache WHERE cache_key = ?").get(cacheKey);
  if (!row) return res.json({ payload: null });

  try {
    return res.json({ payload: JSON.parse(row.payload_json) });
  } catch {
    return res.json({ payload: null });
  }
});

initDb();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Shared Finance API running on port ${PORT}`);
  console.log(`- Login: http://localhost:${PORT}/login.html`);
});
