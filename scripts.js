// Add an install helper to community/scripts.js (append near catalog rendering logic)

function getLocalCatalogKey() { return 'nautilusos:installedApps:v1'; }

function loadInstalledApps() {
    try {
        return JSON.parse(localStorage.getItem(getLocalCatalogKey()) || '[]');
    } catch (e) { return []; }
}

function saveInstalledApps(list) {
    localStorage.setItem(getLocalCatalogKey(), JSON.stringify(list));
}

function isInstalled(appUrl) {
    return loadInstalledApps().some(a => a.url === appUrl);
}

function installApp(item) {
    const list = loadInstalledApps();
    if (isInstalled(item.url)) return false;
    list.push({
        name: item.name,
        url: item.url,
        icon: item.icon,
        author: item.author,
        installedAt: Date.now()
    });
    saveInstalledApps(list);
    window.dispatchEvent(new CustomEvent('nautilus:appInstalled', { detail: item }));
    return true;
}

// When rendering items, show install button
// Replace the download/action area in the renderer with:
// ${item.url ? `<a href="${getDownloadUrl(item.url)}" target="_blank" rel="noopener" class="btn">Download</a>` : '<span class="muted">No download available</span>'}
// with:
${item.url ? (isInstalled(item.url) ? '<button class="btn muted">Installed</button>' : `<button class="btn install" data-url="${escapeHtml(item.url)}">Install</button>`) : '<span class="muted">No download available</span>'}

// And add a delegated click handler:
document.addEventListener('click', (e) => {
    const btn = e.target.closest('button.install');
    if (!btn) return;
    const url = btn.getAttribute('data-url');
    const item = allData.find(d => d.url === url); // ensure allData in scope or re-fetch item
    if (installApp(item)) {
        btn.textContent = 'Installed';
        btn.classList.add('muted');
    } else {
        alert('Already installed');
    }
});