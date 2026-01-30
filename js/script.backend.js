/* Clever | Portal — frontend with local encryption, export/import, and server sync
   - local draft autosave & history (previous behavior)
   - optional encryption with passphrase (PBKDF2 -> AES-GCM)
   - export/import (encrypted if passphrase enabled)
   - sync push / pull (uses api/sync endpoint); server stores the encrypted payload
   Usage:
     - To enable sync: click "Enable Sync" (will generate a sync token if missing)
     - Optional: Set a passphrase to encrypt data before sending to server or storing locally
     - When syncing to other device: paste the sync token and the passphrase (if used)
*/

(function () {
  // Storage keys
  const DRAFT_KEY = "clever_portal:draft";
  const HISTORY_KEY = "clever_portal:history";
  const SYNC_TOKEN_KEY = "clever_portal:sync_token";
  const SYNC_PASSPHRASE_EXISTS = "clever_portal:passphrase_set";
  const SAVE_DEBOUNCE_MS = 600;
  const HISTORY_LIMIT = 50;

  // DOM
  const form = document.getElementById("search-form");
  const qInput = document.getElementById("q");
  const luckyBtn = document.getElementById("lucky-btn");
  const saveIndicator = document.getElementById("save-indicator");
  const saveNowBtn = document.getElementById("save-now");
  const historyList = document.getElementById("history-list");
  const clearHistoryBtn = document.getElementById("clear-history");

  // --- localStorage helpers
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { console.warn("localStorage read failed", e); return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { console.warn("localStorage write failed", e); return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { console.warn("localStorage remove failed", e); return false; }
  }

  // --- Draft management (same as before)
  function loadDraft() {
    const raw = safeGet(DRAFT_KEY);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (obj && obj.query) qInput.value = obj.query;
        setSaveIndicator("Restored draft");
      } catch (e) { console.warn("Invalid draft data", e); }
    }
  }
  function saveDraftImmediate() {
    const data = { query: qInput.value || "", updated_at: new Date().toISOString() };
    safeSet(DRAFT_KEY, JSON.stringify(data));
    setSaveIndicator("Saved");
  }
  let saveTimer = null;
  function scheduleSaveDraft() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveDraftImmediate(); saveTimer = null; }, SAVE_DEBOUNCE_MS);
    setSaveIndicator("Saving...");
  }
  let indicatorTimer = null;
  function setSaveIndicator(text, transient = true) {
    if (!saveIndicator) return;
    saveIndicator.textContent = text;
    if (indicatorTimer) clearTimeout(indicatorTimer);
    if (transient) indicatorTimer = setTimeout(() => { saveIndicator.textContent = "Draft saved"; }, 1400);
  }

  // --- History management
  function loadHistory() {
    const raw = safeGet(HISTORY_KEY);
    let items = [];
    if (raw) {
      try { items = JSON.parse(raw) || []; } catch (e) { console.warn("Invalid history data", e); }
    }
    return items;
  }
  function saveHistory(items) { safeSet(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT))); }
  function pushHistory(entry) {
    const items = loadHistory();
    const qLower = (entry.query || "").trim().toLowerCase();
    const filtered = items.filter(i => (i.query || "").trim().toLowerCase() !== qLower);
    filtered.unshift(entry);
    saveHistory(filtered);
    renderHistory();
  }
  function clearHistory() { safeRemove(HISTORY_KEY); renderHistory(); }
  function removeHistoryAt(index) {
    const items = loadHistory();
    items.splice(index, 1);
    saveHistory(items);
    renderHistory();
  }
  function renderHistory() {
    const items = loadHistory();
    historyList.innerHTML = "";
    if (!items || items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No recent searches";
      li.style.padding = "8px";
      historyList.appendChild(li);
      return;
    }
    items.forEach((it, idx) => {
      const li = document.createElement("li");
      const left = document.createElement("div"); left.style.display = "flex"; left.style.flexDirection = "column";
      const title = document.createElement("button");
      title.className = "mini-btn"; title.style.background = "transparent"; title.style.border = "none";
      title.style.padding = "0"; title.style.font = "inherit"; title.style.color = "var(--accent)"; title.style.cursor = "pointer";
      title.textContent = it.query;
      title.addEventListener("click", () => openInNewTab(it.url || buildSearchUrl(it.query)));
      const meta = document.createElement("div");
      meta.className = "history-item-meta";
      const when = new Date(it.timestamp);
      meta.textContent = when.toLocaleString();
      left.appendChild(title); left.appendChild(meta);
      const actions = document.createElement("div"); actions.className = "history-actions";
      const openBtn = document.createElement("button"); openBtn.className = "mini-btn"; openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => openInNewTab(it.url || buildSearchUrl(it.query)));
      const delBtn = document.createElement("button"); delBtn.className = "mini-btn"; delBtn.textContent = "Remove";
      delBtn.addEventListener("click", () => removeHistoryAt(idx));
      actions.appendChild(openBtn); actions.appendChild(delBtn);
      li.appendChild(left); li.appendChild(actions); historyList.appendChild(li);
    });
  }

  function buildSearchUrl(query) {
    const encoded = encodeURIComponent((query || "").trim());
    return `https://www.google.com/search?q=${encoded}`;
  }

  function openInNewTab(targetUrl) {
    if (!targetUrl) return;
    try {
      const win = window.open("about:blank", "_blank", "noopener,noreferrer");
      if (win) win.location.href = targetUrl;
      else window.location.href = targetUrl;
    } catch (err) { window.location.href = targetUrl; }
  }

  // --- Serverless search call
  async function fetchSearch(q) {
    if (!q || !q.trim()) return null;
    const url = `/api/search?q=${encodeURIComponent(q.trim())}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search error: ${res.status}`);
    return res.json();
  }
  function firstLinkFromResult(result) {
    if (!result || !result.raw) return null;
    if (result.provider === "google" && result.raw.items && result.raw.items.length) return result.raw.items[0].link;
    if (result.provider === "bing" && result.raw.webPages && result.raw.webPages.value && result.raw.webPages.value.length) return result.raw.webPages.value[0].url;
    return null;
  }

  // --- Encryption helpers (Web Crypto)
  // Format for encrypted payload: base64( salt(16) || iv(12) || ciphertext )
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function deriveKeyFromPassphrase(passphrase, salt, iterations = 200_000) {
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    }, baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  function concatBuffers(...bufs) {
    let length = 0; bufs.forEach(b => length += b.byteLength);
    const tmp = new Uint8Array(length);
    let offset = 0;
    bufs.forEach(b => { tmp.set(new Uint8Array(b), offset); offset += b.byteLength; });
    return tmp.buffer;
  }
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  function fromBase64(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function encryptObject(obj, passphrase) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPassphrase(passphrase, salt);
    const plaintext = encoder.encode(JSON.stringify(obj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const combined = concatBuffers(salt.buffer, iv.buffer, ciphertext);
    return toBase64(combined);
  }

  async function decryptObject(b64payload, passphrase) {
    const buf = fromBase64(b64payload);
    const view = new Uint8Array(buf);
    const salt = view.slice(0, 16).buffer;
    const iv = view.slice(16, 28).buffer;
    const ciphertext = view.slice(28).buffer;
    const key = await deriveKeyFromPassphrase(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const json = decoder.decode(plain);
    return JSON.parse(json);
  }

  // --- Export / Import
  function downloadFile(filename, content, mime = 'application/json') {
    const a = document.createElement('a');
    const blob = new Blob([content], { type: mime });
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function exportHistory() {
    const items = loadHistory();
    if (!items || items.length === 0) {
      alert('No history to export');
      return;
    }

    const passphrase = prompt('If you have a passphrase set and want the exported file encrypted, enter it now (leave empty for plaintext export):', '');
    if (passphrase) {
      try {
        const encrypted = await encryptObject(items, passphrase);
        const payload = JSON.stringify({ encrypted: true, payload: encrypted });
        downloadFile('clever-history.encrypted.json', payload);
        alert('Encrypted export downloaded.');
      } catch (err) {
        console.error(err);
        alert('Encryption failed — export aborted.');
      }
    } else {
      downloadFile('clever-history.json', JSON.stringify(items, null, 2));
      alert('Plaintext export downloaded.');
    }
  }

  async function importHistoryFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.encrypted && parsed.payload) {
        const passphrase = prompt('This file appears encrypted. Enter the passphrase to decrypt:', '');
        if (!passphrase) { alert('Passphrase required to import encrypted file'); return; }
        const data = await decryptObject(parsed.payload, passphrase);
        saveHistory(data.concat(loadHistory()).slice(0, HISTORY_LIMIT));
        renderHistory();
        alert('Encrypted history imported.');
      } else if (Array.isArray(parsed)) {
        saveHistory(parsed.concat(loadHistory()).slice(0, HISTORY_LIMIT));
        renderHistory();
        alert('History imported.');
      } else {
        alert('Invalid import format.');
      }
    } catch (err) {
      console.error(err);
      alert('Import failed: ' + String(err));
    }
  }

  // --- Sync (server-side) logic
  function getSyncToken() {
    return safeGet(SYNC_TOKEN_KEY);
  }
  function setSyncToken(token) {
    safeSet(SYNC_TOKEN_KEY, token);
  }
  function removeSyncToken() {
    safeRemove(SYNC_TOKEN_KEY);
  }

  async function enableSyncInteractive() {
    // If user already has a token, offer to show it; else generate a new one
    let token = getSyncToken();
    if (token) {
      const show = confirm('A sync token exists locally. Click OK to view/copy it (you can paste on another device), or Cancel to generate a new token and overwrite the local token.');
      if (show) { prompt('Sync token (copy and save this to use on another device):', token); return; }
    }
    // generate new token
    token = (crypto.randomUUID && crypto.randomUUID()) || ([...Array(36)].map((_, i) => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random()*16)|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }))).join('');
    setSyncToken(token);
    alert('New sync token generated. You must keep it secret to sync to other devices. You will be prompted to paste this token on other devices to link.');
    prompt('Sync token (copy and save this to use on another device):', token);
  }

  function disableSyncInteractive() {
    if (!getSyncToken()) { alert('Sync not enabled locally.'); return; }
    if (!confirm('Disable sync locally? This will remove the local sync token (it does not delete server data).')) return;
    removeSyncToken();
    alert('Sync token removed locally. To delete server data, use the server dashboard (or issue a server-side delete if implemented).');
  }

  // Push local history (encrypted or plaintext) to server
  async function syncPush(passphrase) {
    const token = getSyncToken();
    if (!token) { alert('Sync token not found. Enable sync first.'); return; }

    const items = loadHistory();
    if (!items || items.length === 0) { alert('No history to sync.'); return; }

    let payloadToSend;
    if (passphrase) {
      try { payloadToSend = await encryptObject(items, passphrase); } catch (e) { alert('Encryption failed: ' + String(e)); return; }
    } else {
      // plaintext JSON string stored as base64 for consistency
      payloadToSend = toBase64(encoder.encode(JSON.stringify(items)));
    }

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payload: payloadToSend })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Sync push failed: ${res.status}`);
      }
      alert('Sync push successful.');
    } catch (err) {
      console.error(err);
      alert('Sync push failed: ' + String(err));
    }
  }

  // Pull remote history and merge locally (decrypt if passphrase provided)
  async function syncPull(passphrase) {
    const token = getSyncToken();
    if (!token) { alert('Sync token not found. Enable sync first.'); return; }

    try {
      const res = await fetch('/api/sync', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Sync pull failed: ${res.status}`);
      }
      const j = await res.json();
      const payload = j.payload;
      if (!payload) { alert('No remote data found'); return; }

      let items;
      // Detect whether payload is encrypted (we assume if passphrase provided, it's encrypted; otherwise try decryption)
      if (passphrase) {
        items = await decryptObject(payload, passphrase);
      } else {
        // assume plaintext base64 JSON
        try {
          const buf = fromBase64(payload);
          const text = decoder.decode(buf);
          items = JSON.parse(text);
        } catch (e) {
          // If this fails, prompt for passphrase
          const maybe = prompt('Remote data may be encrypted. Enter your passphrase to decrypt (or Cancel):', '');
          if (!maybe) { alert('Cannot decrypt remote data without passphrase.'); return; }
          items = await decryptObject(payload, maybe);
        }
      }
      if (!Array.isArray(items)) throw new Error('Invalid remote payload format');

      // Merge remote items into local history (preferring existing local entries order)
      const merged = items.concat(loadHistory()).slice(0, HISTORY_LIMIT);
      saveHistory(merged);
      renderHistory();
      alert('Sync pull complete. History merged locally.');
    } catch (err) {
      console.error(err);
      alert('Sync pull failed: ' + String(err));
    }
  }

  // UI helper: expose actions via small prompts (quick integration)
  // For a nicer UI, you can replace these with proper inputs in the DOM.
  async function promptExport() { await exportHistory(); }
  async function promptImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      if (input.files && input.files[0]) await importHistoryFile(input.files[0]);
    });
    input.click();
  }

  async function promptEnableSync() {
    await enableSyncInteractive();
  }
  function promptDisableSync() { disableSyncInteractive(); }

  async function promptSyncPush() {
    const passphrase = prompt('If your data is encrypted, enter the passphrase to encrypt before uploading (leave empty for plaintext):', '');
    await syncPush(passphrase || null);
  }
  async function promptSyncPull() {
    const passphrase = prompt('If your data is encrypted, enter the passphrase to decrypt after downloading (leave empty to attempt plaintext):', '');
    await syncPull(passphrase || null);
  }

  // --- Wire controls to simple keyboard shortcuts and context menu
  // For now we use keyboard shortcuts for quick testing:
  // Ctrl+E = Export, Ctrl+I = Import, Ctrl+S = Sync Push, Ctrl+L = Sync Pull, Ctrl+K = Enable Sync, Ctrl+Shift+K = Disable Sync
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); promptExport(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); promptImport(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); promptSyncPush(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); promptSyncPull(); }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); promptEnableSync(); }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); promptDisableSync(); }
  });

  // --- Form submission / Lucky button (integrate with history & draft)
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const q = qInput.value;
    const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const data = await fetchSearch(q);
      const first = firstLinkFromResult(data);
      const finalUrl = first || buildSearchUrl(q);

      if (newTab) newTab.location.href = finalUrl;
      else window.location.href = finalUrl;

      pushHistory({ query: q, url: finalUrl, timestamp: new Date().toISOString() });
      safeRemove(DRAFT_KEY);
      setSaveIndicator("Saved");

    } catch (err) {
      console.error(err);
      try { if (newTab && !newTab.closed) newTab.close(); } catch (e) {}
      alert("Search failed. Check the server logs or configuration.");
    }
  });

  luckyBtn.addEventListener("click", async function () {
    const q = qInput.value;
    const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const data = await fetchSearch(q);
      const first = firstLinkFromResult(data);
      const finalUrl = first || buildSearchUrl(q);
      if (newTab) newTab.location.href = finalUrl;
      else window.location.href = finalUrl;

      pushHistory({ query: q, url: finalUrl, timestamp: new Date().toISOString() });
      safeRemove(DRAFT_KEY);
      setSaveIndicator("Saved");
    } catch (err) {
      console.error(err);
      try { if (newTab && !newTab.closed) newTab.close(); } catch (e) {}
      alert("Search failed. Check the server logs or configuration.");
    }
  });

  // Input autosave
  qInput.addEventListener("input", scheduleSaveDraft);
  if (saveNowBtn) saveNowBtn.addEventListener("click", saveDraftImmediate);
  if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Clear recent searches? This cannot be undone.")) clearHistory();
  });

  // Initialize
  loadDraft();
  renderHistory();
  setSaveIndicator("Draft saved", false);

  // Public actions (useful for debugging in console)
  window.CleverPortal = {
    exportHistory,
    importHistoryFile,
    enableSyncInteractive,
    disableSyncInteractive,
    syncPush,
    syncPull,
    getSyncToken
  };
})();
