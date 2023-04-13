const formatMessage = require('format-message');
const {parseURL} = require('./url-util');

const IS_LOCAL_HOST = location.hostname === 'localhost';
const EXPIRED = IS_LOCAL_HOST ? 1000 * 60 : 1000 * 60 * 60 * 24 * 2;

const STORE_NAME = 'extensions';

const camel2under = str => str.replace(/([A-Z])/g, '_$1').toLowerCase();

const storeData = (data, resolve) => {
    if (!data) {
        return resolve([]);
    }

    const extensionData = data.map(extension => {
        const extensionUrl = parseURL(`/extensions/${camel2under(extension.extensionId)}`);
        extension.extensionURL = `${extensionUrl}/index.js`;
        extension.iconURL = `${extensionUrl}/${extension.iconURL}`;
        extension.insetIconURL = `${extensionUrl}/${extension.insetIconURL}`;
        extension.connectionIconURL = `${extensionUrl}/${extension.connectionIconURL}`;
        extension.connectionTipIconURL = extension.connectionIconURL;
        extension.featured = true;
        return extension;
    });
    resolve(extensionData);

    const storage = {
        locale: formatMessage.setup().locale,
        expired: Date.now() + EXPIRED,
        extensions: extensionData
    };

    try {
        localStorage.setItem(STORE_NAME, JSON.stringify(storage));
    } catch (e) { /* ignore */ }
};

const fetchExtensionData = () => new Promise(resolve => {
    let storage;
    try {
        storage = JSON.parse(localStorage.getItem(STORE_NAME));
    } catch (e) { /* ignore */ }

    const locale = formatMessage.setup().locale;

    if (storage && Date.now() < storage.expired && storage.locale === locale) {
        resolve(storage.extensions || []);
        return;
    }

    fetch(parseURL(`/extensions/${locale}.json`))
        .then(res => res.json())
        .then(res => storeData(res, resolve))
        .catch(() => fetch(parseURL(`extensions/en.json`))
            .then(res => res.json())
            .then(res => storeData(res, resolve))
            .catch(() => resolve([]))
        );
});

module.exports = fetchExtensionData;
