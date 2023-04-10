/**
 * Parse a URL object or return null.
 * @param {string} url - url stirng
 * @param {string} base - base url stirng
 * @returns {URL|null} URL object
 */
const parseURL = (url, base) => {
    base = base || location.href;
    try {
        return new URL(url, base).href;
    } catch (e) {
        return null;
    }
};

/**
 * Valid url.
 * @param {string} url - url stirng
 * @param {bool} isSameHostname - same hostname
 * @returns {bool} true or false
 */
const validURL = (url, isSameHostname) => {
    try {
        const parsedURL = new URL(url);
        const validProtocol = (
            parsedURL.protocol === 'https:' ||
            parsedURL.protocol === 'http:'
        );
        if (isSameHostname !== true) {
            return validProtocol;
        }
        const validHostname = (
            parsedURL.hostname === 'localhost' ||
            parsedURL.hostname === '127.0.0.1' ||
            parsedURL.hostname === location.hostname
        );
        return validProtocol && validHostname;
    } catch (e) {
        return false;
    }
};

module.exports = {
    parseURL,
    validURL
};
