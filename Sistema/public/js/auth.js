// ==================== AUTH GLOBAL ==================== function getUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } } function exigirLogin() { const user = getUser(); if (!user || !user.id) { alert("Você precisa estar logado."); window.location.href = "login.html"; throw new Error("Usuário não autenticado"); } return user; } function exigirAdmin() { const user = exigirLogin(); if (user.role !== "admin") { alert("Acesso restrito ao administrador."); window.location.href = "index.html"; throw new Error("Usuário sem permissão"); } return user; }auth.js - // ==================== AUTH GLOBAL ==================== function getUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } } function exigirLogin() { const user = getUser(); if (!user || !user.id) { alert("Você precisa estar logado."); window.location.href = "login.html"; throw new Error("Usuário não autenticado"); } return user; } function exigirAdmin() { const user = exigirLogin(); if (user.role !== "admin") { alert("Acesso restrito ao administrador."); window.location.href = "index.html"; throw new Error("Usuário sem permissão"); } return user; }auth.js - // ==================== AUTH GLOBAL ====================

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

function exigirLogin() {
  const user = getUser();
  if (!user || !user.id) {
    alert("Você precisa estar logado.");
    window.location.href = "login.html";
    throw new Error("Usuário não autenticado");
  }
  return user;
}

function exigirAdmin() {
  const user = exigirLogin();

  if (user.role !== "admin") {
    alert("Acesso restrito ao administrador.");
    window.location.href = "index.html";
    throw new Error("Usuário sem permissão");
  }

  return user;
}
