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
const DB_PATH = path.join(__dirname, "orders.db");
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
    description TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  )`);

  // 🔧 Migração segura: garantir coluna description
  db.run(`ALTER TABLE products ADD COLUMN description TEXT`, err => {
    if (err && !err.message.includes("duplicate column")) {
      console.error("Erro ao adicionar coluna description:", err.message);
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
        () => console.log("✅ Conta master criada:", MASTER_EMAIL)
      );
    }
  });
});

// =============================================================
// 📡 LOGIN
// =============================================================
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user)
      return res.status(401).json({ ok: false, error: "Usuário inválido." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid)
      return res.status(401).json({ ok: false, error: "Senha incorreta." });

    res.json({
      ok: true,
      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  });
});

// =============================================================
// 📦 PRODUTOS
// =============================================================
app.get("/api/products", (req, res) => {
  const { company_id } = req.query;
  if (!company_id)
    return res.status(400).json({ ok: false, error: "company_id obrigatório." });

  db.all(
    `SELECT * FROM products WHERE company_id = ? ORDER BY id DESC`,
    [company_id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao listar produtos." });
      res.json(rows);
    }
  );
});

app.post("/api/products", (req, res) => {
  const { company_id, name, price, category, description } = req.body;

  if (!company_id || !name || price == null)
    return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  db.run(
    `INSERT INTO products (company_id, name, price, category, description)
     VALUES (?, ?, ?, ?, ?)`,
    [company_id, name, price, category || "Outros", description || ""],
    function (err) {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao adicionar produto." });

      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.delete("/api/products/:id", (req, res) => {
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], err => {
    if (err)
      return res.status(500).json({ ok: false, error: "Erro ao excluir produto." });
    res.json({ ok: true });
  });
});

// =============================================================
// 🧾 PEDIDOS
// =============================================================
app.post("/api/orders", (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;
  if (!company_id || !items || !items.length)
    return res.status(400).json({ ok: false, error: "Pedido inválido." });

  const created_at = getHoraLocalISOString();

  db.run(
    `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      company_id,
      JSON.stringify(items),
      total,
      table_name,
      notes,
      created_at,
      created_at
    ],
    function (err) {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao salvar pedido." });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// =============================================================
// ⚙️ ARQUIVOS ESTÁTICOS
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// =============================================================
// 🚀 START
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
