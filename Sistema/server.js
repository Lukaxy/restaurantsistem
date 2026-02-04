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
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email_admin TEXT UNIQUE,
      whatsapp TEXT,
      senha_hash TEXT NOT NULL,
      plano TEXT DEFAULT 'trial',
      trial_expires_at TEXT,
      created_at TEXT
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name TEXT,
      email TEXT UNIQUE,
      senha_hash TEXT,
      role TEXT DEFAULT 'atendente',
      ativo INTEGER DEFAULT 1,
      created_at TEXT
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      items TEXT,
      total REAL,
      table_name TEXT,
      notes TEXT,
      status TEXT DEFAULT 'novo',
      created_at TEXT,
      status_updated_at TEXT,
      payment_method TEXT
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name TEXT,
      price REAL,
      category TEXT,
      description TEXT
    )`);

    const checkMaster = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [MASTER_EMAIL]
    });

    if (checkMaster.rows.length === 0) {
      const hash = bcrypt.hashSync(MASTER_SENHA, 10);
      await db.execute({
        sql: "INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)",
        args: ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
      });
      console.log("✅ Master pronto.");
    }
  } catch (err) {
    console.error("❌ Erro initDb:", err);
  }
}
initDb();

// =============================================================
// 📡 LOGIN CORRIGIDO (COM TRATAMENTO DE ERRO DETALHADO)
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

    const valid = await bcrypt.compare(senha, String(user.senha_hash));
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    if (user.plano === 'bloqueado') return res.status(403).json({ ok: false, error: "Conta suspensa. ❌" });

    res.json({ ok: true, user });
  } catch (err) {
    console.error("ERRO CRÍTICO LOGIN:", err);
    res.status(500).json({ ok: false, error: "Erro interno no servidor." });
  }
});

// =============================================================
// 🏢 CADASTRO CORRIGIDO (ESTRATÉGIA DE ID)
// =============================================================
app.post("/api/register-company", async (req, res) => {
  const { name, email, whatsapp, senha } = req.body; 
  const hash = bcrypt.hashSync(senha, 10);
  
  const dataExpira = new Date();
  dataExpira.setDate(dataExpira.getDate() + 5);
  const trial_expires_at = dataExpira.toISOString();
  const created_at = getHoraLocalISOString();

  try {
    const resCompany = await db.execute({
        sql: `INSERT INTO companies (name, email_admin, whatsapp, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?,?)`,
        args: [name, email, whatsapp, hash, trial_expires_at, created_at]
    });
    
    // Pegando o ID de forma garantida no Turso
    const companyId = Number(resCompany.lastInsertRowid);

    await db.execute({
        sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        args: [companyId, "Administrador", email, hash, created_at]
    });

    res.json({ 
        ok: true, 
        user: { 
            id: companyId, 
            company_id: companyId, 
            role: 'admin',
            email: email
        } 
    });
  } catch (err) { 
    console.error("ERRO CADASTRO:", err);
    res.status(400).json({ ok: false, error: "E-mail já cadastrado ou erro no banco." }); 
  }
});

// =============================================================
// 👑 ADMIN LOGIN (MASTER)
// =============================================================
app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await db.execute({
        sql: "SELECT * FROM users WHERE email = ? AND role = 'master'",
        args: [email]
    });
    const user = result.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "Admin não encontrado." });

    const valid = await bcrypt.compare(senha, String(user.senha_hash));
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Erro interno." });
  }
});

// --- REPLICAR O PADRÃO PARA AS OUTRAS ROTAS ---

app.get("/api/empresas", async (req, res) => {
  try {
    const result = await db.execute(`SELECT id, name, email_admin, whatsapp, plano, trial_expires_at, created_at FROM companies ORDER BY id DESC`);
    res.json({ ok: true, empresas: result.rows });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await db.execute({ sql: `SELECT * FROM products WHERE company_id = ?`, args: [req.query.company_id] });
    res.json(result.rows);
  } catch (err) { res.status(500).json([]); }
});

app.post("/api/products", async (req, res) => {
  const { company_id, name, price, category, description } = req.body;
  try {
    await db.execute({
        sql: `INSERT INTO products (company_id, name, price, category, description) VALUES (?,?,?,?,?)`,
        args: [company_id, name, price, category, description]
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/orders", async (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;
  const agora = getHoraLocalISOString();
  try {
    await db.execute({
        sql: `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at) VALUES (?,?,?,?,?,?,?)`,
        args: [company_id, JSON.stringify(items), total, table_name, notes, agora, agora]
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/orders", async (req, res) => {
  let sql = `SELECT * FROM orders WHERE company_id = ?`;
  const args = [req.query.company_id];
  if (req.query.status) { sql += ` AND status = ?`; args.push(req.query.status); }
  try {
    const result = await db.execute({ sql: sql + ` ORDER BY id DESC`, args });
    const rows = result.rows.map(r => {
        r.items = JSON.parse(r.items || "[]");
        return r;
    });
    res.json({ ok: true, pedidos: rows });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/users", async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT id, name, email, role FROM users WHERE company_id = ?`, args: [req.query.company_id] });
        res.json({ ok: true, users: result.rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/pay/create", async (req, res) => {
    const { company_id, email, name, valor, dias, docNumber } = req.body;
    try {
        const payment = new Payment(client);
        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Assinatura Sistema - ${dias} Dias`,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: (name || "Cliente").split(" ")[0],
                    last_name: (name || "App").split(" ").slice(1).join(" ") || "App",
                    identification: { type: docNumber?.length > 11 ? 'CNPJ' : 'CPF', number: docNumber?.replace(/\D/g, '') }
                },
                metadata: { company_id: Number(company_id), dias_adicionar: Number(dias) }
            }
        });
        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    } catch (error) { res.status(500).json({ ok: false, error: "Falha MP" }); }
});

const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Sistema Rodando na porta ${PORT}`);
});
