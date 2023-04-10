// const log = require('../util/log');
const {base64ToUint8Array} = require('../util/base64-util');

const CHUNK_SIZE = 255;

const serial = window.navigator.serial;

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
        this._port = null;

        this._connectCallback = connectCallback;
        this._connected = false;
        this._resetCallback = resetCallback;
        this._extensionId = extensionId;
        this._runtime = runtime;

        this._encoder = new TextEncoder();

        const {
            filters,
            serialOptions
        } = peripheralOptions;

        this._peripheralOptions = {filters};

        this._serialOptions = Object.assign({
            baudRate: 115200 // default
        }, serialOptions);

        this.requestPeripheral();

        serial.addEventListener('disconnect', this.handleDisconnectError.bind(this));
    }

    /**
     * Request connection to the peripheral.
     * Request user to choose a device, and then connect it automatically.
     */
    requestPeripheral () {
        serial.requestPort(this._peripheralOptions)
            .then(port => {
                this._port = port;
                this._reader = null;
                this._writer = null;
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
        if (!this._port) {
            this._handleRequestError(new Error('serial port is not chosen'));
            return;
        }
        this._port.open(this._serialOptions)
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

        if (this._reader) {
            this._reader.releaseLock();
        }

        if (this._writer) {
            this._writer.releaseLock();
        }

        if (this._port) {
            this._port.close();
        }

        this._port = null;

        this._runtime.emit(this._runtime.constructor.PERIPHERAL_DISCONNECTED);
    }

    /**
     * @return {bool} whether the peripheral is connected.
     */
    isConnected () {
        return this._connected;
    }

    /**
     * Read from the specified ble service.
     * @param {function} onChunk - callback for read chunk
     * @return {Promise} - a Promise from the remote read request which resolve Uint8Array.
     */
    read (onChunk = null) {
        if (!this._reader) {
            this._reader = this._port.readable.getReader();
        }
        return this._reader.read()
            .then((function dataReceived ({done, value}) {
                if (done) return;
                if (onChunk) {
                    onChunk(value);
                }
                return this._reader.read().then(dataReceived);
            }).bind(this))
            .catch(e => {
                this._handleRequestError(e);
            })
            .finally(() => {
                this._reader.releaseLock();
                this._reader = null;
                if (this._port) {
                    this.read(onChunk);
                }
            });
    }

    /**
     * Write data to the specified service.
     * @param {string} message - the message to send.
     * @param {string} encoding - the message encoding type.
     * @return {Promise} - a Promise which will resolve true when success to write.
     */
    write (message, encoding = null) {
        let data = message;
        switch (encoding) {
        case 'text':
            data = this._encoder.encode(message);
            break;
        case 'hex':
            data = message.replace(/\s+/g, '');
            if (/^[0-9A-Fa-f]+$/.test(data) && data.length % 2 === 0) {
                const hex = [];
                for (let i = 0; i < data.length; i = i + 2) {
                    const val = data.substring(i, i + 2);
                    hex.push(parseInt(val, 16));
                }
                data = Uint8Array.from(hex);
            } else {
                return Promise.reject(new Error(`Wrong HEX data: ${message}`));
            }
            break;
        case 'base64':
            data = base64ToUint8Array(message);
            break;
        }

        let counter = 0;
        const writer = this._port.writable.getWriter();
        const writeChunk = () => {
            if (counter * CHUNK_SIZE < data.length) {
                const start = counter * CHUNK_SIZE;
                const end = Math.min((counter + 1) * CHUNK_SIZE, data.length);
                const chunk = data.slice(start, end);
                return writer.write(chunk)
                    .then(() => {
                        counter++;
                        return writeChunk();
                    });
            }
            writer.releaseLock();
            this._writer = null;
            return Promise.resolve();
        };
        this._writer = writer;
        return writeChunk();
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
