const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const MASTER_EMAIL = "admin@master.com";
const MASTER_SENHA = "123456";
const JWT_SECRET = process.env.JWT_SECRET || "master_secret_123";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

// =============================================================
// 🕒 HORA LOCAL
// =============================================================
function getHoraLocalISOString(offsetHoras = -3) {
  const d = new Date();
  d.setHours(d.getHours() + offsetHoras);
  return d.toISOString();
}

// =============================================================
// 🧱 BANCO
// =============================================================
const db = new sqlite3.Database(path.join(process.cwd(), "orders.db"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email_admin TEXT UNIQUE,
    senha_hash TEXT,
    plano TEXT DEFAULT 'basic',
    created_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    email TEXT UNIQUE,
    senha_hash TEXT,
    role TEXT,
    created_at DATETIME
  )`);

  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(
    `SELECT id FROM users WHERE email = ? AND role = 'master'`,
    [MASTER_EMAIL],
    (err, row) => {
      if (!row) {
        db.run(
          `INSERT INTO users (name, email, senha_hash, role, created_at)
           VALUES (?, ?, ?, 'master', ?)`,
          ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
        );
      }
    }
  );
});

// =============================================================
// 🔐 LOGIN MASTER
// =============================================================
app.post("/api/admin-login", (req, res) => {
  const { email, senha } = req.body;

  db.get(
    `SELECT * FROM users WHERE email = ? AND role = 'master'`,
    [email],
    async (_, user) => {
      if (!user) return res.status(401).json({ ok: false });

      const valid = await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ ok: false });

      const token = jwt.sign(
        { id: user.id, role: "master" },
        JWT_SECRET,
        { expiresIn: "12h" }
      );

      res.json({ ok: true, token });
    }
  );
});

// =============================================================
// 🔐 LOGIN NORMAL (EMPRESA)  ✅ FALTAVA ISSO
// =============================================================
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;

  db.get(
    `SELECT * FROM users WHERE email = ? AND role = 'admin'`,
    [email],
    async (_, user) => {
      if (!user) return res.status(401).json({ ok: false });

      const valid = await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ ok: false });

      res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          company_id: user.company_id
        }
      });
    }
  );
});

// =============================================================
// 🔐 AUTH MASTER
// =============================================================
function authMaster(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false });

  const token = auth.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "master") throw "err";
    next();
  } catch {
    res.status(401).json({ ok: false });
  }
}

// =============================================================
// 🏢 REGISTRAR EMPRESA
// =============================================================
app.post("/api/register-company", async (req, res) => {
  const { name, email, senha } = req.body;
  const hash = await bcrypt.hash(senha, 10);
  const now = getHoraLocalISOString();

  db.run(
    `INSERT INTO companies (name, email_admin, senha_hash, created_at)
     VALUES (?, ?, ?, ?)`,
    [name, email, hash, now],
    function (err) {
      if (err) return res.status(400).json({ ok: false });

      db.run(
        `INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?)`,
        [this.lastID, "Administrador", email, hash, now]
      );

      res.json({ ok: true });
    }
  );
});

// =============================================================
// 🏢 EMPRESAS — MASTER
// =============================================================
app.get("/api/companies", authMaster, (req, res) => {
  db.all(`SELECT * FROM companies`, [], (_, rows) => {
    res.json({ ok: true, companies: rows });
  });
});

// =============================================================
// ❌ API SEMPRE JSON
// =============================================================
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "API não encontrada" });
});

// =============================================================
// 🌐 FRONTEND
// =============================================================
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// =============================================================
app.listen(process.env.PORT || 3000);
