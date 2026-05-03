const cid = document.getElementById("cid");
const sec = document.getElementById("sec");
const save = document.getElementById("save");
const statusEl = document.getElementById("status");

(async () => {
  const { igdbClientId, igdbClientSecret } = await chrome.storage.sync.get(["igdbClientId", "igdbClientSecret"]);
  if (igdbClientId) cid.value = igdbClientId;
  if (igdbClientSecret) sec.value = igdbClientSecret;
})();

save.addEventListener("click", async () => {
  const igdbClientId = cid.value.trim();
  const igdbClientSecret = sec.value.trim();

  if (!igdbClientId || !igdbClientSecret) {
    statusEl.className = "err";
    statusEl.textContent = "Fill both fields";
    return;
  }

  await chrome.storage.sync.set({ igdbClientId, igdbClientSecret });
  statusEl.className = "ok";
  statusEl.textContent = "Saved";
});