import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 4193;
const base = `http://127.0.0.1:${port}`;
let server;
let dataDir;

async function json(url, options = {}) {
  const response = await fetch(base + url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test.before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "dotti-e2e-"));
  server = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), AI_LOS_DATA_DIR: dataDir, AI_LOS_SEED_DEMO: "true", AI_LOS_ADMIN_EMAIL: "admin@example.test", AI_LOS_ADMIN_PASSWORD: "test-password-123" }, stdio: "ignore" });
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(base + "/")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start.");
});

test.after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
});

test("employment intake flows through consent, matching and LOS acceptance", async () => {
  const intake = await json("/api/dotti/matters", { method: "POST", body: JSON.stringify({ message: "My employer fired me yesterday and hasn't paid me for two months." }) });
  assert.equal(intake.matter.jurisdiction, "Uganda");
  assert.equal(intake.matter.category, "Employment");
  assert.match(intake.messages[1].body, /written termination letter/i);
  const headers = { "X-Dotti-Token": intake.guestToken };
  const analysis = await json(`/api/dotti/matters/${intake.matter.id}/messages`, { method: "POST", headers, body: JSON.stringify({ message: "I worked for three years, have a contract, and received no notice." }) });
  assert.equal(analysis.matter.risk, "MEDIUM");
  assert.ok(analysis.sources.some((source) => /Employment Act/.test(source.title)));
  const matches = await json(`/api/dotti/matters/${intake.matter.id}/lawyers`, { headers });
  assert.ok(matches.lawyers[0].practiceAreas.includes("Employment"));
  const referral = await json(`/api/dotti/matters/${intake.matter.id}/referrals`, { method: "POST", headers, body: JSON.stringify({ consent: true, lawyerUserId: matches.lawyers[0].id, name: "Test Client", email: "client@example.test", phone: "+256700000000" }) });
  assert.equal(referral.referral.status, "pending");
  const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@example.test", password: "test-password-123" }) });
  const workspace = await json(`/api/referrals/${referral.referral.id}`, { method: "PATCH", headers: { "X-Session-Token": login.session.token }, body: JSON.stringify({ action: "accept" }) });
  assert.equal(workspace.referrals.find((item) => item.id === referral.referral.id).status, "accepted");
  assert.equal(workspace.cases.find((item) => item.id === referral.referral.caseId).status, "active");
});

test("referral cannot be created without explicit consent", async () => {
  const intake = await json("/api/dotti/matters", { method: "POST", body: JSON.stringify({ message: "My landlord wants to evict me." }) });
  const headers = { "Content-Type": "application/json", "X-Dotti-Token": intake.guestToken };
  const matches = await json(`/api/dotti/matters/${intake.matter.id}/lawyers`, { headers });
  const response = await fetch(`${base}/api/dotti/matters/${intake.matter.id}/referrals`, { method: "POST", headers, body: JSON.stringify({ consent: false, lawyerUserId: matches.lawyers[0].id }) });
  assert.equal(response.status, 400);
});

test("role signup routes civilians and lawyers to corresponding platforms", async () => {
  const suffix = Date.now();
  const civilian = await json("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Civilian User", email: `civilian-${suffix}@example.test`, password: "secure-pass-123", role: "civilian" }) });
  assert.equal(civilian.session.user.role, "civilian");
  assert.equal(civilian.redirect, "/");
  const denied = await fetch(base + "/api/bootstrap", { headers: { "X-Session-Token": civilian.session.token } });
  assert.equal(denied.status, 403);
  const lawyer = await json("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Lawyer User", email: `lawyer-${suffix}@example.test`, password: "secure-pass-123", role: "lawyer", practiceArea: "Employment", location: "Kampala" }) });
  assert.equal(lawyer.session.user.role, "lawyer");
  assert.equal(lawyer.redirect, "/lawyer");
});
