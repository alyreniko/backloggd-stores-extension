(() => {
  const WIDGET_ID = "igdb-links-widget";
  let lastHandledUrl = "";
  let inFlight = false;

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
  const { igdbClientId, igdbClientSecret } = await chrome.storage.sync.get([
    "igdbClientId",
    "igdbClientSecret"
  ]);
  return Boolean((igdbClientId || "").trim() && (igdbClientSecret || "").trim());
}

function renderMissingCredentials(root) {
  root.innerHTML = `
    <div class="col-3 col-md-2 my-auto">
      <p class="game-details-header">Stores</p>
    </div>
    <div class="col ml-auto text-right text-md-left">
      <div class="blg-store-icons">
        <span class="blg-store-muted" style="margin-right:8px;">
          Set IGDB API credentials
        </span>
        <button type="button" class="blg-store-settings-btn" id="blg-open-ext-settings">
          Open settings
        </button>
      </div>
    </div>
  `;

  root.querySelector("#blg-open-ext-settings")?.addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
      if (!res?.ok) {
        console.error("Failed to open options:", res?.error);
      }
    } catch (e) {
      console.error("OPEN_OPTIONS_PAGE message failed", e);
    }
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
        <img class="blg-store-icon-img" src="${chrome.runtime.getURL(`icons/${s.key}.svg`)}" alt="${escapeAttr(s.label)}">
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

      const res = await chrome.runtime.sendMessage({
        type: "IGDB_FETCH_STORES",
        payload: { slug, title }
      });

      if (!res?.ok) {
        renderError(root);
      } else {
        renderStores(root, res.data?.stores || []);
      }

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
})();
