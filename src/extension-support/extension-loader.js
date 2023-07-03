const AsyncLimiter = require('async-limiter');
const Clone = require('../util/clone');
const formatMessage = require('format-message');
const ScratchCommon = require('./extension-api');
const GUIComponent = require('./gui-component');
const dispatch = require('../dispatch/central-dispatch');
const {parseURL, validURL} = require('../util/url-util');

const camel2under = str => str.replace(/([A-Z])/g, '_$1').toLowerCase();
const url2id = str => str.replace(/[^a-z1-9_]/ig, '').toLowerCase();

// setup global translations
const translationMap = {};
const setupTranslations = () => {
    const {
        locale,
        translations
    } = formatMessage.setup();
    if (translations[locale] && translationMap[locale]) {
        Object.assign(translations[locale], translationMap[locale]);
    }
    formatMessage.setup({translations});
};

// load remote script
const loadScript = url => new Promise((resolve, reject) => {
    const elem = document.querySelector(`#_${url2id(url)}`);
    if (elem) {
        return resolve();
    }
    const script = document.createElement('script');
    script.onerror = () => {
        reject(new Error(`Error in script ${url}`));
    };
    script.onload = resolve;
    script.id = `#_${url2id(url)}`;
    script.src = url;
    document.body.appendChild(script);
});

// load remote style
const loadStyle = url => new Promise((resolve, reject) => {
    const elem = document.querySelector(`#_${url2id(url)}`);
    if (elem) {
        return resolve();
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onerror = () => {
        reject(new Error(`Error in style ${url}`));
    };
    link.onload = resolve;
    link.id = `#_${url2id(url)}`;
    link.href = url;
    document.body.appendChild(link);
});

// load local script
const AsyncFunction = (...args) => {
    const code = args.pop();
    return new Function(...args, `
        return new Promise(___resolve___ => {
            const promise = ${code};
            if (promise instanceof Promise) {
                promise.then(___resolve___);
            } else {
                ___resolve___();
            }
        })
    `);
};
const localScript = url => new Promise((resolve, reject) => {
    fetch(url)
        .then(res => res.text())
        .then(text => {
            resolve(AsyncFunction('Scratch', 'require', 'exports', text));
        })
        .catch(reject);
});

/**
 * Load an unsandboxed extension from an arbitrary URL. This is dangerous.
 * @param {string} extensionURL - unsandboxed extension url
 * @param {Virtualmachine} vm - VirtualMachine
 * @returns {Promise<object[]>} Resolves with a list of extension objects if the extension was loaded successfully.
 */
const loadUnsandboxedExtension = (extensionURL, vm) => new Promise((resolve, reject) => {
    // Create a new copy of global.Scratch for each extension
    const Scratch = Object.assign({}, ScratchCommon);
    Scratch.vm = vm;

    const state = {};
    const interrupts = new Set();

    class StateComponent extends GUIComponent {
        static set initialState (newState) {
            Object.assign(state, newState);
        }
        constructor () {
            super();
            if (this.constructor.observedState) {
                interrupts.add([
                    this.constructor.observedState,
                    this.stateChangedCallback.bind(this)
                ]);
                Object.defineProperties(
                    this._state,
                    Object.fromEntries(
                        this.constructor.observedState.map(name => [
                            name,
                            {get: () => state[name]}
                        ])
                    )
                );
            }
        }
        setState (name, newValue, oldValue) {
            if (typeof name === 'object') {
                const oldState = Clone.simple(state);
                Object.assign(state, name);
                Object.entries(name).forEach(([k, v]) => this.setState(k, v, oldState[k]));
                return;
            }
            if (this.constructor.observedState.includes(name)) {
                oldValue = (typeof oldValue === 'undefined') ? state[name] : oldValue;
                state[name] = newValue;
                interrupts.forEach(([observed, callback]) => {
                    if (observed.includes(name)) {
                        callback(name, oldValue, newValue);
                    }
                });
            } else {
                super.setState(name, newValue);
            }
        }
    }

    Scratch.gui = {};
    Scratch.gui.addon = option => setTimeout(() => vm.emit('SETUP_ADDON', option), 0);
    Scratch.gui.Component = StateComponent;

    const resolveUrl = url => parseURL(url, extensionURL);

    const extensionObjects = [];

    Scratch.extensions = {};
    // register unsandboxed extension
    Scratch.extensions.register = extensionObject => {
        extensionObjects.push(extensionObject);
        resolve(extensionObjects);
    };
    // use/load unsandboxed extension by id
    Scratch.extensions.use = extensionId => {
        if (vm.extensionManager.isExtensionLoaded(extensionId)) {
            return Promise.resolve();
        }
        const url = resolveUrl(`../${camel2under(extensionId)}/index.js`);
        return vm.extensionManager.loadExtensionURL(url);
    };
    // get extension service by id.
    Scratch.extensions.getService = extensionId => {
        const serviceName = vm.extensionManager._loadedExtensions.get(extensionId);
        if (serviceName) {
            return dispatch.call.bind(dispatch, serviceName);
        }
        vm.emit('EXTENSION_IMPORTING', true);
        return Scratch.extensions.use(extensionId)
            .then(() => Scratch.extensions.getService(extensionId))
            .finally(() => {
                vm.emit('EXTENSION_IMPORTING', false);
            });
    };
    // setup translations
    Scratch.extensions.translations = translations => {
        for (const key in translations) {
            const value = translations[key];
            translationMap[key] = Object.assign(translationMap[key] || {}, value);
        }
        setupTranslations();
    };
    // extension configuration value from extension document domain
    Scratch.extensions.getConfig = extensionId => {
        // synchronous localStorage on the same domain
        const arrCookie = document.cookie.split('; ');
        for (let i = 0; i < arrCookie.length; i++) {
            const arr = arrCookie[i].split('=');
            if (arr[0].includes('token_')) {
                localStorage.setItem(arr[0], decodeURIComponent(arr[1]));
            }
        }
        return JSON.parse(localStorage.getItem(`token_${extensionId}`));
    };

    const exportsProxy = resolveModule => {
        const exportsModule = {};
        return new Proxy(new Function(), {
            apply (target, thisArg, args) {
                resolveModule(args[0]);
            },
            set (obj, prop, value) {
                exportsModule[prop] = value;
                resolveModule(exportsModule);
            }
        });
    };

    const requireModule = url => new Promise((resolveModule, rejectModule) => {
        // load remote script or style
        if (validURL(url)) {
            (/\.css$/i.test(url) ? loadStyle(url) : loadScript(url))
                .then(resolveModule)
                .catch(rejectModule);
            return;
        }
        // load local script or style
        const scriptURL = resolveUrl(url);
        if (!scriptURL) {
            rejectModule(new Error(`Unable to parse ${url}`));
            return;
        }
        if (/\.css$/i.test(url)) {
            loadStyle(scriptURL)
                .then(resolveModule)
                .catch(rejectModule);
        } else if (/\.json$/i.test(url)) {
            fetch(scriptURL)
                .then(res => res.json())
                .then(resolveModule)
                .catch(rejectModule);
        } else {
            const exportsModule = exportsProxy(resolveModule);
            localScript(scriptURL)
                .then(callScript => {
                    callScript(Scratch, requireModule, exportsModule)
                        .then(resolveModule);
                })
                .catch(rejectModule);
        }
    });
    requireModule.resolve = resolveUrl;

    localScript(extensionURL)
        .then(callScript => callScript(Scratch, requireModule))
        .catch(reject);
});

// Because loading unsandboxed extensions requires messing with global state (global.Scratch),
// only let one extension load at a time.
const limiter = new AsyncLimiter({concurrency: 1});
const load = (extensionURL, vm) => new Promise((resolve, reject) => {
    limiter.push(next => loadUnsandboxedExtension(extensionURL, vm)
        .then(resolve)
        .catch(reject)
        .finally(next)
    );
});

module.exports = {
    load,
    setupTranslations
};
