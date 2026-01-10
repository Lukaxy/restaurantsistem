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
    created_at DATETIME,
    FOREIGN KEY(company_id) REFERENCES companies(id)
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
    payment_method TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    price REAL,
    category TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  )`);

  // Garante coluna description
  db.all(`PRAGMA table_info(products)`, (err, cols) => {
    if (err) return console.error(err);
    const temDescription = cols.some(c => c.name === "description");
    if (!temDescription) {
      db.run(`ALTER TABLE products ADD COLUMN description TEXT`);
    }
  });

  // Conta master
  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(`SELECT * FROM users WHERE email = ?`, [MASTER_EMAIL], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()],
        () => console.log("✅ Conta master criada")
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

app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (!user) return res.status(404).json({ ok: false });
    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false });

    res.json({
      ok: true,
      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
});

// =============================================================
// 🧾 PEDIDOS
// =============================================================
app.post("/api/orders", (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;

  if (!company_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false });
  }

  const created_at = getHoraLocalISOString();
  const itemsJson = JSON.stringify(items);

  db.run(
    `INSERT INTO orders 
     (company_id, items, total, table_name, notes, status, created_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, 'novo', ?, ?)`,
    [company_id, itemsJson, total, table_name, notes, created_at, created_at],
    function (err) {
      if (err) return res.status(500).json({ ok: false });
      res.json({ ok: true, id: this.lastID });
    }
  );
}); // ✅ FECHAMENTO QUE FALTAVA

app.get("/api/orders", (req, res) => {
  const { company_id } = req.query;

  let query = `
    SELECT * FROM orders 
    WHERE company_id = ?
    AND (status != 'pronto' OR datetime(status_updated_at) > datetime('now', '-5 minutes'))
    ORDER BY id DESC
  `;

  db.all(query, [company_id], (err, rows) => {
    rows.forEach(r => r.items = JSON.parse(r.items || "[]"));
    res.json({ ok: true, pedidos: rows });
  });
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
