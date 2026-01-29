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
  // Tabela de Empresas (SaaS)
  db.run(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email_admin TEXT UNIQUE,
    senha_hash TEXT NOT NULL,
    plano TEXT DEFAULT 'trial',
    trial_expires_at DATETIME,
    created_at DATETIME
  )`);

  // Tabela de Usuários
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

  // Tabelas de Pedidos e Produtos
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

  // Conta Master
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

// Login Master
app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  db.get(`SELECT * FROM users WHERE email = ? AND role = 'master'`, [email], async (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: "Não encontrado." });
    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    res.json({ ok: true, user });
  });
});

// Login Usuário com Trava SaaS
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;
  const sql = `
    SELECT u.*, c.trial_expires_at, c.plano 
    FROM users u 
    JOIN companies c ON u.company_id = c.id 
    WHERE u.email = ?`;

  db.get(sql, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (!user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    // VERIFICAÇÃO DE EXPIRAÇÃO (Só bloqueia se for plano 'trial')
    const hoje = new Date();
    const expira = new Date(user.trial_expires_at);

    if (user.plano === 'trial' && hoje > expira) {
      return res.status(403).json({ 
        ok: false, 
        error: "Seu período de teste acabou! 🛑 Entre em contato para ativar." 
      });
    }

    res.json({ ok: true, user });
  });
});

// Cadastro de Empresa (Inicia 5 dias grátis)
app.post("/api/register-company", (req, res) => {
  const { name, email, senha } = req.body;
  if (!name || !email || !senha) return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  const senha_hash = bcrypt.hashSync(senha, 10);
  const created_at = getHoraLocalISOString();

  const dataExpira = new Date();
  dataExpira.setDate(dataExpira.getDate() + 5);
  const trial_expires_at = dataExpira.toISOString();

  db.get(`SELECT * FROM companies WHERE email_admin = ?`, [email], (err, row) => {
    if (row) return res.status(400).json({ ok: false, error: "E-mail já cadastrado." });

    db.run(
      `INSERT INTO companies (name, email_admin, senha_hash, plano, trial_expires_at, created_at)
       VALUES (?, ?, ?, 'trial', ?, ?)`,
      [name, email, senha_hash, trial_expires_at, created_at],
      function (err) {
        if (err) return res.status(500).json({ ok: false, error: "Erro ao criar empresa." });
        const companyId = this.lastID;
        db.run(
          `INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
           VALUES (?, ?, ?, ?, 'admin', ?)`,
          [companyId, "Administrador", email, senha_hash, created_at],
          (userErr) => {
            if (userErr) return res.status(500).json({ ok: false, error: "Erro ao criar admin." });
            res.json({ ok: true, id: companyId, user: { id: companyId, company_id: companyId, name: "Administrador", email, role: 'admin' } });
          }
        );
      }
    );
  });
});

// =============================================================
// 👑 ROTAS MASTER (admin.html)
// =============================================================

app.get("/api/empresas", (req, res) => {
  db.all(`SELECT id, name, email_admin, plano, trial_expires_at, created_at FROM companies ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro ao listar empresas." });
    res.json({ ok: true, empresas: rows });
  });
});

app.post("/api/empresas/:id/plano", (req, res) => {
  const { plano } = req.body;
  const id = req.params.id;
  db.run(`UPDATE companies SET plano = ? WHERE id = ?`, [plano, id], function (err) {
    if (err) return res.status(500).json({ ok: false, error: "Erro ao atualizar." });
    res.json({ ok: true });
  });
});

app.delete("/api/empresas/:id", (req, res) => {
  const id = req.params.id;
  db.serialize(() => {
    db.run(`DELETE FROM users WHERE company_id = ?`, [id]);
    db.run(`DELETE FROM products WHERE company_id = ?`, [id]);
    db.run(`DELETE FROM orders WHERE company_id = ?`, [id]);
    db.run(`DELETE FROM companies WHERE id = ?`, [id], (err) => {
      res.json({ ok: true });
    });
  });
});

// =============================================================
// 🧾 ROTAS DE NEGÓCIO (PRODUTOS / PEDIDOS)
// =============================================================

// (Aqui entram as suas rotas de produtos, pedidos e usuários que você já tem)
// Vou omitir para o código não ficar gigante, mas mantenha as que você já usa.

// =============================================================
// ⚙️ SERVIR ARQUIVOS ESTÁTICOS
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Sistema Rodando em http://localhost:${PORT}`);
});
