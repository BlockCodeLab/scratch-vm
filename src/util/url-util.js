const IS_REMOTE_HOST = location.hostname !== 'localhost';

const parseDomain = hostname => hostname.split('.')
    .slice(-2)
    .join('.');

/**
 * Parse a URL object or return null.
 * @param {string} url - url stirng
 * @param {string} base - base url stirng
 * @returns {URL|null} URL object
 */
const parseURL = (url, base) => {
    if (!base) {
        if (IS_REMOTE_HOST) {
            const domain = parseDomain(location.hostname);
            base = `${location.protocol}//extensions.${domain}`;
        } else {
            url = `/extensions/${url}`;
            base = location.href;
        }
    }
    try {
        return new URL(url, base).href;
    } catch (e) {
        return null;
    }
};

/**
 * Valid url.
 * @param {string} url - url stirng
 * @param {bool} isSameDomain - same domain
 * @returns {bool} true or false
 */
const validURL = (url, isSameDomain) => {
    try {
        const parsedURL = new URL(url);
        const validProtocol = (
            parsedURL.protocol === 'https:' ||
            parsedURL.protocol === 'http:'
        );
        if (isSameDomain !== true) {
            return validProtocol;
        }
        const validDomain = (
            parsedURL.hostname === 'localhost' ||
            parsedURL.hostname === '127.0.0.1' ||
            parseDomain(parsedURL.hostname) === parseDomain(location.hostname)
        );
        return validProtocol && validDomain;
    } catch (e) {
        return false;
    }
};

module.exports = {
    parseURL,
    validURL
};
