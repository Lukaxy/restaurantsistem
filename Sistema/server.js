const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require("@libsql/client/http");

// =============================================================
// 🔧 CONFIGURAÇÕES
// =============================================================
const db = createClient({
  // URL Fixa com HTTPS para evitar bloqueio do Render
  url: "https://restaurant-system-lukaxy.aws-us-east-1.turso.io", 
  authToken: process.env.TURSO_TOKEN,
});

const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN, 
    options: { timeout: 5000 } 
});

const MASTER_EMAIL = "lucasferreira123459966@gmail.com";
const MASTER_SENHA = "Lu@14032004";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

function getHoraLocalISOString() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19); 
}

// =============================================================
// 🏗️ INICIALIZAÇÃO ROBUSTA DO BANCO
// =============================================================
async function initDb() {
  console.log("🔄 Iniciando verificação do Banco de Dados...");
  try {
    // 1. Criação das Tabelas (Sequencial)
    await db.execute(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email_admin TEXT UNIQUE, whatsapp TEXT, senha_hash TEXT, plano TEXT DEFAULT 'trial', trial_expires_at TEXT, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, email TEXT UNIQUE, senha_hash TEXT, role TEXT DEFAULT 'atendente', ativo INTEGER DEFAULT 1, created_at TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, items TEXT, total REAL, table_name TEXT, notes TEXT, status TEXT DEFAULT 'novo', created_at TEXT, status_updated_at TEXT, payment_method TEXT)`);
    await db.execute(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT, price REAL, category TEXT, description TEXT)`);
    // Linha comentada para evitar erro de coluna duplicada
    // await db.execute(`ALTER TABLE products ADD COLUMN visible INTEGER DEFAULT 1`);
    
    console.log("✅ Tabelas verificadas/criadas.");

    // 2. Verificação/Criação do Master
    const checkMaster = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [MASTER_EMAIL] });
    
    if (checkMaster.rows.length === 0) {
      console.log("👤 Usuário Master não encontrado. Criando agora...");
      const hash = bcrypt.hashSync(MASTER_SENHA, 10);
      await db.execute({
        sql: "INSERT INTO users (name, email, senha_hash, role, created_at) VALUES (?, ?, ?, 'master', ?)",
        args: ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()]
      });
      console.log("✅ Usuário Master criado com sucesso.");
    } else {
      console.log("✅ Usuário Master já existe.");
    }

  } catch (err) { 
    console.error("❌ FALHA CRÍTICA NA INICIALIZAÇÃO DO BANCO:", err);
    process.exit(1); // Mata o servidor se o banco falhar
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

    // --- LOGICA DE EXPIRAÇÃO CORRIGIDA ---
    const expirou = user.role !== 'master' && 
                    user.trial_expires_at && 
                    (new Date() > new Date(user.trial_expires_at));

    // Se o plano expirou, enviamos a resposta e PARAMOS aqui com o 'return'
    if (expirou) {
        return res.json({ 
            ok: true, 
            user: { ...user, planoExpirado: true } 
        });
    }

    // Se NÃO expirou, ele pula o bloco acima e envia a resposta normal de login
    res.json({ ok: true, user: { ...user, planoExpirado: false } });

  } catch (err) {
    console.error("Erro Login:", err);
    // Verificamos se já não enviamos resposta antes de dar erro 500
    if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Erro interno no servidor." });
    }
  }
});

app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ? AND role = 'master'", args: [email] });
    const user = result.rows[0];
    
    if (!user) return res.status(401).json({ ok: false, error: "Master não encontrado." });

    const valid = await bcrypt.compare(String(senha), String(user.senha_hash));
    if (valid) {
        return res.json({ ok: true, user });
    }
    res.status(401).json({ ok: false, error: "Senha incorreta." });
  } catch (err) { 
      console.error(err);
      res.status(500).json({ ok: false, error: "Erro no servidor." }); 
  }
});

app.post("/api/register-company", async (req, res) => {
  const { name, email, whatsapp, senha } = req.body; 
  console.log(`📝 Cadastro solicitado: ${email}`);

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
    
    // Conversão Segura de ID
    const newId = Number(String(resCompany.lastInsertRowid));

    if (!newId || isNaN(newId)) throw new Error("Falha ao gerar ID da empresa.");

    await db.execute({
        sql: `INSERT INTO users (company_id, name, email, senha_hash, role, created_at) VALUES (?,?,?,?,'admin',?)`,
        args: [newId, "Administrador", email, hash, created_at]
    });

    res.json({ 
        ok: true, 
        user: { id: newId, company_id: newId, role: 'admin', name: "Administrador", email: email } 
    });
  } catch (err) { 
    console.error("Erro Cadastro:", err);
    res.status(400).json({ ok: false, error: err.message || "Erro ao cadastrar." }); 
  }
});

// =============================================================
// 📝 PEDIDOS, PRODUTOS E PAGAMENTOS
// =============================================================

// --- PRODUTOS ---
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
          args: [Number(company_id), name, price, category, description]
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

// ROTA PARA ATUALIZAR VISIBILIDADE DO PRODUTO (USADA PELO TOGGLE)
app.put("/api/products/:id/visible", async (req, res) => {
    const { id } = req.params;
    const { visible } = req.body; // Recebe 1 ou 0
    try {
        await db.execute({
            sql: "UPDATE products SET visible = ? WHERE id = ?",
            args: [visible, id]
        });
        res.json({ ok: true });
    } catch (err) {
        console.error("Erro ao atualizar visibilidade:", err);
        res.status(500).json({ ok: false, error: "Erro no banco de dados" });
    }
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
// =============================================================
// 🗑️ ROTA DE EXCLUIR EMPRESA 
// =============================================================
app.delete("/api/empresas/:id", async (req, res) => {
  const id = req.params.id;
  console.log(`🗑️ Solicitando exclusão da empresa ID: ${id}`);
  
  try {
    // 1. Remove tudo que pertence à empresa (Cascata)
    await db.execute({ sql: "DELETE FROM users WHERE company_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM products WHERE company_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM orders WHERE company_id = ?", args: [id] });

    // 2. Remove a empresa
    await db.execute({ sql: "DELETE FROM companies WHERE id = ?", args: [id] });

    console.log(`✅ Empresa ${id} excluída com sucesso.`);
    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Erro ao excluir empresa:", err);
    res.status(500).json({ ok: false, error: "Erro ao excluir dados vinculados." });
  }
});
// =============================================================
// 📅 ROTAS DE GERENCIAMENTO (Adicionar Dias e Mudar Plano)
// =============================================================

// 1. Adicionar Dias Manualmente
app.post("/api/empresas/:id/add-days", async (req, res) => {
  const { id } = req.params;
  const { dias } = req.body;

  try {
    // Busca a data atual da empresa
    const result = await db.execute({ sql: "SELECT trial_expires_at FROM companies WHERE id = ?", args: [id] });
    const row = result.rows[0];

    if (!row) return res.status(404).json({ ok: false, error: "Empresa não encontrada" });

    // Calcula a nova data
    const hoje = new Date();
    // Se já venceu, começa de hoje. Se não, soma na data que já tem.
    let dataBase = (new Date(row.trial_expires_at) > hoje) ? new Date(row.trial_expires_at) : hoje;
    
    dataBase.setDate(dataBase.getDate() + parseInt(dias));

    // Atualiza no banco
    await db.execute({
        sql: "UPDATE companies SET trial_expires_at = ? WHERE id = ?",
        args: [dataBase.toISOString(), id]
    });

    console.log(`✅ Adicionados ${dias} dias para a empresa ${id}`);
    res.json({ ok: true });

  } catch (err) {
    console.error("Erro ao adicionar dias:", err);
    res.status(500).json({ ok: false });
  }
});

// 2. Alterar Plano Manualmente (Trial / Basic / Vitalicio)
app.post("/api/empresas/:id/plano", async (req, res) => {
  const { id } = req.params;
  const { plano } = req.body; // 'trial', 'basic', 'vitalicio'

  try {
    await db.execute({
        sql: "UPDATE companies SET plano = ? WHERE id = ?",
        args: [plano, id]
    });
    console.log(`✅ Plano da empresa ${id} alterado para ${plano}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});
// Rota buscar produtos para o menu do cliente//
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

        res.json({ 
            restaurant: company.rows[0]?.name, 
            menu: products.rows 
        });
    } catch (err) {
        res.status(500).json({ error: "Erro ao carregar cardápio" });
    }
});
// =============================================================
// 🔎 ROTA DE BUSCAR DETALHES DA EMPRESA (Para o Painel Admin)
// =============================================================
app.get("/api/companies/:id", async (req, res) => {
  try {
      const result = await db.execute({ 
          sql: "SELECT * FROM companies WHERE id = ?", 
          args: [req.params.id] 
      });
      
      const company = result.rows[0];
      
      if (company) {
          res.json({ ok: true, company });
      } else {
          res.status(404).json({ ok: false, error: "Empresa não encontrada" });
      }
  } catch (err) { 
      res.status(500).json({ ok: false, error: "Erro ao buscar empresa" }); 
  }
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

// --- PAGAMENTO PIX ---
// ROTA ATUALIZADA PARA ENVIAR ITENS E CATEGORIA (MELHORAR NOTA NO MERCADO PAGO)
app.post("/api/pay/create", async (req, res) => {
    const { company_id, email, name, valor, dias, docNumber } = req.body;
    
    // URL OBRIGATÓRIA PARA O MERCADO PAGO AVISAR O SEU SISTEMA
    const notificationUrl = "https://sistemadigitalmenu.com.br/api/webhook";

    try {
        const payment = new Payment(client);
        
        // Separa o primeiro e último nome para evitar rejeição
        const nameParts = (name || "Cliente").split(" ");
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Empresa";

        const result = await payment.create({
            body: {
                transaction_amount: Number(valor),
                description: `Assinatura Sistema - ${dias} Dias`,
                payment_method_id: 'pix',
                notification_url: notificationUrl,
                payer: {
                    email: email,
                    first_name: firstName,
                    last_name: lastName,
                    identification: { 
                        type: docNumber?.length > 11 ? 'CNPJ' : 'CPF', 
                        number: docNumber?.replace(/\D/g, '') || '00000000000' 
                    }
                },
                // ADICIONADO PARA MELHORAR A NOTA DA INTEGRAÇÃO
                additional_info: {
                    items: [
                        {
                            id: `plan-${dias}`,
                            title: `Plano ${dias} Dias`,
                            description: "Acesso ao sistema de cardápio digital",
                            picture_url: "https://sistemadigitalmenu.com.br/assets/logo.png",
                            category_id: "services", 
                            quantity: 1,
                            unit_price: Number(valor)
                        }
                    ]
                },
                metadata: { company_id: Number(company_id), dias_adicionar: Number(dias) }
            }
        });

        const data = result.point_of_interaction.transaction_data;
        res.json({ ok: true, qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, id: result.id });
    
    } catch (error) { 
        console.error("Erro Mercado Pago:", error);
        res.status(500).json({ ok: false, error: "Erro Mercado Pago" }); 
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

// ROTA LEVE PARA O FRONTEND VERIFICAR SE O PAGAMENTO CAIU
app.get("/api/companies/:id/status", async (req, res) => {
    try {
        const result = await db.execute({ 
            sql: "SELECT trial_expires_at, plano FROM companies WHERE id = ?", 
            args: [req.params.id] 
        });
        
        const company = result.rows[0];
        if (company) {
            // Retorna a data de expiração para comparação
            res.json({ ok: true, expires_at: company.trial_expires_at, plano: company.plano });
        } else {
            res.status(404).json({ ok: false });
        }
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

// =============================================================
// 🚀 INICIALIZAÇÃO CORRETA DO SERVIDOR
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const PORT = process.env.PORT || 3000;

// SÓ LIGA O SERVIDOR DEPOIS QUE O BANCO ESTIVER PRONTO
async function startServer() {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Sistema rodando 100% pronto na porta ${PORT}`);
    });
}

startServer();
