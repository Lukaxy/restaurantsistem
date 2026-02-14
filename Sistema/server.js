const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); // Mantido apenas uma vez
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client/http");
const multer = require('multer');
const fs = require('fs');

// =============================================================
// 🔧 CONFIGURAÇÕES INICIAIS
// =============================================================
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// 1. DEFINIR PASTA PÚBLICA E CRIAR PASTA DE IMAGENS (ESSENCIAL PRO RENDER)
const publicPath = path.join(__dirname, "public");
const uploadDir = path.join(publicPath, "img");

// Garante que a pasta 'public/img' existe antes de qualquer coisa
if (!fs.existsSync(uploadDir)){
    console.log("📁 Criando diretório de imagens...");
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Libera o acesso aos arquivos estáticos (HTML, CSS, IMAGENS)
app.use(express.static(publicPath));

// =============================================================
// 📸 CONFIGURAÇÃO DE UPLOAD (MULTER) - NOVO!
// =============================================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // Salva dentro de public/img criado acima
    },
    filename: function (req, file, cb) {
        // Pega o ID da empresa vindo do corpo da requisição
        const idEmpresa = req.body.companyId;
        
        // Força o nome: logo-companyid-{ID}.png
        // Isso permite que o front-end "adivinhe" a imagem sem consultar o banco
        cb(null, `logo-companyid-${idEmpresa}.png`);
    }
});

const upload = multer({ storage: storage });

// =============================================================
// 🔧 BANCO DE DADOS E PAGAMENTOS
// =============================================================
const db = createClient({
  url: "https://restaurant-system-lukaxy.aws-us-east-1.turso.io", 
  authToken: process.env.TURSO_TOKEN,
});

const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN, 
    options: { timeout: 5000 } 
});

const MASTER_EMAIL = "lucasferreira123459966@gmail.com";
const MASTER_SENHA = "Lu@14032004";

function getHoraLocalISOString() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19); 
}

// =============================================================
// 🏗️ INICIALIZAÇÃO ROBUSTA DO BANCO
// =============================================================
async function initDb() {
  console.log("🔄 Iniciando verificação do Banco de Dados...");
  try {
    // 1. Criação das Tabelas
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT)`);
    
    // Tenta adicionar a coluna visible se não existir (ignora erro se já existir)
    try {
        await db.execute(`ALTER TABLE products ADD COLUMN visible INTEGER DEFAULT 1`);
    } catch (e) { /* Coluna já existe, segue o jogo */ }
    
    console.log("✅ Tabelas verificadas.");

    // ... (depois dos CREATE TABLE e antes do checkMaster) ...

    //'destination' na tabela products (se não existir)
    try {
        await db.execute(`ALTER TABLE products ADD COLUMN destination TEXT DEFAULT 'cozinha'`);
        console.log("✅ Coluna 'destination' adicionada/verificada em Products.");
    } catch (e) {
        // Se der erro é porque a coluna já existe, então ignoramos
    }

    // ... (continua o código do Master) ...  

    // 2. Verificação/Criação do Master
    const checkMaster = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [MASTER_EMAIL] });
    
    if (checkMaster.rows.length === 0) {
      console.log("👤 Criando Usuário Master...");
      const hash = bcrypt.hashSync(MASTER_SENHA, 10);
      await db.execute({
        sql: "INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)",
        args: ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
      });
    }

  } catch (err) { 
    console.error("❌ FALHA CRÍTICA NO BANCO:", err);
    process.exit(1);
  }
}

// =============================================================
// 📡 ROTAS DE AUTENTICAÇÃO
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

    const valid = await bcrypt.compare(String(senha), String(user.senha_hash));
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    
    if (user.plano === 'bloqueado') return res.status(403).json({ ok: false, error: "Conta suspensa." });

    const expirou = user.role !== 'master' && 
                    user.trial_expires_at && 
                    (new Date() > new Date(user.trial_expires_at));

    if (expirou) {
        return res.json({ ok: true, user: { ...user, planoExpirado: true } });
    }

    res.json({ ok: true, user: { ...user, planoExpirado: false } });

  } catch (err) {
    console.error("Erro Login:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "Erro interno." });
  }
});

app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ? AND role = 'master'", args: [email] });
    const user = result.rows[0];
    
    if (!user) return res.status(401).json({ ok: false, error: "Master não encontrado." });

    const valid = await bcrypt.compare(String(senha), String(user.senha_hash));
    if (valid) return res.json({ ok: true, user });
    
    res.status(401).json({ ok: false, error: "Senha incorreta." });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/register-company", async (req, res) => {
  const { name, email, whatsapp, senha } = req.body; 
  try {
    const hash = bcrypt.hashSync(String(senha), 10);
    const dataExpira = new Date();
    dataExpira.setDate(dataExpira.getDate() + 5); 
    const trial_at = dataExpira.toISOString();
    const created_at = getHoraLocalISOString();

    const resCompany = await db.execute({
        sql: `INSERT INTO companies (name, email_admin, whatsapp, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?,?)`,
        args: [name, email, whatsapp, hash, trial_at, created_at]
    });
    
    const newId = Number(String(resCompany.lastInsertRowid));
    if (!newId || isNaN(newId)) throw new Error("Falha ao gerar ID.");

    await db.execute({
        sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        args: [newId, "Administrador", email, hash, created_at]
    });

    res.json({ ok: true, user: { id: newId, company_id: newId, role: 'admin', name: "Administrador", email: email } });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// =============================================================
// 📤 ROTA DE UPLOAD DE LOGO (NOVA!)
// =============================================================
app.post("/api/upload-logo", upload.single('logo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Nenhuma imagem enviada." });
        }
        
        console.log(`✅ Logo atualizada para empresa ${req.body.companyId}`);
        // Redireciona de volta para a tela de configurações com sucesso
        res.redirect('/configuracoes.html?msg=logo_ok');
        
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao fazer upload da imagem.");
    }
});


// =============================================================
// 📝 PEDIDOS E PRODUTOS
// =============================================================

app.get("/api/products", async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT * FROM products WHERE company_id = ?`, args: [req.query.company_id] });
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

app.post("/api/products", async (req, res) => {
  // Agora recebemos também o 'destination'
  const { company_id, name, price, category, description, destination } = req.body;
  
  // Se não vier nada, assume que é para a 'cozinha'
  const destinoFinal = destination || 'cozinha';

  try {
      await db.execute({
          sql: `INSERT INTO products (company_id, name, price, category, description, destination) VALUES (?,?,?,?,?,?)`,
          args: [Number(company_id), name, price, category, description, destinoFinal]
      });
      res.json({ ok: true });
  } catch (err) { 
      console.error(err);
      res.status(500).json({ ok: false }); 
  }
});

app.delete("/api/products/:id", async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM products WHERE id = ?`, args: [req.params.id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.put("/api/products/:id/visible", async (req, res) => {
    const { id } = req.params;
    const { visible } = req.body;
    try {
        await db.execute({
            sql: "UPDATE products SET visible = ? WHERE id = ?",
            args: [visible, id]
        });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// --- USUÁRIOS ---
app.get("/api/users", async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT id, name, email, role FROM users WHERE company_id = ?`, args: [req.query.company_id] });
        res.json({ ok: true, users: result.rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/users", async (req, res) => {
    const { name, email, senha, role, company_id } = req.body;
    try {
        await db.execute({
            sql: `INSERT INTO users (name, email, senha_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [name, email, bcrypt.hashSync(String(senha), 10), role, Number(company_id), getHoraLocalISOString()]
        });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.delete("/api/users/:id", async (req, res) => {
    try {
        const check = await db.execute({ sql: "SELECT email FROM users WHERE id = ?", args: [req.params.id] });
        if (check.rows[0]?.email === MASTER_EMAIL) return res.status(403).json({ ok: false, error: "Master imortal." });
        await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [req.params.id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// --- ADMINISTRAÇÃO ---
app.get("/api/empresas", async (req, res) => {
  try {
      const result = await db.execute(`SELECT * FROM companies ORDER BY id DESC`);
      res.json({ ok: true, empresas: result.rows });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.delete("/api/empresas/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await db.execute({ sql: "DELETE FROM users WHERE company_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM products WHERE company_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM orders WHERE company_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM companies WHERE id = ?", args: [id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// --- ADICIONAR DIAS / PLANOS ---
app.post("/api/empresas/:id/add-days", async (req, res) => {
  const { id } = req.params;
  const { dias } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT trial_expires_at FROM companies WHERE id = ?", args: [id] });
    const row = result.rows[0];
    if (!row) return res.status(404).json({ ok: false });

    const hoje = new Date();
    let dataBase = (new Date(row.trial_expires_at) > hoje) ? new Date(row.trial_expires_at) : hoje;
    dataBase.setDate(dataBase.getDate() + parseInt(dias));

    await db.execute({ sql: "UPDATE companies SET trial_expires_at = ? WHERE id = ?", args: [dataBase.toISOString(), id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/empresas/:id/plano", async (req, res) => {
  const { id } = req.params;
  const { plano } = req.body; 
  try {
    await db.execute({ sql: "UPDATE companies SET plano = ? WHERE id = ?", args: [plano, id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// --- MENU PÚBLICO (MODIFICADO PARA RETORNAR A LOGO PADRONIZADA NO JSON SE QUISER, MAS O HTML JA SE VIRA) ---
app.get("/api/public/menu/:company_id", async (req, res) => {
    try {
        const company = await db.execute({ 
            sql: "SELECT name FROM companies WHERE id = ?", 
            args: [req.params.company_id] 
        });
        
        const products = await db.execute({ 
            sql: "SELECT name, price, category, description FROM products WHERE company_id = ? AND visible = 1", 
            args: [req.params.company_id] 
        });

        // O front-end vai montar o link da imagem sozinho, não precisamos mandar URL aqui
        res.json({ 
            restaurant: company.rows[0]?.name, 
            menu: products.rows 
        });
    } catch (err) { res.status(500).json({ error: "Erro ao carregar cardápio" }); }
});

app.get("/api/companies/:id", async (req, res) => {
  try {
      const result = await db.execute({ sql: "SELECT * FROM companies WHERE id = ?", args: [req.params.id] });
      const company = result.rows[0];
      if (company) res.json({ ok: true, company });
      else res.status(404).json({ ok: false });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// --- PEDIDOS ---
app.post("/api/orders", async (req, res) => {
    const { company_id, items, total, table_name, notes } = req.body;
    const agora = getHoraLocalISOString();
    try {
        await db.execute({
            sql: `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at) VALUES (?,?,?,?,?,?,?)`,
            args: [Number(company_id), JSON.stringify(items), total, table_name, notes, agora, agora]
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
        const rows = result.rows.map(row => ({ ...row, items: JSON.parse(row.items || "[]") }));
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

app.get("/api/orders/history", async (req, res) => {
    const { company_id } = req.query;
    try {
        const result = await db.execute({ 
            sql: `SELECT * FROM orders WHERE company_id = ? AND status IN ('finalizado', 'pronto', 'entregue', 'pago', 'concluido') ORDER BY status_updated_at DESC`, 
            args: [company_id] 
        });
        const rows = result.rows.map(r => ({...r, items: JSON.parse(r.items || "[]")}));
        res.json({ ok: true, pedidos: rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// --- PIX / WEBHOOK ---
app.post("/api/pay/create", async (req, res) => {
    const { company_id, email, name, valor, dias, docNumber, deviceId } = req.body;
    const notificationUrl = "https://sistemadigitalmenu.com.br/api/webhook";

    try {
        const payment = new Payment(client);
        const nameParts = (name || "Cliente").split(" ");
        const bodyPayment = {
            transaction_amount: Number(valor),
            description: `Assinatura Sistema - ${dias} Dias`,
            payment_method_id: 'pix',
            notification_url: notificationUrl,
            payer: {
                email: email,
                first_name: nameParts[0],
                last_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Empresa",
                identification: { 
                    type: docNumber?.length > 11 ? 'CNPJ' : 'CPF', 
                    number: docNumber?.replace(/\D/g, '') || '00000000000' 
                }
            },
            additional_info: {
                ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress
            },
            metadata: { company_id: Number(company_id), dias_adicionar: Number(dias) }
        };
        if (deviceId) bodyPayment.metadata.device_id = deviceId;

        const result = await payment.create({ body: bodyPayment });
        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    } catch (error) { res.status(500).json({ ok: false, error: "Erro Mercado Pago" }); }
});

app.post("/api/webhook", async (req, res) => {
    const { type, data } = req.body;
    if (type === "payment") {
        try {
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
                }
            }
        } catch (error) { console.error("Erro Webhook:", error); }
    }
    res.sendStatus(200);
});

app.get("/api/companies/:id/status", async (req, res) => {
    try {
        const result = await db.execute({ 
            sql: "SELECT trial_expires_at, plano FROM companies WHERE id = ?", 
            args: [req.params.id] 
        });
        const company = result.rows[0];
        if (company) res.json({ ok: true, expires_at: company.trial_expires_at, plano: company.plano });
        else res.status(404).json({ ok: false });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 🚀 INICIALIZAÇÃO
// =============================================================
const PORT = process.env.PORT || 3000;

async function startServer() {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Sistema rodando na porta ${PORT}`);
    });
}

startServer();
