async function login() {
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value.trim();
  const msg = document.getElementById('msg');

  msg.textContent = '';

  if (!email || !senha) {
    msg.textContent = 'Preencha e-mail e senha.';
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro no login');

    // Armazena token e dados do usuário
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    msg.style.color = 'green';
    msg.textContent = '✅ Login realizado! Redirecionando...';

    // Pequeno delay pra garantir render e evitar travamentos de script
    setTimeout(() => {
      const role = data.user.role || '';
      if (role === 'admin') {
        window.location.href = 'index.html';
      } else if (role === 'atendente') {
        window.location.href = 'meus-pedidos.html';
      } else if (role === 'cozinha') {
        window.location.href = 'cozinha.html';
      } else {
        window.location.href = 'index.html';
      }
    }, 800);

  } catch (err) {
    console.error('Erro no login:', err);
    msg.style.color = 'red';
    msg.textContent = err.message || 'Erro ao conectar com o servidor.';
  }
}

// Permitir login ao pressionar Enter
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

// Ignorar erro de extensão (ex: Google Translate)
window.onerror = (msg) => {
  if (String(msg).includes('<path> attribute d: Expected number')) {
    console.warn('⚠️ Erro de extensão ignorado.');
    return true;
  }
  return false;
};

