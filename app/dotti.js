const root = document.querySelector("#dotti-app");
const GUEST_KEY = "legal-advisor-guest-token";
const MATTER_KEY = "legal-advisor-matter-id";
const SESSION_KEY = "ai-los-session-token";
const state = { screen: "home", menuOpen: false, guestToken: localStorage.getItem(GUEST_KEY) || "", matterId: localStorage.getItem(MATTER_KEY) || "", matter: null, messages: [], sources: [], lawyers: [], referral: null, draft: "", busy: false, selectedLawyer: null, account: null, error: "" };

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const money = (value) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value);

function inlineFormat(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
}

function formatAssistantMessage(value) {
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  let html = "";
  let list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) { closeList(); html += `<h3>${inlineFormat(heading[1])}</h3>`; }
    else if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) { closeList(); html += `<${type}>`; list = type; }
      html += `<li>${inlineFormat((bullet || numbered)[1])}</li>`;
    } else { closeList(); html += `<p>${inlineFormat(line)}</p>`; }
  }
  closeList();
  return html;
}

async function request(path, options = {}) {
  const sessionToken = localStorage.getItem(SESSION_KEY) || "";
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(state.guestToken ? { "X-Dotti-Token": state.guestToken } : {}), ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}), ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function setMatter(payload) {
  state.matter = payload.matter;
  state.messages = payload.messages || state.messages;
  state.sources = payload.sources || [];
  state.referral = payload.referral || state.referral;
  if (payload.guestToken) state.guestToken = payload.guestToken;
  state.matterId = payload.matter?.id || state.matterId;
  localStorage.setItem(GUEST_KEY, state.guestToken);
  localStorage.setItem(MATTER_KEY, state.matterId);
}

async function begin(message) {
  state.busy = true; state.error = ""; render();
  try { const payload = await request("/api/dotti/matters", { method: "POST", body: JSON.stringify({ message, guestToken: state.guestToken || undefined }) }); setMatter(payload); state.screen = "advisor"; }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
}

async function sendMessage(message) {
  state.messages.push({ senderType: "client", body: message }); state.busy = true; state.draft = ""; render();
  try { const payload = await request(`/api/dotti/matters/${state.matterId}/messages`, { method: "POST", body: JSON.stringify({ message }) }); state.messages.push(payload.message); state.matter = payload.matter; state.sources = payload.sources; state.actions = payload.actions; }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); document.querySelector(".chat-feed")?.scrollTo(0, 99999); }
}

async function findLawyers() {
  state.busy = true; state.error = ""; render();
  try { const payload = await request(`/api/dotti/matters/${state.matterId}/lawyers`); state.lawyers = payload.lawyers; state.screen = "matches"; }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
}

async function sendReferral(form) {
  const data = Object.fromEntries(new FormData(form)); data.consent = form.elements.consent.checked; data.lawyerUserId = state.selectedLawyer.id;
  state.busy = true; render();
  try { const payload = await request(`/api/dotti/matters/${state.matterId}/referrals`, { method: "POST", body: JSON.stringify(data) }); state.referral = payload.referral; state.screen = "sent"; }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
}

function shell(content) { const accountLabel = state.account ? escapeHtml(state.account.name || state.account.email) : "Sign in"; const accountHref = "/signup?mode=account"; return `<header class="top"><button class="menu-toggle" data-menu aria-label="Open menu">☰</button><a class="brand" href="/">Legal <span>Advisor</span></a><div class="header-actions"><span class="live-status">● Live</span><button class="theme-toggle" data-theme aria-label="Change theme">◐</button><a class="account-link" href="${accountHref}">${accountLabel}</a></div></header><aside class="app-menu ${state.menuOpen ? "open" : ""}"><button data-go="home">＋ New conversation</button><button data-resume>◫ Current matter</button><hr><a href="${accountHref}">My account</a><a href="/privacy">Privacy Policy</a><button data-theme>Settings · Theme</button>${state.account?.role === "lawyer" ? `<a href="/lawyer">Lawyer workspace</a>` : ""}<div class="menu-note">Uganda-first legal guidance<br><small>Your conversations are private.</small></div></aside><button class="menu-scrim ${state.menuOpen ? "show" : ""}" data-menu aria-label="Close menu"></button>${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}<main>${content}</main>`; }
function home() { return shell(`<section class="hero"><div class="hero-copy"><div class="pill">Legal guidance, made human</div><h1>Legal help starts with <em>understanding.</em></h1><p>Tell the Legal Advisor what's happening. Understand the law, explore your options, and connect with the right lawyer when you need one.</p><form id="start-form" class="ask-box"><textarea name="message" required placeholder="Tell me what's happening in your own words..."></textarea><div><span>Uganda - Private & secure</span><button ${state.busy ? "disabled" : ""}>${state.busy ? "Understanding..." : "Ask a legal question"}</button></div></form><div class="quick"><span>Or start here:</span><button data-prompt="My employer fired me and has not paid my salary.">Work problem</button><button data-prompt="My landlord wants to evict me.">Housing</button><button data-prompt="I need help understanding a contract.">Contract</button></div></div><aside class="trust-card"><div class="orb">LA</div><h3>A calm first step</h3><p>The Legal Advisor asks the questions that matter, explains the law in plain language, and helps you decide what to do next.</p><ul><li>Uganda-first legal guidance</li><li>Sources you can inspect</li><li>You control what lawyers see</li></ul></aside></section><section class="features"><article><b>01</b><h3>AI Legal Advisor</h3><p>Describe the problem naturally and get a clear, structured path forward.</p></article><article><b>02</b><h3>Document Analysis</h3><p>Understand contracts, notices and legal letters without the jargon.</p></article><article><b>03</b><h3>The right lawyer</h3><p>Get matched by legal fit, not merely ratings or advertising.</p></article></section><section class="promise"><span>One connected legal journey</span><h2>From "I have a problem" to "my matter is being handled."</h2></section>`); }

function badges() { if (!state.matter) return ""; return `<div class="matter-badges"><span>${escapeHtml(state.matter.jurisdiction)}</span><span>${escapeHtml(state.matter.category)}</span><span class="risk ${state.matter.risk.toLowerCase()}">${escapeHtml(state.matter.risk)} risk</span><span>${escapeHtml(state.matter.confidence)} confidence</span></div>`; }
function advisor() { return shell(`<section class="workspace"><aside class="matter-panel"><p class="kicker">Your legal matter</p><h2>${escapeHtml(state.matter.title)}</h2>${badges()}<div class="step-list"><div class="done">1 <span>Tell the Legal Advisor what happened</span></div><div class="done">2 <span>Understand your situation</span></div><div class="${state.lawyers.length ? "done" : ""}">3 <span>Find the right support</span></div></div><button class="outline full" data-find>Find the right lawyer</button><p class="privacy">Nothing is shared with a lawyer without your clear consent.</p></aside><section class="chat-card"><div class="chat-head"><div class="avatar">§</div><div><strong>Legal Advisor</strong><span>Uganda legal guidance</span></div><i>Online</i></div><div class="chat-feed">${state.messages.map((message) => `<article class="message ${message.senderType}"><div>${message.senderType === "assistant" ? formatAssistantMessage(message.body) : escapeHtml(message.body).replaceAll("\n", "<br>")}</div></article>`).join("")}${state.busy ? '<article class="message assistant"><div class="typing">I’m looking at this carefully <i></i><i></i><i></i></div></article>' : ""}</div>${state.sources.length ? `<div class="sources"><strong>Legal sources</strong>${state.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)} <small>${escapeHtml(s.authority)}</small></a>`).join("")}</div>` : ""}${state.actions?.length ? `<div class="actions">${state.actions.map((x) => `<button data-action-prompt="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>` : ""}<form id="chat-form" class="chat-input"><textarea name="message" required placeholder="Message Legal Advisor…">${escapeHtml(state.draft)}</textarea><button ${state.busy ? "disabled" : ""}>Send ↑</button></form><p class="disclaimer">Legal Advisor provides legal information, not final legal advice. For case-specific decisions, consult a qualified lawyer.</p></section></section>`); }

function matches() { return shell(`<section class="match-page"><button class="back" data-go="advisor">Back to your conversation</button><p class="kicker">Matched to your matter</p><h1>Lawyers who fit your situation</h1><p>These recommendations consider practice area, Uganda jurisdiction, verification, availability and workload.</p>${badges()}<div class="lawyer-grid">${state.lawyers.map((l, i) => `<article class="lawyer-card"><div class="match-score">${l.matchScore}%<small>match</small></div><div class="lawyer-avatar">${escapeHtml(l.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</div><div><span class="verified">${l.verified ? "Verified lawyer" : "Profile under review"}</span><h3>${escapeHtml(l.name)}</h3><p>${escapeHtml(l.practiceAreas.join("  -  "))}</p></div><dl><div><dt>Location</dt><dd>${escapeHtml(l.location)}</dd></div><div><dt>Experience</dt><dd>${l.yearsExperience} years</dd></div><div><dt>Availability</dt><dd>${escapeHtml(l.availability)}</dd></div><div><dt>Consultation</dt><dd>${money(l.consultationFee)}</dd></div></dl><p class="reason">Why this match: ${escapeHtml(l.matchReason)}</p><button class="primary full" data-choose="${escapeHtml(l.id)}">Request consultation</button></article>`).join("") || "<p>No suitable lawyer profiles are available yet.</p>"}</div></section>`); }

function consent() { const l = state.selectedLawyer; return shell(`<section class="consent-page"><button class="back" data-go="matches">Back to matches</button><div class="consent-card"><p class="kicker">Review before sharing</p><h1>Connect with ${escapeHtml(l.name)}</h1><p>Legal Advisor will share a factual case brief, not your private internal AI reasoning. Your full conversation is not shared.</p><div class="brief"><h3>AI case brief</h3><dl><div><dt>Matter</dt><dd>${escapeHtml(state.matter.title)}</dd></div><div><dt>Jurisdiction</dt><dd>${escapeHtml(state.matter.jurisdiction)}</dd></div><div><dt>Issues</dt><dd>${escapeHtml(state.matter.issues.join(", "))}</dd></div><div><dt>Risk</dt><dd>${escapeHtml(state.matter.risk)}</dd></div></dl><h4>Facts you provided</h4><ul>${state.matter.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div><form id="referral-form"><div class="form-grid"><label>Your name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Phone<input name="phone"></label><label>Consultation type<select name="consultationType"><option>Phone or video call</option><option>In person</option></select></label></div><label class="consent"><input type="checkbox" name="consent" required><span>I consent to sharing this case brief and my contact details with ${escapeHtml(l.name)}. I understand no lawyer-client relationship begins until the lawyer accepts.</span></label><button class="primary full" ${state.busy ? "disabled" : ""}>${state.busy ? "Sending securely..." : "Share case and request consultation"}</button></form></div></section>`); }

function sent() { return shell(`<section class="success"><div class="success-mark">OK</div><p class="kicker">Request sent securely</p><h1>Your lawyer has the context.</h1><p>${escapeHtml(state.selectedLawyer.name)} received your contact details and AI-prepared case brief. Your request is pending review.</p><div class="status-card"><span>Current status</span><strong>Lawyer requested</strong><small>We'll keep this legal journey together in Legal Advisor and the lawyer's LOS workspace.</small></div><button class="primary" data-go="advisor">Return to my matter</button></section>`); }

function render() { root.innerHTML = state.screen === "advisor" ? advisor() : state.screen === "matches" ? matches() : state.screen === "consent" ? consent() : state.screen === "sent" ? sent() : home(); }

root.addEventListener("submit", (event) => { event.preventDefault(); const form = event.target; if (form.id === "start-form") begin(new FormData(form).get("message")); if (form.id === "chat-form") sendMessage(new FormData(form).get("message")); if (form.id === "referral-form") sendReferral(form); });
root.addEventListener("click", (event) => { const el = event.target.closest("button"); if (!el) return; if (el.dataset.menu !== undefined) { state.menuOpen = !state.menuOpen; return render(); } if (el.dataset.theme !== undefined) { document.documentElement.classList.toggle("dark"); localStorage.setItem("legal-theme", document.documentElement.classList.contains("dark") ? "dark" : "light"); } if (el.dataset.start !== undefined) document.querySelector("#start-form textarea")?.focus(); if (el.dataset.prompt) begin(el.dataset.prompt); if (el.dataset.find !== undefined) findLawyers(); if (el.dataset.actionPrompt) sendMessage(el.dataset.actionPrompt); if (el.dataset.go) { state.screen = el.dataset.go; render(); } if (el.dataset.choose) { state.selectedLawyer = state.lawyers.find((x) => x.id === el.dataset.choose); state.screen = "consent"; render(); } if (el.dataset.resume !== undefined && state.matter) { state.screen = "advisor"; render(); } });

async function boot() { if (localStorage.getItem("legal-theme") === "dark") document.documentElement.classList.add("dark"); try { const account = await request("/api/auth/me"); state.account = account.user || null; } catch {} if (state.matterId && state.guestToken) { try { const payload = await request(`/api/dotti/matters/${state.matterId}`); setMatter(payload); } catch { localStorage.removeItem(MATTER_KEY); state.matterId = ""; } } render(); }
boot();
