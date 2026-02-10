// ======================== VARIÁVEIS GLOBAIS ========================
let pedidos = [];
let user = null;

// ======================== FUNÇÕES ========================

function renderizarPedidos() {
  const lista = document.getElementById("orders");
  if (!lista) return;

  if (pedidos.length === 0) {
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

window.atualizarStatus = async function(id, status) {
  try {
    const btn = event.target.closest('button');
    if(btn) {
        btn.innerHTML = "Processando...";
        btn.disabled = true;
        document.getElementById(`order-${id}`).style.opacity = "0.5";
        // Efeito de saída suave
        if(status === 'pronto') {
            document.getElementById(`order-${id}`).style.transform = "translateX(20px)";
            document.getElementById(`order-${id}`).style.transition = "0.3s";
        }
    }

    const res = await fetch(`/api/orders/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao atualizar status.");

    // Recarrega a lista para remover o pedido que agora está "pronto"
    await carregarPedidos();
  } catch (err) {
    alert("Erro: " + err.message);
    carregarPedidos();
  }
}

async function carregarPedidos() {
  const lista = document.getElementById("orders");
  try {
    if (!user || !user.company_id) return;

    const res = await fetch(`/api/orders?company_id=${user.company_id}`);
    const data = await res.json();
    
    if (!data.ok) throw new Error(data.error || "Erro ao carregar pedidos.");

    // FILTRO ALTERADO: Agora remove 'cancelado', 'entregue' E 'pronto' da visão da cozinha
    pedidos = data.pedidos.filter((p) => 
        p.status !== "cancelado" && 
        p.status !== "entregue" && 
        p.status !== "pronto"
    );
    
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
  // Intervalo de 5 segundos para checar novos pedidos
  setInterval(carregarPedidos, 5000);
});
