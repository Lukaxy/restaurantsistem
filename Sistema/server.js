const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path"); 
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client/http");
const multer = require('multer');
const fs = require('fs');
const net = require("net"); // Importante para a impressora
const EscPosEncoder = require('esc-pos-encoder'); // npm install esc-pos-encoder

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// 1. CONFIGURAÇÃO DE DIRETÓRIOS
const publicPath = path.join(__dirname, "public");
const uploadDir = path.join(publicPath, "img");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(publicPath));

// 2. BANCO DE DADOS (TURSO) E PAGAMENTOS
const db = createClient({
  url: "https://restaurant-system-lukaxy.aws-us-east-1.turso.io", 
  authToken: process.env.TURSO_TOKEN,
});

const clientMP = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN, 
    options: { timeout: 5000 } 
});

// 3. INICIALIZAÇÃO DO BANCO (COM NOVAS COLUNAS DE IMPRESSORA)
async function initDb() {
    try {
        // Tabelas Base
        await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT, visible INTEGER DEFAULT 1, destination TEXT DEFAULT 'cozinha')`);

        // Verificação de colunas para evolução do banco (Alter Tables)
        const updates = [
            "ALTER TABLE companies ADD COLUMN impressora_cozinha_ip TEXT",
            "ALTER TABLE companies ADD COLUMN impressora_cozinha_porta INTEGER DEFAULT 9100",
            "ALTER TABLE orders ADD COLUMN status_cozinha TEXT DEFAULT 'novo'",
            "ALTER TABLE orders ADD COLUMN status_bar TEXT DEFAULT 'novo'",
            "ALTER TABLE orders ADD COLUMN payment_method TEXT"
        ];
        for (let sql of updates) { try { await db.execute(sql); } catch(e) {} }
        
        console.log("✅ Banco de Dados sincronizado.");
    } catch (err) { console.error("❌ Erro ao iniciar banco:", err); }
}

// 4. ENDPOINTS DE IMPRESSORA (REFEITOS)

// Salvar Configurações
app.post("/api/companies/:id/impressora", async (req, res) => {
    const { id } = req.params;
    const { ip, porta } = req.body;
    try {
        await db.execute({
            sql: `UPDATE companies SET impressora_cozinha_ip = ?, impressora_cozinha_porta = ? WHERE id = ?`,
            args: [ip, porta || 9100, id]
        });
        res.json({ ok: true, msg: "Configurações de impressão salvas!" });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Buscar Configurações
app.get("/api/companies/:id/impressora", async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT impressora_cozinha_ip, impressora_cozinha_porta FROM companies WHERE id = ?",
            args: [req.params.id]
        });
        const config = result.rows[0] || { impressora_cozinha_ip: '', impressora_cozinha_porta: 9100 };
        res.json({ ok: true, ...config });
    } catch (err) { res.status(500).json({ ok: false }); }
});

// Imprimir Comanda (Lógica Robusta com Socket)
app.post("/api/companies/:id/imprimir-comanda", async (req, res) => {
    const { id } = req.params;
    const { comanda } = req.body; // Espera: { id, mesa, total, itens: [{qtd, nome}] }

    try {
        const config = await db.execute({
            sql: "SELECT impressora_cozinha_ip, impressora_cozinha_porta FROM companies WHERE id = ?",
            args: [id]
        });

        const ip = config.rows[0]?.impressora_cozinha_ip;
        const porta = config.rows[0]?.impressora_cozinha_porta || 9100;

        if (!ip) return res.status(400).json({ ok: false, error: "IP da impressora não configurado." });

        const socket = new net.Socket();
        socket.setTimeout(5000); // Não deixa o servidor travado se a impressora sumir

        socket.connect(porta, ip, () => {
            const encoder = new EscPosEncoder();
            const logicaImpressao = encoder
                .initialize()
                .codepage('cp860') // Suporte para acentos PT-BR
                .align('center')
                .bold(true)
                .lineSpacing(40)
                .text(`PEDIDO #${comanda.id}\n`)
                .size('double')
                .text(`MESA ${comanda.mesa}\n`)
                .size('normal')
                .bold(false)
                .align('left')
                .text("-".repeat(30) + "\n")
                .text("QTD  ITEM\n")
                .text("-".repeat(30) + "\n");

            comanda.itens?.forEach(i => {
                const qtd = String(i.qtd || i.qty || 1).padEnd(5);
                const nome = (i.nome || i.name || "").substring(0, 25);
                logicaImpressao.text(`${qtd}${nome}\n`);
            });

            logicaImpressao
                .text("-".repeat(30) + "\n")
                .align('right')
                .text(`TOTAL R$ ${Number(comanda.total || 0).toFixed(2)}\n\n`)
                .align('center')
                .text("Digital Menu - Sistema Interno\n\n")
                .cut()
                .encode();

            socket.write(logicaImpressao.encode());
            socket.end();
            res.json({ ok: true });
        });

        socket.on('error', (err) => {
            socket.destroy();
            if (!res.headersSent) res.json({ ok: false, error: "Impressora offline: " + err.message });
        });

        socket.on('timeout', () => {
            socket.destroy();
            if (!res.headersSent) res.json({ ok: false, error: "Tempo esgotado ao conectar na impressora." });
        });

    } catch (err) {
        if (!res.headersSent) res.status(500).json({ ok: false, error: "Erro interno no servidor." });
    }
});

// 5. INICIALIZAÇÃO DO SERVIDOR
async function start() {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Servidor Digital Menu Ativo na porta ${PORT}`);
    });
}

start();
