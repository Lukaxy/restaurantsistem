const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client");

// Configura o banco de dados imortal do Turso
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
  return new Date().toISOString(); 
}

// 1. Inicialização das Tabelas
async function initDb() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email_admin TEXT UNIQUE,
      whatsapp TEXT,
      senha_hash TEXT NOT NULL,
      plano TEXT DEFAULT 'trial',
      trial_expires_at DATETIME,
      created_at DATETIME
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name TEXT,
      email TEXT UNIQUE,
      senha_hash TEXT,
      role TEXT DEFAULT 'atendente',
      ativo INTEGER DEFAULT 1,
      created_at DATETIME
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS orders (
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

    await db.execute(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name TEXT,
      price REAL,
      category TEXT,
      description TEXT
    )`);

    // Criar Master se não existir
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
      console.log("✅ Conta master pronta no Turso.");
    }
  } catch (err) {
    console.error("❌ Erro ao iniciar banco Turso:", err);
  }
}
initDb();

// =============================================================
// 📡 LOGIN (CORRIGIDO)
// =============================================================
app.post("/api/login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const sql = `SELECT u.*, c.trial_expires_at, c.plano FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.email = ?`;
    const result = await db.execute({ sql, args: [email] });
    const user = result.rows[0]; // Pega a primeira linha

    if (!user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    if (user.plano === 'bloqueado') return res.status(403).json({ ok: false, error: "Sua conta está suspensa. ❌" });

    // Verificação de Teste Expirado (apenas para quem não é Master)
    if (user.role !== 'master') {
        const hoje = new Date();
        const expira = new Date(user.trial_expires_at);
        if (user.plano === 'trial' && hoje > expira) {
          return res.status(403).json({ ok: false, error: "Teste expirado! 🛑" });
        }
    }

    res.json({ ok: true, user });
  } catch (err) {
    console.error("Erro Login:", err);
    res.status(500).json({ ok: false, error: "Erro no servidor." });
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

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Erro interno." });
  }
});

// =============================================================
// 🏢 CADASTRO (CORRIGIDO PARA LOGAR AUTOMÁTICO)
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
    
    // Pega o ID da empresa recém criada
    const companyId = Number(resCompany.lastInsertRowid);

    await db.execute({
        sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        args: [companyId, "Administrador", email, hash, created_at]
    });

    // Retorna o objeto exatamente como o seu Front-end espera para logar
    res.json({ 
        ok: true, 
        user: { 
            id: companyId, 
            company_id: companyId, 
            role: 'admin', 
            name: "Administrador",
            email: email 
        } 
    });
  } catch (err) { 
    console.error(err);
    res.status(400).json({ ok: false, error: "E-mail já cadastrado ou erro no banco." }); 
  }
});

// =============================================================
// 📊 HISTÓRICO & EMPRESAS
// =============================================================
app.get("/api/orders/history", async (req, res) => {
  const { company_id } = req.query;
  const sql = `SELECT * FROM orders WHERE company_id = ? AND status IN ('finalizado', 'pronto', 'entregue', 'pago', 'concluido', 'concluído') ORDER BY status_updated_at DESC`;
  try {
    const result = await db.execute({ sql, args: [company_id] });
    const rows = result.rows.map(r => {
      try { r.items = JSON.parse(r.items || "[]"); } catch(e) { r.items = []; }
      return r;
    });
    res.json({ ok: true, pedidos: rows });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/empresas", async (req, res) => {
  try {
    const result = await db.execute(`SELECT id, name, email_admin, whatsapp, plano, trial_expires_at, created_at FROM companies ORDER BY id DESC`);
    res.json({ ok: true, empresas: result.rows });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/empresas/:id/add-days", async (req, res) => {
  const { id } = req.params;
  const { dias } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT trial_expires_at FROM companies WHERE id = ?", args: [id] });
    const row = result.rows[0];
    if (!row) return res.status(404).json({ ok: false });

    const hoje = new Date();
    const vencimentoAtual = new Date(row.trial_expires_at);
    let novaData = (vencimentoAtual > hoje) ? vencimentoAtual : hoje;
    novaData.setDate(novaData.getDate() + parseInt(dias));

    await db.execute({
        sql: "UPDATE companies SET trial_expires_at = ?, plano = 'basic' WHERE id = ?",
        args: [novaData.toISOString(), id]
    });
    res.json({ ok: true, nova_data: novaData });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 📦 PRODUTOS & PEDIDOS
// =============================================================
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

app.delete("/api/products/:id", async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM products WHERE id = ?`, args: [req.params.id] });
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

app.post("/api/orders/:id/status", async (req, res) => {
    try {
        await db.execute({
            sql: `UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ?`,
            args: [req.body.status, getHoraLocalISOString(), req.params.id]
        });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 👥 USUÁRIOS
// =============================================================
app.get("/api/users", async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT id, name, email, role FROM users WHERE company_id = ?`, args: [req.query.company_id] });
        res.json({ ok: true, users: result.rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.delete("/api/users/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const check = await db.execute({ sql: "SELECT email FROM users WHERE id = ?", args: [id] });
        if (check.rows[0]?.email === MASTER_EMAIL) return res.status(403).json({ ok: false, error: "Não pode deletar o Master!" });

        await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/users", async (req, res) => {
    const { name, email, senha, role, company_id } = req.body;
    const hash = bcrypt.hashSync(senha, 10);
    try {
        await db.execute({
            sql: `INSERT INTO users (name, email, senha_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [name, email, hash, role, parseInt(company_id), getHoraLocalISOString()]
        });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 🏢 OUTRAS ROTAS
// =============================================================
app.post("/api/empresas/:id/plano", async (req, res) => {
    try {
        await db.execute({ sql: `UPDATE companies SET plano = ? WHERE id = ?`, args: [req.body.plano, req.params.id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.delete("/api/empresas/:id", async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM companies WHERE id = ?`, args: [req.params.id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/companies/:id", async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT plano, trial_expires_at, name FROM companies WHERE id = ?`, args: [req.params.id] });
        res.json({ ok: true, company: result.rows[0] });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 💰 MERCADO PAGO & WEBHOOK (SEM ALTERAÇÃO NA LÓGICA)
// =============================================================
app.post("/api/pay/create", async (req, res) => {
    const { company_id, email, name, valor, dias, docNumber } = req.body;
    const cleanDoc = docNumber ? docNumber.replace(/\D/g, '') : '';
    const docType = cleanDoc.length > 11 ? 'CNPJ' : 'CPF';
    const partesNome = (name || "Cliente Teste").split(" ");
    const firstName = partesNome[0];
    const lastName = partesNome.length > 1 ? partesNome.slice(1).join(" ") : "App";

    try {
        const { Payment } = require('mercadopago');
        const payment = new Payment(client);
        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Assinatura Sistema - ${dias} Dias`,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: firstName,
                    last_name: lastName,
                    identification: { type: docType, number: cleanDoc }
                },
                metadata: {
                    company_id: Number(company_id),
                    dias_adicionar: Number(dias)
                }
            }
        });
        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Falha MP" });
    }
});

app.post("/api/webhook", async (req, res) => {
    const { type, data } = req.body;
    if (type === "payment") {
        try {
            const { Payment } = require('mercadopago');
            const payment = new Payment(client);
            const p = await payment.get({ id: data.id });

            if (p.status === "approved") {
                const { company_id, dias_adicionar } = p.metadata;
                const result = await db.execute({ sql: "SELECT trial_expires_at FROM companies WHERE id = ?", args: [company_id] });
                const row = result.rows[0];

                if (row) {
                    const hoje = new Date();
                    let novaData = (new Date(row.trial_expires_at) > hoje) ? new Date(row.trial_expires_at) : hoje;
                    novaData.setDate(novaData.getDate() + parseInt(dias_adicionar));

                    await db.execute({
                        sql: "UPDATE companies SET trial_expires_at = ?, plano = 'basic' WHERE id = ?",
                        args: [novaData.toISOString(), company_id]
                    });
                    console.log(`✅ Webhook: Empresa ${company_id} atualizada.`);
                }
            }
        } catch (error) { console.error("Erro Webhook:", error); }
    }
    res.sendStatus(200);
});

// =============================================================
// 🚀 INICIALIZAÇÃO
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Sistema Blindado rodando na porta ${PORT}`);
});
