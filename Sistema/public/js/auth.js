// ==========================================================
// 🔐 auth.js — controle de autenticação e permissões
// ==========================================================

function exigirLogin() {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (!user) {
    alert("⚠️ Você precisa estar logado.");
    window.location.href = "login.html";
    return null;
  }

  return user;
}

function exigirAdmin() {
  const user = exigirLogin();

  if (!user || user.role !== "admin") {
    alert("🚫 Acesso restrito. Apenas o administrador da empresa.");
    window.location.href = "login.html";
    return null;
  }

  return user;
}
