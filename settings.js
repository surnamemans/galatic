/* SettingsManager
   Usage:
     import Settings from './js/settings.js';
     await Settings.init();
     Settings.set('ui.theme','purple');
     Settings.get('ui.theme','default');
     const blob = Settings.exportProfile(); // download/export JSON
     await Settings.importProfile(json);
*/
const Settings = (function () {
    const STORAGE_KEY = 'nautilusos:settings:v1';
    const DEFAULTS = {
        meta: { version: 1, created: Date.now(), name: 'default' },
        ui: {
            theme: 'lg',
            iconSize: 48,
            animations: true,
            highContrast: false
        },
        bios: {
            showBoot: true,
            cloakOnBoot: false
        },
        plugins: {}
    };

    function deepMerge(target, src) {
        for (const k of Object.keys(src)) {
            if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
                if (!target[k] || typeof target[k] !== 'object') target[k] = {};
                deepMerge(target[k], src[k]);
            } else {
                target[k] = src[k];
            }
        }
        return target;
    }

    let state = null;
    let subscribers = new Set();

    async function init() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                state = JSON.parse(raw);
                // handle migrations (example)
                if (!state.meta) state = { meta: { version: 1, created: Date.now(), name: 'migrated' }, ...state };
            } catch (e) {
                console.warn('Settings corrupt, resetting to defaults', e);
                state = structuredClone(DEFAULTS);
                persist();
            }
        } else {
            state = structuredClone(DEFAULTS);
            persist();
        }
        window.addEventListener('storage', e => {
            if (e.key === STORAGE_KEY && e.newValue) {
                try {
                    state = JSON.parse(e.newValue);
                    publish();
                } catch {}
            }
        });
        return state;
    }

    function persist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function get(path, fallback) {
        if (!path) return state;
        const parts = path.split('.');
        let cur = state;
        for (const p of parts) {
            if (cur && p in cur) cur = cur[p];
            else return fallback;
        }
        return cur;
    }

    function set(path, value) {
        const parts = path.split('.');
        let cur = state;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = value;
        persist();
        publish();
    }

    function subscribe(cb) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
    }

    function publish() {
        for (const cb of subscribers) {
            try { cb(structuredClone(state)); } catch (e) { console.error(e); }
        }
    }

    function exportProfile(name) {
        const out = structuredClone(state);
        out.meta.exportedAt = Date.now();
        if (name) out.meta.name = name;
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        return blob;
    }

    async function importProfile(jsonText, options = { merge: true }) {
        let parsed;
        if (typeof jsonText === 'string') parsed = JSON.parse(jsonText);
        else parsed = jsonText;
        if (options.merge) {
            deepMerge(state, parsed);
        } else {
            state = parsed;
        }
        persist();
        publish();
    }

    function resetToDefaults() {
        state = structuredClone(DEFAULTS);
        persist();
        publish();
    }

    return {
        init,
        get,
        set,
        subscribe,
        exportProfile,
        importProfile,
        resetToDefaults,
    };
})();

export default Settings;