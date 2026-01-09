// ======================== VARIÁVEIS ========================
let pedidos = [];
const lista = document.getElementById("orders");
const TEMPO_OCULTAR_PRONTO = 10 * 60 * 1000; // 10 minutos

const user = verificarAuth(); // chama a função do auth.js
if (!user) return; // se não estiver logado, ele já redireciona automaticamente
const company_id = user.company_id;

// ======================== FUNÇÕES ========================

// Renderiza os pedidos na tela
function renderizarPedidos() {
  if (!lista) return;
  if (pedidos.length === 0) {
    lista.innerHTML = "<p style='text-align:center;margin-top:20px;'>Nenhum pedido no momento 🍽️</p>";
    return;
  }

  lista.innerHTML = pedidos
    .map(
      (p) => `
    <div class="order ${p.status}">
      <b>🧾 Pedido #${p.id}</b> — <span>${p.table_name || "Sem mesa"}</span><br>
      <small>${new Date(p.created_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}</small><br>
      <pre>${JSON.parse(p.items)
        .map((i) => `${i.qty}x ${i.name}`)
        .join("\n")}</pre>
      ${p.notes ? `<div><b>Obs:</b> ${p.notes}</div>` : ""}
      <div class="controls">
        ${
          p.status === "novo"
            ? `<button class="btn" onclick="atualizarStatus(${p.id}, 'preparando')">👨‍🍳 Preparar</button>`
            : ""
        }
        ${
          p.status === "preparando"
            ? `<button class="btn" onclick="atualizarStatus(${p.id}, 'pronto')">✅ Pronto</button>`
            : ""
        }
        <button class="btn cancel" onclick="atualizarStatus(${p.id}, 'cancelado')">❌ Cancelar</button>
      </div>
    </div>
  `
    )
    .join("");
}

// Atualiza status no servidor
async function atualizarStatus(id, status) {
  try {
    const res = await fetch(`/api/orders/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao atualizar status.");

    if (status === "pronto") {
      const pedido = pedidos.find((p) => p.id === id);
      if (pedido) pedido._horaPronto = Date.now();
    }

    carregarPedidos();
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

// Oculta pedidos prontos após 10 minutos
function removerPedidosAntigos() {
  const agora = Date.now();
  pedidos = pedidos.filter((p) => {
    if (p.status !== "pronto") return true;
    if (!p._horaPronto) p._horaPronto = Date.now();
    return agora - p._horaPronto < TEMPO_OCULTAR_PRONTO;
  });
  renderizarPedidos();
}

// Carrega pedidos do backend
async function carregarPedidos() {
  try {
    if (!company_id) {
      lista.innerHTML =
        "<p style='color:red;'>Erro: empresa não identificada (company_id ausente).</p>";
      return;
    }

    const res = await fetch(`/api/orders?company_id=${company_id}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao carregar pedidos.");

    pedidos = data.pedidos.filter((p) => p.status !== "cancelado");
    renderizarPedidos();
  } catch (err) {
    console.error("Erro ao carregar pedidos:", err);
    lista.innerHTML = `<p style="color:red;">${err.message}</p>`;
  }
}

// ======================== LOOP ========================
document.addEventListener("DOMContentLoaded", () => {
  carregarPedidos();
  setInterval(carregarPedidos, 5000); // atualiza a cada 5s
  setInterval(removerPedidosAntigos, 60000); // limpa a cada 1 min
});

