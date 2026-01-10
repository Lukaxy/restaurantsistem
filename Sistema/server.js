const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");

const MASTER_EMAIL = "admin@master.com";
const MASTER_SENHA = "123456";

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
const DB_PATH = path.join(process.cwd(), "orders.db");
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

// Garante coluna description em products (SQLite)

db.get(`PRAGMA table_info(products)`, (err) => {
  if (err) return console.error("Erro PRAGMA products:", err);
  db.all(`PRAGMA table_info(products)`, (err, cols) => {
    if (err) return console.error("Erro PRAGMA products:", err);
    const temDescription = cols.some(c => c.name === "description");
    if (!temDescription) {
      db.run(`ALTER TABLE products ADD COLUMN description TEXT`, (e2) => {
        if (e2) console.error("Erro ao adicionar coluna description:", e2.message);
        else console.log("✅ Coluna 'description' adicionada em products");
      });
    }
  });
});
  // Cria conta master se não existir
  const hash = bcrypt.hashSync(MASTER_SENHA, 10);
  db.get(`SELECT * FROM users WHERE email = ?`, [MASTER_EMAIL], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, senha_hash, role, created_at)
         VALUES (?, ?, ?, 'master', ?)`,
        ["Admin Master", MASTER_EMAIL, hash, getHoraLocalISOString()],
        () =>
          console.log("✅ Conta master criada:", MASTER_EMAIL, "senha:", MASTER_SENHA)
      );
    }
  });
});

// =============================================================
// 📡 ROTAS DE LOGIN E CADASTRO
// =============================================================

// ---- LOGIN MASTER ----
app.post("/api/admin-login", async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ ok: false, error: "Preencha todos os campos." });

  db.get(
    `SELECT * FROM users WHERE email = ? AND role = 'master'`,
    [email],
    async (err, user) => {
      if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
      if (!user)
        return res.status(404).json({ ok: false, error: "Usuário master não encontrado." });

      const valid = await bcrypt.compare(senha, user.senha_hash);
      if (!valid)
        return res.status(401).json({ ok: false, error: "Senha incorreta." });

      console.log(`👑 Login master: ${user.email}`);
      res.json({ ok: true, user });
    }
  );
});

// ---- LOGIN DE USUÁRIO ----
app.post("/api/login", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ ok: false, error: "Preencha todos os campos." });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (!user) return res.status(404).json({ ok: false, error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid)
      return res.status(401).json({ ok: false, error: "Senha incorreta." });

    res.json({
      ok: true,
      user: {
        id: user.id,
        company_id: user.company_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
});

// ---- CADASTRAR EMPRESA ----
app.post("/api/register-company", (req, res) => {
  const { name, email, senha } = req.body;
  if (!name || !email || !senha)
    return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  const senha_hash = bcrypt.hashSync(senha, 10);
  const created_at = getHoraLocalISOString();

  db.get(`SELECT * FROM companies WHERE email_admin = ?`, [email], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: "Erro no banco." });
    if (row) return res.status(400).json({ ok: false, error: "E-mail já cadastrado." });

    db.run(
      `INSERT INTO companies (name, email_admin, senha_hash, created_at)
       VALUES (?, ?, ?, ?)`,
      [name, email, senha_hash, created_at],
      function (err) {
        if (err) {
          console.error("Erro ao cadastrar empresa:", err.message);
          return res.status(500).json({ ok: false, error: "Erro ao cadastrar empresa." });
        }

        const companyId = this.lastID;

        db.run(
          `INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
           VALUES (?, ?, ?, ?, 'admin', ?)`,
          [companyId, "Administrador", email, senha_hash, created_at],
          (userErr) => {
            if (userErr) {
              console.error("Erro ao criar usuário admin:", userErr.message);
              return res.status(500).json({ ok: false, error: "Erro ao criar usuário admin." });
            }
            console.log(`🏢 Empresa "${name}" criada com admin ${email}`);
            res.json({ ok: true, id: companyId });
          }
        );
      }
    );
  });
});

// =============================================================
// 🏢 ROTAS DE EMPRESAS (Painel Admin)
// =============================================================

// Listar empresas
app.get("/api/empresas", (req, res) => {
  db.all(`SELECT id, name, email_admin, plano, created_at FROM companies ORDER BY id DESC`, (err, rows) => {
    if (err) {
      console.error("Erro ao listar empresas:", err.message);
      return res.status(500).json({ ok: false, error: "Erro ao listar empresas." });
    }
    res.json({ ok: true, empresas: rows });
  });
});

// Alterar plano
app.post("/api/empresas/:id/plano", (req, res) => {
  const { plano } = req.body;
  const id = req.params.id;
  if (!plano)
    return res.status(400).json({ ok: false, error: "Plano é obrigatório." });

  db.run(`UPDATE companies SET plano = ? WHERE id = ?`, [plano, id], function (err) {
    if (err) {
      console.error("Erro ao atualizar plano:", err.message);
      return res.status(500).json({ ok: false, error: "Erro ao atualizar plano." });
    }
    res.json({ ok: true });
  });
});

// Excluir empresa
app.delete("/api/empresas/:id", (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM companies WHERE id = ?`, [id], function (err) {
    if (err) {
      console.error("Erro ao excluir empresa:", err.message);
      return res.status(500).json({ ok: false, error: "Erro ao excluir empresa." });
    }
    res.json({ ok: true });
  });
});

// =============================================================
// 👥 ROTAS DE USUÁRIOS
// =============================================================

app.get("/api/users", (req, res) => {
  const { company_id } = req.query;
  if (!company_id)
    return res.status(400).json({ ok: false, error: "company_id é obrigatório." });

  db.all(
    `SELECT id, name, email, role, ativo, created_at 
     FROM users WHERE company_id = ? ORDER BY id DESC`,
    [company_id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao listar usuários." });
      res.json({ ok: true, users: rows });
    }
  );
});

app.post("/api/users", (req, res) => {
  const { company_id, name, email, senha, role } = req.body;
  if (!company_id || !name || !email || !senha)
    return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  const senha_hash = bcrypt.hashSync(senha, 10);
  const created_at = getHoraLocalISOString();

  db.run(
    `INSERT INTO users (company_id, name, email, senha_hash, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [company_id, name, email, senha_hash, role || "atendente", created_at],
    function (err) {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao adicionar usuário." });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.delete("/api/users/:id", (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM users WHERE id = ?`, [id], function (err) {
    if (err)
      return res.status(500).json({ ok: false, error: "Erro ao excluir usuário." });
    res.json({ ok: true });
  });
});

// =============================================================
// 📦 ROTAS DE PRODUTOS
// =============================================================
app.get("/api/products", (req, res) => {
  const { company_id } = req.query;
  if (!company_id)
    return res.status(400).json({ ok: false, error: "company_id é obrigatório." });

  db.all(`SELECT * FROM products WHERE company_id = ?`, [company_id], (err, rows) => {
    if (err)
      return res.status(500).json({ ok: false, error: "Erro ao listar produtos." });
    res.json(rows);
  });
});

app.post("/api/products", (req, res) => {
  const { company_id, name, price, category, description } = req.body;
  if (!company_id || !name || !price)
    return res.status(400).json({ ok: false, error: "Campos obrigatórios." });

  db.run(
    `INSERT INTO products (company_id, name, price, category, description)
     VALUES (?, ?, ?, ?, ?)`,
    [company_id, name, price, category || null, description || ""],
    function (err) {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao adicionar produto." });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.delete("/api/products/:id", (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM products WHERE id = ?`, [id], function (err) {
    if (err)
      return res.status(500).json({ ok: false, error: "Erro ao excluir produto." });
    res.json({ ok: true });
  });
});

// =============================================================
// 🧾 ROTAS DE PEDIDOS
// =============================================================

app.post("/api/orders", (req, res) => {
  const { company_id, items, total, table_name, notes } = req.body;

  if (!company_id || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, error: "Dados inválidos do pedido." });

  const created_at = getHoraLocalISOString();
  const status_updated_at = created_at;
  const itemsJson = JSON.stringify(items);

  db.run(
    `INSERT INTO orders (company_id, items, total, table_name, notes, status, created_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, 'novo', ?, ?)`,
    [company_id, itemsJson, total, table_name, notes, created_at, status_updated_at],
    function (err) {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao salvar pedido." });
      console.log(`🧾 Novo pedido criado (empresa ${company_id})`);
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.get("/api/orders", (req, res) => {
  const { company_id, status } = req.query;
  if (!company_id)
    return res.status(400).json({ ok: false, error: "company_id é obrigatório." });

  let query = `SELECT * FROM orders WHERE company_id = ?`;
  const params = [company_id];

  // não mostrar pedidos prontos com mais de 10 minutos
if (!status) {
  query += ` AND (status != 'pronto' OR datetime(status_updated_at) > datetime('now', '-5 minutes'))`;
}

  query += ` ORDER BY id DESC`;

  db.all(query, params, (err, rows) => {
    if (err)
      return res.status(500).json({ ok: false, error: "Erro ao listar pedidos." });

    rows.forEach((r) => {
      try {
        r.items = JSON.parse(r.items || "[]");
      } catch {
        r.items = [];
      }
    });

    res.json({ ok: true, pedidos: rows });
  });
});

app.post("/api/orders/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run(
    "UPDATE orders SET status = ?, status_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status, id],
    function (err) {
      if (err) return res.json({ ok: false, error: err.message });

      db.get("SELECT * FROM orders WHERE id = ?", [id], (err2, order) => {
        if (err2) return res.json({ ok: false, error: err2.message });
        res.json({ ok: true, order });
      });
    }
  );
});

app.get("/api/orders/history", (req, res) => {
  const { company_id } = req.query;
  if (!company_id)
    return res.status(400).json({ ok: false, error: "company_id é obrigatório." });

  db.all(
    `SELECT * FROM orders WHERE company_id = ? AND status IN ('pronto','entregue','cancelado')
     ORDER BY status_updated_at DESC`,
    [company_id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ ok: false, error: "Erro ao carregar histórico." });

      rows.forEach((r) => {
        try {
          r.items = JSON.parse(r.items || "[]");
        } catch {
          r.items = [];
        }
      });

      res.json({ ok: true, pedidos: rows });
    }
  );
});

// =============================================================
// ⚙️ SERVIR ARQUIVOS ESTÁTICOS
// =============================================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

app.use(
  "/js",
  express.static(path.join(publicPath, "js"), {
    extensions: ["js"],
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    },
  })
);

// =============================================================
// 🚀 INICIAR SERVIDOR
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
});

