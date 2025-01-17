const Buffer = require('buffer').Buffer;
const formatMessage = require('format-message');

const ArgumentType = require('./argument-type');
const BlockType = require('./block-type');
const TargetType = require('./target-type');

const BLE = require('../io/web-ble');
const Serial = require('../io/web-serial');

const Base64Util = require('../util/base64-util');
const Cast = require('../util/cast');
const Clone = require('../util/clone');
const Color = require('../util/color');
const fetchWithTimeout = require('../util/fetch-with-timeout');
const log = require('../util/log');
const MathUtil = require('../util/math-util');
const RateLimiter = require('../util/rateLimiter');
const Timer = require('../util/timer');
const uid = require('../util/uid');

const defineMessages = messages => {
    const messageDescriptors = {};
    Object.defineProperties(
        messageDescriptors,
        Object.fromEntries(
            Object.entries(messages).map(([key, descr]) => [
                key,
                {get: () => formatMessage(descr)}
            ])
        )
    );
    return messageDescriptors;
};

const Scratch = {
    Buffer,
    formatMessage,
    defineMessages,
    /* extension support */
    ArgumentType,
    BlockType,
    TargetType,
    /* io */
    BLE,
    Serial,
    /* util */
    Base64Util,
    Cast,
    Clone,
    Color,
    fetchWithTimeout,
    log,
    MathUtil,
    RateLimiter,
    Timer,
    uid
};

module.exports = Scratch;
