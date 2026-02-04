// ==================== UTILITÁRIOS: TOAST & ESTILOS ====================
function showToast(mensagem, tipo = 'sucesso') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = "position:fixed; top:20px; right:20px; z-index:10000;";
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: #1a1a1a; color: white; padding: 15px 25px; border-radius: 10px; 
        border-left: 4px solid ${tipo === 'sucesso' ? '#51cf66' : '#ff6b6b'};
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 10px;
        display: flex; align-items: center; gap: 10px; font-family: 'Poppins', sans-serif;
        animation: slideIn 0.5s ease forwards;
    `;
    toast.innerHTML = `<span>${tipo === 'sucesso' ? '✅' : '❌'}</span> <span>${mensagem}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "fadeOut 0.5s ease forwards";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

const style = document.createElement('style');
style.innerHTML = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-20px); } }
`;
document.head.appendChild(style);

// ==================== VARIÁVEIS GLOBAIS ====================
const user = JSON.parse(localStorage.getItem("user") || "null");
let idUsuarioParaExcluir = null;

// Bloqueio de segurança (Seu código antigo)
if (!user || user.role !== "admin") {
    window.location.href = "login.html";
}

// ==================== LÓGICA DO CARD DE ASSINATURA ====================
function renderizarCardPlano(data) {
    const pNome = document.getElementById("plano-nome");
    const pDias = document.getElementById("plano-dias");
    const pCard = document.getElementById("plano-card");
    const pEmoji = document.getElementById("plano-emoji");

    if (!pNome || !pDias || !pCard) return;

    // Se não tiver data de expiração, exibe como carregando ou erro
    if (!data || !data.trial_expires_at) {
        pNome.textContent = "Plano Indisponível";
        return;
    }

    const expiraEm = new Date(data.trial_expires_at);
    const hoje = new Date();
    const diffDias = Math.ceil((expiraEm - hoje) / (1000 * 60 * 60 * 24));

    if (data.plano === 'vitalicio' || diffDias > 5000) {
        pNome.textContent = "Plano Vitalício 👑";
        pDias.textContent = "∞";
        pCard.style.borderLeftColor = "#fcc419";
        pEmoji.textContent = "👑";
    } else {
        pNome.textContent = data.plano === 'trial' ? "Período de Teste" : "Plano Profissional";
        pDias.textContent = diffDias > 0 ? diffDias : 0;
        pCard.style.borderLeftColor = diffDias <= 3 ? "var(--color-red)" : "var(--color-green)";
        pEmoji.textContent = data.plano === 'trial' ? "⏳" : "💎";
    }
}

// ==================== LISTAR USUÁRIOS ====================
async function carregarUsuarios() {
    const list = document.getElementById("users-list");
    if (!list) return;
    list.innerHTML = "<p style='text-align:center;'>Carregando...</p>";

    try {
        const res = await fetch("/api/users?company_id=" + user.company_id);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        list.innerHTML = data.users.map(u => `
            <div class="user" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color);">
                <div><b>${u.name}</b> — ${u.email} <small>(${u.role})</small></div>
                ${u.role !== "admin" ? `<button class="btn cancel" onclick="prepararExclusao(${u.id})">🗑️</button>` : ""}
            </div>
        `).join("");
    } catch (err) {
        showToast("Erro ao carregar lista", "erro");
    }
}

// ==================== ADICIONAR & EXCLUIR ====================
window.addUser = async function() {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value.trim();
    const role = document.getElementById("role").value;

    if (!name || !email || !senha) {
        showToast("Preencha todos os campos!", "erro");
        return;
    }

    try {
        const res = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, senha, role, company_id: user.company_id })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        showToast("Usuário adicionado! 🚀");
        document.getElementById("name").value = "";
        document.getElementById("email").value = "";
        document.getElementById("senha").value = "";
        carregarUsuarios();
    } catch (err) { showToast(err.message, "erro"); }
};

window.prepararExclusao = (id) => {
    idUsuarioParaExcluir = id;
    document.getElementById('confirmModal').style.display = 'flex';
};

window.fecharConfirm = () => {
    document.getElementById('confirmModal').style.display = 'none';
};

// ==================== INICIALIZAÇÃO ====================
document.addEventListener("DOMContentLoaded", () => {
    carregarUsuarios();
    renderizarCardPlano(user); // Tenta carregar com o que já tem no login

    // Botão do Modal
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            try {
                await fetch(`/api/users/${idUsuarioParaExcluir}`, { method: "DELETE" });
                showToast("Removido com sucesso!");
                fecharConfirm();
                carregarUsuarios();
            } catch (err) { showToast("Erro ao excluir", "erro"); }
        };
    }
});

window.logout = () => { localStorage.clear(); window.location.href = "login.html"; };
window.toggleMenu = () => document.getElementById("menuDropdown").classList.toggle("show");
