async function login() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value.trim();
  const msg = document.getElementById("msg");

  msg.textContent = "";
  msg.style.color = "red";

  if (!email || !senha) {
    msg.textContent = "Preencha e-mail e senha.";
    return;
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok || !data.user) {
      throw new Error(data.error || "Login inválido");
    }

    // ✅ SALVA APENAS O USER (SEM TOKEN)
    localStorage.setItem("user", JSON.stringify(data.user));

    msg.style.color = "green";
    msg.textContent = "Login realizado! Redirecionando...";

    setTimeout(() => {
      const role = data.user.role;

      if (role === "admin") {
        window.location.href = "index.html";
      } else if (role === "atendente") {
        window.location.href = "meus-pedidos.html";
      } else if (role === "cozinha") {
        window.location.href = "cozinha.html";
      } else {
        window.location.href = "index.html";
      }
    }, 500);

  } catch (err) {
    console.error("Erro no login:", err);
    msg.textContent = err.message;
  }
}

// Login com Enter
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // 🚫 impede reload
    login();
  }
});

