// ======================== VARIÁVEIS ========================
let pedidos = [];
const lista = document.getElementById("pedidosList");
const TEMPO_OCULTAR_PRONTO = 5* 60 * 1000; // 30 segundos (teste rápido)

// Recupera dados do usuário logado
const user = verificarAuth(); // chama a função do auth.js
if (!user) return; // se não estiver logado, ele já redireciona automaticamente
const company_id = user.company_id;

// ======================== FUNÇÕES ========================

// Renderiza a lista de pedidos
function renderizar() {
  if (!lista) return;

  if (pedidos.length === 0) {
    lista.innerHTML =
      "<p style='text-align:center;margin-top:20px;'>Nenhum pedido realizado ainda 🧺</p>";
    return;
  }

  lista.innerHTML = pedidos
    .map(
      (p) => `
      <div class="pedido ${p.status}">
        <b>Pedido #${p.id}</b><br>
        <small>${new Date(p.created_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}</small><br>
        <pre>${JSON.parse(p.items)
          .map((i) => `${i.qty}x ${i.name}`)
          .join("\n")}</pre>
        ${p.notes ? `<div><b>Obs:</b> ${p.notes}</div>` : ""}
        <div class="status">Status: <b>${p.status.toUpperCase()}</b></div>
      </div>
    `
    )
    .join("");
}

// ======================== REMOVE PEDIDOS ANTIGOS ========================
function removerPedidosAntigos() {
  const agora = Date.now();
  let mudou = false;

  pedidos = pedidos.filter(p => {
    if (p.status !== "pronto") return true;

    // usa hora salva localmente ou data do servidor
    const horaBase = p._horaPronto || new Date(p.status_updated_at || p.created_at).getTime();
    const deveManter = agora - horaBase < TEMPO_OCULTAR_PRONTO;

    if (!deveManter) mudou = true;
    return deveManter;
  });

  if (mudou) renderizar();
}

async function carregarPedidos() {
  try {
    if (!company_id) {
      lista.innerHTML = "<p style='color:red;'>Erro: empresa não identificada.</p>";
      return;
    }

    const res = await fetch(`/api/orders?company_id=${company_id}`);
    const text = await res.text();
    if (text.trim().startsWith("<"))
      throw new Error("Servidor retornou HTML — verifique rota /api/orders.");

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || "Erro ao carregar pedidos.");

    // mantém hora local de pronto entre atualizações
    const novos = data.pedidos.filter(p => p.status !== "cancelado");
    novos.forEach(p => {
      const antigo = pedidos.find(a => a.id === p.id);
      if (antigo && antigo._horaPronto) p._horaPronto = antigo._horaPronto;

      // se virou pronto agora, grava a hora local
      if (p.status === "pronto" && !p._horaPronto)
        p._horaPronto = new Date(p.status_updated_at || Date.now()).getTime();
    });

    pedidos = novos;
    removerPedidosAntigos(); // limpa logo após atualizar
    renderizar();
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

