import test from "node:test";
import assert from "node:assert/strict";
import { ensureDocumentFixture } from "../integrations/directus/ensure-document.js";
import { fixtureDocument } from "../integrations/directus/inspect-document.js";
function fakeLab({
  existing = false,
  missingDocument = false,
  ignoreWrites = false,
  loseDocumentResponse = false
} = {}) {
  const state = {
    collections: existing ? [{ collection: "revokx_documents" }] : [],
    documentFields: existing ? [
      {
        collection: "revokx_documents",
        field: "id",
        type: "integer",
        schema: { is_primary_key: true, has_auto_increment: true }
      },
      {
        collection: "revokx_documents",
        field: "title",
        type: "string",
        schema: {}
      },
      {
        collection: "revokx_documents",
        field: "content",
        type: "text",
        schema: {}
      }
    ] : [],
    documents: existing && !missingDocument ? [{ ...fixtureDocument }] : []
  };
  const writes = [];
  const admin = {
    async readSetupResource(resource) {
      return { status: 200, body: { data: structuredClone(state[resource]) } };
    },
    async createSetupResource(resource, body) {
      writes.push(resource);
      if (!ignoreWrites) {
        if (resource === "collections") {
          assert.equal(body.collection, "revokx_documents");
          state.collections = [{ collection: body.collection }];
          state.documentFields = body.fields.map((field) => ({
            ...structuredClone(field),
            collection: body.collection
          }));
        } else if (resource === "documents") {
          assert.equal(state.collections.length, 1);
          state.documents = [structuredClone(body)];
          if (loseDocumentResponse) {
            throw new Error("Synthetic lost response");
          }
        } else {
          assert.fail("Unexpected write resource");
        }
      }
      return { status: 200, body: { data: {} } };
    }
  };
  return { state, writes, admin };
}
test("document setup creates missing fixtures and reuses them on rerun", async () => {
  const lab = fakeLab();
  const first = await ensureDocumentFixture(lab.admin);
  assert.equal(first.status, "MATCH");
  assert.deepEqual(lab.writes, ["collections", "documents"]);
  assert.deepEqual(lab.state.documents, [{ ...fixtureDocument }]);
  const second = await ensureDocumentFixture(lab.admin);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(second.attempted, []);
  assert.deepEqual(lab.writes, ["collections", "documents"]);
});
test("document setup reuses an existing fixture without writes", async () => {
  const lab = fakeLab({ existing: true });
  const result = await ensureDocumentFixture(lab.admin);
  assert.equal(result.status, "MATCH");
  assert.deepEqual(lab.writes, []);
});
test("document setup creates only the missing record", async () => {
  const lab = fakeLab({ existing: true, missingDocument: true });
  const result = await ensureDocumentFixture(lab.admin);
  assert.equal(result.status, "MATCH");
  assert.deepEqual(lab.writes, ["documents"]);
});
test("document setup stops on existing content conflict", async () => {
  const lab = fakeLab({ existing: true });
  lab.state.documents[0].content = "Different content";
  const result = await ensureDocumentFixture(lab.admin);
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(lab.writes, []);
  assert.equal(lab.state.documents[0].content, "Different content");
});
test("document setup does not interpret failed inspection as absence", async () => {
  const lab = fakeLab();
  lab.admin.readSetupResource = async () => ({
    status: 403,
    body: { errors: [{ message: "Denied" }] }
  });
  const result = await ensureDocumentFixture(lab.admin);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.deepEqual(lab.writes, []);
});
test("successful create response without persisted state cannot pass", async () => {
  const lab = fakeLab({ ignoreWrites: true });
  const result = await ensureDocumentFixture(lab.admin);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.reason, "CREATED_FIXTURE_NOT_OBSERVED");
  assert.deepEqual(lab.writes, ["collections"]);
});
test("lost write response remains inconclusive and a rerun reads existing state", async () => {
  const lab = fakeLab({
    existing: true,
    missingDocument: true,
    loseDocumentResponse: true
  });
  const first = await ensureDocumentFixture(lab.admin);
  assert.equal(first.status, "INCONCLUSIVE");
  assert.equal(first.stage, "create-document");
  assert.deepEqual(first.attempted, ["document"]);
  const second = await ensureDocumentFixture(lab.admin);
  assert.equal(second.status, "MATCH");
  assert.deepEqual(lab.writes, ["documents"]);
});