(function () {
  const API_CACHE_KEY = "live-dashboard-feed";

  async function requestJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 7000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchRates() {
    const data = await requestJson("https://open.er-api.com/v6/latest/INR", 9000);
    if (!data || data.result !== "success" || !data.rates) {
      throw new Error("Invalid exchange payload");
    }

    return {
      base: data.base_code || "INR",
      rates: {
        USD: Number(data.rates.USD || 0),
        EUR: Number(data.rates.EUR || 0),
        GBP: Number(data.rates.GBP || 0),
        AED: Number(data.rates.AED || 0)
      },
      updatedAt: data.time_last_update_utc || new Date().toUTCString(),
      provider: "open.er-api.com"
    };
  }

  async function fetchAdvice() {
    const data = await requestJson("https://api.adviceslip.com/advice", 7000);
    const advice = data && data.slip && data.slip.advice ? String(data.slip.advice).trim() : "Track small recurring spends weekly to avoid silent budget leaks.";
    return {
      text: advice,
      provider: "api.adviceslip.com"
    };
  }

  async function fetchIndiaTime() {
    const data = await requestJson("https://worldtimeapi.org/api/timezone/Asia/Kolkata", 7000);
    if (!data || !data.datetime) {
      throw new Error("Invalid time payload");
    }

    return {
      iso: data.datetime,
      zone: data.timezone || "Asia/Kolkata",
      provider: "worldtimeapi.org"
    };
  }

  function fallbackFeed() {
    return {
      source: "fallback",
      fetchedAt: new Date().toISOString(),
      rates: {
        base: "INR",
        rates: {
          USD: 0.012,
          EUR: 0.011,
          GBP: 0.0094,
          AED: 0.044
        },
        updatedAt: new Date().toUTCString(),
        provider: "offline-default"
      },
      advice: {
        text: "Split and settle weekly to keep shared budgets predictable.",
        provider: "offline-default"
      },
      indiaTime: {
        iso: new Date().toISOString(),
        zone: "Asia/Kolkata",
        provider: "offline-default"
      }
    };
  }

  function readCache() {
    if (!window.FinanceDB || typeof window.FinanceDB.getApiCache !== "function") {
      return null;
    }
    return window.FinanceDB.getApiCache(API_CACHE_KEY);
  }

  function writeCache(payload) {
    if (!window.FinanceDB || typeof window.FinanceDB.setApiCache !== "function") {
      return;
    }
    window.FinanceDB.setApiCache(API_CACHE_KEY, payload);

    if (window.ServerAPI && typeof window.ServerAPI.setApiCache === "function" && window.ServerAPI.getToken()) {
      window.ServerAPI.setApiCache(API_CACHE_KEY, payload).catch(() => {
        // Keep local cache available even if backend cache write fails.
      });
    }
  }

  async function fetchDashboardFeed() {
    const [ratesResult, adviceResult, timeResult] = await Promise.allSettled([
      fetchRates(),
      fetchAdvice(),
      fetchIndiaTime()
    ]);

    const cached = readCache();
    const fallback = fallbackFeed();

    const payload = {
      source: "live",
      fetchedAt: new Date().toISOString(),
      rates: ratesResult.status === "fulfilled" ? ratesResult.value : (cached && cached.rates) || fallback.rates,
      advice: adviceResult.status === "fulfilled" ? adviceResult.value : (cached && cached.advice) || fallback.advice,
      indiaTime: timeResult.status === "fulfilled" ? timeResult.value : (cached && cached.indiaTime) || fallback.indiaTime,
      errors: {
        rates: ratesResult.status === "rejected" ? String(ratesResult.reason || "Unknown error") : null,
        advice: adviceResult.status === "rejected" ? String(adviceResult.reason || "Unknown error") : null,
        indiaTime: timeResult.status === "rejected" ? String(timeResult.reason || "Unknown error") : null
      }
    };

    if (payload.errors.rates || payload.errors.advice || payload.errors.indiaTime) {
      payload.source = "partial";
    }

    writeCache(payload);
    return payload;
  }

  function getCachedDashboardFeed() {
    return readCache();
  }

  window.FinanceAPI = {
    fetchDashboardFeed,
    getCachedDashboardFeed
  };
})();
