// js/http.js
export async function api(url, options = {}) {
  const token =
    localStorage.getItem("master_token") ||
    localStorage.getItem("token"); // fallback futuro

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Resposta inválida do servidor.");
  }

  if (!res.ok) {
    throw new Error(data?.error || "Erro na API.");
  }

  return data;
}
