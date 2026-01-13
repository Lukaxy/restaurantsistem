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
  const date = new Date();
  date.setHours(date.getHours() + offsetHoras);
  return date.toISOString();
}

// =============================================================
// 🧱 BANCO
// =============================================================
const DB_PATH = path.join(process.cwd(), "orders.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email_admin TEXT UNIQUE,
    senha_hash TEXT NOT NULL,
    plano TEXT DEFAULT 'basic',
    created_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    email TEXT UNIQUE,
    senha_hash TEXT,
    role TEXT DEFAULT 'atendente',
    ativo INTEGER DEFAULT 1,
    created_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    items TEXT,
    total REAL,
    table_name TEXT,
    notes TEXT,
    status TEXT DEFAULT 'novo',
    created_at DATETIME,
    status_updated_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    description TEXT,
    price REAL,
    category TEXT
  )`);

  // cria master se não existir
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
  if (!email || !senha) return res.status(400).json({ ok: false });

  db.get(
    `SELECT * FROM users WHERE email = ? AND role = 'master'`,
    [email],
    async (err, user) => {
      if (!user) return res.status(401).json({ ok: false });

      const valid = await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ ok: false });

      const token = jwt.sign(
        { id: user.id, role: "master" },
        JWT_SECRET,
        { expiresIn: "12h" }
      );

      res.json({
        ok: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    }
  );
});

// =============================================================
// 🔐 MIDDLEWARE MASTER
// =============================================================
function authMaster(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false });

  const [, token] = auth.split(" ");
  if (!token) return res.status(401).json({ ok: false });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "master") throw new Error();
    req.master = decoded;
    next();
  } catch {
    return res.status(401).json({ ok: false });
  }
}

// =============================================================
// 🏢 REGISTRAR EMPRESA (NOVA ROTA)
// =============================================================
app.post("/api/register-company", async (req, res) => {
  const { name, email, senha } = req.body;
  if (!name || !email || !senha) {
    return res.status(400).json({ ok: false, error: "Dados incompletos" });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const now = getHoraLocalISOString();

  db.run(
    `INSERT INTO companies (name, email_admin, senha_hash, created_at)
     VALUES (?, ?, ?, ?)`,
    [name, email, senhaHash, now],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(409).json({
            ok: false,
            error: "E-mail já cadastrado"
          });
        }
        return res.status(500).json({ ok: false });
      }

      // cria admin da empresa
      db.run(
        `INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?)`,
        [this.lastID, "Administrador", email, senhaHash, now]
      );

      res.json({ ok: true });
    }
  );
});

// =============================================================
// 🏢 EMPRESAS — PAINEL MASTER
// =============================================================
app.get("/api/companies", authMaster, (req, res) => {
  db.all(
    `SELECT id, name, email_admin, plano, created_at FROM companies`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false });
      res.json({ ok: true, companies: rows });
    }
  );
});

// =============================================================
// 📦 PRODUTOS
// =============================================================
app.get("/api/products", (req, res) => {
  const { company_id } = req.query;
  if (!company_id) return res.status(400).json({ ok: false });

  db.all(
    `SELECT * FROM products WHERE company_id = ?`,
    [company_id],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false });
      res.json(rows);
    }
  );
});

// =============================================================
// 🧾 PEDIDOS
// =============================================================
app.post("/api/orders", (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;
  if (!company_id || !Array.isArray(items)) {
    return res.status(400).json({ ok: false });
  }

  const now = getHoraLocalISOString();
  db.run(
    `INSERT INTO orders 
     (company_id, items, total, table_name, notes, created_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [company_id, JSON.stringify(items), total, table_name, notes, now, now],
    function (err) {
      if (err) return res.status(500).json({ ok: false });
      res.json({ ok: true, id: this.lastID });
    }
  );
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
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// =============================================================
// 🚀 START
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Servidor rodando na porta", PORT);
});
