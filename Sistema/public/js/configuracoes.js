// ==================== UTILITÁRIOS: NOTIFICAÇÕES (TOAST) ====================
// Verifica se a função já existe no HTML para não duplicar, se não, cria.
if (typeof window.showToast !== 'function') {
    window.showToast = function(mensagem, tipo = 'sucesso') {
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
}

// ==================== VARIÁVEIS GLOBAIS ====================
let user = null;
let idParaExcluir = null; 
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
            if (list) list.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">Nenhum produto cadastrado.</p>';
            return;
        }

        if (list) {
            list.innerHTML = produtos.map(p => {
                // Define a etiqueta (Cozinha ou Bar)
                // Se não tiver destino definido, assume Cozinha
                let badge = '';
                if (p.destination === 'bar') {
                    badge = '<span style="background: #d63384; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 5px;">🍸 BAR</span>';
                } else {
                    badge = '<span style="background: #e8590c; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 5px;">🍳 COZINHA</span>';
                }

                return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid var(--border-color); gap: 10px; opacity: ${p.visible === 0 ? '0.5' : '1'};">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <strong style="color: var(--text-primary); font-size: 1.1rem;">${p.name}</strong>
                            ${badge}
                            <span style="background: var(--bg-main); color: var(--color-amber); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">
                                ${p.category || 'Geral'}
                            </span>
                        </div>
                        <div style="color: var(--color-green); font-weight: bold; margin-top: 4px;">
                            R$ ${Number(p.price).toFixed(2).replace('.', ',')}
                        </div>
                        ${p.description ? `<div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">${p.description}</div>` : ''}
                    </div>

                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="text-align: center;">
                            <div style="font-size: 0.65rem; color: var(--text-secondary); margin-bottom: 4px;">Visível</div>
                            <label class="switch">
                                <input type="checkbox" ${p.visible !== 0 ? 'checked' : ''} onchange="alterarVisibilidade(${p.id}, this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>

                        <button class="btn cancel" onclick="prepararExclusao(${p.id})" style="padding: 8px 12px; font-size: 1rem; background: transparent; cursor: pointer;">
                            🗑️
                        </button>
                    </div>
                </div>
            `}).join('');
        }

    } catch (err) {
        console.error('Erro ao carregar produtos:', err);
        showToast('Erro ao conectar com o servidor.', 'erro');
    }
}

// ==================== ALTERAR VISIBILIDADE ====================
window.alterarVisibilidade = async function(id, checked) {
    try {
        const response = await fetch(`/api/products/${id}/visible`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible: checked ? 1 : 0 })
        });

        if (response.ok) {
            showToast(checked ? 'Visível no cardápio! 👁️' : 'Oculto do cardápio! 🙈');
            // Opcional: recarregar a lista para aplicar a opacidade
            carregarProdutos();
        } else {
            throw new Error();
        }
    } catch (err) {
        showToast('Erro ao atualizar visibilidade.', 'erro');
        carregarProdutos(); 
    }
}

// ==================== ADICIONAR PRODUTO (CORRIGIDO) ====================
window.addProduct = async function() {
    // 1. PEGA OS VALORES
    const name = document.getElementById('newName').value.trim();
    const price = parseFloat(document.getElementById('newPrice').value.trim());
    const category = document.getElementById('newCategory').value.trim();
    const description = document.getElementById('newDescription').value.trim();
    
    // Tenta pegar o destino (Bar ou Cozinha)
    const destInput = document.getElementById('newDestination');
    const destination = destInput ? destInput.value : 'cozinha';

    // 2. VALIDAÇÃO
    if (!name || isNaN(price)) {
        showToast('Preencha nome e preço corretamente.', 'erro');
        return;
    }

    // 3. BLOQUEIA BOTÃO
    const btn = event.target || document.querySelector('button[onclick="addProduct()"]');
    const originalText = btn ? btn.innerText : "Salvar";
    if(btn) {
        btn.innerText = "Salvando...";
        btn.disabled = true;
    }

    try {
        // 4. ENVIA
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                company_id: user.company_id,
                name,
                price,
                category,
                description,
                destination // Envia o destino
            })
        });

        const data = await res.json();

        if (res.ok) {
            showToast("Produto salvo com sucesso!");
            
            // 5. LIMPA CAMPOS
            document.getElementById('newName').value = "";
            document.getElementById('newPrice').value = "";
            document.getElementById('newCategory').value = "";
            document.getElementById('newDescription').value = "";
            if(destInput) destInput.value = "cozinha";

            // 6. ATUALIZA A LISTA
            carregarProdutos();
        } else {
            showToast("Erro ao salvar: " + (data.error || "Desconhecido"), "erro");
        }

    } catch (err) {
        console.error(err);
        showToast("Erro de conexão.", "erro");
    } finally {
        // 7. LIBERA BOTÃO
        if(btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
};

// ==================== MODAL DE EXCLUSÃO ====================
window.prepararExclusao = function(id) {
    idParaExcluir = id;
    const modal = document.getElementById('confirmModal');
    if(modal) modal.style.display = 'flex';
}

window.fecharConfirm = function() {
    const modal = document.getElementById('confirmModal');
    if(modal) modal.style.display = 'none';
    idParaExcluir = null;
}

// Configura o botão de confirmar exclusão ao carregar
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            if (!idParaExcluir) return;
            try {
                const res = await fetch(`/api/products/${idParaExcluir}`, { method: 'DELETE' });
                const data = await res.json();
                
                if (!data.ok) throw new Error(data.error || 'Erro ao excluir.');
                
                fecharConfirm();
                await carregarProdutos();
                showToast('Produto removido! 🗑️');
            } catch (err) {
                showToast('Erro ao excluir: ' + err.message, 'erro');
            }
        };
    }
});

// ==================== INICIALIZAÇÃO GERAL ====================
document.addEventListener('DOMContentLoaded', () => {
    try {
        const userData = localStorage.getItem("user");
        if (!userData) {
            // Se não estiver logado na página de config, manda pro login
            // (A menos que seja a primeira renderização)
            if(!window.location.href.includes('login.html')) {
                window.location.replace("index.html");
            }
            return;
        }
        
        user = JSON.parse(userData);
        
        if (user.role !== "admin") {
            showToast("Acesso restrito a administradores.", "erro");
            setTimeout(() => window.location.replace("index.html"), 2000);
            return;
        }

        // Se passou em tudo, carrega a lista
        carregarProdutos();

    } catch (e) {
        console.error(e);
    }
});
