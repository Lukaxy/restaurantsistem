// ======================== VARIÁVEIS GLOBAIS ========================
let pedidos = [];
// O TEMPO_OCULTAR_PRONTO é legal para limpar a tela visualmente
const TEMPO_OCULTAR_PRONTO = 10 * 60 * 1000; // 10 minutos
let user = null; // Vamos definir o usuário depois

// ======================== FUNÇÕES ========================

// Renderiza os pedidos na tela
function renderizarPedidos() {
  const lista = document.getElementById("orders");
  if (!lista) return;

  if (pedidos.length === 0) {
    lista.innerHTML = "<p style='text-align:center;margin-top:20px;color:#666;'>Nenhum pedido pendente 🍽️</p>";
    return;
  }

  lista.innerHTML = pedidos
    .map((p) => {
      // ⚠️ CORREÇÃO DO JSON:
      // O backend já manda p.items como Array. Não precisa de JSON.parse de novo.
      // Mas por segurança, garantimos que é array:
      const itensArray = Array.isArray(p.items) ? p.items : [];

      return `
      <div class="order ${p.status}">
        <div style="display:flex;justify-content:space-between;">
           <b>🧾 Pedido #${p.id}</b>
           <span style="font-weight:bold;">${p.table_name || "Balcão"}</span>
        </div>
        
        <small style="color:#888;">${new Date(p.created_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}</small>
        
        <hr style="margin: 5px 0; border: 0; border-top: 1px dashed #ccc;">

        <div style="margin: 10px 0; font-family: monospace; font-size: 1.1rem;">
          ${itensArray
            .map((i) => `<div>${i.qty}x ${i.name}</div>`)
            .join("")}
        </div>

        ${p.notes ? `<div style="background:#fff3cd; padding:5px; border-radius:4px; margin-bottom:10px;"><b>⚠️ Obs:</b> ${p.notes}</div>` : ""}

        <div class="controls" style="display:flex; gap:10px; margin-top:10px;">
          ${
            p.status === "novo"
              ? `<button class="btn" onclick="atualizarStatus(${p.id}, 'preparando')" style="flex:1; background:#007bff; color:white;">👨‍🍳 Preparar</button>`
              : ""
          }
          ${
            p.status === "preparando"
              ? `<button class="btn" onclick="atualizarStatus(${p.id}, 'pronto')" style="flex:1; background:#28a745; color:white;">✅ Pronto</button>`
              : ""
          }
          <button class="btn cancel" onclick="atualizarStatus(${p.id}, 'cancelado')" style="background:#dc3545; color:white;">❌</button>
        </div>
      </div>
    `;
    })
    .join("");
}

// Torna a função global para o HTML conseguir chamar no onclick
window.atualizarStatus = async function(id, status) {
  try {
    // Muda visualmente na hora (pra parecer rápido)
    const btn = event.target; 
    const textoOriginal = btn.innerText;
    btn.innerText = "...";
    btn.disabled = true;

    const res = await fetch(`/api/orders/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Erro ao atualizar status.");

    // Se deu certo, recarrega a lista
    carregarPedidos();
  } catch (err) {
    alert("Erro: " + err.message);
    // Se deu erro, recarrega para voltar ao estado real
    carregarPedidos();
  }
}

// Oculta pedidos prontos após 10 minutos (apenas visual)
function removerPedidosAntigos() {
  const agora = Date.now();
  // Filtra localmente
  const novaLista = pedidos.filter((p) => {
    if (p.status !== "pronto") return true;
    // Se não tem hora de pronto marcada, marca agora (gambiarra visual)
    if (!p._horaPronto) p._horaPronto = new Date(p.status_updated_at).getTime();
    return agora - p._horaPronto < TEMPO_OCULTAR_PRONTO;
  });
  
  // Se mudou algo, renderiza
  if (novaLista.length !== pedidos.length) {
     pedidos = novaLista;
     renderizarPedidos();
  }
}

// Carrega pedidos do backend
async function carregarPedidos() {
  const lista = document.getElementById("orders");
  try {
    if (!user || !user.company_id) {
        console.warn("Sem company_id");
        return;
    }

    const res = await fetch(`/api/orders?company_id=${user.company_id}`);
    const data = await res.json();
    
    if (!data.ok) throw new Error(data.error || "Erro ao carregar pedidos.");

    // Guardamos na memória
    // O backend já manda ordenado, mas garantimos que cancelados não aparecem na cozinha
    pedidos = data.pedidos.filter((p) => p.status !== "cancelado" && p.status !== "entregue");
    
    renderizarPedidos();
  } catch (err) {
    console.error("Erro ao carregar pedidos:", err);
    if(lista) lista.innerHTML = `<p style="color:red;">Erro de conexão: ${err.message}</p>`;
  }
}

// ======================== INICIALIZAÇÃO ========================
document.addEventListener("DOMContentLoaded", () => {
  
  // 1. Autenticação Manual (Para não depender de função externa quebrada)
  try {
    const userJson = localStorage.getItem("user");
    if (!userJson) {
        window.location.href = "login.html";
        return;
    }
    user = JSON.parse(userJson);
  } catch(e) {
    window.location.href = "login.html";
    return;
  }

  // 2. Se chegou aqui, tá logado. Carrega!
  carregarPedidos();

  // 3. Loop de atualização (Polling)
  setInterval(carregarPedidos, 5000); // busca a cada 5s
  setInterval(removerPedidosAntigos, 60000); // limpa antigos a cada 1 min
});
