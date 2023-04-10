const AsyncLimiter = require('async-limiter');
const formatMessage = require('format-message');
const ScratchCommon = require('./extension-api');
const fetchExtensionData = require('../util/fetch-extension-data');
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
         */
        use (extensionId) {
            fetchExtensionData()
                .then(extensionData => {
                    const extension = extensionData.find(e => e.extensionId === extensionId);
                    if (extension) {
                        vm.extensionManager.loadExtensionURL(extension.extensionURL);
                    }
                });
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
        }
    };

    const resolveUrl = url => parseURL(url, extensionURL);

    Scratch.require = url => new Promise((resolveModule, reject) => {
        if (validURL(url)) {
            loadScript(url)
                .then(resolveModule)
                .catch(reject);
            return;
        }
        const scriptURL = resolveUrl(url);
        if (!scriptURL) {
            reject(new Error(`Unable to parse ${url}`));
            return;
        }
        pendingModules.push(resolveModule);
        loadScript(scriptURL)
            .catch(reject);
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
    const resolve = global.Scratch.require.resolve;
    global.Scratch.require = () => {
        throw new Error(`Can't use require now`);
    };
    global.Scratch.require.resolve = resolve;
    global.Scratch.export = () => {
        throw new Error(`Can't use exports now`);
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
