import {
  fixtureDocument,
  inspectDocumentFixture
} from "./inspect-document.js";
function collectionPayload() {
  return {
    collection: "revokx_documents",
    schema: {},
    meta: {
      hidden: false,
      singleton: false,
      note: "Synthetic REVOKX experiment data"
    },
    fields: [
      {
        field: "id",
        type: "integer",
        schema: {
          is_primary_key: true,
          has_auto_increment: true,
          is_nullable: false
        },
        meta: { interface: "input", readonly: true, hidden: true }
      },
      {
        field: "title",
        type: "string",
        schema: { is_nullable: true },
        meta: { interface: "input" }
      },
      {
        field: "content",
        type: "text",
        schema: { is_nullable: true },
        meta: { interface: "input-multiline" }
      }
    ]
  };
}
function requireAcknowledgement(response) {
  if (
    ![200, 201].includes(response?.status) ||
    response.body === null ||
    typeof response.body !== "object" ||
    Object.hasOwn(response.body, "errors")
  ) {
    throw new Error("CREATE_NOT_ACKNOWLEDGED");
  }
}
export async function ensureDocumentFixture(admin) {
  const attempted = [];
  let stage = "initial-inspection";
  try {
    let inspection = await inspectDocumentFixture(admin);
    if (inspection.status !== "MISSING") {
      return { ...inspection, attempted };
    }
    if (inspection.reason === "COLLECTION_MISSING") {
      stage = "create-collection";
      attempted.push("collection");
      requireAcknowledgement(
        await admin.createSetupResource("collections", collectionPayload())
      );
      stage = "verify-collection";
      inspection = await inspectDocumentFixture(admin);
    }
    if (
      inspection.status === "MISSING" &&
      inspection.reason === "DOCUMENT_MISSING"
    ) {
      stage = "create-document";
      attempted.push("document");
      requireAcknowledgement(
        await admin.createSetupResource("documents", { ...fixtureDocument })
      );
      stage = "verify-document";
      inspection = await inspectDocumentFixture(admin);
    }
    if (inspection.status === "MISSING") {
      return {
        status: "INCONCLUSIVE",
        reason: "CREATED_FIXTURE_NOT_OBSERVED",
        stage,
        attempted
      };
    }
    return { ...inspection, attempted };
  } catch {
    return {
      status: "INCONCLUSIVE",
      reason: "DOCUMENT_SETUP_FAILED",
      stage,
      attempted
    };
  }
}