const root = document.querySelector("#dotti-app");
const GUEST_KEY = "legal-advisor-guest-token";
const MATTER_KEY = "legal-advisor-matter-id";
const SESSION_KEY = "ai-los-session-token";
const state = { screen: "home", menuOpen: false, guestToken: localStorage.getItem(GUEST_KEY) || "", matterId: localStorage.getItem(MATTER_KEY) || "", matter: null, messages: [], sources: [], lawyers: [], referral: null, draft: "", pendingFiles: [], busy: false, selectedLawyer: null, account: null, authPrompt: false, error: "" };
const syncNativeTheme = () => window.LegalAdvisorNative?.setDarkMode(document.documentElement.classList.contains("dark"));

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
  const text = String(message || "").trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) { state.error = "Type a message or attach a file."; return render(); }
  state.busy = true; state.error = ""; state.draft = ""; render();
  try {
    const attachments = [];
    for (const file of files) {
      const upload = await request(`/api/dotti/matters/${state.matterId}/attachments/upload-url`, { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size }) });
      const stored = await fetch(upload.signedUrl, { method: "PUT", headers: { "x-upsert": "false", "Content-Type": upload.attachment.mimeType }, body: file });
      if (!stored.ok) throw new Error("A file could not be uploaded. Check your connection and try again.");
      attachments.push(upload.attachment);
    }
    const payload = await request(`/api/dotti/matters/${state.matterId}/messages`, { method: "POST", body: JSON.stringify({ message: text, attachments }) });
    state.messages.push(payload.clientMessage, payload.message);
    state.pendingFiles = [];
    state.matter = payload.matter; state.sources = payload.sources; state.actions = payload.actions;
  }
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
  const formData = new FormData(form);
  const data = Object.fromEntries(formData); data.attachmentIds = formData.getAll("shareAttachment"); data.consent = form.elements.consent.checked; data.lawyerUserId = state.selectedLawyer.id;
  state.busy = true; render();
  try { const payload = await request(`/api/dotti/matters/${state.matterId}/referrals`, { method: "POST", body: JSON.stringify(data) }); state.referral = payload.referral; state.screen = "sent"; }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; render(); }
}

function shell(content) { const accountLabel = state.account ? escapeHtml(state.account.name || state.account.email) : "Sign in"; const accountHref = "/signup?mode=account"; return `<header class="top"><button class="menu-toggle" data-menu aria-label="Open menu">☰</button><a class="brand" href="/">Legal <span>Advisor</span></a><div class="header-actions"><span class="live-status">● Live</span><button class="theme-toggle" data-theme aria-label="Change theme">◐</button><a class="account-link" href="${accountHref}">${accountLabel}</a></div></header><aside class="app-menu ${state.menuOpen ? "open" : ""}"><button data-go="home">＋ New conversation</button><button data-resume>◫ Current matter</button><hr><a href="${accountHref}">My account</a><a href="/privacy">Privacy Policy</a><button data-theme>Settings · Theme</button>${state.account?.role === "lawyer" ? `<a href="/lawyer">Lawyer workspace</a>` : ""}<div class="menu-note">Uganda-first legal guidance<br><small>Your conversations are private.</small></div></aside><button class="menu-scrim ${state.menuOpen ? "show" : ""}" data-menu aria-label="Close menu"></button>${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}<main>${content}</main>`; }
function home() { return shell(`<section class="hero"><div class="hero-copy"><div class="pill">Legal guidance, made human</div><h1>Legal help starts with <em>understanding.</em></h1><p>Tell the Legal Advisor what's happening. Understand the law, explore your options, and connect with the right lawyer when you need one.</p><form id="start-form" class="ask-box"><textarea name="message" required placeholder="Tell me what's happening in your own words..."></textarea><div><span>Uganda - Private & secure</span><button ${state.busy ? "disabled" : ""}>${state.busy ? "Understanding..." : "Ask a legal question"}</button></div></form><div class="quick"><span>Or start here:</span><button data-prompt="My employer fired me and has not paid my salary.">Work problem</button><button data-prompt="My landlord wants to evict me.">Housing</button><button data-prompt="I need help understanding a contract.">Contract</button></div></div><aside class="trust-card"><div class="orb">LA</div><h3>A calm first step</h3><p>The Legal Advisor asks the questions that matter, explains the law in plain language, and helps you decide what to do next.</p><ul><li>Uganda-first legal guidance</li><li>Sources you can inspect</li><li>You control what lawyers see</li></ul></aside></section><section class="features"><article><b>01</b><h3>AI Legal Advisor</h3><p>Describe the problem naturally and get a clear, structured path forward.</p></article><article><b>02</b><h3>Document Analysis</h3><p>Understand contracts, notices and legal letters without the jargon.</p></article><article><b>03</b><h3>The right lawyer</h3><p>Get matched by legal fit, not merely ratings or advertising.</p></article></section><section class="promise"><span>One connected legal journey</span><h2>From "I have a problem" to "my matter is being handled."</h2></section>`); }

function badges() { if (!state.matter) return ""; return `<div class="matter-badges"><span>${escapeHtml(state.matter.jurisdiction)}</span><span>${escapeHtml(state.matter.category)}</span><span class="risk ${state.matter.risk.toLowerCase()}">${escapeHtml(state.matter.risk)} risk</span><span>${escapeHtml(state.matter.confidence)} confidence</span></div>`; }
function attachmentLinks(attachments = []) { return attachments.length ? `<div class="chat-attachments">${attachments.map((file) => `<a href="${escapeHtml(file.downloadUrl || "#")}" ${file.downloadUrl ? 'target="_blank" rel="noopener"' : "aria-disabled=\"true\""}>📎 ${escapeHtml(file.name)} <small>${(file.size / 1024 / 1024).toFixed(1)} MB</small></a>`).join("")}</div>` : ""; }
function advisor() { return shell(`<section class="workspace"><aside class="matter-panel"><p class="kicker">Your legal matter</p><h2>${escapeHtml(state.matter.title)}</h2>${badges()}<div class="step-list"><div class="done">1 <span>Tell the Legal Advisor what happened</span></div><div class="done">2 <span>Understand your situation</span></div><div class="${state.lawyers.length ? "done" : ""}">3 <span>Find the right support</span></div></div><button class="outline full" data-find>Find the right lawyer</button><p class="privacy">Nothing is shared with a lawyer without your clear consent.</p></aside><section class="chat-card"><div class="chat-head"><div class="avatar">§</div><div><strong>Legal Advisor</strong><span>Uganda legal guidance</span></div><i>Online</i></div><div class="chat-feed">${state.messages.map((message) => `<article class="message ${message.senderType}"><div>${message.senderType === "assistant" ? formatAssistantMessage(message.body) : escapeHtml(message.body).replaceAll("\n", "<br>")}${attachmentLinks(message.metadata?.attachments || [])}</div></article>`).join("")}${state.busy ? '<article class="message assistant"><div class="typing">I’m looking at this carefully <i></i><i></i><i></i></div></article>' : ""}</div>${state.sources.length ? `<div class="sources"><strong>Legal sources</strong>${state.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)} <small>${escapeHtml(s.authority)}</small></a>`).join("")}</div>` : ""}${state.actions?.length ? `<div class="actions">${state.actions.map((x) => `<button data-action-prompt="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>` : ""}<form id="chat-form" class="chat-input"><div class="chat-compose"><textarea name="message" placeholder="Message Legal Advisor…">${escapeHtml(state.draft)}</textarea><div class="chat-controls"><input id="chat-attachment-input" type="file" multiple hidden accept=".pdf,.doc,.docx,.odt,.txt,.md,.csv,.rtf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg,.aac,application/pdf,image/*,video/*,audio/*"><button type="button" class="attach-button" data-attach aria-label="Add documents, photos, videos or voice recordings" title="Add files">＋</button><button type="submit" ${state.busy ? "disabled" : ""}>Send ↑</button></div></div>${state.pendingFiles.length ? `<div class="pending-files">${state.pendingFiles.map((file, index) => `<span>📎 ${escapeHtml(file.name)} <button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button></span>`).join("")}</div>` : ""}<small class="attachment-help">Documents, photos, videos and audio · up to 25 MB each. Files stay with your matter; choose which ones to share with a lawyer.</small></form><p class="disclaimer">Legal Advisor provides legal information, not final legal advice. For case-specific decisions, consult a qualified lawyer.</p></section></section>`); }

function matches() { return shell(`<section class="match-page"><button class="back" data-go="advisor">Back to your conversation</button><p class="kicker">Matched to your matter</p><h1>Lawyers who fit your situation</h1><p>These recommendations consider practice area, Uganda jurisdiction, verification, availability and workload.</p>${badges()}<div class="lawyer-grid">${state.lawyers.map((l, i) => `<article class="lawyer-card"><div class="match-score">${l.matchScore}%<small>match</small></div><div class="lawyer-avatar">${escapeHtml(l.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</div><div><span class="verified">${l.verified ? "Verified lawyer" : "Profile under review"}</span><h3>${escapeHtml(l.name)}</h3><p>${escapeHtml(l.practiceAreas.join("  -  "))}</p></div><dl><div><dt>Location</dt><dd>${escapeHtml(l.location)}</dd></div><div><dt>Experience</dt><dd>${l.yearsExperience} years</dd></div><div><dt>Availability</dt><dd>${escapeHtml(l.availability)}</dd></div><div><dt>Consultation</dt><dd>${money(l.consultationFee)}</dd></div></dl><p class="reason">Why this match: ${escapeHtml(l.matchReason)}</p><button class="primary full" data-choose="${escapeHtml(l.id)}">Request consultation</button></article>`).join("") || "<p>No suitable lawyer profiles are available yet.</p>"}</div></section>`); }

function consent() { const l = state.selectedLawyer; const attachments = [...new Map(state.messages.flatMap((message) => message.metadata?.attachments || []).map((file) => [file.id, file])).values()]; return shell(`<section class="consent-page"><button class="back" data-go="matches">Back to matches</button><div class="consent-card"><p class="kicker">Review before sharing</p><h1>Connect with ${escapeHtml(l.name)}</h1><p>Legal Advisor will share a factual case brief, not your private internal AI reasoning. Your full conversation is not shared.</p><div class="brief"><h3>AI case brief</h3><dl><div><dt>Matter</dt><dd>${escapeHtml(state.matter.title)}</dd></div><div><dt>Jurisdiction</dt><dd>${escapeHtml(state.matter.jurisdiction)}</dd></div><div><dt>Issues</dt><dd>${escapeHtml(state.matter.issues.join(", "))}</dd></div><div><dt>Risk</dt><dd>${escapeHtml(state.matter.risk)}</dd></div></dl><h4>Facts you provided</h4><ul>${state.matter.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div><form id="referral-form"><div class="form-grid"><label>Your name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Phone<input name="phone"></label><label>Consultation type<select name="consultationType"><option>Phone or video call</option><option>In person</option></select></label></div>${attachments.length ? `<fieldset class="share-files"><legend>Files to share with ${escapeHtml(l.name)} (optional)</legend>${attachments.map((file) => `<label><input type="checkbox" name="shareAttachment" value="${escapeHtml(file.id)}"><span>📎 ${escapeHtml(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} MB</span></label>`).join("")}</fieldset>` : ""}<label class="consent"><input type="checkbox" name="consent" required><span>I consent to sharing this case brief, my contact details, and only the files I selected above with ${escapeHtml(l.name)}. I understand no lawyer-client relationship begins until the lawyer accepts.</span></label><button class="primary full" ${state.busy ? "disabled" : ""}>${state.busy ? "Sending securely..." : "Share case and request consultation"}</button></form></div></section>`); }

function sent() { return shell(`<section class="success"><div class="success-mark">OK</div><p class="kicker">Request sent securely</p><h1>Your lawyer has the context.</h1><p>${escapeHtml(state.selectedLawyer.name)} received your contact details and AI-prepared case brief. Your request is pending review.</p><div class="status-card"><span>Current status</span><strong>Lawyer requested</strong><small>We'll keep this legal journey together in Legal Advisor and the lawyer's LOS workspace.</small></div><button class="primary" data-go="advisor">Return to my matter</button></section>`); }

function renderAuthPrompt() {
  document.querySelector("#auth-prompt")?.remove();
  if (!state.authPrompt) return;
  const modal = document.createElement("div");
  modal.id = "auth-prompt";
  modal.className = "auth-prompt-backdrop";
  modal.innerHTML = `<section class="auth-prompt" role="dialog" aria-modal="true" aria-labelledby="auth-prompt-title"><button type="button" class="auth-prompt-close" data-auth-close aria-label="Close">×</button><div class="auth-prompt-icon">LA</div><p class="kicker">Private lawyer matching</p><h2 id="auth-prompt-title">Sign in to find a lawyer</h2><p>Create or sign in to an account before viewing lawyer profiles or sharing a consultation request. Your conversation remains private until you choose what to share.</p><div class="auth-prompt-actions"><a class="primary" href="/signup?mode=account">Sign in</a><a class="outline" href="/signup?mode=account&new=1">Create an account</a></div></section>`;
  document.body.append(modal);
}

function render() { root.innerHTML = state.screen === "advisor" ? advisor() : state.screen === "matches" ? matches() : state.screen === "consent" ? consent() : state.screen === "sent" ? sent() : home(); renderAuthPrompt(); }

root.addEventListener("submit", (event) => { event.preventDefault(); const form = event.target; if (form.id === "start-form") begin(new FormData(form).get("message")); if (form.id === "chat-form") sendMessage(new FormData(form).get("message")); if (form.id === "referral-form") sendReferral(form); });
root.addEventListener("change", (event) => {
  if (event.target.id !== "chat-attachment-input") return;
  const selected = [...(event.target.files || [])];
  const available = 5 - state.pendingFiles.length;
  const accepted = selected.filter((file) => file.size > 0 && file.size <= 25 * 1024 * 1024);
  if (accepted.length !== selected.length) state.error = "Each attachment must be smaller than 25 MB.";
  if (accepted.length > available) state.error = "Attach up to five files to one message.";
  state.pendingFiles.push(...accepted.slice(0, Math.max(available, 0)));
  render();
});
root.addEventListener("click", (event) => { const el = event.target.closest("button"); if (!el) return; if (el.dataset.menu !== undefined) { state.menuOpen = !state.menuOpen; return render(); } if (el.dataset.theme !== undefined) { document.documentElement.classList.toggle("dark"); localStorage.setItem("legal-theme", document.documentElement.classList.contains("dark") ? "dark" : "light"); syncNativeTheme(); } if (el.dataset.start !== undefined) document.querySelector("#start-form textarea")?.focus(); if (el.dataset.prompt) begin(el.dataset.prompt); if (el.dataset.attach !== undefined) document.querySelector("#chat-attachment-input")?.click(); if (el.dataset.removeFile !== undefined) { state.pendingFiles.splice(Number(el.dataset.removeFile), 1); render(); } if (el.dataset.authClose !== undefined) { state.authPrompt = false; return render(); } if (el.dataset.find !== undefined) { if (!state.account) { state.authPrompt = true; return render(); } findLawyers(); } if (el.dataset.actionPrompt) sendMessage(el.dataset.actionPrompt); if (el.dataset.go) { state.screen = el.dataset.go; render(); } if (el.dataset.choose) { state.selectedLawyer = state.lawyers.find((x) => x.id === el.dataset.choose); state.screen = "consent"; render(); } if (el.dataset.resume !== undefined && state.matter) { state.screen = "advisor"; render(); } });
document.addEventListener("click", (event) => { if (event.target.closest("[data-auth-close]")) { state.authPrompt = false; render(); } });

async function boot() { if (localStorage.getItem("legal-theme") === "dark") document.documentElement.classList.add("dark"); syncNativeTheme(); try { const account = await request("/api/auth/me"); state.account = account.user || null; } catch {} if (state.matterId && state.guestToken) { try { const payload = await request(`/api/dotti/matters/${state.matterId}`); setMatter(payload); } catch { localStorage.removeItem(MATTER_KEY); state.matterId = ""; } } render(); }
boot();
