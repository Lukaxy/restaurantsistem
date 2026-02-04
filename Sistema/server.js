const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client");

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN, 
    options: { timeout: 5000 } 
});

const MASTER_EMAIL = "admin@master.com";
const MASTER_SENHA = "123456";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

function getHoraLocalISOString() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19); 
}

async function initDb() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT)`);

    const checkMaster = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [MASTER_EMAIL] });
    if (checkMaster.rows.length === 0) {
      await db.execute({
        sql: "INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)",
        args: ["Admin Master", MASTER_EMAIL, bcrypt.hashSync(MASTER_SENHA, 10), getHoraLocalISOString()]
      });
    }
  } catch (err) { console.error("Erro init:", err); }
}
initDb();

// =============================================================
// 📡 LOGIN BLINDADO
// =============================================================
app.post("/api/login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await db.execute({ 
        sql: `SELECT u.*, c.trial_expires_at, c.plano FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.email = ?`, 
        args: [email] 
    });
    
    const user = result.rows[0]; 
    if (!user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    // GARANTIA: Força a senha_hash a ser string para o bcrypt não quebrar
    const senhaHash = String(user.senha_hash);
    const valid = await bcrypt.compare(String(senha), senhaHash);
    
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    if (user.plano === 'bloqueado') return res.status(403).json({ ok: false, error: "Conta suspensa." });

    res.json({ ok: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Erro interno no servidor." });
  }
});

// =============================================================
// 🏢 CADASTRO (FIX DO REDIRECIONAMENTO)
// =============================================================
app.post("/api/register-company", async (req, res) => {
  const { name, email, whatsapp, senha } = req.body; 
  const hash = bcrypt.hashSync(String(senha), 10);
  const dataExpira = new Date();
  dataExpira.setDate(dataExpira.getDate() + 5);
  
  const trial_at = dataExpira.toISOString();
  const created_at = getHoraLocalISOString();

  try {
    const resCompany = await db.execute({
        sql: `INSERT INTO companies (name, email_admin, whatsapp, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?,?)`,
        args: [name, email, whatsapp, hash, trial_at, created_at]
    });
    
    // O segredo para o redirecionamento: Converter BigInt para Number
    const newId = Number(resCompany.lastInsertRowid);

    await db.execute({
        sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        args: [newId, "Administrador", email, hash, created_at]
    });

    // Envia o objeto EXATO que o seu front usa no localStorage
    res.json({ 
        ok: true, 
        user: { 
            id: newId, 
            company_id: newId, 
            role: 'admin',
            name: "Administrador",
            email: email
        } 
    });
  } catch (err) { 
    console.error(err);
    res.status(400).json({ ok: false, error: "Erro ao cadastrar. Verifique se o e-mail já existe." }); 
  }
});

app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ? AND role = 'master'", args: [email] });
    const user = result.rows[0];
    if (user && await bcrypt.compare(String(senha), String(user.senha_hash))) {
        return res.json({ ok: true, user });
    }
    res.status(401).json({ ok: false, error: "Acesso negado." });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// --- OUTRAS ROTAS SIMPLIFICADAS ---
app.get("/api/empresas", async (req, res) => {
  const r = await db.execute(`SELECT * FROM companies ORDER BY id DESC`);
  res.json({ ok: true, empresas: r.rows });
});

app.get("/api/products", async (req, res) => {
  const r = await db.execute({ sql: `SELECT * FROM products WHERE company_id = ?`, args: [req.query.company_id] });
  res.json(r.rows);
});

app.post("/api/products", async (req, res) => {
  const { company_id, name, price, category, description } = req.body;
  await db.execute({
      sql: `INSERT INTO products (company_id, name, price, category, description) VALUES (?,?,?,?,?)`,
      args: [Number(company_id), name, price, category, description]
  });
  res.json({ ok: true });
});

app.post("/api/orders", async (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;
  const agora = getHoraLocalISOString();
  await db.execute({
      sql: `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at) VALUES (?,?,?,?,?,?,?)`,
      args: [Number(company_id), JSON.stringify(items), total, table_name, notes, agora, agora]
  });
  res.json({ ok: true });
});

app.get("/api/orders", async (req, res) => {
  let sql = `SELECT * FROM orders WHERE company_id = ?`;
  const args = [req.query.company_id];
  if (req.query.status) { sql += ` AND status = ?`; args.push(req.query.status); }
  const r = await db.execute({ sql: sql + ` ORDER BY id DESC`, args });
  res.json({ ok: true, pedidos: r.rows.map(row => ({...row, items: JSON.parse(row.items || "[]")})) });
});

const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Porta ${PORT}`));
