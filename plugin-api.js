/* PluginAPI - sandboxed plugin host
   Example:
     const api = new PluginHost();
     api.register({ id:'calculator', url:'/apps/calc/index.html', permissions:['storage']});
     await api.install('calculator');
     api.on('app:installed', info => {...});
*/

class PluginHost {
    constructor({ container = document.body } = {}) {
        this._container = container;
        this._registry = new Map();
        this._installed = new Map();
        this._events = new Map();
    }

    register(manifest) {
        if (!manifest.id || !manifest.url) throw new Error('Invalid manifest');
        this._registry.set(manifest.id, manifest);
    }

    async install(id) {
        const manifest = this._registry.get(id);
        if (!manifest) throw new Error('Unknown plugin');
        // create sandboxed iframe
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin'); // restrict by default
        iframe.src = manifest.url;
        iframe.dataset.pluginId = id;
        iframe.style.border = 'none';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        // append to container or a dedicated plugin area
        this._container.appendChild(iframe);
        this._installed.set(id, { manifest, iframe, installedAt: Date.now() });
        this._emit('app:installed', { id, manifest });
        // setup postMessage bridge
        window.addEventListener('message', this._onMessage);
        return { id, manifest };
    }

    async uninstall(id) {
        const info = this._installed.get(id);
        if (!info) return;
        info.iframe.remove();
        this._installed.delete(id);
        this._emit('app:uninstalled', { id });
    }

    listInstalled() {
        return Array.from(this._installed.keys());
    }

    on(event, cb) {
        if (!this._events.has(event)) this._events.set(event, new Set());
        this._events.get(event).add(cb);
    }

    off(event, cb) {
        if (!this._events.has(event)) return;
        this._events.get(event).delete(cb);
    }

    _emit(event, payload) {
        if (!this._events.has(event)) return;
        for (const cb of this._events.get(event)) {
            try { cb(payload); } catch (e) { console.error(e); }
        }
    }

    // basic message handler for plugin-UI bridge (can be extended)
    _onMessage = (ev) => {
        const { data, source } = ev;
        if (!data || !data.pluginEvent) return;
        // dispatch to host events
        this._emit(data.pluginEvent, { data: data.payload, source });
    };
}

export default PluginHost;