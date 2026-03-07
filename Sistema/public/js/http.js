// ==========================================================
// 🌐 http.js — Wrapper Inteligente e Blindado
// ==========================================================

export async function api(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
  }

  try {
    const res = await fetch(url, { ...opts, headers });

    // 🛡️ NOVO: O "Botão de Expulsão"
    // Se o servidor disse que o acesso foi negado (401), o usuário é um fantasma!
    if (res.status === 401) {
      console.warn("🚫 Acesso negado: Redirecionando para login...");
      localStorage.clear(); // Limpa as migalhas do fantasma
      window.location.href = "login.html"; // Tchau, tchau!
      return { ok: false, error: "Sessão expirada." };
    }

    const text = await res.text();

    if (text.trim().startsWith("<")) {
      throw new Error(`Servidor retornou HTML (possível erro 404 ou 500).`);
    }

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`JSON inválido retornado de ${url}.`);
    }

    if (res.status >= 400 || (data && data.ok === false)) {
      throw new Error(data.error || `Erro ${res.status}`);
    }

    return data;

  } catch (err) {
    console.error(`❌ Erro na requisição para ${url}:`, err.message);
    return { ok: false, error: err.message };
  }
}
