const Buffer = require('buffer').Buffer;
const formatMessage = require('format-message');

const ArgumentType = require('./argument-type');
const BlockType = require('./block-type');
const TargetType = require('./target-type');

const Video = require('../io/video');
const BLE = require('../io/web-ble');

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

const Scratch = {
    Buffer,
    formatMessage,
    /* extension support */
    ArgumentType,
    BlockType,
    TargetType,
    /* io */
    Video,
    BLE,
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
