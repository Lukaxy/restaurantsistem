function showToast(mensagem, tipo = 'sucesso') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        // Adicionando o estilo básico via JS para garantir que funcione
        container.style.cssText = "position:fixed; top:20px; right:20px; z-index:9999;";
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    // Estilização baseada no seu sistema Dark
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

    // Remove automaticamente
    setTimeout(() => {
        toast.style.animation = "fadeOut 0.5s ease forwards";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Estilos de animação injetados no head
const style = document.createElement('style');
style.innerHTML = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-20px); } }
`;
document.head.appendChild(style);
// ==================== VARIÁVEIS GLOBAIS ====================
let user = null;
const list = document.getElementById('productList');

// ==================== CARREGAR PRODUTOS ====================
async function carregarProdutos() {
    if (!user || !user.company_id) {
        if (list) list.innerHTML = '<p style="color:var(--color-red);">Erro: Empresa não identificada.</p>';
        return;
    }

    try {
        const res = await fetch(`/api/products?company_id=${user.company_id}`);
        const produtos = await res.json();

        if (!Array.isArray(produtos) || produtos.length === 0) {
            list.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">Nenhum produto cadastrado.</p>';
            return;
        }

        // Renderiza cada produto com o novo visual de lista
        list.innerHTML = produtos.map(p => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid var(--border-color); gap: 10px;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary); font-size: 1.1rem;">${p.name}</strong>
                        <span style="background: var(--bg-main); color: var(--color-amber); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">
                            ${p.category || 'Geral'}
                        </span>
                    </div>
                    <div style="color: var(--color-green); font-weight: bold; margin-top: 4px;">
                        R$ ${Number(p.price).toFixed(2).replace('.', ',')}
                    </div>
                    ${p.description ? `<div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">${p.description}</div>` : ''}
                </div>
                <button class="btn cancel" onclick="excluirProduto(${p.id})" style="padding: 8px 12px; font-size: 1rem;">
                    🗑️
                </button>
            </div>
        `).join('');

    } catch (err) {
        console.error('Erro ao carregar produtos:', err);
        if (list) list.innerHTML = `<p style="color:var(--color-red);">Erro ao conectar com o servidor.</p>`;
    }
}

// ==================== ADICIONAR PRODUTO ====================
window.addProduct = async function() {
    const name = document.getElementById('newName').value.trim();
    const price = parseFloat(document.getElementById('newPrice').value.trim());
    const category = document.getElementById('newCategory').value.trim();
    const description = document.getElementById('newDescription').value.trim();

    if (!name || isNaN(price)) {
        alert('Por favor, preencha o nome e o preço corretamente.');
        return;
    }

    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Salvando...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                company_id: user.company_id,
                name,
                price,
                category,
                description
            })
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Erro ao adicionar produto.');

        // Limpa os campos
        document.getElementById('newName').value = '';
        document.getElementById('newPrice').value = '';
        document.getElementById('newCategory').value = '';
        document.getElementById('newDescription').value = '';

        await carregarProdutos();
        showToast('Produto cadastrado com sucesso! 🚀');

    } catch (err) {
        console.error(err);
        alert('❌ Erro: ' + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ==================== EXCLUIR PRODUTO ====================
window.excluirProduto = async function(id) {
    if (!confirm('Deseja realmente excluir este produto?')) return;

    try {
        const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (!data.ok) throw new Error(data.error || 'Erro ao excluir produto.');

        await carregarProdutos();
    } catch (err) {
        alert('❌ Erro ao excluir: ' + err.message);
    }
}

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', () => {
    // Busca usuário e valida permissão
    try {
        const userData = localStorage.getItem("user");
        if (!userData) {
            window.location.replace("login.html");
            return;
        }
        user = JSON.parse(userData);
        
        if (user.role !== "admin") {
            alert("Acesso restrito a administradores.");
            window.location.replace("index.html");
            return;
        }
    } catch (e) {
        window.location.replace("index.html");
        return;
    }

    carregarProdutos();
});
