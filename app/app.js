const app = document.querySelector("#app");
if (localStorage.getItem("legal-theme") === "dark") document.documentElement.classList.add("dark");
const SESSION_KEY = "ai-los-session-token";
const state = {
  view: "dashboard",
  loading: true,
  authenticated: false,
  sessionToken: localStorage.getItem(SESSION_KEY) || "",
  bootstrap: null,
  selectedCaseId: null,
  search: "",
  modal: null,
  loggingIn: false,
  savingCase: false,
  savingCaseEdit: false,
  savingUser: false,
  savingTimeline: false,
  uploading: false,
  asking: false,
  briefing: false,
  drafting: false,
  verificationStep: 1,
  verificationDraft: {},
  verificationFiles: {},
  kycSubmitting: false,
  assistantDraft: "",
  selectedTemplateKey: "brief",
  templateInstructions: "",
  assistantMessages: [
    {
      role: "assistant",
      text: "AI-LOS is ready. Sign in, manage matters, upload documents, and generate structured legal drafts.",
    },
  ],
  toasts: [],
};

const icons = {
  dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>',
  referrals: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H8l-4 3V5Zm4 4h8M8 13h5"/></svg>',
  clients: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5M15 15c3 0 5 1.7 6 4"/></svg>',
  cases: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4V6Zm3-3h10l2 3H5l2-3Zm1 8h8M8 15h5"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 14 9l6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"/></svg>',
  verification: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></svg>',
  account: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function saveSessionToken(token) {
  state.sessionToken = token || "";
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

function queueToast(message, tone = "neutral") {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.toasts.push({ id, message, tone });
  render();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((toast) => toast.id !== id);
    render();
  }, 3500);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (state.sessionToken) headers["X-Session-Token"] = state.sessionToken;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    state.authenticated = false;
    state.bootstrap = null;
    saveSessionToken("");
    render();
  }
  if (response.status === 204) return null;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof payload === "string" ? payload : payload.error || "Request failed.");
  return payload;
}

function hydrateBootstrap(payload) {
  state.bootstrap = payload;
  state.authenticated = true;
  if (!payload.cases.find((item) => item.id === state.selectedCaseId)) {
    state.selectedCaseId = payload.cases[0]?.id || null;
  }
}

function getSelectedCase() {
  return state.bootstrap?.cases.find((item) => item.id === state.selectedCaseId) || null;
}

function filteredCases() {
  const query = state.search.trim().toLowerCase();
  const cases = state.bootstrap?.cases || [];
  if (!query) return cases;
  return cases.filter((item) =>
    [item.reference, item.title, item.category, item.client?.name, item.summary]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query)),
  );
}

function filteredClients() {
  const query = state.search.trim().toLowerCase();
  const clients = state.bootstrap?.clients || [];
  if (!query) return clients;
  return clients.filter((item) =>
    [item.name, item.contact, item.email, item.segment]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query)),
  );
}

async function bootstrapSession() {
  state.loading = true;
  render();
  if (!state.sessionToken) {
    state.loading = false;
    render();
    return;
  }
  try {
    hydrateBootstrap(await api("/api/auth/session"));
  } catch (error) {
    saveSessionToken("");
    queueToast(error.message, "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function login(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  state.loggingIn = true;
  render();
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    saveSessionToken(data.session?.token || "");
    hydrateBootstrap(data);
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.loggingIn = false;
    state.loading = false;
    render();
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  state.authenticated = false;
  state.bootstrap = null;
  saveSessionToken("");
  render();
}

async function submitNewCase(form) {
  state.savingCase = true;
  render();
  try {
    hydrateBootstrap(await api("/api/cases", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }));
    state.modal = null;
    queueToast("New matter created.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.savingCase = false;
    render();
  }
}

async function updateCase(form) {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return;
  state.savingCaseEdit = true;
  render();
  try {
    hydrateBootstrap(
      await api(`/api/cases/${selectedCase.id}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      }),
    );
    state.modal = null;
    queueToast("Case updated.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.savingCaseEdit = false;
    render();
  }
}

async function createUser(form) {
  state.savingUser = true;
  render();
  try {
    hydrateBootstrap(await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }));
    state.modal = null;
    queueToast("User created.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.savingUser = false;
    render();
  }
}

async function createClient(form) {
  state.savingClient = true;
  render();
  try {
    hydrateBootstrap(await api("/api/clients", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }));
    state.modal = null;
    queueToast("Client created.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.savingClient = false;
    render();
  }
}

async function addTimelineEntry(form) {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return;
  state.savingTimeline = true;
  render();
  try {
    hydrateBootstrap(await api(`/api/cases/${selectedCase.id}/timeline`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }));
    queueToast("Timeline entry added.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.savingTimeline = false;
    render();
  }
}

async function deleteTimelineEntry(timelineId) {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return;
  try {
    hydrateBootstrap(await api(`/api/cases/${selectedCase.id}/timeline/${timelineId}`, { method: "DELETE" }));
    queueToast("Timeline entry removed.");
  } catch (error) {
    queueToast(error.message, "error");
  }
}

async function updateReferral(referralId, action) {
  try {
    hydrateBootstrap(await api(`/api/referrals/${referralId}`, { method: "PATCH", body: JSON.stringify({ action }) }));
    queueToast(action === "accept" ? "Referral accepted and matter activated." : action === "decline" ? "Referral declined." : "More information requested.");
  } catch (error) { queueToast(error.message, "error"); }
}

async function updateDiscoverability(discoverable) {
  try {
    hydrateBootstrap(await api("/api/lawyer/discoverability", { method: "PATCH", body: JSON.stringify({ discoverable }) }));
    queueToast(discoverable ? "Your profile is now visible to Legal Advisor clients." : "Your profile is hidden from new client matches.");
  } catch (error) { queueToast(error.message, "error"); }
}

const fileDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read the document.")); reader.readAsDataURL(file); });

async function submitVerification(form) {
  const values = Object.fromEntries(new FormData(form));
  if (form.id === "verification-step-1") { state.verificationDraft = { ...state.verificationDraft, ...values }; state.verificationStep = 2; return render(); }
  if (form.id === "verification-step-2") {
    const personal = form.elements.personalDocument.files?.[0];
    const personalBack = form.elements.personalDocumentBack.files?.[0];
    const legal = form.elements.legalDocument.files?.[0];
    if (!personal || !personalBack || !legal) return queueToast("Please provide the front and back of your ID, plus your legal certificate.", "error");
    if ([personal, personalBack, legal].some((file) => file.size > 8 * 1024 * 1024)) return queueToast("Each document must be 8 MB or smaller.", "error");
    state.verificationDraft = { ...state.verificationDraft, idType: values.idType, idNumber: values.idNumber, country: values.country };
    state.verificationFiles = { personal, personalBack, legal }; state.verificationStep = 3; return render();
  }
  if (form.id !== "verification-step-3") return;
  state.kycSubmitting = true; render();
  try {
    const d = state.verificationDraft, files = state.verificationFiles;
    const [personalData, personalBackData, legalData] = await Promise.all([fileDataUrl(files.personal), fileDataUrl(files.personalBack), fileDataUrl(files.legal)]);
    hydrateBootstrap(await api("/api/lawyer/kyc", { method: "POST", body: JSON.stringify({ ...d, documents: [{ name: files.personal.name, dataUrl: personalData }, { name: files.personalBack.name, dataUrl: personalBackData }, { name: files.legal.name, dataUrl: legalData }] }) }));
    state.verificationStep = 1; state.verificationDraft = {}; state.verificationFiles = {};
    queueToast("Verification submitted securely. Your profile remains hidden until review.");
  } catch (error) { queueToast(error.message, "error"); }
  finally { state.kycSubmitting = false; render(); }
}

async function enableTestDiscoverability() {
  try {
    hydrateBootstrap(await api("/api/lawyer/test-discoverability", { method: "POST" }));
    queueToast("Test discoverability enabled. This profile can now appear in matching tests.");
  } catch (error) { queueToast(error.message, "error"); }
}

async function askAssistant() {
  const question = state.assistantDraft.trim();
  if (!question) return queueToast("Enter a question for the assistant.", "error");
  state.asking = true;
  state.assistantMessages.push({ role: "user", text: question });
  state.assistantDraft = "";
  render();
  try {
    const payload = await api("/api/assistant/query", { method: "POST", body: JSON.stringify({ question, caseId: state.selectedCaseId }) });
    state.assistantMessages.push({ role: "assistant", text: payload.answer });
  } catch (error) {
    state.assistantMessages.push({ role: "assistant", text: `Error: ${error.message}` });
  } finally {
    state.asking = false;
    render();
  }
}

async function generateBrief() {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return queueToast("Select a case first.", "error");
  state.briefing = true;
  render();
  try {
    const payload = await api(`/api/cases/${selectedCase.id}/brief`, { method: "POST", body: JSON.stringify({ note: `Prepare an internal legal brief for ${selectedCase.reference}.` }) });
    state.assistantMessages.push({ role: "assistant", text: `Case brief for ${selectedCase.reference}\n\n${payload.brief}` });
  } catch (error) {
    state.assistantMessages.push({ role: "assistant", text: `Error: ${error.message}` });
  } finally {
    state.briefing = false;
    render();
  }
}

async function generateTemplateDraft() {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return queueToast("Select a case first.", "error");
  state.drafting = true;
  render();
  try {
    const payload = await api(`/api/cases/${selectedCase.id}/drafts`, {
      method: "POST",
      body: JSON.stringify({ templateKey: state.selectedTemplateKey, instructions: state.templateInstructions }),
    });
    state.assistantMessages.push({ role: "assistant", text: `${payload.templateLabel} for ${selectedCase.reference}\n\n${payload.draft}` });
  } catch (error) {
    state.assistantMessages.push({ role: "assistant", text: `Error: ${error.message}` });
  } finally {
    state.drafting = false;
    render();
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function readTextIfPossible(file) {
  if (file.type.startsWith("text/") || file.name.match(/\.(txt|md|json|csv|xml)$/i)) return file.text();
  return "";
}

async function uploadDocument(file) {
  const selectedCase = getSelectedCase();
  if (!selectedCase) return queueToast("Select a case before uploading a document.", "error");
  state.uploading = true;
  render();
  try {
    const payload = await api(`/api/cases/${selectedCase.id}/documents`, {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl: await fileToDataUrl(file),
        extractedText: await readTextIfPossible(file),
      }),
    });
    hydrateBootstrap(payload.bootstrap);
    queueToast("Document uploaded.");
  } catch (error) {
    queueToast(error.message, "error");
  } finally {
    state.uploading = false;
    render();
  }
}

async function deleteDocument(documentId) {
  try {
    hydrateBootstrap(await api(`/api/documents/${documentId}`, { method: "DELETE" }));
    queueToast("Document deleted.");
  } catch (error) {
    queueToast(error.message, "error");
  }
}

function downloadDocument(documentId) {
  fetch(`/api/documents/${documentId}/download`, { headers: { "X-Session-Token": state.sessionToken } })
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to download document.");
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const name = match ? decodeURIComponent(match[1]) : "document";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    })
    .catch((error) => queueToast(error.message, "error"));
}

function renderLogin() {
  return `
    <div class="boot-screen">
      <div class="boot-card auth-card">
        <p class="eyebrow">AI-LOS Secure Workspace</p>
        <h1>Legal operations sign-in</h1>
        <p class="panel-copy">Sign in to access matters, users, uploaded documents, and AI drafting workflows.</p>
        <form id="login-form" class="auth-form">
          <label class="form-field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
          <label class="form-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="button primary" type="submit" ${state.loggingIn ? "disabled" : ""}>${state.loggingIn ? "Signing in..." : "Sign In"}</button>
        </form>
        <p class="panel-copy">New here? <a href="/signup">Create a civilian or lawyer account</a></p>
      </div>
      ${renderToasts()}
    </div>
  `;
}

function renderStats(metrics) {
  const items = [
    ["Active Cases", metrics.activeCases],
    ["Clients", metrics.clients],
    ["Revenue", metrics.revenue],
    ["Pending Tasks", metrics.pendingTasks],
    ["Documents", metrics.documents],
  ];
  return `<section class="stats-grid stats-grid--five">${items
    .map(
      ([label, value]) => `<article class="panel stat-card"><p class="subtle">${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong></article>`,
    )
    .join("")}</section>`;
}

function renderActivity(activity) {
  return `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Pipeline</p><h3>Team Activity</h3></div></div><div class="activity-list">${activity
    .map((item) => `<article class="activity-item"><div><strong>${escapeHtml(item.time)}</strong><p class="subtle">${escapeHtml(item.text)}</p></div></article>`)
    .join("")}</div></section>`;
}

function renderDiscoverability() {
  const profile = state.bootstrap?.lawyerProfile;
  if (!profile) return "";
  const discoverable = Boolean(profile.discoverable);
  const eligible = Boolean(profile.verified && profile.kycStatus === "approved");
  return `<section class="panel discoverability-panel"><div><p class="eyebrow">Client matching</p><h3>Discoverable by clients</h3><p class="panel-copy">Only verified lawyers with approved KYC can appear in client matches.</p></div><div class="discoverability-control"><span class="status-pill ${discoverable ? "online" : ""}">${discoverable ? "Visible" : eligible ? "Hidden" : "KYC required"}</span>${eligible ? `<button class="button ${discoverable ? "secondary" : "primary"}" data-action="toggle-discoverability" data-discoverable="${discoverable ? "false" : "true"}">${discoverable ? "Hide my profile" : "Make me discoverable"}</button>` : ""}</div></section>`;
}

function renderKyc() {
  const profile = state.bootstrap?.lawyerProfile;
  if (!profile) return "";
  const status = profile.kycStatus || "not_submitted";
  const labels = { not_submitted: "Not submitted", submitted: "Under review", approved: "Approved", rejected: "Needs changes" };
  const isLive = Boolean(profile.discoverable);
  const testControl = `<div class="test-control ${isLive ? "test-control--live" : ""}"><div><strong>Test discoverability</strong><p>${isLive ? "This profile is live and can appear in lawyer matching." : "Use this control to test how your profile appears in lawyer matching."}</p></div><div class="test-control-action">${isLive ? '<span class="status-pill online">Enabled · Live</span><button class="button secondary" disabled>Discoverability enabled</button>' : '<button class="button secondary" data-action="enable-test-discoverability">Enable discoverability</button>'}</div></div>`;
  if (status === "approved") return `<section class="panel kyc-panel"><div><p class="eyebrow">Identity verification</p><h3>KYC approved</h3><p class="panel-copy">Your identity and professional documents are approved. You can now choose whether clients can discover your profile.</p></div><span class="status-pill online">Approved</span>${testControl}</section>`;
  if (status === "submitted") return `<section class="panel kyc-panel"><div class="panel-head"><div><p class="eyebrow">Identity verification</p><h3>Verification in progress</h3><p class="panel-copy">Your documents were submitted securely. Your profile stays hidden until review is approved.</p></div><span class="status-pill">Under review</span></div>${testControl}</section>`;
  const step = state.verificationStep || 1;
  const draft = state.verificationDraft;
  const stepper = `<div class="verification-steps">${["Credentials", "Documents", "Declaration"].map((label, index) => `<div class="verification-step ${step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}"><b>0${index + 1}</b><span>${label}</span></div>`).join("")}</div>`;
  let content = "";
  if (step === 1) content = `<form id="verification-step-1" class="verification-form"><div class="form-grid"><label class="form-field"><span>Full legal name</span><input name="fullName" value="${escapeHtml(draft.fullName)}" required /></label><label class="form-field"><span>Phone number</span><input name="phone" value="${escapeHtml(draft.phone)}" required /></label><label class="form-field"><span>Firm or chambers name <small>(if applicable)</small></span><input name="firmName" value="${escapeHtml(draft.firmName)}" placeholder="Independent practice" /></label><label class="form-field"><span>Firm registration number <small>(if applicable)</small></span><input name="firmRegistration" value="${escapeHtml(draft.firmRegistration)}" /></label><label class="form-field"><span>Bar or practising certificate number</span><input name="barNumber" value="${escapeHtml(draft.barNumber)}" required /></label><label class="form-field"><span>Practice address</span><input name="address" value="${escapeHtml(draft.address)}" required /></label></div><div class="verification-actions"><button class="button primary" type="submit">Continue to documents <span>Next</span></button></div></form>`;
  if (step === 2) content = `<form id="verification-step-2" class="verification-form"><div class="form-grid"><label class="form-field"><span>Identity document type</span><select name="idType" required><option value="">Select one</option><option ${draft.idType === "National ID" ? "selected" : ""}>National ID</option><option ${draft.idType === "Passport" ? "selected" : ""}>Passport</option><option ${draft.idType === "Driving licence" ? "selected" : ""}>Driving licence</option></select></label><label class="form-field"><span>Document number</span><input name="idNumber" value="${escapeHtml(draft.idNumber)}" required /></label><label class="form-field"><span>Country of issue</span><input name="country" value="${escapeHtml(draft.country || "Uganda")}" required /></label></div><label class="form-field"><span>ID card front</span><input name="personalDocument" type="file" accept="image/*,.pdf" required /><small class="subtle">Clear, full image of the front of your National ID. Up to 8 MB.</small></label><label class="form-field"><span>ID card back</span><input name="personalDocumentBack" type="file" accept="image/*,.pdf" required /><small class="subtle">Clear, full image of the back of your National ID. Up to 8 MB.</small></label><label class="form-field"><span>Legal practice certificate</span><input name="legalDocument" type="file" accept="image/*,.pdf" required /><small class="subtle">Practising certificate, bar certificate or equivalent credential.</small></label><div class="verification-actions"><button class="button secondary" type="button" data-action="verification-back">Back</button><button class="button primary" type="submit">Continue to declaration <span>Next</span></button></div></form>`;
  if (step === 3) content = `<form id="verification-step-3" class="verification-form"><div class="declaration-card"><div class="declaration-icon">OK</div><h4>Professional responsibility</h4><p>Confirm that your information is accurate, you are authorised to practise, and you will follow applicable law, professional rules, confidentiality duties and Legal Advisor's Terms and Conditions.</p><label class="consent-row"><input name="accurate" type="checkbox" required /><span>I confirm that my details and documents are true and belong to me.</span></label><label class="consent-row"><input name="professional" type="checkbox" required /><span>I agree to practise responsibly, protect client information and follow the Terms and Conditions.</span></label></div><div class="verification-actions"><button class="button secondary" type="button" data-action="verification-back">Back</button><button class="button primary" type="submit" ${state.kycSubmitting ? "disabled" : ""}>${state.kycSubmitting ? "Submitting securely..." : "Submit for review"}</button></div></form>`;
  return `<section class="panel verification-card"><div class="verification-intro"><div><p class="eyebrow">AI-LOS verification</p><h3>Become a verified Legal Advisor</h3><p class="panel-copy">A short, secure review helps clients know who they are speaking with. Your profile remains private until approval.</p></div><span class="status-pill">${labels[status]}</span></div>${stepper}<div class="verification-body"><p class="verification-counter">Step ${step} of 3</p>${content}</div>${testControl}</section>`;
}

function renderCases(cases) {
  if (!cases.length) return `<div class="empty-state">No matters match your current search.</div>`;
  return `<div class="case-list">${cases
    .map(
      (item) => `
        <article class="case-row ${item.id === state.selectedCaseId ? "active" : ""}" data-case-id="${escapeHtml(item.id)}">
          <div class="case-meta">
            <strong>Case ${escapeHtml(item.reference)}</strong>
            <span>${escapeHtml(item.title)}</span>
            <span class="subtle tiny">${escapeHtml(item.client?.name || "Unknown client")} Â· ${escapeHtml(item.category)}</span>
          </div>
          <div class="row-actions">
            <span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            <span class="subtle tiny">${escapeHtml(item.priority)}</span>
          </div>
        </article>
      `,
    )
    .join("")}</div>`;
}

function renderClients(clients) {
  if (!clients.length) return `<div class="empty-state">No clients match your current search.</div>`;
  return `<div class="client-list">${clients
    .map(
      (client) => `<article class="client-row"><div class="client-meta"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(client.contact)} Â· ${escapeHtml(client.segment)}</span><span class="subtle tiny">${escapeHtml(client.email)}</span></div></article>`,
    )
    .join("")}</div>`;
}

function renderUsers(users) {
  return `<div class="user-list">${users
    .map(
      (user) => `<article class="user-row"><div><strong>${escapeHtml(user.name)}</strong><p class="subtle tiny">${escapeHtml(user.email)}</p></div><span class="subtle tiny">${escapeHtml(formatDate(user.createdAt))}</span></article>`,
    )
    .join("")}</div>`;
}

function renderDocuments(documents) {
  return `<div class="document-list">${
    documents.length
      ? documents
          .map(
            (doc) => `
              <article class="document-row">
                <div>
                  <strong>${escapeHtml(doc.name)}</strong>
                  <p class="subtle tiny">${escapeHtml(doc.mimeType || "Unknown type")} Â· ${Math.max(1, Math.round((doc.size || 0) / 1024))} KB</p>
                </div>
                <div class="row-actions">
                  <span class="subtle tiny">${escapeHtml(formatDate(doc.uploadedAt))}</span>
                  <button class="button secondary button--small" data-action="download-document" data-document-id="${escapeHtml(doc.id)}">Download</button>
                  <button class="button danger button--small" data-action="delete-document" data-document-id="${escapeHtml(doc.id)}">Delete</button>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No documents uploaded yet.</div>'
  }</div>`;
}

function renderReferrals() {
  const referrals = state.bootstrap?.referrals || [];
  return `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Legal Advisor</p><h3>Client Referrals</h3></div><span class="status-pill online">${referrals.filter((r) => r.status === "pending").length} awaiting review</span></div>
    <div class="activity-list">${referrals.length ? referrals.map((ref) => `<article class="activity-row"><div><strong>${escapeHtml(ref.title)}</strong><p class="subtle tiny">${escapeHtml(ref.category)} Â· ${escapeHtml(ref.jurisdiction)} Â· ${escapeHtml(ref.risk)} risk</p><p>${escapeHtml(ref.brief?.summary || "No summary supplied.")}</p><p class="subtle tiny">Issues: ${escapeHtml((ref.brief?.potentialIssues || []).join(", "))}</p></div><div class="row-actions"><span class="badge ${escapeHtml(ref.status)}">${escapeHtml(ref.status)}</span>${ref.status === "pending" ? `<button class="button primary button--small" data-action="accept-referral" data-referral-id="${escapeHtml(ref.id)}">Accept</button><button class="button secondary button--small" data-action="request-referral-info" data-referral-id="${escapeHtml(ref.id)}">Ask for info</button><button class="button danger button--small" data-action="decline-referral" data-referral-id="${escapeHtml(ref.id)}">Decline</button>` : ref.caseId ? `<button class="button secondary button--small" data-open-referral-case="${escapeHtml(ref.caseId)}">Open matter</button>` : ""}</div></article>`).join("") : '<div class="empty-state">No Legal Advisor client referrals yet.</div>'}</div></section>`;
}

function renderAssistant(config) {
  const templates = state.bootstrap.templates || [];
  return `
    <section class="panel">
      <div class="panel-head"><div><p class="eyebrow">Workspace Assistant</p><h3>AI Legal Assistant</h3></div><span class="status-pill ${config.openAiConfigured ? "online" : ""}">${config.openAiConfigured ? "OpenAI Connected" : "Key Missing"}</span></div>
      <div class="assistant-actions"><p class="subtle tiny">Model: ${escapeHtml(config.model)}</p><button class="button ghost" data-action="generate-brief" ${state.briefing ? "disabled" : ""}>${state.briefing ? "Generating..." : "Generate Case Brief"}</button></div>
      <div class="draft-panel">
        <label class="form-field"><span>Draft Template</span><select id="template-select">${templates
          .map((template) => `<option value="${escapeHtml(template.key)}" ${template.key === state.selectedTemplateKey ? "selected" : ""}>${escapeHtml(template.label)}</option>`)
          .join("")}</select></label>
        <label class="form-field"><span>Additional Instructions</span><textarea id="template-instructions">${escapeHtml(state.templateInstructions)}</textarea></label>
        <button class="button secondary" data-action="generate-template" ${state.drafting ? "disabled" : ""}>${state.drafting ? "Drafting..." : "Generate Template Draft"}</button>
      </div>
      <div class="assistant-messages">${state.assistantMessages
        .map((message) => `<article class="message ${message.role}"><span class="message-meta">${escapeHtml(message.role)}</span><div>${escapeHtml(message.text).replaceAll("\n", "<br />")}</div></article>`)
        .join("")}</div>
      <div class="assistant-input-wrap">
        <textarea class="assistant-input" id="assistant-input">${escapeHtml(state.assistantDraft)}</textarea>
        <button class="button primary" data-action="ask-assistant" ${state.asking ? "disabled" : ""}>${state.asking ? "Thinking..." : "Ask"}</button>
      </div>
    </section>
  `;
}

function renderCaseDetail(selectedCase, tasks) {
  if (!selectedCase) return `<section class="panel"><div class="empty-state">Select a case to inspect its details.</div></section>`;
  const relatedTasks = tasks.filter((task) => task.caseId === selectedCase.id);
  return `
    <section class="panel">
      <div class="panel-head"><div><p class="eyebrow">Matter Detail</p><h3>${escapeHtml(selectedCase.reference)} Â· ${escapeHtml(selectedCase.title)}</h3></div><div class="row-actions"><span class="badge ${escapeHtml(selectedCase.status)}">${escapeHtml(selectedCase.status)}</span><button class="button secondary button--small" data-action="open-edit-case">Edit Case</button></div></div>
      <p class="panel-copy">${escapeHtml(selectedCase.summary)}</p>
      <div class="task-list"><div class="task-row"><strong>Client</strong><span>${escapeHtml(selectedCase.client?.name || "Unknown client")}</span></div><div class="task-row"><strong>Next Step</strong><span>${escapeHtml(selectedCase.nextStep)}</span></div><div class="task-row"><strong>Last Updated</strong><span>${escapeHtml(formatDate(selectedCase.updatedAt))}</span></div></div>
      <div>
        <div class="panel-head"><div><p class="eyebrow">Timeline</p><h4>Case History</h4></div></div>
        <form id="timeline-form" class="form-grid form-grid--timeline">
          <label class="form-field"><span>Date</span><input name="time" type="date" required /></label>
          <label class="form-field"><span>Event</span><input name="label" placeholder="Hearing scheduled" required /></label>
          <button class="button secondary" type="submit" ${state.savingTimeline ? "disabled" : ""}>${state.savingTimeline ? "Saving..." : "Add Entry"}</button>
        </form>
        <div class="timeline">${selectedCase.timeline
          .map((item) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(item.time)}</span><span>${escapeHtml(item.label)}</span><button class="button danger button--small" data-action="delete-timeline" data-timeline-id="${escapeHtml(item.id)}">Remove</button></div>`)
          .join("")}</div>
      </div>
      <div><div class="panel-head"><div><p class="eyebrow">Documents</p><h4>Uploaded Matter Files</h4></div><label class="button secondary file-button">${state.uploading ? "Uploading..." : "Upload Document"}<input id="document-upload" type="file" hidden ${state.uploading ? "disabled" : ""} /></label></div>${renderDocuments(selectedCase.documents || [])}</div>
      <div><p class="eyebrow">Tasks</p><div class="task-list">${relatedTasks
        .map((task) => `<div class="task-row"><span>${escapeHtml(task.title)}</span><span class="badge ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></div>`)
        .join("") || '<div class="empty-state">No tasks linked to this matter.</div>'}</div></div>
    </section>
  `;
}

function renderView() {
  if (state.view === "referrals") return renderReferrals();
  if (state.view === "verification") return renderKyc();
  if (state.view === "account") return renderAccount();
  if (state.view === "clients") {
    return `<section class="content-grid"><section class="panel"><div class="panel-head"><div><p class="eyebrow">Client Directory</p><h3>Active Clients</h3></div><button class="button secondary" data-action="open-new-client">+ New Client</button></div>${renderClients(filteredClients())}</section><section class="panel"><div class="panel-head"><div><p class="eyebrow">Workspace Users</p><h3>Team Access</h3></div><button class="button secondary" data-action="open-new-user">+ New User</button></div>${renderUsers(state.bootstrap.users || [])}</section></section>`;
  }
  if (state.view === "assistant") {
    return `<section class="content-grid">${renderAssistant(state.bootstrap.config)}${renderCaseDetail(getSelectedCase(), state.bootstrap.tasks)}</section>`;
  }
  if (state.view === "cases") {
    return `<section class="workspace-grid"><section class="panel"><div class="panel-head"><div><p class="eyebrow">Matter Tracking</p><h3>All Cases</h3></div><button class="button secondary" data-action="open-new-case">+ New Case</button></div>${renderCases(filteredCases())}</section>${renderCaseDetail(getSelectedCase(), state.bootstrap.tasks)}</section>`;
  }
  return `${renderStats(state.bootstrap.metrics)}${renderDiscoverability()}<section class="content-grid">${renderAssistant(state.bootstrap.config)}${renderActivity(state.bootstrap.activity)}</section><section class="workspace-grid"><section class="panel"><div class="panel-head"><div><p class="eyebrow">Matter Tracking</p><h3>Recent Cases</h3></div><button class="button secondary" data-action="open-new-case">+ New Case</button></div>${renderCases(filteredCases())}</section>${renderCaseDetail(getSelectedCase(), state.bootstrap.tasks)}</section>`;
}

function renderAccount() {
  const user = state.bootstrap.session.user;
  const profile = state.bootstrap.lawyerProfile || {};
  return `<section class="account-page"><section class="panel account-hero"><div><p class="eyebrow">Lawyer account</p><h3>${escapeHtml(user.name)}</h3><p class="panel-copy">Manage your profile, workspace preferences and account access.</p></div><span class="status-pill online">${escapeHtml(user.role === "admin" ? "Administrator" : "Lawyer")}</span></section><section class="account-grid"><section class="panel"><p class="eyebrow">Personal details</p><dl class="account-details"><div><dt>Name</dt><dd>${escapeHtml(user.name)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(user.email)}</dd></div><div><dt>Consultation fee</dt><dd>UGX ${Number(profile.consultation_fee || 0).toLocaleString()}</dd></div><div><dt>Verification</dt><dd>${escapeHtml(profile.kycStatus || "Not submitted")}</dd></div></dl></section><section class="panel"><p class="eyebrow">Preferences</p><h4>Appearance</h4><p class="panel-copy">Choose how your lawyer workspace looks on this device.</p><button class="button secondary" data-action="toggle-theme">${document.documentElement.classList.contains("dark") ? "Switch to light theme" : "Switch to dark theme"}</button><hr><button class="button danger" data-action="logout">Sign out</button></section></section></section>`;
}

function renderModal() {
  const selectedCase = getSelectedCase();
  if (!state.modal) return "";
  if (state.modal === "new-user") {
    return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><p class="eyebrow">Team Access</p><h3>Add a user</h3></div><button class="button secondary" data-action="close-modal">Close</button></div><form id="new-user-form"><label class="form-field"><span>Name</span><input name="name" required /></label><label class="form-field"><span>Email</span><input name="email" type="email" required /></label><label class="form-field"><span>Password</span><input name="password" type="password" required /></label><div class="assistant-actions"><button class="button primary" type="submit" ${state.savingUser ? "disabled" : ""}>${state.savingUser ? "Saving..." : "Create User"}</button></div></form></div></div>`;
  }
  if (state.modal === "new-client") {
    return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><p class="eyebrow">Client Directory</p><h3>Add a client</h3></div><button class="button secondary" data-action="close-modal">Close</button></div><form id="new-client-form"><div class="form-grid"><label class="form-field"><span>Name</span><input name="name" required /></label><label class="form-field"><span>Email</span><input name="email" type="email" /></label><label class="form-field"><span>Phone</span><input name="contact" /></label><label class="form-field"><span>Segment</span><input name="segment" value="Direct" /></label></div><div class="assistant-actions"><button class="button primary" type="submit" ${state.savingClient ? "disabled" : ""}>${state.savingClient ? "Saving..." : "Create Client"}</button></div></form></div></div>`;
  }
  if (state.modal === "edit-case" && selectedCase) {
    return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><p class="eyebrow">Edit Matter</p><h3>${escapeHtml(selectedCase.reference)} Â· ${escapeHtml(selectedCase.title)}</h3></div><button class="button secondary" data-action="close-modal">Close</button></div><form id="edit-case-form"><div class="form-grid"><label class="form-field"><span>Title</span><input name="title" value="${escapeHtml(selectedCase.title)}" required /></label><label class="form-field"><span>Client</span><select name="clientId">${state.bootstrap.clients
      .map((client) => `<option value="${escapeHtml(client.id)}" ${client.id === selectedCase.clientId ? "selected" : ""}>${escapeHtml(client.name)}</option>`)
      .join("")}</select></label><label class="form-field"><span>Category</span><input name="category" value="${escapeHtml(selectedCase.category)}" required /></label><label class="form-field"><span>Status</span><select name="status">${["pending", "review", "active", "closed"]
      .map((status) => `<option ${status === selectedCase.status ? "selected" : ""}>${status}</option>`)
      .join("")}</select></label><label class="form-field"><span>Priority</span><select name="priority">${["High", "Medium", "Low"]
      .map((priority) => `<option ${priority === selectedCase.priority ? "selected" : ""}>${priority}</option>`)
      .join("")}</select></label><label class="form-field"><span>Next Step</span><input name="nextStep" value="${escapeHtml(selectedCase.nextStep)}" required /></label></div><label class="form-field"><span>Summary</span><textarea name="summary" required>${escapeHtml(selectedCase.summary)}</textarea></label><div class="assistant-actions"><button class="button primary" type="submit" ${state.savingCaseEdit ? "disabled" : ""}>${state.savingCaseEdit ? "Saving..." : "Save Changes"}</button></div></form></div></div>`;
  }
  return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><p class="eyebrow">New Matter</p><h3>Create a case</h3></div><button class="button secondary" data-action="close-modal">Close</button></div><form id="new-case-form"><div class="form-grid"><label class="form-field"><span>Title</span><input name="title" required /></label><label class="form-field"><span>Client</span><select name="clientId">${state.bootstrap.clients
    .map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`)
    .join("")}</select></label><label class="form-field"><span>Category</span><input name="category" required /></label><label class="form-field"><span>Priority</span><select name="priority"><option>High</option><option selected>Medium</option><option>Low</option></select></label></div><label class="form-field"><span>Summary</span><textarea name="summary" required></textarea></label><div class="assistant-actions"><button class="button primary" type="submit" ${state.savingCase ? "disabled" : ""}>${state.savingCase ? "Saving..." : "Create Matter"}</button></div></form></div></div>`;
}

function renderToasts() {
  if (!state.toasts.length) return "";
  return `<div class="toast-wrap">${state.toasts
    .map((toast) => `<div class="toast"><strong>${toast.tone === "error" ? "Error" : "Notice"}</strong><p class="subtle">${escapeHtml(toast.message)}</p></div>`)
    .join("")}</div>`;
}

function renderShell() {
  const viewCopy = { dashboard: "Live operational overview", referrals: "Legal Advisor client-to-lawyer handoffs", clients: "Client and team workspace", cases: "Matter tracking workspace", assistant: "AI drafting and review workspace", verification: "Professional identity and practice verification", account: "Your profile and workspace preferences" };
  return `<div class="app-shell"><aside class="sidebar"><div class="brand"><p class="eyebrow">Legal Operating System</p><h1>AI-LOS</h1></div><div class="nav-list">${Object.keys(icons)
    .map((key) => `<button class="nav-item ${state.view === key ? "active" : ""}" data-view="${key}"><span class="nav-icon">${icons[key]}</span><span>${escapeHtml(key.charAt(0).toUpperCase() + key.slice(1))}</span></button>`)
    .join("")}</div><div class="sidebar-foot"><p class="eyebrow">Signed In</p><strong>${escapeHtml(state.bootstrap.session.user.name)}</strong><span class="subtle">${escapeHtml(state.bootstrap.session.user.email)}</span><button class="button secondary" data-action="logout">Sign Out</button></div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">Overview</p><h2>${escapeHtml(state.view.charAt(0).toUpperCase() + state.view.slice(1))}</h2><p class="subtle">${escapeHtml(viewCopy[state.view])}</p></div><div class="toolbar"><label class="search-bar"><span>Search</span><input id="workspace-search" value="${escapeHtml(state.search)}" /></label><button class="button primary" data-action="open-new-case">+ New Case</button></div></header>${renderView()}</main></div>${renderModal()}${renderToasts()}`;
}

function render() {
  if (state.loading) {
    app.innerHTML = `<div class="boot-screen"><div class="boot-card"><p class="eyebrow">AI-LOS</p><h1>Loading legal workspace...</h1></div></div>`;
    return;
  }
  app.innerHTML = `${!state.authenticated || !state.bootstrap ? renderLogin() : renderShell()}`;
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-view], [data-case-id], [data-open-referral-case]");
  if (!target) return;
  const action = target.dataset.action;
  if (target.dataset.view) {
    state.view = target.dataset.view;
    render();
    return;
  }
  if (target.dataset.caseId) {
    state.selectedCaseId = target.dataset.caseId;
    render();
    return;
  }
  if (action === "open-new-case") state.modal = "new-case";
  else if (action === "open-edit-case") state.modal = "edit-case";
  else if (action === "open-new-user") state.modal = "new-user";
  else if (action === "open-new-client") state.modal = "new-client";
  else if (action === "close-modal") state.modal = null;
  else if (action === "logout") return logout();
  else if (action === "toggle-theme") { document.documentElement.classList.toggle("dark"); localStorage.setItem("legal-theme", document.documentElement.classList.contains("dark") ? "dark" : "light"); return render(); }
  else if (action === "ask-assistant") return askAssistant();
  else if (action === "generate-brief") return generateBrief();
  else if (action === "generate-template") return generateTemplateDraft();
  else if (action === "delete-timeline") return deleteTimelineEntry(target.dataset.timelineId);
  else if (action === "download-document") return downloadDocument(target.dataset.documentId);
  else if (action === "delete-document") return deleteDocument(target.dataset.documentId);
  else if (action === "accept-referral") return updateReferral(target.dataset.referralId, "accept");
  else if (action === "decline-referral") return updateReferral(target.dataset.referralId, "decline");
  else if (action === "request-referral-info") return updateReferral(target.dataset.referralId, "request_information");
  else if (action === "toggle-discoverability") return updateDiscoverability(target.dataset.discoverable === "true");
  else if (action === "enable-test-discoverability") return enableTestDiscoverability();
  else if (action === "verification-back") { state.verificationStep = Math.max(1, (state.verificationStep || 1) - 1); return render(); }
  else if (target.dataset.openReferralCase) { state.selectedCaseId = target.dataset.openReferralCase; state.view = "cases"; return render(); }
  render();
});

app.addEventListener("input", (event) => {
  if (event.target.id === "workspace-search") {
    state.search = event.target.value;
    render();
  } else if (event.target.id === "assistant-input") {
    state.assistantDraft = event.target.value;
  } else if (event.target.id === "template-instructions") {
    state.templateInstructions = event.target.value;
  } else if (event.target.id === "template-select") {
    state.selectedTemplateKey = event.target.value;
  }
});

app.addEventListener("change", (event) => {
  if (event.target.id === "document-upload" && event.target.files?.[0]) {
    uploadDocument(event.target.files[0]);
    event.target.value = "";
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "login-form") return login(event.target);
  if (event.target.id === "new-case-form") return submitNewCase(event.target);
  if (event.target.id === "edit-case-form") return updateCase(event.target);
  if (event.target.id === "new-user-form") return createUser(event.target);
  if (event.target.id === "new-client-form") return createClient(event.target);
  if (event.target.id === "timeline-form") return addTimelineEntry(event.target);
  if (event.target.id?.startsWith("verification-step-")) return submitVerification(event.target);
});

bootstrapSession();


