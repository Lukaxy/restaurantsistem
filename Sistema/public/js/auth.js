// ==================== AUTH GLOBAL ====================

function getUser() {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    return user && user.id ? user : null;
  } catch (e) {
    console.error("Erro ao ler usuário do localStorage", e);
    return null;
  }
}

/**
 * Exige que o usuário esteja logado
 * Redireciona e PARA a execução da página
 */
function exigirLogin() {
  const user = getUser();

  if (!user) {
    alert("Você precisa estar logado.");
    window.location.href = "login.html";
    return null; // ❗ NÃO usar throw aqui
  }

  return user;
}

/**
 * Exige que o usuário seja admin
 */
function exigirAdmin() {
  const user = exigirLogin();

  if (!user) return null;

  if (user.role !== "admin") {
    alert("Acesso restrito ao administrador.");
    window.location.href = "index.html";
    return null; // ❗ evita quebrar JS da página
  }

  return user;
}
