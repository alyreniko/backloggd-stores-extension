const TOKEN_CACHE_KEY = "igdb_token_v1";
const GAME_CACHE_PREFIX = "igdb_game_stores_v2_";
const GAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "IGDB_FETCH_STORES") {
    fetchStoresFromIgdb(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || "Unknown error" }));
    return true;
  }

  if (message?.type === "OPEN_OPTIONS_PAGE") {
    chrome.runtime.openOptionsPage(() => {
      const err = chrome.runtime.lastError;
      if (err) sendResponse({ ok: false, error: err.message });
      else sendResponse({ ok: true });
    });
    return true;
  }
});

async function fetchStoresFromIgdb(payload) {
  const slug = (payload?.slug || "").trim().toLowerCase();
  const title = (payload?.title || "").trim();
  if (!slug && !title) throw new Error("No slug/title");

  const cacheKey = (slug || title.toLowerCase());
  const cached = await getGameCache(cacheKey);
  if (cached) return cached;

  const { igdbClientId, igdbClientSecret } = await chrome.storage.sync.get([
    "igdbClientId",
    "igdbClientSecret"
  ]);

  if (!igdbClientId || !igdbClientSecret) {
    throw new Error("Set IGDB credentials in extension options");
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
  const obj = await chrome.storage.local.get([TOKEN_CACHE_KEY]);
  const cached = obj[TOKEN_CACHE_KEY];

  if (cached?.access_token && cached?.expires_at && now < cached.expires_at - 60000) {
    return cached.access_token;
  }

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
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

  await chrome.storage.local.set({
    [TOKEN_CACHE_KEY]: {
      access_token: data.access_token,
      expires_at: Date.now() + Number(data.expires_in) * 1000
    }
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
  const res = await fetch("https://api.igdb.com/v4/games", {
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

// IGDB website categories:
// 13 Steam, 16 Epic, 17 GOG, etc. But Xbox/PS/Nintendo often appear as official links.
// Therefore, we also filter by domain.
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
  const obj = await chrome.storage.local.get([k]);
  const e = obj[k];
  if (!e) return null;
  if (Date.now() - e.ts > GAME_CACHE_TTL_MS) return null;
  return e.data;
}

async function setGameCache(key, data) {
  const k = GAME_CACHE_PREFIX + key;
  await chrome.storage.local.set({ [k]: { ts: Date.now(), data } });
}