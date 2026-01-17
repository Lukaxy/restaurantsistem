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

  if (!menu.length) {
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
        <div class="price">R$ ${Number(i.price).toFixed(2).replace(".", ",")}</div>
        ${i.description ? `<p class="desc">${i.description}</p>` : ""}
      `;
      div.onclick = () => abrirModalProduto(i);
      itemsDiv.appendChild(div);
    });

    catDiv.appendChild(itemsDiv);
    el.appendChild(catDiv);
  }
}

/* ======== MODAL DO PRODUTO ======== */
function abrirModalProduto(produto) {
  document.getElementById('productName').innerText = produto.name;
  document.getElementById('productDescription').innerText =
    produto.description || "Sem descrição disponível.";
  document.getElementById('productPrice').innerText =
    "R$ " + Number(produto.price).toFixed(2).replace(".", ",");

  document.getElementById('addToCartBtn').onclick = () => {
    addToCart(produto.id);
    fecharModalProduto();
  };

  document.getElementById('productModal').style.display = 'flex';
}

function fecharModalProduto() {
  document.getElementById('productModal').style.display = 'none';
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

/* ======== AO CARREGAR ======== */
document.addEventListener('DOMContentLoaded', async () => {
  const user = getUser(); // ✅ CORRETO

  if (!user || !user.company_id) {
    document.getElementById('categories').innerHTML =
      '<p style="color:red;text-align:center;">Empresa não identificada.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/products?company_id=${user.company_id}`);
    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("Resposta inválida do servidor");
    }

    menu = data;
    renderItems();

  } catch (err) {
    console.error(err);
    document.getElementById('categories').innerHTML =
      `<p style="color:red;">Erro ao carregar cardápio.</p>`;
  }

  document.getElementById('openCart')?.onclick = () => {
    renderCart();
    document.getElementById('cartModal').style.display = 'flex';
  };

  document.getElementById('closeCart')?.onclick = () => {
    document.getElementById('cartModal').style.display = 'none';
  };
});
