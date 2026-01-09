document.addEventListener("DOMContentLoaded", async () => {
  const user = verificarAuth(); // chama a função do auth.js
if (!user) return; // se não estiver logado, ele já redireciona automaticamente
const company_id = user.company_id;

  const resumoEl = document.getElementById("resumo");
  const listaEl = document.getElementById("listaPedidos");

  if (!companyId) {
    resumoEl.innerHTML = "<p style='color:red;'>company_id é obrigatório (faça login novamente).</p>";
    listaEl.innerHTML = "";
    return;
  }

  try {
    // Busca histórico de pedidos finalizados (rota do teu server.js)
    const res = await fetch(`/api/orders/history?company_id=${companyId}`);
    const text = await res.text();

    if (text.trim().startsWith("<")) {
      throw new Error("Servidor retornou HTML — verifique se a rota /api/orders/history existe.");
    }

    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || "Erro ao carregar histórico.");

    const pedidos = data.pedidos || [];

    if (pedidos.length === 0) {
      resumoEl.innerHTML = "<p style='color:#bbb;'>Nenhum pedido finalizado ainda.</p>";
      listaEl.innerHTML = "";
      return;
    }

    // 📊 Resumo
    const totalVendas = pedidos.reduce((s, p) => s + (Number(p.total) || 0), 0);
    const totalPedidos = pedidos.length;

    resumoEl.innerHTML = `
      <div class="box-resumo">
        <div><b>Total de pedidos:</b> ${totalPedidos}</div>
        <div><b>Vendas totais:</b> R$ ${totalVendas.toFixed(2)}</div>
      </div>
    `;

    // 🧾 Lista detalhada
    listaEl.innerHTML = pedidos
      .map((p) => {
        let items = [];
        try { items = JSON.parse(p.items || "[]"); } catch {}
        const quando = p.status_updated_at || p.created_at;
        return `
          <div class="pedido">
            <div class="pedido-header">
              <b>#${p.id}</b> — <span>${p.status}</span>
              <span style="float:right;">${quando ? new Date(quando).toLocaleString("pt-BR") : ""}</span>
            </div>
            <div class="pedido-itens">
              ${items.map(i => `${i.qty}x ${i.name}`).join("<br>")}
            </div>
            <div><b>Total:</b> R$ ${(Number(p.total)||0).toFixed(2)}</div>
            ${p.table_name ? `<div><b>Mesa:</b> ${p.table_name}</div>` : ""}
            ${p.notes ? `<div class="obs"><b>Obs:</b> ${p.notes}</div>` : ""}
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Erro ao carregar relatório:", err);
    resumoEl.innerHTML = `<p style="color:red;">${err.message}</p>`;
    listaEl.innerHTML = "";
  }
});

