const root = document.querySelector("#signup");
const params = new URLSearchParams(location.search);
let role = params.get("role") === "lawyer" ? "lawyer" : "civilian";
let mode = params.get("mode") === "signin" ? "signin" : params.get("mode") === "account" ? "account" : "signup";
let accountUser = null;
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function render(error = "") {
  if (mode === "account") {
    if (!accountUser) { root.innerHTML = `<main><section><p class="eyebrow">Account</p><h1>Loading your account…</h1></section></main>`; return; }
    root.innerHTML = `<main><a class="brand" href="/">Legal Advisor</a><button class="theme" id="theme">◐ Theme</button><section><p class="eyebrow">Personal account</p><h1>${esc(accountUser.name || "Your account")}</h1><p>Your Legal Advisor account details.</p><div class="account-details"><div><span>Name</span><strong>${esc(accountUser.name)}</strong></div><div><span>Email</span><strong>${esc(accountUser.email)}</strong></div><div><span>Account type</span><strong>${esc(accountUser.role === "lawyer" ? "Lawyer" : "Civilian")}</strong></div></div><div class="account-actions"><a class="submit" href="/">Return to Legal Advisor</a><button class="link-button" data-logout>Sign out</button></div></section></main>`;
    return;
  }
  const signingIn = mode === "signin";
  root.innerHTML = `<main><a class="brand" href="/">Legal Advisor</a><button class="theme" id="theme">◐ Theme</button><section><p class="eyebrow">One legal platform</p><h1>${signingIn ? "Sign in" : "Create your account"}</h1><p>${signingIn ? "Continue securely to your Legal Advisor account." : "Choose the experience that fits you. Your account and data stay connected across the same legal platform."}</p><div class="roles"><button data-role="civilian" class="${role === "civilian" ? "active" : ""}"><b>I need legal help</b><span>${signingIn ? "Civilian account" : "Sign up as a civilian"}</span></button><button data-role="lawyer" class="${role === "lawyer" ? "active" : ""}"><b>I provide legal services</b><span>${signingIn ? "Lawyer account" : "Sign up as a lawyer"}</span></button></div>${error ? `<div class="error">${esc(error)}</div>` : ""}<form id="form"><input type="hidden" name="role" value="${role}">${signingIn ? "" : '<label>Full name<input name="name" required autocomplete="name"></label>'}<label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="${signingIn ? "current-password" : "new-password"}"></label>${!signingIn && role === "lawyer" ? '<div class="grid"><label>Practice area<input name="practiceArea" required placeholder="Employment"></label><label>Location<input name="location" required placeholder="Kampala"></label><label>Years of experience<input name="yearsExperience" type="number" min="0"></label><label>Consultation fee (UGX)<input name="consultationFee" type="number" min="0" step="1000" inputmode="numeric" placeholder="150000"><small class="field-help">Your standard fee for an initial consultation.</small></label><label>Languages<input name="languages" placeholder="English, Luganda"></label></div><p class="notice">Lawyer profiles remain unverified until reviewed. You can make your profile visible from the lawyer workspace after signing up.</p>' : ""}<button class="submit">${signingIn ? "Sign in" : `Create ${role} account`}</button></form><p class="signin">${signingIn ? '<button class="link-button" data-mode="signup">Create an account</button>' : '<button class="link-button" data-mode="signin">Already registered? Sign in</button>'}</p></section></main>`;
}

root.addEventListener("click", async (event) => {
  const roleButton = event.target.closest("[data-role]");
  const modeButton = event.target.closest("[data-mode]");
  if (roleButton) { role = roleButton.dataset.role; render(); }
  if (modeButton) { mode = modeButton.dataset.mode; render(); }
  if (event.target.id === "theme") {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem("legal-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
  }
  if (event.target.closest("[data-logout]")) {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("ai-los-session-token");
    location.href = "/";
  }
});

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector(".submit");
  button.disabled = true;
  button.textContent = mode === "signin" ? "Signing in…" : "Creating account…";
  try {
    const response = await fetch(mode === "signin" ? "/api/auth/login" : "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    localStorage.setItem("ai-los-session-token", data.session.token);
    location.href = role === "lawyer" ? "/lawyer" : "/";
  } catch (error) { render(error.message); }
});

if (localStorage.getItem("legal-theme") === "dark") document.documentElement.classList.add("dark");
if (mode === "account") {
  fetch("/api/auth/me", { headers: { Authorization: `Bearer ${localStorage.getItem("ai-los-session-token") || ""}` } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Please sign in first.")))
    .then((payload) => { accountUser = payload.user; render(); })
    .catch(() => { location.href = "/signup?mode=signin"; });
} else render();
