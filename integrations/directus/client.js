const setupResources = new Map([
  ["collections", "/collections"],
  ["documentFields", "/fields/revokx_documents"],
  ["documents", "/items/revokx_documents"],
  ["policies", "/policies"],
  ["roles", "/roles"],
  ["permissions", "/permissions"],
  ["access", "/access"],
  ["users", "/users"]
]);
export function createDirectusClient({
  baseUrl = "http://127.0.0.1:8055",
  requestTimeoutMs = 3000
} = {}) {
  const base = new URL(baseUrl);
  const userFields = "id,email,status,role";
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("This integration requires a loopback HTTP origin");
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60000
  ) {
    throw new Error("Invalid request timeout");
  }
  async function request(path, { method = "GET", body, cookie } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    try {
      const response = await fetch(new URL(path, base), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      const text = await response.text();
      let parsedBody = null;
      try {
        parsedBody = JSON.parse(text);
      } catch {}
      return {
        status: response.status,
        body: parsedBody,
        cookies: response.headers.getSetCookie()
      };
    } catch {
      throw new Error("DIRECTUS_REQUEST_FAILED");
    }
  }
  async function requestData(path, options) {
    const result = await request(path, options);
    return { status: result.status, body: result.body };
  }
  function documentPath(documentId) {
    if (!Number.isSafeInteger(documentId) || documentId < 1) {
      throw new Error("Document ID must be a positive integer");
    }
    return `/items/revokx_documents/${documentId}?fields=id,title,content`;
  }
  function userPath(userId) {
    if (typeof userId !== "string" || !uuidPattern.test(userId)) {
      throw new Error("A valid user UUID is required");
    }
    return `/users/${userId}?fields=${userFields}`;
  }
  function validateEmail(email) {
    if (typeof email !== "string" || email.trim().length === 0) {
      throw new Error("Email is required");
    }
    return email.trim();
  }
  function setupPath(resource, query = {}) {
    const path = setupResources.get(resource);
    if (!path) {
      throw new Error("Unsupported setup resource");
    }
    if (query === null || typeof query !== "object" || Array.isArray(query)) {
      throw new Error("Invalid setup query");
    }
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (
        !["fields", "filter", "limit", "offset", "sort"].includes(key) ||
        typeof value !== "string"
      ) {
        throw new Error("Invalid setup query");
      }
      parameters.set(key, value);
    }
    return parameters.size ? `${path}?${parameters}` : path;
  }
  async function login({ email, password }) {
    if (
      typeof email !== "string" ||
      email.trim().length === 0 ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      throw new Error("Email and password are required");
    }
    const result = await request("/auth/login", {
      method: "POST",
      body: { email: email.trim(), password, mode: "session" }
    });
    if (result.status !== 200) {
      throw new Error("DIRECTUS_LOGIN_REJECTED");
    }
    const sessionCookies = result.cookies.filter((value) =>
      value.startsWith("directus_session_token=")
    );
    if (sessionCookies.length !== 1) {
      throw new Error("DIRECTUS_SESSION_COOKIE_MISSING");
    }
    const cookie = sessionCookies[0].split(";")[0];
    if (cookie === "directus_session_token=") {
      throw new Error("DIRECTUS_SESSION_COOKIE_MISSING");
    }
    return Object.freeze({
      readDocument: (documentId = 1) =>
        requestData(documentPath(documentId), { cookie }),
      readIdentity: () =>
        requestData(`/users/me?fields=${userFields}`, { cookie }),
      readUser: (userId) =>
        requestData(userPath(userId), { cookie }),
      findUsersByEmail: (userEmail) => {
        const query = new URLSearchParams({
          fields: userFields,
          limit: "2",
          filter: JSON.stringify({
            email: { _eq: validateEmail(userEmail) }
          })
        });
        return requestData(`/users?${query}`, { cookie });
      },
      setUserStatus: (userId, status) => {
        const path = userPath(userId);
        if (!["active", "suspended"].includes(status)) {
          throw new Error("Only active and suspended statuses are supported");
        }
        return requestData(path, {
          method: "PATCH",
          body: { status },
          cookie
        });
      },
      readSetupResource: (resource, query = {}) =>
        requestData(setupPath(resource, query), { cookie }),
      createSetupResource: (resource, body) => {
        const path = setupPath(resource);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          throw new Error("Setup creation requires one object");
        }
        return requestData(path, { method: "POST", body, cookie });
      }
    });
  }
  return Object.freeze({
    login,
    readAnonymousDocument: (documentId = 1) =>
      requestData(documentPath(documentId))
  });
}