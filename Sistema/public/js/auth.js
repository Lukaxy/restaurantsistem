// ==================== AUTH GLOBAL ====================

// Adicionei 'export' caso você decida usar módulos ES6 no futuro,
// mas funciona igual sem ele se estiver usando <script src="..."> normal.

function getUser() {
  try {
    const json = localStorage.getItem("user");
    // Verifica se tem algo antes de tentar parsear
    if (!json) return null;
    
    const user = JSON.parse(json);
    return user && user.id ? user : null;
  } catch (e) {
    console.error("Erro ao ler usuário do localStorage", e);
    // Se deu erro, melhor limpar a sujeira para não bugar no futuro
    localStorage.removeItem("user");
    return null;
  }
}

/**
 * Exige que o usuário esteja logado.
 */
function exigirLogin() {
  const user = getUser();

  if (!user) {
    // Salva a página que ele tentou acessar para redirecionar depois do login (Dica de UX!)
    localStorage.setItem("redirect_after_login", window.location.pathname);
    
    alert("Você precisa estar logado.");
    window.location.href = "login.html";
    
    // Dica de Ouro: Lançar um erro aqui É BOM.
    // Isso mata o script imediatamente e impede que dados sensíveis
    // sejam carregados nas linhas abaixo enquanto a página não muda.
    throw new Error("⛔ Acesso negado: Redirecionando para login...");
  }

  return user;
}

/**
 * Exige que o usuário seja admin DA EMPRESA (ou Master, que pode tudo).
 */
function exigirAdmin() {
  const user = exigirLogin(); // Já garante que está logado

  // Se for Master, ele também é "Admin" supremo, então deixa passar.
  // Se for só 'atendente' ou 'cozinha', barra.
  if (user.role !== "admin" && user.role !== "master") {
    alert("Acesso restrito a administradores.");
    window.location.href = "index.html"; // Ou uma página de 'sem permissão'
    throw new Error("⛔ Acesso negado: Usuário sem permissão de admin.");
  }

  return user;
}

/**
 * Exige que seja o MASTER (Você)
 */
function exigirMaster() {
  const user = exigirLogin();

  if (user.role !== "master") {
    alert("Área restrita ao Super Admin.");
    window.location.href = "index.html";
    throw new Error("⛔ Acesso negado: Área restrita ao Master.");
  }

  return user;
}

// Função bônus: Logout
function logout() {
  localStorage.removeItem("user");
  window.location.href = "login.html";
}
