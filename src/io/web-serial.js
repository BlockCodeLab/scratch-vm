// const log = require('../util/log');
const Serial = require('../util/serial');
const transfer = require('../util/ymodem');
const {base64ToUint8Array} = require('../util/base64-util');

/**
 * Class to communicate with device via USB serial-port using Web Serial API.
 */
class WebSerial {

    /**
     * A Serial peripheral object.  It handles connecting, over Web Serial API, to
     * Serial peripherals, and reading and writing data to them.
     * @param {Runtime} runtime - the Runtime for sending/receiving GUI update events.
     * @param {string} extensionId - the id of the extension using this object.
     * @param {object} peripheralOptions - the list of options for peripheral discovery.
     * @param {function} connectCallback - a callback for connection.
     * @param {function} resetCallback - a callback for resetting extension state.
     */
    constructor (runtime, extensionId, peripheralOptions, connectCallback, resetCallback = null) {
        /**
         * Remote device which have been connected.
         * @type {SerialPort}
         */
        this._serial = null;

        this._connectCallback = connectCallback;
        this._connected = false;
        this._resetCallback = resetCallback;
        this._extensionId = extensionId;
        this._runtime = runtime;

        const {
            filters,
            serialOptions
        } = peripheralOptions;

        this._peripheralOptions = {filters};

        this._serialOptions = Object.assign({
            baudRate: 115200 // default
        }, serialOptions);

        this.requestPeripheral();
    }

    /**
     * Request connection to the peripheral.
     * Request user to choose a device, and then connect it automatically.
     */
    requestPeripheral () {
        window.navigator.serial.requestPort(this._peripheralOptions)
            .then(port => {
                this._serial = new Serial(port);
                this._serial.on('disconnect', this.handleDisconnectError.bind(this));
                this._runtime.connectPeripheral(this._extensionId, `${port.getInfo()}`);
            })
            .catch(e => {
                this._handleRequestError(e);
            });
    }

    /**
     * Try connecting to the input peripheral id, and then call the connect
     * callback if connection is successful.
     * @param {number} id - the id of the peripheral to connect to
     */
    connectPeripheral (/* id */) {
        if (!this._serial) {
            this._handleRequestError(new Error('serial port is not chosen'));
            return;
        }
        this._serial.open(this._serialOptions)
            .then(() => {
                this._connected = true;
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_CONNECTED);
                this._connectCallback();
            })
            .catch(e => {
                this._handleRequestError(e);
            });
    }

    /**
     * Disconnect from the device and clean up.
     * Then emit the connection state by the runtime.
     */
    disconnect () {
        if (this._connected) {
            this._connected = false;
        }
        if (this._serial) {
            this._serial.close().catch(e => this.handleDisconnectError(e));
        }
        this._serial = null;
        this._runtime.emit(this._runtime.constructor.PERIPHERAL_DISCONNECTED);
    }

    /**
     * @return {bool} whether the peripheral is connected.
     */
    isConnected () {
        return this._connected;
    }

    /**
     * @param {function} handler - event data handler
     */
    set ondata (handler) {
        this._serial.on('data', handler);
    }

    /**
     * Write data to the specified service.
     * @param {string} message - the message to send.
     * @param {string} encoding - the message encoding type.
     * @return {Promise} - a Promise which will resolve true when success to write.
     */
    write (message, encoding = null) {
        if (encoding === 'base64') {
            message = base64ToUint8Array(message);
            encoding = 'binary';
        }
        return this._serial.write(message, encoding);
    }

    /**
     * Write data to the specified service.
     * @param {string} filename - the file name.
     * @param {Buffer} buffer - the file buffer.
     * @return {Promise} - a Promise which will resolve true when success to transfer.
     */
    transfer (filename, buffer) {
        return transfer(this._serial, filename, buffer);
    }

    /**
     * Handle an error resulting from losing connection to a peripheral.
     *
     * This could be due to:
     * - battery depletion
     * - going out of bluetooth range
     * - being powered down
     *
     * Disconnect the device, and if the extension using this object has a
     * reset callback, call it. Finally, emit an error to the runtime.
     */
    handleDisconnectError (/* e */) {
        // log.error(`Serial error: ${e}`);

        if (!this._connected) return;

        this.disconnect();

        if (this._resetCallback) {
            this._resetCallback();
        }

        this._runtime.emit(this._runtime.constructor.PERIPHERAL_CONNECTION_LOST_ERROR, {
            message: `Scratch lost connection to`,
            extensionId: this._extensionId
        });
    }

    _handleRequestError (/* e */) {
        // log.error(`Serial error: ${e}`);

        this._runtime.emit(this._runtime.constructor.PERIPHERAL_REQUEST_ERROR, {
            message: `Scratch lost connection to`,
            extensionId: this._extensionId
        });
    }
}

module.exports = WebSerial;
