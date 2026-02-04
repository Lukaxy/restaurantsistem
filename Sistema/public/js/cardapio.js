let menu = [];
const cart = [];

// ==================== FUNÇÕES DE INTERFACE (TOAST & ANIMAÇÃO) ====================

function showToast(mensagem, tipo = 'sucesso') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = "position:fixed; top:20px; right:20px; z-index:20001;";
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

// Animação central de Pedido Concluído
window.animarPedidoConcluido = function() {
    let overlay = document.getElementById('order-success-overlay');
    if (!overlay) {
        // Cria o overlay se não existir no HTML
        overlay = document.createElement('div');
        overlay.id = 'order-success-overlay';
        overlay.innerHTML = `
            <div class="success-circle" style="width:120px; height:120px; background:#51cf66; border-radius:50%; display:flex; justify-content:center; align-items:center; font-size:4rem; color:white; box-shadow:0 0 50px rgba(81,207,102,0.4); animation: popIn 0.6s cubic-bezier(0.17, 0.89, 0.32, 1.49) forwards;">✓</div>
            <div class="success-text" style="margin-top:20px; color:white; font-size:1.5rem; font-weight:bold; animation: fadeInUp 0.5s ease 0.3s both;">Pedido Enviado! 🚀</div>
        `;
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:none; flex-direction:column; justify-content:center; align-items:center; z-index:30000; backdrop-filter:blur(8px);";
        document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';

    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.transition = '0.5s';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.opacity = '1';
        }, 500);
    }, 3000);
}

// Injeção de Keyframes para as animações
const styleTag = document.createElement('style');
styleTag.innerHTML = `
    @keyframes popIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes fadeInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-20px); } }
`;
document.head.appendChild(styleTag);

/* ======== AGRUPAR POR CATEGORIA ======== */
function groupByCategory(items) {
  const grouped = {};
  items.forEach(i => {
    const cat = i.category && i.category.trim() ? i.category : "Outros";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(i);
  });
  return grouped;
}

/* ======== RENDERIZAR ITENS ======== */
function renderItems() {
  const el = document.getElementById('categories');
  if (!el) return;
  el.innerHTML = '';

  if (!menu.length) {
    el.innerHTML = '<p style="text-align:center;margin-top:20px;"> Nenhum item disponível 🍽️</p>';
    return;
  }

  const grouped = groupByCategory(menu);
  for (const category in grouped) {
    const catDiv = document.createElement('div');
    catDiv.className = 'category-block';
    catDiv.innerHTML = `<h3>${category}</h3>`;
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'grid';

    grouped[category].forEach(i => {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `
        <h4>${i.name}</h4>
        <div class="price">R$ ${Number(i.price).toFixed(2).replace(".", ",")}</div>
      `;
      div.onclick = () => abrirModalProduto(i);
      itemsDiv.appendChild(div);
    });
    catDiv.appendChild(itemsDiv);
    el.appendChild(catDiv);
  }
}

/* ======== MODAL DO PRODUTO ======== */
window.abrirModalProduto = function(produto) {
  const modal = document.getElementById('productModal');
  if (!modal) return;

  document.getElementById('productName').innerText = produto.name;
  document.getElementById('productDescription').innerText = produto.description || "Sem descrição disponível.";
  document.getElementById('productPrice').innerText = "R$ " + Number(produto.price).toFixed(2).replace(".", ",");

  const btnAdd = document.getElementById('addToCartBtn');
  if (btnAdd) {
      btnAdd.onclick = () => {
        addToCart(produto.id);
        fecharModalProduto();
        showToast(`${produto.name} adicionado!`);
      };
  }
  modal.style.display = 'flex';
}

window.fecharModalProduto = function() {
  const modal = document.getElementById('productModal');
  if (modal) modal.style.display = 'none';
}

/* ======== CARRINHO ======== */
function addToCart(id) {
  const item = menu.find(i => i.id === id);
  if (!item) return;
  const found = cart.find(c => c.id === id);
  if (found) found.qty++;
  else cart.push({ ...item, qty: 1 });
  updateCartCount();
}

function updateCartCount() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const el = document.getElementById('cartCount');
  if (el) el.innerText = count;
}

function renderCart() {
  const el = document.getElementById('cartList');
  if (!el) return;
  if (!cart.length) {
    el.innerHTML = '<p style="text-align:center; color:gray;">Carrinho vazio</p>';
    return;
  }
  el.innerHTML = cart.map(i => `
    <div style="padding:10px 0; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <b>${i.name}</b> <br>
        <small>Qtd: ${i.qty}</small>
      </div>
      <span style="font-weight:bold;">R$ ${(i.price * i.qty).toFixed(2).replace(".", ",")}</span>
    </div>
  `).join('');
}

/* ======== INICIALIZAÇÃO ======== */
document.addEventListener('DOMContentLoaded', async () => {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('user'));
  } catch (e) { user = null; }

  if (!user || !user.company_id) {
    const el = document.getElementById('categories');
    if (el) el.innerHTML = '<p style="color:red;text-align:center;">Empresa não identificada.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/products?company_id=${user.company_id}`);
    const data = await res.json();
    menu = Array.isArray(data) ? data : [];
    renderItems();
  } catch (err) {
    showToast("Erro ao carregar cardápio.", "erro");
  }

  // Eventos de Modal
  document.getElementById('openCart')?.addEventListener('click', () => {
      renderCart();
      document.getElementById('cartModal').style.display = 'flex';
  });

  document.getElementById('closeCart')?.addEventListener('click', () => {
      document.getElementById('cartModal').style.display = 'none';
  });

  document.getElementById('productModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'productModal') fecharModalProduto();
  });

  // ==================== ENVIAR PEDIDO COM ANIMAÇÃO ====================
  const btnSend = document.getElementById('sendOrder');
  if (btnSend) {
    btnSend.onclick = async () => {
      if (cart.length === 0) {
        showToast("Seu carrinho está vazio!", "erro");
        return;
      }

      const tableName = document.getElementById('tableName').value;
      if (!tableName) {
        showToast("Informe a Mesa ou Nome.", "erro");
        return;
      }

      const notes = document.getElementById('notes').value;
      const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
      const pedido = {
        company_id: user.company_id,
        items: cart,
        total: total,
        table_name: tableName,
        notes: notes
      };

      const btnOriginalText = btnSend.innerText;
      btnSend.innerText = "Enviando...";
      btnSend.disabled = true;

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pedido)
        });

        const data = await res.json();

        if (data.ok) {
          // FECHA O CARRINHO E DISPARA A ANIMAÇÃO CENTRAL
          document.getElementById('cartModal').style.display = 'none';
          animarPedidoConcluido(); 
          
          // Limpa tudo
          cart.length = 0;
          updateCartCount();
          document.getElementById('tableName').value = "";
          document.getElementById('notes').value = "";

        } else {
          showToast(data.error || "Erro ao enviar", "erro");
        }

      } catch (erro) {
          showToast("Erro de conexão com a cozinha.", "erro");
      } finally {
        btnSend.innerText = btnOriginalText;
        btnSend.disabled = false;
      }
    };
  }
});
