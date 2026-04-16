const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); 
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client/http");
const multer = require('multer');
const fs = require('fs');
const net = require("net");
const EscPosEncoder = require('esc-pos-encoder');

// =============================================================
// 🔧 CONFIGURAÇÕES INICIAIS
// =============================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

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
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const idEmpresa = req.body.companyId || 'desconhecido';
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

const mpClient = new MercadoPagoConfig({ 
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
    console.log("🔄 Verificando integridade do banco...");
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT, impressora_cozinha_ip TEXT, impressora_cozinha_porta INTEGER DEFAULT 9100)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT, status_cozinha TEXT DEFAULT 'novo', status_bar TEXT DEFAULT 'novo')`);
        await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT, visible INTEGER DEFAULT 1, destination TEXT DEFAULT 'cozinha')`);

        // Migrações de colunas para sistemas antigos
        const migrations = [
            "ALTER TABLE products ADD COLUMN visible INTEGER DEFAULT 1",
            "ALTER TABLE products ADD COLUMN destination TEXT DEFAULT 'cozinha'",
            "ALTER TABLE orders ADD COLUMN status_cozinha TEXT DEFAULT 'novo'",
            "ALTER TABLE orders ADD COLUMN status_bar TEXT DEFAULT 'novo'",
            "ALTER TABLE orders ADD COLUMN payment_method TEXT",
            "ALTER TABLE companies ADD COLUMN impressora_cozinha_ip TEXT",
            "ALTER TABLE companies ADD COLUMN impressora_cozinha_porta INTEGER DEFAULT 9100"
        ];
        for (let sql of migrations) { try { await db.execute(sql); } catch (e) {} }

        const checkMaster = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [MASTER_EMAIL] });
        if (checkMaster.rows.length === 0) {
            const hash = bcrypt.hashSync(MASTER_SENHA, 10);
            await db.execute({
                sql: "INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)",
                args: ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
            });
        }
        console.log("✅ Banco pronto.");
    } catch (err) { console.error("❌ Erro Banco:", err); process.exit(1); }
}

// =============================================================
// 🛡️ MIDDLEWARE DE SEGURANÇA
// =============================================================
async function verificarEmpresaAtiva(req, res, next) {
    const company_id = req.query.company_id || req.body.company_id || req.body.companyId || req.params.company_id;
    if (!company_id) return next();
    try {
        const result = await db.execute({ sql: "SELECT id, plano FROM companies WHERE id = ?", args: [Number(company_id)] });
        const empresa = result.rows[0];
        if (!empresa || empresa.plano === 'bloqueado') return res.status(401).json({ ok: false, error: "Empresa inativa." });
        next();
    } catch (err) { res.status(500).json({ ok: false }); }
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
        if (!await bcrypt.compare(String(senha), String(user.senha_hash))) return res.status(401).json({ ok: false, error: "Senha incorreta." });
        if (user.plano === 'bloqueado') return res.status(403).json({ ok: false, error: "Conta suspensa." });

        const expirou = user.role !== 'master' && user.trial_expires_at && (new Date() > new Date(user.trial_expires_at));
        res.json({ ok: true, user: { ...user, planoExpirado: expirou } });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/register-company", async (req, res) => {
    const { name, email, whatsapp, senha } = req.body; 
    try {
        const hash = bcrypt.hashSync(String(senha), 10);
        const trial_at = new Date(); trial_at.setDate(trial_at.getDate() + 7);
        const created_at = getHoraLocalISOString();

        const resCompany = await db.execute({
            sql: `INSERT INTO companies (name, email_admin, whatsapp, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?,?)`,
            args: [name, email, whatsapp, hash, trial_at.toISOString(), created_at]
        });
        const newId = Number(String(resCompany.lastInsertRowid));
        await db.execute({
            sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
            args: [newId, "Administrador", email, hash, created_at]
        });
        res.json({ ok: true, user: { id: newId, company_id: newId, role: 'admin', name: "Administrador", email } });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// =============================================================
// 🖨️ ENDPOINTS IMPRESSORA
// =============================================================
app.post("/api/companies/:id/impressora", verificarEmpresaAtiva, async (req,res)=>{
    const {id}=req.params,{ip,porta}=req.body;
    await db.execute({sql:`UPDATE companies SET impressora_cozinha_ip=?,impressora_cozinha_porta=? WHERE id=?`,args:[ip,porta||9100,id]});
    res.json({ok:true,msg:"✅ Config salva!"});
});

app.get("/api/companies/:id/impressora", verificarEmpresaAtiva, async (req,res)=>{
    const result=await db.execute({sql:"SELECT impressora_cozinha_ip,impressora_cozinha_porta FROM companies WHERE id=?",args:[req.params.id]});
    res.json({ok:true,...result.rows[0]||{impressora_cozinha_ip:'',impressora_cozinha_porta:9100}});
});

app.post("/api/companies/:id/imprimir-comanda", verificarEmpresaAtiva, async (req,res)=>{
    const {id}=req.params,{comanda}=req.body;
    try {
        const config = await db.execute({sql:"SELECT impressora_cozinha_ip,impressora_cozinha_porta FROM companies WHERE id=?",args:[id]});
        const ip = config.rows[0]?.impressora_cozinha_ip;
        if(!ip) return res.json({ok:false,error:"Configure a impressora!"});

        const client = new net.Socket();
        client.setTimeout(5000);
        client.connect(config.rows[0].impressora_cozinha_porta || 9100, ip, () => {
            const encoder = new EscPosEncoder();
            const logica = encoder.initialize().codepage('cp860').bold(true).text(`COMANDA #${comanda.id}\n`).bold(false)
                .text(`MESA ${comanda.table_name || comanda.mesa}\n` + "-".repeat(30) + '\nQTD  ITEM\n' + "-".repeat(30) + '\n');
            
            comanda.itens?.forEach(i => {
                const qtd = String(i.qtd || i.qty || 1).padEnd(5);
                const nome = (i.nome || i.name || '').substring(0,20);
                logica.text(`${qtd}${nome}\n`);
            });

            logica.text("-".repeat(30) + `\nTOTAL R$ ${Number(comanda.total || 0).toFixed(2)}\n\n`).cut();
            client.write(logica.encode()); client.end();
            res.json({ok:true});
        });
        client.on('error', err => { client.destroy(); if(!res.headersSent) res.json({ok:false, error: "Impressora Offline"}); });
    } catch (err) { res.status(500).json({ok:false}); }
});

// =============================================================
// 📝 PEDIDOS E PRODUTOS
// =============================================================
app.post("/api/orders", verificarEmpresaAtiva, async (req, res) => {
    const { company_id, items, total, table_name, notes } = req.body;
    const agora = getHoraLocalISOString();
    try {
        await db.execute({
            sql: `INSERT INTO orders (company_id, items, total, table_name, notes, created_at, status_updated_at, status_cozinha, status_bar) VALUES (?,?,?,?,?,?,?, 'novo', 'novo')`,
            args: [Number(company_id), JSON.stringify(items), total, table_name, notes, agora, agora]
        });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.get("/api/orders", verificarEmpresaAtiva, async (req, res) => {
    let sql = `SELECT * FROM orders WHERE company_id = ?`;
    const args = [req.query.company_id];
    if (req.query.status) { sql += ` AND status = ?`; args.push(req.query.status); }
    try {
        const result = await db.execute({ sql: sql + ` ORDER BY id DESC`, args });
        const rows = result.rows.map(row => {
            try { return { ...row, items: JSON.parse(row.items || "[]") }; } catch(e) { return { ...row, items: [] }; }
        });
        res.json({ ok: true, pedidos: rows });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/orders/:id/status-sector", async (req, res) => {
    const { id } = req.params;
    const { sector, status } = req.body; 
    const coluna = sector === 'bar' ? 'status_bar' : 'status_cozinha';
    const agora = getHoraLocalISOString();

    try {
        await db.execute({ sql: `UPDATE orders SET ${coluna} = ?, status_updated_at = ? WHERE id = ?`, args: [status, agora, id] });
        const result = await db.execute({ sql: "SELECT total, items, status_cozinha, status_bar FROM orders WHERE id = ?", args: [id] });
        const order = result.rows[0];
        const items = JSON.parse(order.items || "[]");

        if (status === 'cancelado') {
            const valorDescontar = items
                .filter(i => sector === 'bar' ? i.destination === 'bar' : i.destination !== 'bar')
                .reduce((s, i) => s + (Number(i.price || 0) * Number(i.qty || 1)), 0);
            await db.execute({ sql: `UPDATE orders SET total = ? WHERE id = ?`, args: [Math.max(0, order.total - valorDescontar), id] });
        }
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// =============================================================
// 📊 DASHBOARD E PAGAMENTOS (PIX)
// =============================================================
app.get("/api/reports/dashboard", verificarEmpresaAtiva, async (req, res) => {
    const { company_id } = req.query;
    const mes = getHoraLocalISOString().substring(0, 7);
    try {
        const result = await db.execute({ sql: `SELECT status FROM orders WHERE company_id = ? AND created_at LIKE ?`, args: [company_id, `${mes}%`] });
        let stats = { prontos: 0, cancelados: 0, pendentes: 0 };
        result.rows.forEach(r => {
            if (r.status === 'cancelado') stats.cancelados++;
            else if (['pago', 'finalizado', 'concluido'].includes(r.status)) stats.prontos++;
            else stats.pendentes++;
        });
        res.json({ ok: true, stats, mes });
    } catch (err) { res.status(500).json({ ok: false }); }
});

app.post("/api/pay/create", async (req, res) => {
    const { company_id, email, name, valor, dias } = req.body;
    try {
        const payment = new Payment(mpClient);
        const result = await payment.create({ body: {
            transaction_amount: Number(valor),
            description: `Assinatura - ${dias} Dias`,
            payment_method_id: 'pix',
            notification_url: "https://sistemadigitalmenu.com.br/api/webhook",
            payer: { email, first_name: (name || "Cliente").split(" ")[0] },
            metadata: { company_id: Number(company_id), dias_adicionar: Number(dias) }
        }});
        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post("/api/webhook", async (req, res) => {
    const { type, data } = req.body;
    if (type === "payment") {
        try {
            const payment = new Payment(mpClient);
            const p = await payment.get({ id: data.id });
            if (p.status === "approved") {
                const { company_id, dias_adicionar } = p.metadata;
                const result = await db.execute({ sql: "SELECT trial_expires_at FROM companies WHERE id = ?", args: [company_id] });
                if (result.rows[0]) {
                    let novaData = new Date(Math.max(new Date(), new Date(result.rows[0].trial_expires_at)));
                    novaData.setDate(novaData.getDate() + parseInt(dias_adicionar));
                    await db.execute({ sql: "UPDATE companies SET trial_expires_at = ?, plano = 'basic' WHERE id = ?", args: [novaData.toISOString(), company_id] });
                }
            }
        } catch (e) { console.error("Webhook Error:", e); }
    }
    res.sendStatus(200);
});

// =============================================================
// 🚀 INICIALIZAÇÃO
// =============================================================
async function startServer() {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Digital Menu rodando na porta ${PORT}`);
    });
}
startServer();
