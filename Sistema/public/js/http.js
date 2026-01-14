// http.js — versão corrigida
export async function api(endpoint, options = {}) {
  const baseURL = window.location.origin; // pega o domínio atual
  const token = localStorage.getItem("token");

  // ================== HEADERS ==================
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // ================== BODY ==================
  if (options.body && typeof options.body !== "string") {
    options.body = JSON.stringify(options.body);
  }

  options.headers = headers;

  try {
    const res = await fetch(baseURL + endpoint, options);
    const text = await res.text();

    // caso o servidor retorne HTML, normalmente erro 404 ou redirecionamento
    if (text.trim().startsWith("<")) {
      return { ok: false, error: "Servidor retornou HTML." };
    }

    // tenta converter para JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "Resposta do servidor inválida." };
    }

    // garante que sempre exista a propriedade ok
    if (typeof data.ok === "undefined") data.ok = res.ok;

    return data;
  } catch (err) {
    return { ok: false, error: "Falha de comunicação." };
  }
}
