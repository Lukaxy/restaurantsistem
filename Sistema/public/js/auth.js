// auth.js — autenticação + autorização por página

function verificarAuth(rolesPermitidos = []) {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (!user || !user.id || !user.role) {
    alert("Você precisa fazer login.");
    window.location.href = "login.html";
    return null;
  }

  // Master acessa tudo
  if (user.role === "master") return user;

  // Se a página exige roles específicos
  if (rolesPermitidos.length > 0) {
    if (!rolesPermitidos.includes(user.role)) {
      alert("Você não tem permissão para acessar esta página.");
      window.location.href = "index.html";
      return null;
    }
  }

  // Usuários comuns precisam de empresa
  if (!user.company_id) {
    alert("Sessão inválida. Faça login novamente.");
    window.location.href = "login.html";
    return null;
  }

  return user;
}

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

window.verificarAuth = verificarAuth;
window.logout = logout;

