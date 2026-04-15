const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); 
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

// 1. DEFINIR PASTA PÚBLICA E CRIAR PASTA DE IMAGENS
const publicPath = path.join(__dirname, "public");
const uploadDir = path.join(publicPath, "img");

if (!fs.existsSync(uploadDir)){
    console.log("📁 Criando diretório de imagens...");
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.static(publicPath));

// =============================================================
// 📸 CONFIGURAÇÃO DE UPLOAD (MULTER)
// =============================================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); 
    },
    filename: function (req, file, cb) {
        const idEmpresa = req.body.companyId;
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
  const date = new Date();
  const options = {
    timeZone: 'America/Campo_Grande',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('pt-BR', options);
  const parts = formatter.formatToParts(date);
  const getPart = (type) => parts.find(p => p.type === type).value;
  return `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

// =============================================================
// 🏗️ INICIALIZAÇÃO ROBUSTA DO BANCO
// =============================================================
async function initDb() {
  console.log("🔄 Iniciando verificação do Banco de Dados...");
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT)`);
    
    try { await db.execute(`ALTER TABLE products ADD COLUMN visible INTEGER DEFAULT 1`); } catch (e) { }
    try { await db.execute(`ALTER TABLE products ADD COLUMN destination TEXT DEFAULT 'cozinha'`); } catch (e) { }
    try { await db.execute(`ALTER TABLE orders ADD COLUMN status_cozinha TEXT DEFAULT 'novo'`); } catch (e) {}
    try { await db.execute(`ALTER TABLE orders ADD COLUMN status_bar TEXT DEFAULT 'novo'`); } catch (e) {}
    
    console.log("✅ Tabelas verificadas.");
 
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
// 🛡️ MIDDLEWARE DE SEGURANÇA: EXPULSA FANTASMAS
// =============================================================
async function verificarEmpresaAtiva(req, res, next) {
    // Tenta capturar o company_id de várias formas possíveis na requisição
    const company_id = req.query.company_id || req.body.company_id || req.body.companyId || req.params.company_id;

    if (!company_id) {
        return next(); // Se não houver ID na rota, segue (ex: login ou rotas master)
    }

    try {
        const result = await db.execute({ 
            sql: "SELECT id, plano FROM companies WHERE id = ?", 
            args: [Number(company_id)] 
        });

        const empresa = result.rows[0];

        // Se a empresa foi deletada OU o plano está explicitamente como 'bloqueado'
        if (!empresa || empresa.plano === 'bloqueado') {
            console.log(`🚫 Bloqueando acesso: Empresa ${company_id} não existe ou está suspensa.`);
            return res.status(401).json({ ok: false, error: "Sessão inválida. Empresa não encontrada." });
        }

        next(); // Se estiver tudo certo, permite o acesso à rota
    } catch (err) {
        console.error("Erro no Middleware de segurança:", err);
        res.status(500).json({ ok: false, error: "Erro interno de validação." });
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

    const expirou = user.role !== 'master' && user.trial_expires_at && (new Date() > new Date(user.trial_expires_at));
    if (expirou) return res.json({ ok: true, user: { ...user, planoExpirado: true } });

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
    dataExpira.setDate(dataExpira.getDate() + 7); 
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

app.post("/api/upload-logo", upload.single('logo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
        console.log(`✅ Logo atualizada para empresa ${req.body.companyId}`);
        res.redirect('/configuracoes.html?msg=logo_ok');
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao fazer upload da imagem.");
    }
});

// =============================================================
// 📝 PEDIDOS E PRODUTOS (COM TRAVA DE SEGURANÇA)
// =============================================================
app.get("/api/products", verificarEmpresaAtiva, async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT * FROM products WHERE company_id = ?`, args: [req.query.company_id] });
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

app.post("/api/products", verificarEmpresaAtiva, async (req, res) => {
  const { company_id, name, price, category, description, destination } = req.body;
  const destinoFinal = destination || 'cozinha';
  try {
      await db.execute({
          sql: `INSERT INTO products (company_id, name, price, category, description, destination) VALUES (?,?,?,?,?,?)`,
          args: [Number(company_id), name, price, category, description, destinoFinal]
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

app.put("/api/products/:id/visible", async (req, res) => {
    const { id } = req.params;
    const { visible } = req.body;
    try {
        await db.execute({ sql: "UPDATE products SET visible = ? WHERE id = ?", args: [visible, id] });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// --- USUÁRIOS (COM TRAVA) ---
app.get("/api/users", verificarEmpresaAtiva, async (req, res) => {
    try {
        const result = await db.execute({ sql: `SELECT id, name, email, role FROM users WHERE company_id = ?`, args: [req.query.company_id] });
        res.json({ ok: true, users: result.rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/users", verificarEmpresaAtiva, async (req, res) => {
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

// --- MENU PÚBLICO ---
app.get("/api/public/menu/:company_id", async (req, res) => {
    try {
        const company = await db.execute({ sql: "SELECT name FROM companies WHERE id = ?", args: [req.params.company_id] });
        const products = await db.execute({ sql: "SELECT name, price, category, description FROM products WHERE company_id = ? AND visible = 1", args: [req.params.company_id] });
        res.json({ restaurant: company.rows[0]?.name, menu: products.rows });
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

// --- PEDIDOS (COM TRAVA) ---
app.post("/api/orders", verificarEmpresaAtiva, async (req, res) => {
    const { company_id, items, total, table_name, notes } = req.body;
    const agora = getHoraLocalISOString();
    try {
        await db.execute({
            sql: `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at, status_cozinha, status_bar) VALUES (?,?,?,?,?,?,?, 'novo', 'novo')`,
            args: [Number(company_id), JSON.stringify(items), total, table_name, notes, agora, agora]
        });
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ ok: false }); }
});

app.get("/api/orders", verificarEmpresaAtiva, async (req, res) => {
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
    const { status, payment_method } = req.body; // O servidor agora pega a forma de pagamento
    try {
        if (payment_method) {
            // Se tiver forma de pagamento, salva ela no banco
            await db.execute({
                sql: `UPDATE orders SET status = ?, status_updated_at = ?, payment_method = ? WHERE id = ?`,
                args: [status, getHoraLocalISOString(), payment_method, req.params.id]
            });
        } else {
            // Se não tiver (ex: apenas mudando status normal), faz como antes
            await db.execute({
                sql: `UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ?`,
                args: [status, getHoraLocalISOString(), req.params.id]
            });
        }
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/orders/history", verificarEmpresaAtiva, async (req, res) => {
    const { company_id } = req.query;
    try {
        const result = await db.execute({ 
            sql: `SELECT * FROM orders WHERE company_id = ? AND status IN ('finalizado', 'pronto', 'entregue', 'pago', 'concluido', 'cancelado') ORDER BY status_updated_at DESC`, 
            args: [company_id] 
        });
        const rows = result.rows.map(r => ({...r, items: JSON.parse(r.items || "[]")}));
        res.json({ ok: true, pedidos: rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});
// ROTA PARA BUSCAR QUAIS MESAS ESTÃO COM PEDIDO ABERTO
app.get('/api/orders/active', async (req, res) => {
  const { company_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ error: "Company ID é obrigatório" });
  }

  try {
    // CORREÇÃO: Usando 'table_name' que é o nome real da sua coluna no banco
    const result = await db.execute({
      sql: `SELECT DISTINCT table_name 
            FROM orders 
            WHERE company_id = ? 
            AND status NOT IN ('pago', 'finalizado', 'cancelado')`,
      args: [Number(company_id)]
    });

    // Retorna as linhas encontradas
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar mesas ativas:", error);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// =============================================================
// 🧠 ROTA ESPECIAL: Atualiza Setor e Lógica de Cancelamento Parcial
// =============================================================
app.post("/api/orders/:id/status-sector", async (req, res) => {
    const { id } = req.params;
    const { sector, status } = req.body; 
    const coluna = sector === 'bar' ? 'status_bar' : 'status_cozinha';
    const agora = getHoraLocalISOString();

    try {
        await db.execute({
            sql: `UPDATE orders SET ${coluna} = ?, status_updated_at = ? WHERE id = ?`,
            args: [status, agora, id]
        });

        const result = await db.execute({ sql: "SELECT total, items, status_cozinha, status_bar FROM orders WHERE id = ?", args: [id] });
        const order = result.rows[0];
        const items = JSON.parse(order.items || "[]");

        if (status === 'cancelado') {
            const valorDescontar = items
                .filter(i => sector === 'bar' ? i.destination === 'bar' : i.destination !== 'bar')
                .reduce((s, i) => s + (Number(i.price || 0) * Number(i.qty || 1)), 0);
            
            const novoTotal = Math.max(0, order.total - valorDescontar);
            
            await db.execute({
                sql: `UPDATE orders SET total = ? WHERE id = ?`,
                args: [novoTotal, id]
            });
        }

        const temBar = items.some(i => i.destination === 'bar');
        const temCozinha = items.some(i => i.destination !== 'bar');

        const stCozinha = temCozinha ? order.status_cozinha : 'pronto';
        const stBar = temBar ? order.status_bar : 'pronto';

        let novoStatusGlobal = null;

        if ((!temCozinha || stCozinha === 'cancelado') && (!temBar || stBar === 'cancelado')) {
            novoStatusGlobal = 'cancelado';
        }
        else if (stCozinha === 'preparando' || stBar === 'preparando') {
            novoStatusGlobal = 'preparando';
        }
        else {
            const cozinhaResolvida = (!temCozinha || stCozinha === 'pronto' || stCozinha === 'cancelado');
            const barResolvido = (!temBar || stBar === 'pronto' || stBar === 'cancelado');
            
            if (cozinhaResolvida && barResolvido && (stCozinha === 'pronto' || stBar === 'pronto')) {
                novoStatusGlobal = 'pronto';
            }
        }

        if (novoStatusGlobal) {
            await db.execute({
                sql: `UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ?`,
                args: [novoStatusGlobal, agora, id]
            });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

// =============================================================
// 📊 RELATÓRIOS E DASHBOARD (COM TRAVA)
// =============================================================
app.get("/api/reports/dashboard", verificarEmpresaAtiva, async (req, res) => {
    const { company_id } = req.query;
    const mesAtual = getHoraLocalISOString().substring(0, 7); 

    try {
        const result = await db.execute({
            sql: `SELECT status FROM orders WHERE company_id = ? AND created_at LIKE ?`,
            args: [company_id, `${mesAtual}%`]
        });

        let prontos = 0; let cancelados = 0; let pendentes = 0;

        result.rows.forEach(row => {
            if (row.status === 'cancelado') cancelados++;
            else if (['pronto', 'entregue', 'pago', 'concluido', 'finalizado'].includes(row.status)) prontos++;
            else pendentes++; 
        });

        res.json({ ok: true, stats: { prontos, cancelados, pendentes }, mes: mesAtual });
    } catch (err) { res.status(500).json({ ok: false, error: "Erro ao gerar estatísticas." }); }
});

// =============================================================
// 💸 PIX / WEBHOOK
// =============================================================
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
            additional_info: { ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress },
            metadata: { company_id: Number(company_id), dias_adicionar: Number(dias) }
        };
        if (deviceId) bodyPayment.metadata.device_id = deviceId;

        const result = await payment.create({ body: bodyPayment });
        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    } catch (error) { 
    // Isso vai imprimir o detalhe real no log do Render
    console.error("🔥 ERRO DO MERCADO PAGO:", error.cause || error.message); 
    res.status(500).json({ ok: false, error: "Erro Mercado Pago: " + (error.message || "Erro desconhecido") }); 
}
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
        const result = await db.execute({ sql: "SELECT trial_expires_at, plano FROM companies WHERE id = ?", args: [req.params.id] });
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
