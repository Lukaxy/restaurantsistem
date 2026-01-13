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

  // Cria conta master se não existir
  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(`SELECT * FROM users WHERE email = ?`, [MASTER_EMAIL], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()],
        () => console.log("✅ Conta master criada:", MASTER_EMAIL, "senha:", MASTER_SENHA)
      );
    }
  });
});

// =============================================================
// 🔐 LOGIN MASTER (com JWT)
// =============================================================
app.post("/api/admin-login", (req, res) => {
  const { email, senha } = req.body;

  db.get(`SELECT * FROM users WHERE email = ? AND role = 'master'`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (!user) return res.status(404).json({ ok: false, error: "Usuário master não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    const token = jwt.sign({ id: user.id, role: "master" }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
  });
});

// =============================================================
// 🔐 LOGIN NORMAL (admin empresa)
// =============================================================
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;

  db.get(`SELECT * FROM users WHERE email = ? AND role = 'admin'`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (!user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

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
// 🔑 Middleware para autenticar Master com JWT
// =============================================================
function authMaster(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Token não fornecido." });

  const token = auth.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "master") throw new Error("Role inválido");
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido ou expirado." });
  }
}

// =============================================================
// 🏢 REGISTRAR EMPRESA (compatível com frontend antigo)
// =============================================================
app.post("/api/register-company", (req, res) => {
  const { name, email, senha } = req.body;
  if (!name || !email || !senha) return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  db.get(`SELECT * FROM companies WHERE email_admin = ?`, [email], async (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (row) return res.status(400).json({ ok: false, error: "E-mail já cadastrado." });

    const hash = await bcrypt.hash(senha, 10);
    const now = getHoraLocalISOString();

    db.run(`INSERT INTO companies (name, email_admin, senha_hash, created_at) VALUES (?, ?, ?, ?)`,
      [name, email, hash, now],
      function(err) {
        if (err) return res.status(500).json({ ok: false, error: "Erro ao cadastrar empresa." });

        const companyId = this.lastID;

        db.run(`INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
                VALUES (?, ?, ?, ?, 'admin', ?)`,
                [companyId, "Administrador", email, hash, now],
                (errUser) => {
                  if (errUser) return res.status(500).json({ ok: false, error: "Erro ao criar usuário admin." });
                  // ✅ Retorna compatível com frontend antigo
                  res.json({ ok: true, id: companyId });
                });
      });
  });
});

// =============================================================
// 🏢 LISTAR EMPRESAS (apenas master)
app.get("/api/empresas", authMaster, (req, res) => {
  db.all(`SELECT id, name, email_admin, plano, created_at FROM companies ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro ao listar empresas." });
    res.json({ ok: true, empresas: rows });
  });
});

// =============================================================
// ❌ API SEMPRE JSON
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "API não encontrada" });
});

// =============================================================
// 🌐 FRONTEND
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// =============================================================
// 🚀 INICIAR SERVIDOR
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando em http://0.0.0.0:3000");
});
