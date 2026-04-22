(function () {
  const DB_KEY = "shared-finance-db";
  const ADMIN_ALLOWLIST = ["admin@sharedfinancehub.com", "owner@sharedfinancehub.com"];

  function safeParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function defaultDb() {
    return {
      version: 1,
      theme: "light",
      accounts: [],
      pageAssignments: {},
      sessions: {
        userAuthenticated: false,
        currentUser: null,
        adminAuthenticated: false
      },
      financeStates: {},
      apiCache: {}
    };
  }

  function loadDb() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      return migrateLegacy(defaultDb());
    }
    const parsed = safeParse(raw, null);
    if (!parsed || typeof parsed !== "object") {
      return migrateLegacy(defaultDb());
    }

    const merged = {
      ...defaultDb(),
      ...parsed,
      sessions: {
        ...defaultDb().sessions,
        ...(parsed.sessions || {})
      }
    };

    saveDb(merged);
    return merged;
  }

  function saveDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function migrateLegacy(db) {
    const migrated = { ...db };

    const legacyTheme = localStorage.getItem("shared-finance-theme");
    if (legacyTheme) {
      migrated.theme = legacyTheme;
    }

    const legacyAccounts = safeParse(localStorage.getItem("shared-finance-accounts") || "[]", []);
    if (Array.isArray(legacyAccounts) && legacyAccounts.length > 0) {
      migrated.accounts = legacyAccounts;
    }

    const legacyAssignments = safeParse(localStorage.getItem("shared-finance-user-pages") || "{}", {});
    if (legacyAssignments && typeof legacyAssignments === "object") {
      migrated.pageAssignments = legacyAssignments;
    }

    const legacyAuth = localStorage.getItem("shared-finance-authenticated") === "true";
    const legacyAdminAuth = localStorage.getItem("shared-finance-admin-authenticated") === "true";
    const legacyUser = safeParse(localStorage.getItem("shared-finance-user") || "null", null);

    migrated.sessions = {
      userAuthenticated: legacyAuth,
      currentUser: legacyUser,
      adminAuthenticated: legacyAdminAuth
    };

    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith("shared-finance-state-")) {
        const state = safeParse(localStorage.getItem(key) || "null", null);
        if (state) {
          migrated.financeStates[key] = state;
        }
      }
    });

    saveDb(migrated);
    return migrated;
  }

  function update(mutator) {
    const db = loadDb();
    mutator(db);
    saveDb(db);
    return db;
  }

  function isAdminAuthorized(db) {
    if (!db || !db.sessions || !db.sessions.adminAuthenticated) {
      return false;
    }

    const currentUser = db.sessions.currentUser;
    if (!currentUser || !currentUser.email) {
      return false;
    }

    return ADMIN_ALLOWLIST.includes(String(currentUser.email).toLowerCase());
  }

  window.FinanceDB = {
    getTheme() {
      return loadDb().theme;
    },

    setTheme(theme) {
      update((db) => {
        db.theme = theme;
      });
    },

    getAccounts() {
      return loadDb().accounts;
    },

    setAccounts(accounts) {
      update((db) => {
        db.accounts = Array.isArray(accounts) ? accounts : [];
      });
    },

    upsertAccount(account) {
      update((db) => {
        const idx = db.accounts.findIndex((item) => item.email.toLowerCase() === account.email.toLowerCase());
        if (idx >= 0) {
          db.accounts[idx] = account;
        } else {
          db.accounts.push(account);
        }
      });
    },

    findAccount(email, password) {
      return loadDb().accounts.find((item) => item.email.toLowerCase() === email.toLowerCase() && item.password === password) || null;
    },

    getPageAssignments() {
      return loadDb().pageAssignments;
    },

    setPageAssignments(assignments) {
      update((db) => {
        db.pageAssignments = assignments || {};
      });
    },

    getAssignedPage(email) {
      const assignments = loadDb().pageAssignments;
      return assignments[email.toLowerCase()] || null;
    },

    assignPage(email, page) {
      update((db) => {
        db.pageAssignments[email.toLowerCase()] = page;
      });
    },

    getUserSession() {
      const sessions = loadDb().sessions;
      return {
        authenticated: !!sessions.userAuthenticated,
        user: sessions.currentUser || null
      };
    },

    setUserSession(authenticated, user) {
      update((db) => {
        db.sessions.userAuthenticated = !!authenticated;
        db.sessions.currentUser = user || null;
      });
    },

    clearUserSession() {
      update((db) => {
        db.sessions.userAuthenticated = false;
        db.sessions.currentUser = null;
      });
    },

    getAdminSession() {
      return !!loadDb().sessions.adminAuthenticated;
    },

    setAdminSession(value) {
      update((db) => {
        db.sessions.adminAuthenticated = !!value;
      });
    },

    clearAdminSession() {
      update((db) => {
        db.sessions.adminAuthenticated = false;
      });
    },

    getFinanceState(stateKey) {
      return loadDb().financeStates[stateKey] || null;
    },

    setFinanceState(stateKey, value) {
      update((db) => {
        db.financeStates[stateKey] = value;
      });
    },

    getApiCache(cacheKey) {
      return loadDb().apiCache[cacheKey] || null;
    },

    setApiCache(cacheKey, value) {
      update((db) => {
        db.apiCache[cacheKey] = value;
      });
    },

    getDatabaseSnapshot() {
      const db = loadDb();
      if (!isAdminAuthorized(db)) {
        return null;
      }
      return db;
    },

    clearDatabase() {
      const db = loadDb();
      if (!isAdminAuthorized(db)) {
        return false;
      }

      const currentUser = db.sessions.currentUser;
      const theme = db.theme;
      const next = defaultDb();
      next.theme = theme;
      next.sessions.currentUser = currentUser;
      next.sessions.userAuthenticated = true;
      next.sessions.adminAuthenticated = true;
      saveDb(next);
      return true;
    }
  };
})();
