// http.js — comunicação simplificada com o backend
export async function api(endpoint, options = {}) {
  const baseURL = window.location.origin;
  const headers = { "Content-Type": "application/json" };

  // ✅ Mescla cabeçalhos (sem token)
  options.headers = { ...headers, ...(options.headers || {}) };

  try {
    const res = await fetch(baseURL + endpoint, options);
    const text = await res.text();

    // Detecta resposta HTML acidental (ex: erro 404 servindo index.html)
    if (text.trim().startsWith("<")) {
      console.error("❌ HTML recebido em vez de JSON em", endpoint);
      return { ok: false, error: "Servidor retornou HTML em vez de JSON." };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("❌ Erro ao converter JSON:", err, text);
      return { ok: false, error: "Resposta inválida do servidor." };
    }

    // Garante que sempre tenha campo ok
    if (typeof data.ok === "undefined") {
      data.ok = res.ok;
    }

    return data;
  } catch (err) {
    console.error("❌ Erro geral em fetch:", err);
    return { ok: false, error: "Falha na comunicação com o servidor." };
  }
}

