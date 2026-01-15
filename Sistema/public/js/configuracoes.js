// ==================== SEGURANÇA ====================
const user = exigirAdmin(); // 🔒 só admin entra

// ==================== VARIÁVEIS ====================
const list = document.getElementById('productList');
const msgEl = document.createElement('p');
msgEl.style.marginTop = '8px';
msgEl.style.fontWeight = '500';

// ==================== CARREGAR PRODUTOS ====================
async function carregarProdutos() {
  if (!user || !user.company_id) {
    list.innerHTML = '<p style="color:red;">ID da empresa não encontrado.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/products?company_id=${user.company_id}`);
    const text = await res.text();

    if (text.trim().startsWith('<')) {
      throw new Error("Servidor retornou HTML — verifique se a rota /api/products existe.");
    }

    const produtos = JSON.parse(text);

    if (!Array.isArray(produtos) || produtos.length === 0) {
      list.innerHTML = '<p style="color:#bbb;">Nenhum produto cadastrado.</p>';
      return;
    }

    list.innerHTML = produtos.map(p => `
      <div class="produto-item">
        <div>
          <b>${p.name}</b> — R$ ${Number(p.price).toFixed(2).replace('.', ',')}
          <small style="color:#888;">(${p.category || 'Sem categoria'})</small><br>
          <span style="color:#aaa;font-size:0.85em;">${p.description || 'Sem descrição'}</span>
        </div>
        <button class="btn-del" onclick="excluirProduto(${p.id})">🗑️</button>
      </div>
    `).join('');

  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    list.innerHTML = `<p style="color:red;">${err.message}</p>`;
  }
}

// ==================== ADICIONAR PRODUTO ====================
async function addProduct() {
  const name = document.getElementById('newName').value.trim();
  const price = parseFloat(document.getElementById('newPrice').value.trim());
  const category = document.getElementById('newCategory').value.trim();
  const description = document.getElementById('newDescription').value.trim();

  if (!name || isNaN(price)) {
    alert('Preencha o nome e o preço corretamente.');
    return;
  }

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

    const text = await res.text();

    if (text.trim().startsWith('<')) {
      throw new Error("Servidor retornou HTML — verifique se a rota /api/products existe.");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'Erro ao adicionar produto.');

    document.getElementById('newName').value = '';
    document.getElementById('newPrice').value = '';
    document.getElementById('newCategory').value = '';
    document.getElementById('newDescription').value = '';

    await carregarProdutos();
    showMensagem('✅ Produto adicionado com sucesso!', 'green');

  } catch (err) {
    console.error('Erro ao adicionar produto:', err);
    showMensagem('❌ ' + err.message, 'red');
  }
}

// ==================== EXCLUIR PRODUTO ====================
async function excluirProduto(id) {
  if (!confirm('Deseja realmente excluir este produto?')) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    const text = await res.text();

    if (text.trim().startsWith('<')) {
      throw new Error("Servidor retornou HTML — verifique se a rota /api/products/:id existe.");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'Erro ao excluir produto.');

    await carregarProdutos();
    showMensagem('✅ Produto removido.', 'green');

  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    showMensagem('❌ ' + err.message, 'red');
  }
}

// ==================== MENSAGEM DE STATUS ====================
function showMensagem(msg, cor = 'black') {
  msgEl.textContent = msg;
  msgEl.style.color = cor;
  if (!msgEl.parentNode) {
    document.querySelector('main').appendChild(msgEl);
  }
}

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', carregarProdutos);

// ==================== EXPORTAÇÕES GLOBAIS ====================
window.addProduct = addProduct;
window.excluirProduto = excluirProduto;
