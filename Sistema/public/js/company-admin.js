// ==================== PAINEL DA EMPRESA - SEM TOKEN ====================

const user = JSON.parse(localStorage.getItem("user") || "null");
const msg = document.getElementById("msg");
const list = document.getElementById("users-list");

// 🔒 Garante que apenas o admin da empresa acesse
if (!user || user.role !== "admin") {
  alert("Acesso negado. Apenas o administrador da empresa pode entrar.");
  window.location.href = "login.html";
}

// ======== LISTAR USUÁRIOS ========
async function carregarUsuarios() {
  list.innerHTML = "Carregando...";

  try {
    const res = await fetch("/api/users?company_id=" + user.company_id);
    if (!res.ok) throw new Error("Erro ao carregar usuários.");

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao carregar usuários");

    if (!data.users || data.users.length === 0) {
      list.innerHTML = "<p>Nenhum usuário encontrado.</p>";
      return;
    }

    list.innerHTML = data.users.map(u => `
      <div class="user">
        <b>${u.name}</b> — ${u.email} (${u.role})
        ${u.role !== "admin" ? `<button onclick="excluir(${u.id})">🗑️</button>` : ""}
      </div>
    `).join("");

  } catch (err) {
    console.error("Erro ao carregar usuários:", err);
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
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, senha, role, company_id: user.company_id })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao adicionar usuário.");

    msg.style.color = "green";
    msg.textContent = "✅ Usuário adicionado com sucesso!";
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
  if (!confirm("Deseja realmente excluir este usuário?")) return;

  try {
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "Erro ao excluir usuário.");
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

