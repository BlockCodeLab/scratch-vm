// const log = require('../util/log');
const {base64ToUint8Array} = require('../util/base64-util');

class WebBLE {

    /**
     * A BLE peripheral object.  It handles connecting, over web bluetooth, to
     * BLE peripherals, and reading and writing data to them.
     * @param {Runtime} runtime - the Runtime for sending/receiving GUI update events.
     * @param {string} extensionId - the id of the extension using this bluetooth.
     * @param {object} peripheralOptions - the list of options for peripheral discovery.
     * @param {object} connectCallback - a callback for connection.
     * @param {object} resetCallback - a callback for resetting extension state.
     */
    constructor (runtime, extensionId, peripheralOptions, connectCallback, resetCallback = null) {
        this._device = null;
        this._server = null;

        this._connectCallback = connectCallback;
        this._connected = false;
        this._characteristicDidChangeCallback = null;
        this._resetCallback = resetCallback;
        this._extensionId = extensionId;
        this._peripheralOptions = peripheralOptions;
        this._runtime = runtime;

        this.requestPeripheral();
    }

    /**
     * Request connection to the peripheral.
     * Request user to choose a device, and then connect it automatically.
     */
    requestPeripheral () {
        window.navigator.bluetooth.requestDevice(this._peripheralOptions)
            .then(device => {
                this._device = device;
                this._runtime.connectPeripheral(this._extensionId, device.id);
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
        if (!this._device) {
            this._handleRequestError(new Error('device is not chosen'));
            return;
        }
        this._device.gatt.connect()
            .then(server => {
                this._server = server;
                this._connected = true;
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_CONNECTED);
                this._connectCallback();
                this._device.addEventListener('gattserverdisconnected', () => {
                    this.disconnect();
                });
            })
            .catch(e => {
                this._handleRequestError(e);
            });
    }

    /**
     * Disconnect the device.
     */
    disconnect () {
        if (this._connected) {
            this._connected = false;
        }

        if (this._server && this._server.connected) {
            this._server.disconnect();
        }

        this._device = null;
        this._server = null;

        // Sets connection status icon to orange
        this._runtime.emit(this._runtime.constructor.PERIPHERAL_DISCONNECTED);
    }

    /**
     * @return {bool} whether the peripheral is connected.
     */
    isConnected () {
        return this._connected;
    }

    /**
     * Start receiving notifications from the specified ble service.
     * @param {number} serviceId - the ble service to read.
     * @param {number} characteristicId - the ble characteristic to get notifications from.
     * @param {object} onCharacteristicChanged - callback for characteristic change notifications.
     * @return {Promise} - a promise from the remote startNotifications request.
     */
    startNotifications (serviceId, characteristicId, onCharacteristicChanged = null) {
        return this._server.getPrimaryService(serviceId)
            .then(service => service.getCharacteristic(characteristicId))
            .then(characteristic => {
                characteristic.stopNotifications();
                characteristic.oncharacteristicvaluechanged = event => {
                    const dataView = event.target.value;
                    const buffer = new Uint8Array(dataView.buffer);
                    if (onCharacteristicChanged) {
                        onCharacteristicChanged(buffer);
                    }
                };
                characteristic.startNotifications();
            });
    }

    /**
     * Read from the specified ble service.
     * @param {number} serviceId - the ble service to read.
     * @param {number} characteristicId - the ble characteristic to read.
     * @param {boolean} optStartNotifications - whether to start receiving characteristic change notifications.
     * @param {object} onCharacteristicChanged - callback for characteristic change notifications.
     * @return {Promise} - a promise from the remote read request.
     */
    read (serviceId, characteristicId, optStartNotifications = false, onCharacteristicChanged = null) {
        return this._server.getPrimaryService(serviceId)
            .then(service => service.getCharacteristic(characteristicId))
            .then(characteristic => {
                if (optStartNotifications) {
                    characteristic.stopNotifications();
                    characteristic.oncharacteristicvaluechanged = event => {
                        const dataView = event.target.value;
                        const buffer = new Uint8Array(dataView.buffer);
                        if (onCharacteristicChanged) {
                            onCharacteristicChanged(buffer);
                        }
                    };
                    characteristic.startNotifications();
                }
                return characteristic.readValue();
            })
            .then(dataView => ({
                message: new Uint8Array(dataView.buffer)
            }))
            .catch(e => {
                this.handleDisconnectError(e);
            });
    }

    /**
     * Write data to the specified ble service.
     * @param {number} serviceId - the ble service to write.
     * @param {number} characteristicId - the ble characteristic to write.
     * @param {string} message - the message to send.
     * @param {string} encoding - the message encoding type.
     * @param {boolean} withResponse - if true, resolve after peripheral's response.
     * @return {Promise} - a promise from the remote send request.
     */
    write (serviceId, characteristicId, message, encoding = null, withResponse = null) {
        const data = encoding === 'base64' ? base64ToUint8Array(message) : message;
        return this._server.getPrimaryService(serviceId)
            .then(service => service.getCharacteristic(characteristicId))
            .then(characteristic => {
                if (withResponse && characteristic.writeValueWithResponse) {
                    return characteristic.writeValueWithResponse(data);
                }
                if (characteristic.writeValueWithoutResponse) {
                    return characteristic.writeValueWithoutResponse(data);
                }
                return characteristic.writeValue(data);
            })
            .catch(e => {
                this.handleDisconnectError(e);
            });
    }

    /**
     * Handle an error resulting from losing connection to a peripheral.
     *
     * This could be due to:
     * - battery depletion
     * - going out of bluetooth range
     * - being powered down
     *
     * Disconnect the socket, and if the extension using this socket has a
     * reset callback, call it. Finally, emit an error to the runtime.
     */
    handleDisconnectError (/* e */) {
        // log.error(`BLE error: ${e}`);

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
        // log.error(`BLE error: ${e}`);

        this._runtime.emit(this._runtime.constructor.PERIPHERAL_REQUEST_ERROR, {
            message: `Scratch lost connection to`,
            extensionId: this._extensionId
        });
    }
}

module.exports = WebBLE;
