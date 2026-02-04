// ==================== UTILITÁRIOS: NOTIFICAÇÕES (TOAST) ====================
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
        background: #1a1a1a; 
        color: white; 
        padding: 15px 25px; 
        border-radius: 10px; 
        border-left: 4px solid ${tipo === 'sucesso' ? '#51cf66' : '#ff6b6b'};
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: 'Poppins', sans-serif;
        animation: slideIn 0.5s ease forwards;
    `;

    toast.innerHTML = `<span>${tipo === 'sucesso' ? '✅' : '❌'}</span> <span>${mensagem}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "fadeOut 0.5s ease forwards";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Injeção de animações CSS
const style = document.createElement('style');
style.innerHTML = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-20px); } }
`;
document.head.appendChild(style);

// ==================== VARIÁVEIS GLOBAIS E SEGURANÇA ====================
const user = JSON.parse(localStorage.getItem("user") || "null");
const list = document.getElementById("users-list");
let idUsuarioParaExcluir = null;

if (!user || user.role !== "admin") {
    window.location.href = "login.html";
}

// ======== LISTAR USUÁRIOS ========
async function carregarUsuarios() {
    if (list) list.innerHTML = "<p style='color:var(--text-secondary); text-align:center;'>Carregando funcionários...</p>";

    try {
        const res = await fetch("/api/users?company_id=" + user.company_id);
        const data = await res.json();

        if (!data.ok) throw new Error(data.error || "Erro ao carregar lista");

        if (!data.users || data.users.length === 0) {
            list.innerHTML = "<p style='text-align:center; color:var(--text-secondary);'>Nenhum funcionário cadastrado.</p>";
            return;
        }

        list.innerHTML = data.users.map(u => `
            <div class="user" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid var(--border-color); gap: 10px;">
                <div style="flex: 1;">
                    <strong style="color: var(--text-primary); font-size: 1.1rem;">${u.name}</strong>
                    <div style="color: var(--text-secondary); font-size: 0.85rem;">${u.email} — <span style="color:var(--color-blue);">${u.role}</span></div>
                </div>
                <div>
                    ${u.role !== "admin" ? `<button class="btn cancel" onclick="prepararExclusaoUsuario(${u.id})" style="padding: 8px 12px;">🗑️</button>` : ""}
                </div>
            </div>
        `).join("");

    } catch (err) {
        showToast(err.message, 'erro');
    }
}

// ======== ADICIONAR USUÁRIO ========
window.addUser = async function() {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const whatsapp = document.getElementById("whatsapp").value.trim();
    const senha = document.getElementById("senha").value.trim();
    const role = document.getElementById("role").value;

    if (!name || !email || !whatsapp || !senha) {
        showToast("Preencha todos os campos corretamente.", "erro");
        return;
    }

    const btn = event.target;
    btn.innerText = "Adicionando...";
    btn.disabled = true;

    try {
        const res = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, whatsapp, senha, role, company_id: user.company_id })
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Erro ao salvar");

        showToast("Funcionário cadastrado com sucesso! 🚀");
        
        // Limpa formulário
        document.getElementById("name").value = "";
        document.getElementById("whatsapp").value = "";
        document.getElementById("email").value = "";
        document.getElementById("senha").value = "";

        carregarUsuarios();
    } catch (err) {
        showToast(err.message, "erro");
    } finally {
        btn.innerText = "Adicionar Funcionário";
        btn.disabled = false;
    }
}

// ======== LOGICA DO MODAL DE EXCLUSÃO ========
window.prepararExclusaoUsuario = function(id) {
    idUsuarioParaExcluir = id;
    document.getElementById('confirmModal').style.display = 'flex';
}

window.fecharConfirm = function() {
    document.getElementById('confirmModal').style.display = 'none';
    idUsuarioParaExcluir = null;
}

// Configura o botão do Modal no carregamento da página
document.addEventListener("DOMContentLoaded", () => {
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            if (!idUsuarioParaExcluir) return;
            try {
                const res = await fetch(`/api/users/${idUsuarioParaExcluir}`, { method: "DELETE" });
                const data = await res.json();

                if (!data.ok) throw new Error(data.error || "Erro ao excluir");

                fecharConfirm();
                carregarUsuarios();
                showToast("Funcionário removido com sucesso! 🗑️");
            } catch (err) {
                showToast(err.message, "erro");
            }
        };
    }
    carregarUsuarios();
});

// ======== LOGOUT ========
window.logout = function() {
    localStorage.clear();
    window.location.href = "login.html";
}
