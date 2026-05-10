// ==UserScript==
// @name         Backloggd Stores (IGDB API) – Tampermonkey
// @namespace    https://backloggd.com/
// @version      2.0.0
// @description  Shows game stores from IGDB API on Backloggd pages.
// @match        https://backloggd.com/games/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.igdb.com
// @connect      id.twitch.tv
// @license      MIT
// ==/UserScript==

(() => {
  const WIDGET_ID = "igdb-links-widget";
  const TOKEN_CACHE_KEY = "igdb_token_v1";
  const GAME_CACHE_PREFIX = "igdb_game_stores_v2_";
  const GAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  const ICON_BASE = "https://raw.githubusercontent.com/alyreniko/backloggd-stores-extension/main/icons/";

  let lastHandledUrl = "";
  let inFlight = false;

  GM_registerMenuCommand("Set IGDB credentials", async () => {
    const igdbClientId = prompt("IGDB / Twitch Client ID:", (await GM_getValue("igdbClientId", "")) || "");
    if (igdbClientId === null) return;

    const igdbClientSecret = prompt("IGDB / Twitch Client Secret:", (await GM_getValue("igdbClientSecret", "")) || "");
    if (igdbClientSecret === null) return;

    await GM_setValue("igdbClientId", igdbClientId.trim());
    await GM_setValue("igdbClientSecret", igdbClientSecret.trim());
    alert("Saved.");
  });

  GM_addStyle(`
    .blg-store-icons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-start;
    }
    .blg-store-icon-link {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0);
      border: 1px solid rgb(143, 156, 167);
      text-decoration: none;
      transition: transform .12s ease, border-color .12s ease, background .12s ease;
    }
    .blg-store-icon-link:hover { border-color: rgba(252,99,153); }
    .blg-store-icon-img { width: 24px; height: 24px; display: block; }
    .blg-store-muted { color: rgba(220, 227, 241, .7); }
    .blg-store-settings-btn {
      margin-left: 6px; padding: 0; border: 0; background: transparent;
      color: #9ecbff; text-decoration: underline; cursor: pointer; font: inherit;
    }
    .blg-store-settings-btn:hover { color: #c7e0ff; }
    .blg-console-snake {
      --size: 5px; --gap: 4px;
      --dim: rgba(220, 227, 241, 0.22);
      --mid: rgba(220, 227, 241, 0.55);
      --hot: rgba(220, 227, 241, 1);
      display: inline-grid;
      grid-template-columns: repeat(2, var(--size));
      grid-template-rows: repeat(3, var(--size));
      gap: var(--gap);
      margin-left: 8px;
      vertical-align: middle;
    }
    .blg-console-snake i {
      width: var(--size); height: var(--size); border-radius: 50%;
      background: var(--dim); display: block; animation: blgSnake 900ms linear infinite;
    }
    .blg-console-snake i:nth-child(1) { animation-delay: 0ms; }
    .blg-console-snake i:nth-child(2) { animation-delay: 150ms; }
    .blg-console-snake i:nth-child(3) { animation-delay: 300ms; }
    .blg-console-snake i:nth-child(4) { animation-delay: 450ms; }
    .blg-console-snake i:nth-child(5) { animation-delay: 600ms; }
    .blg-console-snake i:nth-child(6) { animation-delay: 750ms; }
    @keyframes blgSnake {
      0%, 100% { background: var(--dim); transform: scale(1); }
      35%      { background: var(--mid); transform: scale(1.08); }
      50%      { background: var(--hot); transform: scale(1.22); }
      65%      { background: var(--mid); transform: scale(1.08); }
    }
  `);

  function isGamePageUrl(url = location.pathname) {
    return /^\/games\/([^/]+)/i.test(url);
  }

  function getSlugFromUrl() {
    const m = location.pathname.match(/^\/games\/([^/]+)/i);
    return m ? m[1].toLowerCase() : "";
  }

  function getTitle() {
    return (document.querySelector("h1")?.textContent || "").trim();
  }

  function ensureWidgetRootUnderPlatforms() {
    let el = document.getElementById(WIDGET_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = WIDGET_ID;
    el.className = "row mt-2";

    const platformsRow = document.getElementById("game-page-platforms");
    if (platformsRow) {
      platformsRow.insertAdjacentElement("afterend", el);
    } else {
      (document.querySelector("main") || document.body).prepend(el);
    }

    return el;
  }

  async function hasIgdbCredentials() {
    const igdbClientId = (await GM_getValue("igdbClientId", "")).trim();
    const igdbClientSecret = (await GM_getValue("igdbClientSecret", "")).trim();
    return Boolean(igdbClientId && igdbClientSecret);
  }

  function renderMissingCredentials(root) {
    root.innerHTML = `
      <div class="col-3 col-md-2 my-auto">
        <p class="game-details-header">Stores</p>
      </div>
      <div class="col ml-auto text-right text-md-left">
        <div class="blg-store-icons">
          <span class="blg-store-muted" style="margin-right:8px;">Set IGDB API credentials</span>
          <button type="button" class="blg-store-settings-btn" id="blg-open-ext-settings">Open settings</button>
        </div>
      </div>
    `;
    root.querySelector("#blg-open-ext-settings")?.addEventListener("click", async () => {
      const igdbClientId = prompt("IGDB / Twitch Client ID:", (await GM_getValue("igdbClientId", "")) || "");
      if (igdbClientId === null) return;

      const igdbClientSecret = prompt("IGDB / Twitch Client Secret:", (await GM_getValue("igdbClientSecret", "")) || "");
      if (igdbClientSecret === null) return;

      await GM_setValue("igdbClientId", igdbClientId.trim());
      await GM_setValue("igdbClientSecret", igdbClientSecret.trim());
      alert("Saved.");
      scheduleInit();
    });
  }

  function renderLoading(root) {
    root.innerHTML = `
      <div class="col-3 col-md-2 my-auto">
        <p class="game-details-header">Stores</p>
      </div>
      <div class="col ml-auto text-right text-md-left">
        <div class="blg-store-icons">
          <span class="blg-console-snake" aria-label="Loading" role="status">
            <i></i><i></i><i></i><i></i><i></i><i></i>
          </span>
        </div>
      </div>
    `;
  }

  function renderError(root) {
    root.innerHTML = `
      <div class="col-3 col-md-2 my-auto">
        <p class="game-details-header">Stores</p>
      </div>
      <div class="col ml-auto text-right text-md-left">
        <div class="blg-store-icons"><span class="blg-store-muted">—</span></div>
      </div>
    `;
  }

  function renderStores(root, stores) {
    if (!stores.length) return renderError(root);

    const html = stores.map((s) => `
      <a class="blg-store-icon-link"
         href="${escapeAttr(s.url)}"
         target="_blank"
         rel="noopener noreferrer nofollow"
         title="${escapeAttr(s.label)}"
         aria-label="${escapeAttr(s.label)}">
        <img class="blg-store-icon-img" src="${ICON_BASE}${s.key}.svg" alt="${escapeAttr(s.label)}">
      </a>
    `).join("");

    root.innerHTML = `
      <div class="col-3 col-md-2 my-auto">
        <p class="game-details-header">Stores</p>
      </div>
      <div class="col ml-auto text-right text-md-left">
        <div class="blg-store-icons">${html}</div>
      </div>
    `;
  }

  function escapeAttr(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }

  async function init() {
    if (!isGamePageUrl()) return;
    if (!document.querySelector("#game-body")) return;
    if (inFlight) return;

    const currentUrl = location.href;
    const existing = document.getElementById(WIDGET_ID);

    if (lastHandledUrl === currentUrl && existing) return;

    inFlight = true;
    try {
      existing?.remove();

      const slug = getSlugFromUrl();
      const title = getTitle();
      if (!slug && !title) return;

      const root = ensureWidgetRootUnderPlatforms();

      const credsOk = await hasIgdbCredentials();
      if (!credsOk) {
        renderMissingCredentials(root);
        return;
      }

      renderLoading(root);

      const data = await fetchStoresFromIgdb({ slug, title });
      renderStores(root, data?.stores || []);

      lastHandledUrl = currentUrl;
    } catch (e) {
      const root = ensureWidgetRootUnderPlatforms();
      renderError(root);
    } finally {
      inFlight = false;
    }
  }

  function scheduleInit() {
    queueMicrotask(() => requestAnimationFrame(() => init()));
  }

  ["turbo:load", "turbo:render", "turbo:frame-load"].forEach((evt) => {
    document.addEventListener(evt, scheduleInit, true);
    window.addEventListener(evt, scheduleInit, true);
  });

  let prevHref = location.href;
  setInterval(() => {
    if (location.href !== prevHref) {
      prevHref = location.href;
      scheduleInit();
    }
  }, 400);

  scheduleInit();

  async function fetchStoresFromIgdb(payload) {
    const slug = (payload?.slug || "").trim().toLowerCase();
    const title = (payload?.title || "").trim();
    if (!slug && !title) throw new Error("No slug/title");

    const cacheKey = (slug || title.toLowerCase());
    const cached = await getGameCache(cacheKey);
    if (cached) return cached;

    const igdbClientId = (await GM_getValue("igdbClientId", "")).trim();
    const igdbClientSecret = (await GM_getValue("igdbClientSecret", "")).trim();
    if (!igdbClientId || !igdbClientSecret) {
      throw new Error("Set IGDB credentials in script menu");
    }

    const token = await getAccessToken(igdbClientId, igdbClientSecret);

    let game = null;
    if (slug) game = await findGameBySlug(slug, igdbClientId, token);
    if (!game && title) game = await findGameBySearch(title, igdbClientId, token);
    if (!game && slug) game = await findGameBySearch(slug.replace(/-/g, " "), igdbClientId, token);

    if (!game) throw new Error("Game not found in IGDB");

    const stores = normalizeStoreLinks(game.websites || []);

    const result = {
      game: { id: game.id, name: game.name, slug: game.slug || null },
      stores
    };

    await setGameCache(cacheKey, result);
    return result;
  }

  async function getAccessToken(clientId, clientSecret) {
    const now = Date.now();
    const cached = await GM_getValue(TOKEN_CACHE_KEY, null);

    if (cached?.access_token && cached?.expires_at && now < cached.expires_at - 60000) {
      return cached.access_token;
    }

    const res = await gmFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        "client_id=" + encodeURIComponent(clientId) +
        "&client_secret=" + encodeURIComponent(clientSecret) +
        "&grant_type=client_credentials"
    });

    if (!res.ok) throw new Error(`OAuth failed (${res.status})`);
    const data = await res.json();
    if (!data?.access_token || !data?.expires_in) throw new Error("Bad OAuth response");

    await GM_setValue(TOKEN_CACHE_KEY, {
      access_token: data.access_token,
      expires_at: Date.now() + Number(data.expires_in) * 1000
    });

    return data.access_token;
  }

  async function findGameBySlug(slug, clientId, token) {
    const q = `
fields id,name,slug,websites.url,websites.category,websites.trusted;
where slug = "${esc(slug)}";
limit 1;
`;
    const arr = await igdbGamesQuery(q, clientId, token);
    return arr[0] || null;
  }

  async function findGameBySearch(name, clientId, token) {
    const q = `
fields id,name,slug,websites.url,websites.category,websites.trusted;
search "${esc(name)}";
limit 10;
`;
    const arr = await igdbGamesQuery(q, clientId, token);
    if (!arr.length) return null;
    const exact = arr.find(x => (x.name || "").trim().toLowerCase() === name.trim().toLowerCase());
    return exact || arr[0];
  }

  async function igdbGamesQuery(body, clientId, token) {
    const res = await gmFetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`IGDB error ${res.status}: ${txt || "unknown"}`);
    }

    return await res.json();
  }

  function normalizeStoreLinks(websites) {
    const items = [];

    for (const w of websites || []) {
      const url = (w?.url || "").trim();
      if (!url) continue;

      let host = "";
      try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }

      const key = detectStoreKey(host, url.toLowerCase(), w?.category);
      if (!key) continue;

      items.push({
        key,
        label: storeLabel(key),
        url
      });
    }

    const byKey = new Map();
    for (const i of items) {
      if (!byKey.has(i.key)) byKey.set(i.key, i);
    }

    const orderedKeys = ["steam", "epic", "gog", "xbox", "playstation", "nintendo", "itch"];
    return orderedKeys.map(k => byKey.get(k)).filter(Boolean);
  }

  function detectStoreKey(host, fullUrl, category) {
    if (host.includes("steampowered.com") || category === 13) return "steam";
    if (host.includes("epicgames.com")) return "epic";
    if (host.includes("gog.com") || category === 17) return "gog";
    if (host.includes("xbox.com") || host.includes("microsoft.com")) return "xbox";
    if (host.includes("playstation.com")) return "playstation";
    if (host.includes("nintendo.") && /(eshop|store)/.test(fullUrl)) return "nintendo";
    if (host.includes("itch.io") || category === 15) return "itch";
    return null;
  }

  function storeLabel(key) {
    return ({
      steam: "Steam",
      epic: "Epic Games",
      gog: "GOG",
      xbox: "Xbox",
      playstation: "PlayStation",
      nintendo: "Nintendo",
      itch: "itch.io"
    })[key] || "Store";
  }

  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async function getGameCache(key) {
    const k = GAME_CACHE_PREFIX + key;
    const e = await GM_getValue(k, null);
    if (!e) return null;
    if (Date.now() - e.ts > GAME_CACHE_TTL_MS) return null;
    return e.data;
  }

  async function setGameCache(key, data) {
    const k = GAME_CACHE_PREFIX + key;
    await GM_setValue(k, { ts: Date.now(), data });
  }

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        headers: options.headers || {},
        data: options.body || null,
        onload: (res) => {
          resolve({
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            text: () => Promise.resolve(res.responseText),
            json: () => Promise.resolve(JSON.parse(res.responseText))
          });
        },
        onerror: (err) => reject(err)
      });
    });
  }
})();
