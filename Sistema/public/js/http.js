// ==========================================================
// 🌐 http.js — Wrapper simples para requisições ao servidor
// ==========================================================

export async function api(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  try {
    const res = await fetch(url, { ...opts, headers });
    const text = await res.text();

    // 🚨 Se o backend devolveu HTML, algo está errado
    if (text.trim().startsWith("<")) {
      throw new Error(`Servidor retornou HTML — verifique se a rota ${url} existe.`);
    }

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`JSON inválido retornado de ${url}.`);
    }

    if (res.status >= 400 || data.ok === false) {
      throw new Error(data.error || `Erro ${res.status}`);
    }

    return data;
  } catch (err) {
    console.error("Erro na requisição:", err.message);
    return { ok: false, error: err.message };
  }
}

