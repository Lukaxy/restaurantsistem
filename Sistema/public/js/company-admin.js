// ==================== PAINEL DA EMPRESA ====================

// URL base da API
const API_URL = "https://restaurantsistem.onrender.com";

const user = JSON.parse(localStorage.getItem("user") || "null");
const msg = document.getElementById("msg");
const list = document.getElementById("users-list");

// 🔒 Apenas admin da empresa
if (!user || user.role !== "admin" || !user.company_id) {
  alert("Acesso negado.");
  window.location.href = "login.html";
}

// ======== LISTAR USUÁRIOS ========
async function carregarUsuarios() {
  list.innerHTML = "Carregando...";

  try {
    const res = await fetch(`${API_URL}/api/users?company_id=${user.company_id}`);
    const text = await res.text();

    // 🔥 evita erro silencioso de HTML
    if (text.trim().startsWith("<")) {
      throw new Error("Servidor retornou HTML. Verifique a rota /api/users.");
    }

    const data = JSON.parse(text);

    if (!data.ok) throw new Error(data.error || "Erro ao carregar usuários.");

    if (!data.users || data.users.length === 0) {
      list.innerHTML = "<p>Nenhum usuário encontrado.</p>";
      return;
    }

    list.innerHTML = data.users.map(u => `
      <div class="user">
        <b>${u.name}</b> — ${u.email} (${u.role})
        ${u.role !== "admin"
          ? `<button onclick="excluir(${u.id})">🗑️</button>`
          : ""}
      </div>
    `).join("");

  } catch (err) {
    console.error(err);
    list.innerHTML = `<p style="color:red;">${err.message}</p>`;
  }
}

// ======== ADICIONAR USUÁRIO ========
async function addUser() {
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value.trim();
  const role = document.getElementById("role").value;

  msg.textContent = "";

  if (!name || !email || !senha) {
    msg.style.color = "red";
    msg.textContent = "Preencha todos os campos.";
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        senha,
        role,
        company_id: user.company_id
      })
    });

    const text = await res.text();
    if (text.trim().startsWith("<")) {
      throw new Error("Deu merda aqui, o servidor retornou HTML.");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || "Deu erro ao adicionar usuário.");

    msg.style.color = "green";
    msg.textContent = "✅ Usuário adicionado com sucesso, marcha nos trabalhos!";

    document.getElementById("name").value = "";
    document.getElementById("email").value = "";
    document.getElementById("senha").value = "";

    carregarUsuarios();
  } catch (err) {
    msg.style.color = "red";
    msg.textContent = err.message;
  }
}

// ======== EXCLUIR USUÁRIO ========
async function excluir(id) {
  if (!confirm("Deseja realmente excluir este camarada?")) return;

  try {
    const res = await fetch(`${API_URL}/api/users/${id}`, { method: "DELETE" });
    const text = await res.text();

    if (text.trim().startsWith("<")) {
      throw new Error("Servidor retornou HTML.");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || "Deu erro ao excluir usuário.");

    carregarUsuarios();
  } catch (err) {
    alert(err.message);
  }
}

// ======== LOGOUT ========
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

document.addEventListener("DOMContentLoaded", carregarUsuarios);
