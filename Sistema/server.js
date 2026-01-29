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
function getHoraLocalISOString() {
  return new Date().toISOString(); 
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
    plano TEXT DEFAULT 'trial',
    trial_expires_at DATETIME,
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

  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(`SELECT * FROM users WHERE email = ?`, [MASTER_EMAIL], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()],
        () => console.log("✅ Conta master pronta.")
      );
    }
  });
});

// =============================================================
// 📡 ROTAS DE LOGIN E CADASTRO
// =============================================================

app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  db.get(`SELECT * FROM users WHERE email = ? AND role = 'master'`, [email], async (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: "Não encontrado." });
    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    res.json({ ok: true, user });
  });
});

app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;
  const sql = `SELECT u.*, c.trial_expires_at, c.plano FROM users u JOIN companies c ON u.company_id = c.id WHERE u.email = ?`;
  db.get(sql, [email], async (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: "Não encontrado." });
    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    const hoje = new Date();
    const expira = new Date(user.trial_expires_at);
    if (user.plano === 'trial' && hoje > expira) {
      return res.status(403).json({ ok: false, error: "Teste expirado! 🛑" });
    }
    res.json({ ok: true, user });
  });
});

app.post("/api/register-company", (req, res) => {
  const { name, email, senha } = req.body;
  const hash = bcrypt.hashSync(senha, 10);
  const dataExpira = new Date();
  dataExpira.setDate(dataExpira.getDate() + 5);
  const trial_expires_at = dataExpira.toISOString();
  const created_at = getHoraLocalISOString();

  db.run(`INSERT INTO companies (name, email_admin, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?)`,
    [name, email, hash, trial_expires_at, created_at], function(err) {
      if (err) return res.status(400).json({ ok: false, error: "E-mail já cadastrado." });
      const companyId = this.lastID;
      db.run(`INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        [companyId, "Administrador", email, hash, created_at], () => {
          res.json({ ok: true, user: { id: companyId, company_id: companyId, role: 'admin' } });
        });
    });
});

// =============================================================
// 👑 ROTAS MASTER
// =============================================================
app.get("/api/empresas", (req, res) => {
  db.all(`SELECT id, name, email_admin, plano, trial_expires_at, created_at FROM companies ORDER BY id DESC`, (err, rows) => {
    res.json({ ok: true, empresas: rows });
  });
});

app.post("/api/empresas/:id/plano", (req, res) => {
  db.run(`UPDATE companies SET plano = ? WHERE id = ?`, [req.body.plano, req.params.id], () => res.json({ ok: true }));
});

app.delete("/api/empresas/:id", (req, res) => {
  db.run(`DELETE FROM companies WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
});

// =============================================================
// 📦 ROTAS DE NEGÓCIO (PRODUTOS / PEDIDOS / USUÁRIOS)
// =============================================================

app.get("/api/products", (req, res) => {
  db.all(`SELECT * FROM products WHERE company_id = ?`, [req.query.company_id], (err, rows) => res.json(rows));
});

app.post("/api/products", (req, res) => {
  const { company_id, name, price, category } = req.body;
  db.run(`INSERT INTO products (company_id, name, price, category) VALUES (?,?,?,?)`, [company_id, name, price, category], function() {
    res.json({ ok: true, id: this.lastID });
  });
});

app.delete("/api/products/:id", (req, res) => {
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
});

app.post("/api/orders", (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;
  const agora = getHoraLocalISOString();
  db.run(`INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at) VALUES (?,?,?,?,?,?,?)`,
    [company_id, JSON.stringify(items), total, table_name, notes, agora, agora], () => res.json({ ok: true }));
});

app.get("/api/orders", (req, res) => {
  let sql = `SELECT * FROM orders WHERE company_id = ?`;
  const params = [req.query.company_id];
  if (req.query.status) { sql += ` AND status = ?`; params.push(req.query.status); }
  db.all(sql + ` ORDER BY id DESC`, params, (err, rows) => {
    rows.forEach(r => r.items = JSON.parse(r.items || "[]"));
    res.json({ ok: true, pedidos: rows });
  });
});

app.post("/api/orders/:id/status", (req, res) => {
  db.run(`UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ?`, [req.body.status, getHoraLocalISOString(), req.params.id], () => res.json({ ok: true }));
});

app.get("/api/users", (req, res) => {
  db.all(`SELECT id, name, email, role FROM users WHERE company_id = ?`, [req.query.company_id], (err, rows) => res.json({ ok: true, users: rows }));
});

// =============================================================
// ⚙️ SERVIR ARQUIVOS ESTÁTICOS
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Sistema Rodando em http://localhost:${PORT}`);
});
