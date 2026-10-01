import { createHash, randomBytes } from "node:crypto";

const enc = encodeURIComponent;
const one = (rows) => Array.isArray(rows) ? rows[0] || null : rows;

export class PostgresStore {
  constructor({ url, serviceKey, anonKey }) {
    this.url = String(url || "").replace(/\/$/, "");
    this.serviceKey = serviceKey;
    this.anonKey = anonKey;
  }

  get configured() { return Boolean(this.url && this.serviceKey && this.anonKey); }

  async rest(path, { method = "GET", body, headers = {}, token } = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${token || this.serviceKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(payload?.message || payload?.hint || `Database request failed (${response.status}).`);
    return payload;
  }

  rpc(name, body) { return this.rest(`rpc/${name}`, { method: "POST", body }); }

  async rateLimit(key, limit, seconds) {
    const row = one(await this.rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: seconds }));
    return { allowed: row?.allowed !== false, remaining: Number(row?.remaining || 0), resetAt: row?.reset_at };
  }

  async profile(id) {
    return one(await this.rest(`profiles?id=eq.${enc(id)}&select=id,email,name,role&limit=1`));
  }

  async workspace(user) {
    let membership = one(await this.rest(`workspace_members?user_id=eq.${enc(user.id)}&select=workspace_id,role&limit=1`));
    if (!membership && user.role !== "civilian") {
      const workspaceId = await this.rpc("ensure_lawyer_workspace", { p_user_id: user.id, p_name: `${user.name}'s practice` });
      membership = { workspace_id: workspaceId, role: "owner" };
    }
    return membership;
  }

  async bootstrap(user) {
    const membership = await this.workspace(user);
    if (!membership) return { user, users: [user], clients: [], cases: [], tasks: [], activity: [], metrics: {}, templates: [], referrals: [] };
    const wid = membership.workspace_id;
    const [clients, cases, timeline, tasks, activity, documents, members, referrals, lawyerProfile] = await Promise.all([
      this.rest(`clients?workspace_id=eq.${enc(wid)}&select=id,name,contact,email,segment&order=name.asc`),
      this.rest(`cases?workspace_id=eq.${enc(wid)}&select=*&order=updated_at.desc`),
      this.rest(`case_timeline?select=id,case_id,event_date,label,sort_order,created_at,cases!inner(workspace_id)&cases.workspace_id=eq.${enc(wid)}&order=sort_order.asc,created_at.asc`),
      this.rest(`tasks?workspace_id=eq.${enc(wid)}&select=*&order=updated_at.desc`),
      this.rest(`activity?workspace_id=eq.${enc(wid)}&select=*&order=created_at.desc&limit=100`),
      this.rest(`documents?workspace_id=eq.${enc(wid)}&select=*&order=uploaded_at.desc`),
      this.rest(`workspace_members?workspace_id=eq.${enc(wid)}&select=user_id,role`),
      this.rest(`referrals?lawyer_user_id=eq.${enc(user.id)}&select=*&order=created_at.desc`),
      this.rest(`lawyer_profiles?user_id=eq.${enc(user.id)}&select=*&limit=1`),
    ]);
    const ids = members.map((m) => m.user_id);
    const users = ids.length ? await this.rest(`profiles?id=in.(${ids.map(enc).join(",")})&select=id,email,name,role`) : [user];
    const timelinesByCase = Map.groupBy(timeline, (item) => item.case_id);
    const documentsByCase = Map.groupBy(documents, (item) => item.case_id);
    const normalizedCases = cases.map((item) => ({
      id: item.id, reference: item.reference, title: item.title, clientId: item.client_id,
      category: item.category, status: item.status, priority: item.priority, summary: item.summary,
      nextStep: item.next_step, updatedAt: item.updated_at,
      timeline: (timelinesByCase.get(item.id) || []).map((event) => ({ id: event.id, time: event.event_date, label: event.label })),
      documents: (documentsByCase.get(item.id) || []).map((doc) => this.document(doc)),
    }));
    const normalizedTasks = tasks.map((item) => ({ id: item.id, title: item.title, caseId: item.case_id, status: item.status }));
    return {
      user, users, clients, cases: normalizedCases, tasks: normalizedTasks,
      activity: activity.map((item) => ({ id: item.id, time: item.created_at, text: item.body })),
      documents: documents.map((item) => this.document(item)),
      metrics: this.metrics(normalizedCases, clients, normalizedTasks, documents),
      referrals: referrals.map((item) => ({ id: item.id, matterId: item.matter_id, caseId: item.case_id, status: item.status, matchScore: item.match_score, brief: item.brief })),
      workspace: { id: wid, role: membership.role },
      lawyerProfile: lawyerProfile[0] ? { ...lawyerProfile[0], discoverable: Boolean(lawyerProfile[0].discoverable), verified: Boolean(lawyerProfile[0].verified), kycStatus: lawyerProfile[0].kyc_status || "not_submitted" } : null,
    };
  }

  async updateDiscoverability(user, discoverable) {
    const profile = one(await this.rest(`lawyer_profiles?user_id=eq.${enc(user.id)}&select=verified,kyc_status&limit=1`));
    if (!profile || (discoverable && (!profile.verified || profile.kyc_status !== "approved"))) return null;
    const rows = await this.rest(`lawyer_profiles?user_id=eq.${enc(user.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { discoverable: Boolean(discoverable) } });
    return one(rows);
  }

  async submitKyc(user, details) {
    const rows = await this.rest(`lawyer_profiles?user_id=eq.${enc(user.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { kyc_status: "submitted", kyc_full_name: details.fullName, kyc_firm_name: details.firmName, kyc_firm_registration: details.firmRegistration, kyc_bar_number: details.barNumber, kyc_phone: details.phone, kyc_address: details.address, kyc_id_type: details.idType, kyc_id_number: details.idNumber, kyc_country: details.country, kyc_document_name: details.documentName, kyc_document_path: details.documentPath, kyc_document_back_name: details.documentBackName, kyc_document_back_path: details.documentBackPath, kyc_legal_document_name: details.legalDocumentName, kyc_legal_document_path: details.legalDocumentPath, kyc_submitted_at: new Date().toISOString(), kyc_rejection_reason: null, discoverable: false },
    });
    return one(rows);
  }

  async enableTestDiscoverability(user) {
    const rows = await this.rest(`lawyer_profiles?user_id=eq.${enc(user.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { verified: true, kyc_status: "approved", discoverable: true, kyc_reviewed_at: new Date().toISOString() } });
    return one(rows);
  }

  metrics(cases, clients, tasks, documents) {
    return {
      totalCases: cases.length, activeCases: cases.filter((x) => x.status === "active").length,
      pendingCases: cases.filter((x) => x.status === "pending").length, clients: clients.length,
      openTasks: tasks.filter((x) => x.status !== "done").length, documents: documents.length,
    };
  }

  document(item) {
    return { id: item.id, caseId: item.case_id, name: item.name, mimeType: item.mime_type, size: Number(item.size), storedPath: `supabase://${item.object_name}`, extractedText: item.extracted_text, uploadedAt: item.uploaded_at };
  }

  async addActivity(workspaceId, userId, body) {
    await this.rest("activity", { method: "POST", headers: { Prefer: "return=minimal" }, body: { workspace_id: workspaceId, actor_user_id: userId, body } });
  }

  async createClient(user, input) {
    const membership = await this.workspace(user);
    const rows = await this.rest("clients", { method: "POST", headers: { Prefer: "return=representation" }, body: { workspace_id: membership.workspace_id, profile_id: null, name: input.name, contact: input.contact || null, email: input.email || null, segment: input.segment || "Direct" } });
    await this.addActivity(membership.workspace_id, user.id, `Client ${input.name} created.`);
    return one(rows);
  }

  async addMember(owner, memberId) {
    const membership = await this.workspace(owner);
    await this.rest("workspace_members", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { workspace_id: membership.workspace_id, user_id: memberId, role: "lawyer" } });
    return membership.workspace_id;
  }

  async createCase(user, input) {
    const membership = await this.workspace(user);
    return this.rpc("create_case_bundle", { p_workspace_id: membership.workspace_id, p_client_id: input.clientId, p_title: input.title, p_category: input.category, p_priority: input.priority, p_summary: input.summary, p_actor: user.id });
  }

  async updateCase(user, id, changes) {
    const membership = await this.workspace(user);
    const rows = await this.rest(`cases?id=eq.${enc(id)}&workspace_id=eq.${enc(membership.workspace_id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { title: changes.title, client_id: changes.clientId, category: changes.category, status: changes.status, priority: changes.priority, summary: changes.summary, next_step: changes.nextStep, updated_at: new Date().toISOString() } });
    return one(rows);
  }

  async createTimeline(user, caseId, { time, label }) {
    const membership = await this.workspace(user);
    const cases = await this.rest(`cases?id=eq.${enc(caseId)}&workspace_id=eq.${enc(membership.workspace_id)}&select=id&limit=1`);
    if (!cases.length) return null;
    await this.rest("case_timeline", { method: "POST", headers: { Prefer: "return=minimal" }, body: { case_id: caseId, event_date: time, label } });
    return true;
  }

  async deleteTimeline(user, caseId, timelineId) {
    const membership = await this.workspace(user);
    const cases = await this.rest(`cases?id=eq.${enc(caseId)}&workspace_id=eq.${enc(membership.workspace_id)}&select=id&limit=1`);
    if (!cases.length) return false;
    await this.rest(`case_timeline?id=eq.${enc(timelineId)}&case_id=eq.${enc(caseId)}`, { method: "DELETE" });
    return true;
  }

  async case(user, id) {
    const membership = await this.workspace(user);
    return one(await this.rest(`cases?id=eq.${enc(id)}&workspace_id=eq.${enc(membership.workspace_id)}&select=*&limit=1`));
  }

  async documents(user, caseId) {
    const membership = await this.workspace(user);
    return (await this.rest(`documents?case_id=eq.${enc(caseId)}&workspace_id=eq.${enc(membership.workspace_id)}&select=*&order=uploaded_at.desc`)).map((item) => this.document(item));
  }

  async saveDocument(user, caseId, input) {
    const membership = await this.workspace(user);
    const id = crypto.randomUUID();
    const objectName = `${membership.workspace_id}/${caseId}/${id}-${input.safeName}`;
    const rows = await this.rest("documents", { method: "POST", headers: { Prefer: "return=representation" }, body: { id, workspace_id: membership.workspace_id, case_id: caseId, name: input.name, mime_type: input.mimeType, size: input.size, object_name: objectName, extracted_text: input.extractedText, uploaded_by: user.id } });
    return { row: one(rows), objectName };
  }

  async documentById(user, id) {
    const membership = await this.workspace(user);
    return one(await this.rest(`documents?id=eq.${enc(id)}&workspace_id=eq.${enc(membership.workspace_id)}&select=*&limit=1`));
  }

  async deleteDocument(user, id) {
    const row = await this.documentById(user, id);
    if (!row) return null;
    await this.rest(`documents?id=eq.${enc(id)}`, { method: "DELETE" });
    return row;
  }

  async createMatter(message, analysis, ownerUserId = null) {
    const guestToken = this.guestToken();
    const rows = await this.rest("legal_matters", { method: "POST", headers: { Prefer: "return=representation" }, body: { owner_user_id: ownerUserId, title: `${analysis.category} legal question`, jurisdiction: "Uganda", category: analysis.category, facts: [message], issues: analysis.issues, risk: analysis.risk, urgency: analysis.urgency, complexity: analysis.complexity, confidence: "LOW", lawyer_needed: analysis.lawyerNeeded, status: "AI guidance", guest_token_hash: this.guestHash(guestToken) } });
    const matter = one(rows);
    return { matter, guestToken };
  }

  async matter(id, guestToken) {
    const matter = one(await this.rest(`legal_matters?id=eq.${enc(id)}&select=*&limit=1`));
    if (!matter || !guestToken || matter.guest_token_hash !== this.guestHash(guestToken)) return null;
    return matter;
  }

  async addMessage(matterId, senderType, body, metadata = {}) {
    const rows = await this.rest("conversation_messages", { method: "POST", headers: { Prefer: "return=representation" }, body: { matter_id: matterId, sender_type: senderType, body, metadata } });
    return one(rows);
  }

  async messages(matterId) {
    return this.rest(`conversation_messages?matter_id=eq.${enc(matterId)}&select=id,sender_type,body,metadata,created_at&order=created_at.asc`);
  }

  async updateMatter(id, changes) {
    return one(await this.rest(`legal_matters?id=eq.${enc(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { ...changes, updated_at: new Date().toISOString() } }));
  }

  async legalSources(category) {
    return this.rest(`legal_sources?or=(category.eq.${enc(category)},category.eq.General)&select=id,title,url,authority,verified_at&order=category.desc`);
  }

  async lawyerMatches(category) {
    // Discovery is controlled by the lawyer's explicit visibility choice.
    const profiles = await this.rest("lawyer_profiles?verified=eq.true&kyc_status=eq.approved&discoverable=eq.true&select=*&limit=100");
    const ranked = profiles.map((profile) => ({ profile, score: (profile.practice_areas || []).some((area) => String(area).toLowerCase() === String(category).toLowerCase()) ? 95 : 60 })).sort((a, b) => b.score - a.score).slice(0, 12);
    const ids = ranked.map((x) => x.profile.user_id);
    const users = ids.length ? await this.rest(`profiles?id=in.(${ids.map(enc).join(",")})&select=id,name,email`) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return ranked.map(({ profile, score }) => ({ id: profile.user_id, name: byId.get(profile.user_id)?.name || "Verified lawyer", email: byId.get(profile.user_id)?.email, practiceAreas: profile.practice_areas, jurisdictions: profile.jurisdictions, location: profile.location, yearsExperience: profile.years_experience, availability: profile.availability, consultationFee: profile.consultation_fee, languages: profile.languages, verified: profile.verified, rating: Number(profile.rating), workload: profile.workload, bio: profile.bio, matchScore: score }));
  }

  guestHash(token) { return createHash("sha256").update(token).digest("hex"); }
  guestToken() { return randomBytes(32).toString("base64url"); }
}
