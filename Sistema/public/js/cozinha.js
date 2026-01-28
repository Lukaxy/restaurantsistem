// ======================== VARIÁVEIS GLOBAIS ========================
let pedidos = [];
const TEMPO_OCULTAR_PRONTO = 10 * 60 * 1000; // 10 minutos
let user = null;

// ======================== FUNÇÕES ========================

// Renderiza os pedidos na tela (COM O NOVO VISUAL)
function renderizarPedidos() {
  const lista = document.getElementById("orders");
  if (!lista) return;

  if (pedidos.length === 0) {
    // Mensagem centralizada e bonita quando não há pedidos
    lista.innerHTML = `
        <div style="text-align:center; margin-top:50px; color: var(--text-secondary);">
            <div style="font-size: 4rem; margin-bottom: 20px;">👩‍🍳🍽️</div>
            <h2>Sem pedidos pendentes</h2>
            <p>Aguardando novas comandas...</p>
        </div>`;
    return;
  }

  lista.innerHTML = pedidos
    .map((p) => {
      // Garante que items é um array
      const itensArray = Array.isArray(p.items) ? p.items : [];
      const horaFormatada = new Date(p.created_at).toLocaleTimeString("pt-BR", {hour: "2-digit", minute: "2-digit"});

      return `
      <div class="order ${p.status}" id="order-${p.id}">
        
        <div class="order-header">
           <div class="order-title">🧾 Pedido #${p.id}</div>
           <div class="order-meta">
             <span class="table-info">${p.table_name || "Balcão"}</span>
             <small>🕒 ${horaFormatada}</small>
           </div>
        </div>
        
        <div class="order-items">
          ${itensArray
            .map((i) => `<div><span class="item-qty">${i.qty}x</span> ${i.name}</div>`)
            .join("")}
        </div>

        ${p.notes ? `
            <div class="order-obs">
                <span>⚠️</span> 
                <strong>Obs:</strong>&nbsp;${p.notes}
            </div>
        ` : ""}

        <div class="controls">
          <button class="btn btn-cancel" onclick="atualizarStatus(${p.id}, 'cancelado')">
            Cancelar
          </button>
          
          ${p.status === "novo" ? `
            <button class="btn btn-preparar" onclick="atualizarStatus(${p.id}, 'preparando')">
              👨‍🍳 Preparar
            </button>
          ` : ""}
          
          ${p.status === "preparando" ? `
            <button class="btn btn-pronto" onclick="atualizarStatus(${p.id}, 'pronto')">
              ✅ Pronto!
            </button>
          ` : ""}
        </div>

      </div>
    `;
    })
    .join("");
}

// Função global para atualizar status
window.atualizarStatus = async function(id, status) {
  try {
    // Feedback visual imediato no botão clicado
    const btn = event.target.closest('button');
    if(btn) {
        btn.innerHTML = "Processando...";
        btn.disabled = true;
        // Opcional: diminuir a opacidade do cartão inteiro pra mostrar que está carregando
        document.getElementById(`order-${id}`).style.opacity = "0.6";
    }

    const res = await fetch(`/api/orders/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao atualizar status.");

    carregarPedidos();
  } catch (err) {
    alert("Erro: " + err.message);
    carregarPedidos();
  }
}

// Oculta pedidos prontos (visual)
function removerPedidosAntigos() {
  const agora = Date.now();
  const novaLista = pedidos.filter((p) => {
    if (p.status !== "pronto") return true;
    if (!p._horaPronto) p._horaPronto = new Date(p.status_updated_at).getTime();
    return agora - p._horaPronto < TEMPO_OCULTAR_PRONTO;
  });
  
  if (novaLista.length !== pedidos.length) {
     pedidos = novaLista;
     renderizarPedidos();
  }
}

// Carrega pedidos do backend
async function carregarPedidos() {
  const lista = document.getElementById("orders");
  try {
    if (!user || !user.company_id) return;

    const res = await fetch(`/api/orders?company_id=${user.company_id}`);
    const data = await res.json();
    
    if (!data.ok) throw new Error(data.error || "Erro ao carregar pedidos.");

    pedidos = data.pedidos.filter((p) => p.status !== "cancelado" && p.status !== "entregue");
    renderizarPedidos();
  } catch (err) {
    console.error("Erro ao carregar pedidos:", err);
    if(lista && pedidos.length === 0) {
        lista.innerHTML = `<p style="color:var(--color-red);text-align:center;">Erro de conexão: ${err.message}</p>`;
    }
  }
}

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", () => {
  try {
    const userJson = localStorage.getItem("user");
    if (!userJson) { window.location.href = "login.html"; return; }
    user = JSON.parse(userJson);
  } catch(e) {
    window.location.href = "login.html";
    return;
  }

  carregarPedidos();
  setInterval(carregarPedidos, 5000);
  setInterval(removerPedidosAntigos, 60000);
});
