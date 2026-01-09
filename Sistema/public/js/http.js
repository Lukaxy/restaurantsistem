// http.js
export async function api(endpoint, options = {}) {
  const baseURL = window.location.origin;
  const token = localStorage.getItem("token");

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  options.headers = { ...headers, ...(options.headers || {}) };

  try {
    const res = await fetch(baseURL + endpoint, options);
    const text = await res.text();

    if (text.trim().startsWith("<")) {
      return { ok: false, error: "Servidor retornou HTML." };
    }

    const data = JSON.parse(text);
    data.ok = typeof data.ok === "undefined" ? res.ok : data.ok;

    return data;
  } catch {
    return { ok: false, error: "Falha de comunicação." };
  }
}

