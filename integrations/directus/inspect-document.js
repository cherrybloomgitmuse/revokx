export const fixtureDocument = Object.freeze({
  id: 1,
  title: "REVOKX synthetic project notes",
  content: [
    "REVOKX-FIXTURE-001",
    "This is synthetic data for a local access-revocation experiment.",
    "Project: Sample College Project",
    "Document: Internal planning notes",
    "No real personal or confidential information is included."
  ].join("\n")
});
function requireList(response) {
  if (
    response?.status !== 200 ||
    !Array.isArray(response.body?.data) ||
    Object.hasOwn(response.body, "errors")
  ) {
    throw new Error("UNEXPECTED_LIST_RESPONSE");
  }
  return response.body.data;
}
export async function inspectDocumentFixture(admin) {
  let stage = "collections";
  try {
    const collections = requireList(
      await admin.readSetupResource("collections")
    );
    if (!collections.every((item) =>
      item !== null && typeof item.collection === "string"
    )) {
      throw new Error("INVALID_COLLECTION_RESPONSE");
    }
    const matches = collections.filter(
      (item) => item.collection === "revokx_documents"
    );
    if (matches.length === 0) {
      return { status: "MISSING", reason: "COLLECTION_MISSING" };
    }
    if (matches.length !== 1) {
      throw new Error("DUPLICATE_COLLECTION_RESPONSE");
    }
    stage = "fields";
    const fields = requireList(
      await admin.readSetupResource("documentFields")
    );
    const expectedTypes = new Map([
      ["id", "integer"],
      ["title", "string"],
      ["content", "text"]
    ]);
    const validFields = fields.length === expectedTypes.size &&
      new Set(fields.map((field) => field?.field)).size === fields.length &&
      fields.every((field) =>
        field?.collection === "revokx_documents" &&
        expectedTypes.has(field.field) &&
        expectedTypes.get(field.field) === field.type &&
        field.schema !== null &&
        typeof field.schema === "object"
      );
    if (!validFields) {
      return { status: "CONFLICT", reason: "DOCUMENT_SCHEMA_MISMATCH" };
    }
    const primaryKey = fields.find((field) => field.field === "id");
    if (
      primaryKey.schema.is_primary_key !== true ||
      primaryKey.schema.has_auto_increment !== true ||
      fields.some((field) =>
        field.field !== "id" && field.schema.is_primary_key === true
      )
    ) {
      return { status: "CONFLICT", reason: "DOCUMENT_PRIMARY_KEY_MISMATCH" };
    }
    stage = "document";
    const documents = requireList(
      await admin.readSetupResource("documents", {
        fields: "id,title,content",
        filter: JSON.stringify({ id: { _eq: 1 } }),
        limit: "2"
      })
    );
    if (documents.length === 0) {
      return { status: "MISSING", reason: "DOCUMENT_MISSING" };
    }
    if (documents.length !== 1) {
      throw new Error("UNEXPECTED_DOCUMENT_COUNT");
    }
    const actual = documents[0];
    if (!Object.entries(fixtureDocument).every(
      ([key, value]) => actual?.[key] === value
    )) {
      return { status: "CONFLICT", reason: "DOCUMENT_CONTENT_MISMATCH" };
    }
    return { status: "MATCH", reason: "DOCUMENT_FIXTURE_VERIFIED" };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "FIXTURE_INSPECTION_FAILED",
      stage
    };
  }
}