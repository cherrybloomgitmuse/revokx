export function classifyDocumentResponse(response, expectedDocument) {
  if (
    expectedDocument?.id === undefined ||
    typeof expectedDocument.title !== "string" ||
    typeof expectedDocument.content !== "string" ||
    expectedDocument.content.length === 0
  ) {
    throw new Error("A verified baseline document is required");
  }

  const body = response?.body;
  const document = body?.data;

  if (
    document?.id === expectedDocument.id &&
    document?.title === expectedDocument.title &&
    document?.content === expectedDocument.content
  ) {
    return "allowed";
  }

  const errorOnly =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    Array.isArray(body.errors) &&
    body.errors.length > 0;

  if (!errorOnly) {
    return "inconclusive";
  }

  const expectedErrorCode =
    response.status === 403
      ? "FORBIDDEN"
      : response.status === 401
        ? "INVALID_CREDENTIALS"
        : null;

  if (
    expectedErrorCode !== null &&
    body.errors.every(
      (error) => error?.extensions?.code === expectedErrorCode
    )
  ) {
    return "denied";
  }

  return "inconclusive";
}