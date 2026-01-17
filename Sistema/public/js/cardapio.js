let menu = [];
const cart = [];

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
  if (menu.length === 0) {
    el.innerHTML = '<p style="text-align:center;margin-top:20px;">🍽️ Nenhum item disponível no cardápio.</p>';
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
        <div class="price">R$ ${Number(i.price).toFixed(2)}</div>
        ${i.description ? `<p class="desc">${i.description}</p>` : ""}
      `;

      div.addEventListener('click', () => abrirModalProduto(i));
      itemsDiv.appendChild(div);
    });

    catDiv.appendChild(itemsDiv);
    el.appendChild(catDiv);
  }
}

/* ======== MODAL DO PRODUTO ======== */
function abrirModalProduto(produto) {
  const modal = document.getElementById('productModal');
  const nameEl = document.getElementById('productName');
  const descEl = document.getElementById('productDescription');
  const priceEl = document.getElementById('productPrice');
  const addBtn = document.getElementById('addToCartBtn');

  nameEl.textContent = produto.name;
  descEl.textContent = produto.description || "Sem descrição disponível.";
  priceEl.textContent = "R$ " + produto.price.toFixed(2);

  addBtn.onclick = () => {
    addToCart(produto.id);
    fecharModalProduto();
  };

  modal.style.display = "flex";
}

function fecharModalProduto() {
  document.getElementById('productModal').style.display = "none";
}

/* ======== ADICIONAR AO CARRINHO ======== */
function addToCart(id) {
  const item = menu.find(x => x.id === id);
  if (!item) return;

  const found = cart.find(c => c.id === id);
  if (found) found.qty++;
  else cart.push({ ...item, qty: 1 });
  updateCartCount();
}

/* ======== ATUALIZAR CONTADOR DO CARRINHO ======== */
function updateCartCount() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const countEl = document.getElementById('cartCount');
  if (countEl) countEl.innerText = count;
}

/* ======== RENDERIZAR CARRINHO ======== */
function renderCart() {
  const el = document.getElementById('cartList');
  if (!el) return;

  if (cart.length === 0) {
    el.innerHTML = '<p>Carrinho vazio</p>';
    return;
  }

  el.innerHTML = cart.map(i => `
    <div style="padding:6px 0;border-bottom:1px solid #eee">
      <b>${i.name}</b>
      <span style="float:right">R$ ${(i.price * i.qty).toFixed(2)}</span><br>
      <small>Qtd: ${i.qty}</small>
    </div>
  `).join('');
}

/* ======== AO CARREGAR A PÁGINA ======== */
document.addEventListener('DOMContentLoaded', async () => {
  const user = verificarAuth();
  if (!user) return;

  const savedTable = localStorage.getItem("mesa_nome");
  if (savedTable) document.getElementById("tableName").value = savedTable;

  try {
    const res = await fetch(`/api/products?company_id=${user.company_id}`);
    const text = await res.text();

    if (text.trim().startsWith('<')) {
      throw new Error("Servidor retornou HTML — verifique se a rota /api/products existe.");
    }

    const produtos = JSON.parse(text);

if (!Array.isArray(produtos)) {
  throw new Error("Formato inválido do cardápio.");
}

menu = produtos;
renderItems();

  } catch (err) {
    console.error('Erro ao carregar cardápio:', err);
    document.getElementById('categories').innerHTML =
      `<p style="color:red;">${err.message}</p>`;
  }

  // Eventos do carrinho
  document.getElementById('openCart')?.addEventListener('click', () => {
    renderCart();
    document.getElementById('cartModal').style.display = 'flex';
  });

  document.getElementById('closeCart')?.addEventListener('click', () => {
    document.getElementById('cartModal').style.display = 'none';
  });

  document.getElementById('sendOrder')?.addEventListener('click', async () => {
    if (cart.length === 0) {
      alert('Carrinho vazio');
      return;
    }

    const table_name = document.getElementById('tableName').value || '';
    const notes = document.getElementById('notes').value || '';

    if (!table_name.trim()) {
      alert("Por favor, informe a mesa ou nome do cliente.");
      return;
    }

    localStorage.setItem("mesa_nome", table_name.trim());

    const items = cart.map(i => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      price: i.price
    }));

    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: user.company_id,
          items,
          total,
          table_name,
          notes
        })
      });

      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error("Servidor retornou HTML — verifique se a rota /api/orders existe.");
      }

      const j = JSON.parse(text);

      if (j.ok) {
        cart.length = 0;
        updateCartCount();
        document.getElementById('cartModal').style.display = 'none';
        showNotification("✅ Pedido enviado com sucesso!", "success");
        window.location.href = 'meus-pedidos.html';
      } else {
        throw new Error(j.error || 'Erro ao enviar pedido.');
      }

    } catch (e) {
      console.error('Erro ao enviar pedido:', e);
      alert('Erro ao enviar: ' + e.message);
    }
  });
});

/* ======== NOTIFICAÇÕES ======== */
function showNotification(message, type = "success") {
  const notif = document.getElementById("notification");
  if (!notif) return;
  notif.innerText = message;
  notif.className = "notification " + type;
  setTimeout(() => notif.classList.add("show"), 10);
  setTimeout(() => notif.classList.remove("show"), 3000);
}
