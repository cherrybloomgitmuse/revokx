import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocumentResponse } from "../integrations/directus/classify.js";

const expectedDocument = {
  id: 1,
  title: "Synthetic document",
  content: "REVOKX-TEST-CONTENT"
};

function errorResponse(status, code) {
  return {
    status,
    body: {
      errors: [
        {
          message: "Synthetic error",
          extensions: { code }
        }
      ]
    }
  };
}

test("Directus: exact protected content proves access despite error status", () => {
  for (const status of [200, 401, 403, 500]) {
    assert.equal(
      classifyDocumentResponse(
        {
          status,
          body: { data: { ...expectedDocument } }
        },
        expectedDocument
      ),
      "allowed"
    );
  }
});

test("Directus: recognized error-only responses establish request denial", () => {
  for (const [status, code] of [
    [403, "FORBIDDEN"],
    [401, "INVALID_CREDENTIALS"]
  ]) {
    assert.equal(
      classifyDocumentResponse(
        errorResponse(status, code),
        expectedDocument
      ),
      "denied"
    );
  }
});

test("Directus: unexpected responses remain inconclusive", () => {
  const responses = [
    { status: 200, body: "<html>Login</html>" },
    { status: 200, body: { data: null } },
    { status: 403, body: null },
    errorResponse(500, "INTERNAL_SERVER_ERROR"),
    errorResponse(200, "FORBIDDEN"),
    errorResponse(403, "UNKNOWN_ERROR"),
    {
      status: 200,
      body: {
        data: { ...expectedDocument, id: 2 }
      }
    },
    {
      status: 200,
      body: {
        data: { id: 1, content: expectedDocument.content }
      }
    }
  ];

  for (const response of responses) {
    assert.equal(
      classifyDocumentResponse(response, expectedDocument),
      "inconclusive"
    );
  }
});

test("Directus: extra response data prevents an error-only denial", () => {
  const response = errorResponse(403, "FORBIDDEN");
  response.body.partialContent = expectedDocument.content;

  assert.equal(
    classifyDocumentResponse(response, expectedDocument),
    "inconclusive"
  );
});

test("Directus: missing baseline cannot produce a verdict", () => {
  for (const baseline of [
    undefined,
    {},
    { id: 1, title: "Synthetic document", content: "" }
  ]) {
    assert.throws(
      () => classifyDocumentResponse(
        errorResponse(403, "FORBIDDEN"),
        baseline
      ),
      /verified baseline document/
    );
  }
});