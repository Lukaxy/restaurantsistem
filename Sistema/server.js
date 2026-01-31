const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose(); 
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

// Configura o cliente pegandoo token do Render
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

const DB_PATH = path.join(__dirname, "orders.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email_admin TEXT UNIQUE,
    whatsapp TEXT,
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
      db.run(`INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()],
        () => console.log("✅ Conta master pronta.")
      );
    }
  });
});

// =============================================================
// 📡 LOGIN COM TRAVA MANUAL E AUTOMÁTICA
// =============================================================
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;
  const sql = `SELECT u.*, c.trial_expires_at, c.plano FROM users u JOIN companies c ON u.company_id = c.id WHERE u.email = ?`;
  
  db.get(sql, [email], async (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });

    // 1. VERIFICAÇÃO DE BLOQUEIO MANUAL
    if (user.plano === 'bloqueado') {
      return res.status(403).json({ ok: false, error: "Sua conta está suspensa. ❌" });
    }

    // 2. VERIFICAÇÃO DE EXPIRAÇÃO AUTOMÁTICA
    const hoje = new Date();
    const expira = new Date(user.trial_expires_at);
    if (user.plano === 'trial' && hoje > expira) {
      return res.status(403).json({ ok: false, error: "Teste expirado! 🛑" });
    }

    res.json({ ok: true, user });
  });
});

// =============================================================
// 📊 ROTA DE HISTÓRICO CORRIGIDA
// =============================================================
app.get("/api/orders/history", (req, res) => {
  const { company_id } = req.query;
  // Agora aceita 'concluido' e 'pago', que são comuns ao finalizar pedidos
  const sql = `SELECT * FROM orders WHERE company_id = ? AND status IN ('finalizado', 'pronto', 'entregue', 'pago', 'concluido', 'concluído') ORDER BY status_updated_at DESC`;
  
  db.all(sql, [company_id], (err, rows) => {
    if (err) return res.status(500).json({ ok: false });
    rows.forEach(r => {
      try { r.items = JSON.parse(r.items || "[]"); } catch(e) { r.items = []; }
    });
    res.json({ ok: true, pedidos: rows });
  });
});

// [Abaixo estão as mesmas rotas que você enviou, sem alterações para não quebrar nada]

app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  db.get(`SELECT * FROM users WHERE email = ? AND role = 'master'`, [email], async (err, user) => {
    if (err || !user) return res.status(404).json({ ok: false, error: "Não encontrado." });
    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
    res.json({ ok: true, user });
  });
});

app.post("/api/register-company", (req, res) => {

  const { name, email, whatsapp, senha } = req.body; 
  
  const hash = bcrypt.hashSync(senha, 10);
  
  // Calcula data de expiração (5 dias)
  const dataExpira = new Date();
  dataExpira.setDate(dataExpira.getDate() + 5);
  
  const trial_expires_at = dataExpira.toISOString();
  const created_at = getHoraLocalISOString();

  // Adicionei 'whatsapp' no INSERT abaixo
  db.run(`INSERT INTO companies (name, email_admin, whatsapp, senha_hash, trial_expires_at, created_at) VALUES (?,?,?,?,?,?)`,
    [name, email, whatsapp, hash, trial_expires_at, created_at], function(err) {
      if (err) return res.status(400).json({ ok: false, error: "E-mail cadastrado." });
      
      const companyId = this.lastID;
      
      // Cria o usuário admin dessa empresa
      db.run(`INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        [companyId, "Administrador", email, hash, created_at], () => {
          res.json({ ok: true, user: { id: companyId, company_id: companyId, role: 'admin' } });
        });
    });
});

app.get("/api/empresas", (req, res) => {
  
  db.all(`SELECT id, name, email_admin, whatsapp, plano, trial_expires_at, created_at FROM companies ORDER BY id DESC`, (err, rows) => {
    res.json({ ok: true, empresas: rows });
  });
});

// NOVA ROTA: Adicionar dias ao plano manualmente
app.post("/api/empresas/:id/add-days", (req, res) => {
  const { id } = req.params;
  const { dias } = req.body;

  // 1. Primeiro buscamos a empresa para ver a data atual dela
  db.get("SELECT trial_expires_at FROM companies WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ ok: false, error: "Empresa não encontrada" });

    // 2. Lógica inteligente de data
    const hoje = new Date();
    const vencimentoAtual = new Date(row.trial_expires_at);
    
    // Se já venceu, começa a contar de HOJE. Se não venceu, soma ao que já tem.
    let novaData = (vencimentoAtual > hoje) ? vencimentoAtual : hoje;
    novaData.setDate(novaData.getDate() + parseInt(dias));

    // 3. Atualiza no banco
    db.run("UPDATE companies SET trial_expires_at = ?, plano = 'basic' WHERE id = ?", 
      [novaData.toISOString(), id], 
      (err) => {
        if (err) return res.status(500).json({ ok: false });
        res.json({ ok: true, nova_data: novaData });
      }
    );
  });
});

app.post("/api/empresas/:id/plano", (req, res) => {
  db.run(`UPDATE companies SET plano = ? WHERE id = ?`, [req.body.plano, req.params.id], () => res.json({ ok: true }));
});

app.delete("/api/empresas/:id", (req, res) => {
  db.run(`DELETE FROM companies WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
});

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
// 🗑️ ROTA QUE FALTAVA: DELETAR USUÁRIO
// =============================================================
app.delete("/api/users/:id", (req, res) => {
    const { id } = req.params;
    
    // Impede de deletar o Master (segurança)
    db.get("SELECT email FROM users WHERE id = ?", [id], (err, user) => {
        if (user && user.email === "admin@master.com") {
            return res.status(403).json({ ok: false, error: "Não pode deletar o Master!" });
        }

        db.run(`DELETE FROM users WHERE id = ?`, [id], function(err) {
            if (err) return res.status(500).json({ ok: false, error: "Erro ao excluir." });
            res.json({ ok: true });
        });
    });
});

// =============================================================
// ➕ ROTA DE ADICIONAR (COM CORREÇÃO DO parseInt)
// =============================================================
app.post("/api/users", (req, res) => {
    const { name, email, senha, role, company_id } = req.body;

    if (!name || !email || !senha || !company_id) {
        return res.status(400).json({ ok: false, error: "Dados incompletos." });
    }

    const hash = bcrypt.hashSync(senha, 10);
    
    // O parseInt(company_id) aqui é o segredo para o LOGIN funcionar depois!
    const sql = `INSERT INTO users (name, email, senha_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [name, email, hash, role, parseInt(company_id), getHoraLocalISOString()];

    db.run(sql, params, function(err) {
        if (err) {
            if (err.message.includes("UNIQUE")) {
                 return res.status(400).json({ ok: false, error: "E-mail já está em uso." });
            }
            console.error(err);
            return res.status(500).json({ ok: false, error: "Erro ao salvar no banco." });
        }
        res.json({ ok: true, id: this.lastID });
    });
});

// =============================================================
// 💰 ROTA PIX REAL (COM DADOS DO USUÁRIO CORRETOS)
// =============================================================
app.post("/api/pay/create", async (req, res) => {
    // Agora recebemos 'name' também
    const { company_id, email, name, valor, dias, docNumber } = req.body;

    // 1. Limpa o CPF/CNPJ (Deixa só números)
    const cleanDoc = docNumber ? docNumber.replace(/\D/g, '') : '';
    const docType = cleanDoc.length > 11 ? 'CNPJ' : 'CPF';

    // 2. Trata o Nome e Sobrenome (O MP exige separado)
    // Se o nome for "João Silva", first="João", last="Silva"
    // Se for só "João", first="João", last="Cliente"
    const partesNome = (name || "Cliente Teste").split(" ");
    const firstName = partesNome[0];
    const lastName = partesNome.length > 1 ? partesNome.slice(1).join(" ") : "App";

    // 3. Email de segurança
    // Se for teste, force um email diferente para não dar conflito com o dono da conta
    // DICA: Mantenha 'email' se for produção real, mas para testar, use um fake se der erro
    const emailPayer = email; 

    try {
        const payment = new Payment(client);

        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Assinatura Sistema - ${dias} Dias`,
                payment_method_id: 'pix',
                payer: {
                    email: emailPayer,
                    first_name: firstName,
                    last_name: lastName,
                    identification: {
                        type: docType,
                        number: cleanDoc
                    }
                },
                metadata: {
                    company_id: Number(company_id),
                    dias_adicionar: Number(dias)
                }
            }
        });

        const data = result.point_of_interaction.transaction_data;

        res.json({ 
            ok: true, 
            qr_code: data.qr_code,
            qr_code_base64: data.qr_code_base64,
            id: result.id
        });

    } catch (error) {
        console.error("ERRO MP:", JSON.stringify(error, null, 2));
        const msg = error.cause?.[0]?.description || error.message || "Erro desconhecido";
        res.status(500).json({ ok: false, error: "Falha MP: " + msg });
    }
});

// =============================================================
// 🔔 WEBHOOK: RECEBE AVISO DE PAGAMENTO DO MERCADO PAGO
// =============================================================
app.post("/api/webhook", async (req, res) => {
    console.log("🚀 WEBHOOK RECEBIDO! Corpo da requisição:", JSON.stringify(req.body));
 
    const { type, data } = req.body;

    if (type === "payment") {
        try {
            const paymentId = data.id;
            const payment = new Payment(client);
            const p = await payment.get({ id: paymentId });

            if (p.status === "approved") {
                const { company_id, dias_adicionar } = p.metadata;

                // 1. Buscamos a empresa para ver a data de expiração atual
                db.get("SELECT trial_expires_at FROM companies WHERE id = ?", [company_id], (err, row) => {
                    if (err || !row) return console.error("Empresa não encontrada no Webhook");

                    const hoje = new Date();
                    const vencimentoAtual = new Date(row.trial_expires_at);
                    
                    // 2. Lógica: Se já venceu, soma a partir de hoje. Se não, soma no que já tem.
                    let novaData = (vencimentoAtual > hoje) ? vencimentoAtual : hoje;
                    novaData.setDate(novaData.getDate() + parseInt(dias_adicionar));
                   
                   // Dentro do app.post("/api/webhook"...)
                   db.serialize(() => {
                    db.run("UPDATE companies SET trial_expires_at = ?, plano = 'basic' WHERE id = ?", 
                       [novaData.toISOString(), company_id], 
                       function(err) {
                       if (err) {
                          console.error("❌ Erro SQL no Webhook:", err.message);
                       } else {
                         console.log(`✅ SUCESSO TOTAL: Empresa ${company_id} agora vence em ${novaData.toISOString()}`);
            }
        }
    );
});
            }
        } catch (error) {
            console.error("Erro no processamento do Webhook:", error);
        }
    }

    // Responde sempre 200 para o Mercado Pago não ficar reenviando o mesmo aviso
    res.sendStatus(200);
});

const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Sistema Rodando em http://localhost:${PORT}`);
});
