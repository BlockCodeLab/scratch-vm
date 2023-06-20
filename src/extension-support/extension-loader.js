const AsyncLimiter = require('async-limiter');
const formatMessage = require('format-message');
const ScratchCommon = require('./extension-api');
const GUIComponent = require('./gui-component');
const fetchExtensionData = require('../util/fetch-extension-data');
const dispatch = require('../dispatch/central-dispatch');
const {parseURL, validURL} = require('../util/url-util');

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

const loadScript = url => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.onerror = () => {
        reject(new Error(`Error in script ${url}`));
    };
    script.onload = resolve;
    script.src = url;
    document.body.appendChild(script);
});

const loadStyle = url => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onerror = () => {
        reject(new Error(`Error in style ${url}`));
    };
    link.onload = resolve;
    link.href = url;
    document.body.appendChild(link);
});

/**
 * Sets up the global.Scratch API for an unsandboxed extension.
 * @param {string} extensionURL - unsandboxed extension url
 * @param {VirtualMachine} vm - VirtualMachine
 * @returns {Promise<object[]>} Resolves with a list of extension objects when Scratch.extensions.register is called.
 */
const setupUnsandboxedExtensionAPI = (extensionURL, vm) => new Promise(resolve => {
    // Create a new copy of global.Scratch for each extension
    const Scratch = Object.assign({}, global.Scratch || {}, ScratchCommon);
    Scratch.vm = vm;

    const pendingModules = [];

    const extensionObjects = [];

    const state = {};
    const interrupts = new Set();

    Scratch.gui = {
        addon (option) {
            setTimeout(() => {
                vm.emit('SETUP_ADDON', option);
            }, 0);
        },

        get Component () {
            return class extends GUIComponent {
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
                setState (name, newValue) {
                    if (typeof name === 'object') {
                        Object.entries(name).forEach(args => this.setState(...args));
                        return;
                    }
                    if (this.constructor.observedState.includes(name)) {
                        const oldValue = state[name];
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
            };
        }
    };

    Scratch.extensions = {
        /**
         * register unsandboxed extension.
         * @param {object} extensionObject - unsandboxed extension object
         */
        register (extensionObject) {
            extensionObjects.push(extensionObject);
            resolve(extensionObjects);
        },

        /**
         * use/load unsandboxed extension by id.
         * @param {string} extensionId - extension id
         * @return {Promise}
         */
        use (extensionId) {
            vm.emit('EXTENSION_IMPORTING', true);
            return fetchExtensionData()
                .then(extensionData => {
                    const extension = extensionData.find(e => e.extensionId === extensionId);
                    if (extension) {
                        return vm.extensionManager.loadExtensionURL(extension.extensionURL)
                            .finally(() => {
                                vm.emit('EXTENSION_IMPORTING', false);
                            });
                    }
                });
        },

        getService (extensionId) {
            const serviceName = vm.extensionManager._loadedExtensions.get(extensionId);
            if (!serviceName) {
                return this.use(extensionId).then(() => this.getService(extensionId));
            }
            return dispatch.call.bind(dispatch, serviceName);
        },

        /**
         * set translations.
         * @param {array} translations - translation map
         */
        translations (translations) {
            for (const key in translations) {
                const value = translations[key];
                translationMap[key] = Object.assign(translationMap[key] || {}, value);
            }
            setupTranslations();
        },

        /**
         * extension configuration value
         *
         * @param {string} extensionId - extension id
         * @return {any} the configuration value for the given extensionId or null if it does
         * not exist
         */
        getConfig (extensionId) {
            // synchronous localStorage on the same domain
            const arrCookie = document.cookie.split('; ');
            for (let i = 0; i < arrCookie.length; i++) {
                const arr = arrCookie[i].split('=');
                if (arr[0].includes('token_')) {
                    localStorage.setItem(arr[0], decodeURIComponent(arr[1]));
                }
            }
            return JSON.parse(localStorage.getItem(`token_${extensionId}`));
        }
    };

    const resolveUrl = url => parseURL(url, extensionURL);

    Scratch.require = (url, hasExport = true) => new Promise((resolveModule, reject) => {
        if (validURL(url)) {
            (/\.css$/i.test(url) ? loadStyle(url) : loadScript(url))
                .then(resolveModule)
                .catch(reject);
            return;
        }
        const scriptURL = resolveUrl(url);
        if (!scriptURL) {
            reject(new Error(`Unable to parse ${url}`));
            return;
        }
        if (/\.css$/i.test(url)) {
            loadStyle(scriptURL)
                .then(resolveModule)
                .catch(reject);
        } else {
            const promise = loadScript(scriptURL).catch(reject);
            if (hasExport) {
                pendingModules.push(resolveModule);
            } else {
                promise.then(resolveModule);
            }
        }
    });
    Scratch.require.resolve = resolveUrl;

    Scratch.export = module => {
        if (pendingModules.length > 0) {
            const resolveModule = pendingModules.pop();
            resolveModule(module);
        }
    };

    global.Scratch = Scratch;
});

/**
 * Disable the existing global.Scratch unsandboxed extension APIs.
 * This helps debug poorly designed extensions.
 */
const teardownUnsandboxedExtensionAPI = () => {
    // We can assume global.Scratch already exists.
    global.Scratch.extensions.register = () => {
        throw new Error('Too late to register new extensions.');
    };
};

/**
 * Load an unsandboxed extension from an arbitrary URL. This is dangerous.
 * @param {string} extensionURL - unsandboxed extension url
 * @param {Virtualmachine} vm - VirtualMachine
 * @returns {Promise<object[]>} Resolves with a list of extension objects if the extension was loaded successfully.
 */
const loadUnsandboxedExtension = (extensionURL, vm) => new Promise((resolve, reject) => {
    setupUnsandboxedExtensionAPI(extensionURL, vm).then(resolve);
    loadScript(extensionURL).catch(reject);
}).then(objects => {
    teardownUnsandboxedExtensionAPI();
    return objects;
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
