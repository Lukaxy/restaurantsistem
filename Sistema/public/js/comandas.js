let comandas = {};
let mesaAtual = '';

document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/comandas-abertas')
    .then(r => r.json())
    .then(data => {
      comandas = data;
      renderComandas();
    });
});

function renderComandas() {
  const container = document.getElementById('comandaList');
  container.innerHTML = '';

  for (const mesa in comandas) {
    const pedidos = comandas[mesa];
    const total = pedidos.reduce((s, p) => s + (p.total || 0), 0);

    const div = document.createElement('div');
    div.className = 'comanda-card';
    div.innerHTML = `<b>${mesa}</b><br><small>${pedidos.length} pedidos - Total: R$ ${total.toFixed(2)}</small>`;
    div.onclick = () => abrirPopup(mesa);
    container.appendChild(div);
  }
}

function abrirPopup(mesa) {
  mesaAtual = mesa;
  const pedidos = comandas[mesa] || [];
  const popup = document.getElementById('comandaPopup');
  const overlay = document.getElementById('overlay');

  const html = pedidos.map(p =>
    `<div style="margin-bottom:10px">
      ${p.items.map(i => `${i.qty}x ${i.name}`).join('<br>')}
      <div style="margin-top:4px;color:#555;font-size:13px">${p.notes || ''}</div>
    </div>`
  ).join('<hr>');

  const total = pedidos.reduce((s, p) => s + (p.total || 0), 0);

  document.getElementById('popupMesa').innerText = `Mesa: ${mesa}`;
  document.getElementById('popupContent').innerHTML = html + `<hr><b>Total: R$ ${total.toFixed(2)}</b>`;

  popup.style.display = 'block';
  overlay.style.display = 'block';
}

function fecharPopup() {
  document.getElementById('comandaPopup').style.display = 'none';
  document.getElementById('overlay').style.display = 'none';
}

function finalizarPagamento() {
  const forma = document.getElementById('formaPagamento').value;
  if (!forma) {
    alert("Selecione a forma de pagamento");
    return;
  }

  fetch(`/api/comandas/${mesaAtual}/pagar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forma_pagamento: forma })
  }).then(r => r.json())
    .then(j => {
      if (j.ok) {
        alert("Comanda finalizada!");
        location.reload();
      } else {
        alert("Erro ao finalizar comanda.");
      }
    });
}
