// ==========================================================
// 🌐 http.js — Wrapper simples (e agora inteligente)
// ==========================================================

export async function api(url, opts = {}) {
  // 1. Garante que os headers existam
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  // 🛠️ MELHORIA: Auto-Stringify
  // Se você mandar um objeto (ex: { nome: "João" }), ele converte pra texto sozinho.
  // Se você mandar texto (o jeito antigo), ele respeita e manda como está.
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(url, { ...opts, headers });
    const text = await res.text();

    // 🚨 Detecção de erro HTML (famoso erro 404/500 do servidor)
    if (text.trim().startsWith("<")) {
      throw new Error(`Servidor retornou HTML (possível erro 404 ou 500). Início: ${text.substring(0, 50)}...`);
    }

    let data;
    try {
      // Se vier vazio, evita o crash do JSON.parse
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`JSON inválido retornado de ${url}.`);
    }

    // Verifica se o servidor retornou erro lógico (ok: false) ou HTTP (400+)
    if (res.status >= 400 || (data && data.ok === false)) {
      throw new Error(data.error || `Erro ${res.status}`);
    }

    return data;

  } catch (err) {
    console.error(`❌ Erro na requisição para ${url}:`, err.message);
    // Retorna erro amigável para o front não travar
    return { ok: false, error: err.message };
  }
}
