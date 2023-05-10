const EventEmitter = require('events').EventEmitter;
// const log = require('./log');

class Serial extends EventEmitter {
    constructor (port) {
        super();
        this.reader = null;
        this.port = port;
    }

    getInfo () {
        return this.port.getInfo();
    }

    open (options) {
        return new Promise((resolve, reject) => {
            this.port
                .open(options)
                .then(() => {
                    const readLoop = () => {
                        this.reader = this.port.readable.getReader();
                        this.reader.read()
                            .then(({value, done}) => {
                                this.reader.releaseLock();
                                if (value) {
                                    this.emit('data', value);
                                }
                                if (done) {
                                    // disconnect
                                    // log.log('disconnect in readLoop()');
                                } else {
                                    readLoop();
                                }
                            })
                            .catch((/* err */) => {
                                // log.error(err);
                                this.emit('disconnect');
                            });
                    };
                    readLoop();
                    this.emit('connect');
                    resolve();
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    close () {
        return new Promise((resolve, reject) => {
            if (this.reader) {
                this.reader.cancel()
                    .then(() => this.port.close())
                    .then(() => resolve())
                    .catch(err => reject(err));
            } else {
                this.reader = null;
                this.port.close()
                    .then(() => resolve())
                    .catch(err => reject(err));
            }
        });
    }

    write (data, encoding = 'text') {
        return new Promise((resolve, reject) => {
            const writer = this.port.writable.getWriter();
            if (encoding === 'text') {
                const encoder = new TextEncoder();
                writer.write(encoder.encode(data))
                    .then(() => resolve())
                    .catch(err => reject(err));
            } else if (encoding === 'binary') {
                writer.write(data)
                    .then(() => resolve())
                    .catch(err => reject(err));
            }
            writer.releaseLock();
        });
    }
}

module.exports = Serial;
