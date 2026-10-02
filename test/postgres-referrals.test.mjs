import test from "node:test";
import assert from "node:assert/strict";
import { PostgresStore } from "../lib/postgres-store.mjs";

test("consultation is assigned to the selected lawyer workspace and includes consented files", async () => {
  const calls = [];
  let createdReferral;
  const store = new PostgresStore({ url: "https://example.supabase.co", serviceKey: "service", anonKey: "anon" });
  store.rest = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.startsWith("workspace_members?")) return [{ workspace_id: "workspace-lawyer-1" }];
    if (path.startsWith("referrals?") && options.method !== "POST") return createdReferral ? [createdReferral] : [];
    if (path.startsWith("clients?") && options.method !== "POST") return [];
    if (path === "clients") return [{ id: "client-1" }];
    if (path === "cases") return [{ id: "case-1", reference: "LA-TEST" }];
    if (path === "referrals") { createdReferral = { id: "referral-1", case_id: "case-1", status: "pending", ...options.body }; return [createdReferral]; }
    return [];
  };

  const input = {
    matter: { id: "matter-1", title: "Unpaid salary", category: "Employment", risk: "MEDIUM" },
    lawyer: { id: "lawyer-selected" },
    client: { name: "Civilian", email: "civilian@example.test", phone: "+256700000000" },
    matchScore: 95,
    brief: { summary: "Wages were not paid." },
    attachments: [{ id: "file-1", name: "contract.pdf", mimeType: "application/pdf", size: 12, objectName: "advisor/matter-1/file-1-contract.pdf" }],
  };

  const result = await store.createReferralBundle(input);
  assert.deepEqual(result, { id: "referral-1", caseId: "case-1", status: "pending" });
  assert.equal(calls.find((call) => call.path === "cases").body.workspace_id, "workspace-lawyer-1");
  assert.equal(calls.find((call) => call.path === "referrals").body.lawyer_user_id, "lawyer-selected");
  assert.equal(calls.find((call) => call.path === "documents").body.case_id, "case-1");
  assert.equal(calls.find((call) => call.path === "referrals").body.brief.attachments[0].id, "file-1");

  const repeated = await store.createReferralBundle(input);
  assert.deepEqual(repeated, result);
  assert.equal(calls.filter((call) => call.path === "cases").length, 1);
});
