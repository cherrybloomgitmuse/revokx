import test from "node:test";
import assert from "node:assert/strict";
import {
  fixtureDocument,
  inspectDocumentFixture
} from "../integrations/directus/inspect-document.js";
function makeFixture() {
  return {
    collections: [{ collection: "revokx_documents" }],
    documentFields: [
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
        schema: { is_primary_key: false }
      },
      {
        collection: "revokx_documents",
        field: "content",
        type: "text",
        schema: { is_primary_key: false }
      }
    ],
    documents: [{ ...fixtureDocument }]
  };
}
function fakeAdmin(fixture, overrides = {}) {
  return {
    async readSetupResource(resource, query) {
      if (resource === "documents") {
        assert.equal(query.fields, "id,title,content");
        assert.deepEqual(JSON.parse(query.filter), { id: { _eq: 1 } });
        assert.equal(query.limit, "2");
      }
      return overrides[resource] ?? {
        status: 200,
        body: { data: fixture[resource] }
      };
    },
    createSetupResource() {
      assert.fail("Inspection must never create resources");
    }
  };
}
test("document inspection accepts matching fixtures without mutation", async () => {
  const fixture = makeFixture();
  const before = structuredClone(fixture);
  const result = await inspectDocumentFixture(fakeAdmin(fixture));
  assert.equal(result.status, "MATCH");
  assert.deepEqual(fixture, before);
});
test("document inspection distinguishes missing collection and record", async () => {
  const absentCollection = makeFixture();
  absentCollection.collections = [];
  assert.deepEqual(await inspectDocumentFixture(fakeAdmin(absentCollection)), {
    status: "MISSING",
    reason: "COLLECTION_MISSING"
  });
  const absentDocument = makeFixture();
  absentDocument.documents = [];
  assert.deepEqual(await inspectDocumentFixture(fakeAdmin(absentDocument)), {
    status: "MISSING",
    reason: "DOCUMENT_MISSING"
  });
});
test("document inspection rejects incompatible schema and primary key", async () => {
  for (const change of [
    (fixture) => { fixture.documentFields[1].type = "integer"; },
    (fixture) => { fixture.documentFields[0].schema.has_auto_increment = false; },
    (fixture) => { fixture.documentFields.push({ field: "extra" }); }
  ]) {
    const fixture = makeFixture();
    change(fixture);
    const result = await inspectDocumentFixture(fakeAdmin(fixture));
    assert.equal(result.status, "CONFLICT");
  }
});
test("document inspection rejects modified content despite a matching marker", async () => {
  const fixture = makeFixture();
  fixture.documents[0].content += "\nDifferent experiment";
  const result = await inspectDocumentFixture(fakeAdmin(fixture));
  assert.deepEqual(result, {
    status: "CONFLICT",
    reason: "DOCUMENT_CONTENT_MISMATCH"
  });
});
test("HTTP failures and malformed responses cannot mean missing fixture", async () => {
  for (const resource of ["collections", "documentFields", "documents"]) {
    for (const response of [
      { status: 403, body: { errors: [{ message: "Denied" }] } },
      { status: 500, body: { data: [] } },
      { status: 200, body: null },
      { status: 200, body: { data: [], errors: [] } }
    ]) {
      const result = await inspectDocumentFixture(
        fakeAdmin(makeFixture(), { [resource]: response })
      );
      assert.equal(result.status, "INCONCLUSIVE");
    }
  }
});
test("request errors are reported without exposing exception contents", async () => {
  const result = await inspectDocumentFixture({
    async readSetupResource() {
      throw new Error("synthetic-sensitive-value");
    }
  });
  assert.deepEqual(result, {
    status: "INCONCLUSIVE",
    reason: "FIXTURE_INSPECTION_FAILED",
    stage: "collections"
  });
  assert.equal(JSON.stringify(result).includes("synthetic-sensitive-value"), false);
});