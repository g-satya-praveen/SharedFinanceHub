(function () {
  function sanitizeApiBase(value) {
    if (!value || typeof value !== "string") return "";
    return value.replace(/\/+$/, "");
  }

  function defaultApiBase() {
    const hasBrowser = typeof window !== "undefined" && window.location && window.location.origin;
    if (hasBrowser && /^https?:/i.test(window.location.origin)) {
      return window.location.origin + "/api";
    }
    return "http://localhost:3000/api";
  }

  const API_BASE = sanitizeApiBase(localStorage.getItem("shared-finance-api-base")) || defaultApiBase();
  const TOKEN_KEY = "shared-finance-token";
  const USER_KEY = "shared-finance-server-user";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }

  function setApiBase(url) {
    const nextBase = sanitizeApiBase(url);
    if (!nextBase) return;
    localStorage.setItem("shared-finance-api-base", nextBase);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getCachedUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setCachedUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user || null));
  }

  async function request(path, options) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {})
    };

    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    const response = await fetch(API_BASE + path, {
      method: options && options.method ? options.method : "GET",
      headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error ? data.error : "Request failed";
      throw new Error(message);
    }

    return data;
  }

  async function login(email, password) {
    const data = await request("/auth/login", {
      method: "POST",
      body: { email, password }
    });
    setToken(data.token);
    setCachedUser(data.user);
    return data.user;
  }

  async function signup(email, password, name) {
    const data = await request("/auth/signup", {
      method: "POST",
      body: { email, password, name }
    });
    setToken(data.token);
    setCachedUser(data.user);
    return data.user;
  }

  async function adminLogin(email, password) {
    const data = await request("/auth/admin-login", {
      method: "POST",
      body: { email, password }
    });
    setToken(data.token);
    setCachedUser(data.user);
    return data.user;
  }

  async function signout() {
    try {
      await request("/auth/signout", { method: "POST" });
    } finally {
      clearToken();
    }
  }

  async function updatePresence() {
    await request("/auth/presence", { method: "POST" });
  }

  async function getMe() {
    const data = await request("/auth/me");
    setCachedUser(data.user);
    return data.user;
  }

  async function getFinanceState(pageKey) {
    const data = await request("/users/me/finance-state?pageKey=" + encodeURIComponent(pageKey));
    return data.state;
  }

  async function setFinanceState(pageKey, state) {
    await request("/users/me/finance-state?pageKey=" + encodeURIComponent(pageKey), {
      method: "PUT",
      body: { state }
    });
  }

  async function getAdminAccounts() {
    const data = await request("/admin/accounts");
    return data.accounts || [];
  }

  async function getAdminDatabase() {
    return request("/admin/database");
  }

  async function clearAdminDatabase() {
    return request("/admin/database/clear", { method: "POST" });
  }

  async function deleteAdminUser(email) {
    return request("/admin/users/" + encodeURIComponent(email), { method: "DELETE" });
  }

  async function getApiCache(cacheKey) {
    const data = await request("/cache/" + encodeURIComponent(cacheKey));
    return data.payload || null;
  }

  async function setApiCache(cacheKey, payload) {
    await request("/cache/" + encodeURIComponent(cacheKey), {
      method: "PUT",
      body: { payload }
    });
  }

  window.ServerAPI = {
    baseUrl: API_BASE,
    setApiBase,
    login,
    signup,
    adminLogin,
    signout,
    updatePresence,
    getMe,
    getFinanceState,
    setFinanceState,
    getAdminAccounts,
    getAdminDatabase,
    clearAdminDatabase,
    deleteAdminUser,
    getApiCache,
    setApiCache,
    getToken,
    getCachedUser,
    clearToken
  };
})();
