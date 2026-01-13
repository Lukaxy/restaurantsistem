const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");

const MASTER_EMAIL = "admin@master.com";
const MASTER_SENHA = "123456";

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
// 🧱 BANCO DE DADOS
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
    status_updated_at DATETIME,
    payment_method TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    description TEXT,
    price REAL,
    category TEXT
  )`);

  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(`SELECT * FROM users WHERE email = ?`, [MASTER_EMAIL], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
      );
    }
  });
});

// =============================================================
// 🔐 LOGIN
// =============================================================
app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ ok: false });

  db.get(
    `SELECT * FROM users WHERE email = ? AND role = 'master'`,
    [email],
    async (err, user) => {
      if (!user) return res.status(404).json({ ok: false });
      const valid = await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ ok: false });
      res.json({ ok: true, user });
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

app.get("/api/orders", (req, res) => {
  const { company_id } = req.query;

  db.all(
    `SELECT * FROM orders WHERE company_id = ? ORDER BY id DESC`,
    [company_id],
    (err, rows) => {
      rows.forEach(r => (r.items = JSON.parse(r.items || "[]")));
      res.json({ ok: true, pedidos: rows });
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
      res.json({ ok: true, products: rows });
    }
  );
});

app.post("/api/products", (req, res) => {
  const { company_id, name, description, price, category } = req.body;
  if (!company_id || !name) return res.status(400).json({ ok: false });

  db.run(
    `INSERT INTO products (company_id, name, description, price, category)
     VALUES (?, ?, ?, ?, ?)`,
    [company_id, name, description, price, category],
    function (err) {
      if (err) return res.status(500).json({ ok: false });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// =============================================================
// 🏢 EMPRESAS (PAINEL MASTER)
// =============================================================
app.get("/api/companies", (req, res) => {
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
// 🌐 ARQUIVOS ESTÁTICOS
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// =============================================================
// 🚀 START
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
