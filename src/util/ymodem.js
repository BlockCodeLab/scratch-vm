const Buffer = require('buffer').Buffer;

const PACKET_SIZE = 1024;
// const SOH = 0x01 // 128 byte blocks
const STX = 0x02; // 1K blocks
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CA = 0x18; // 24
const CRC16 = 0x43; // 67 'C'
// const ABORT1 = 0x41 // 65
// const ABORT2 = 0x61 // 97

const crc16 = current => {
    let crc = 0x0;
    for (let index = 0; index < current.length; index++) {
        let code = (crc >>> 8) & 0xff;
        code ^= current[index] & 0xff;
        code ^= code >>> 4;
        crc = (crc << 8) & 0xffff;
        crc ^= code;
        code = (code << 5) & 0xffff;
        crc ^= code;
        code = (code << 7) & 0xffff;
        crc ^= code;
    }
    return crc;
};

/**
 * Make file header payload from file path and size
 * @param {string} filename -
 * @param {number} filesize -
 * @return {Buffer} -
 */
const makeFileHeader = (filename, filesize) => {
    const payload = Buffer.alloc(PACKET_SIZE, 0x00);
    let offset = 0;
    if (filename) {
        payload.write(filename, offset);
        offset = filename.length + 1;
    }
    if (filesize) {
        payload.write(`${filesize.toString()} `, offset);
    }
    return payload;
};

/**
 * Split buffer into multiple smaller buffers of the given size
 * @param {Buffer} buffer -
 * @param {number} size -
 * @param {number} fixedSize -
 * @return {Array<Buffer>} -
 */
const splitBuffer = (buffer, size, fixedSize) => {
    if (buffer.byteLength > size) {
        const array = [];
        let start = 0;
        let end = start + size - 1;
        while (start < buffer.byteLength) {
            if (end >= buffer.byteLength) {
                end = buffer.byteLength - 1;
            }
            const chunk = Buffer.alloc(fixedSize || end - start + 1, 0xff);
            buffer.copy(chunk, 0, start, end + 1);
            array.push(chunk);
            start = start + size;
            end = start + size - 1;
        }
        return array;
    }
    const buf = Buffer.alloc(fixedSize || size, 0xff);
    buffer.copy(buf, 0, 0, buffer.byteLength);
    return [buf];
};

/**
 * Transfer a file to serial port using ymodem protocol
 * @param {SerialPort} serial -
 * @param {string} filename -
 * @param {Buffer} buffer -
 * @returns {Promise} -
 */
const transfer = (serial, filename, buffer) => {
    return new Promise(resolve => {
        const queue = [];
        let totalBytes = 0;
        let writtenBytes = 0;
        let seq = 0;
        let session = false;
        let sending = false;
        let finished = false;

        // convert Uint8Array to Buffer
        buffer = Buffer.from(buffer.buffer);

        /* Send buffer to the serial port */
        const sendBuffer = buf => {
            const bulk = () => {
                const chunks = splitBuffer(buf, 256);
                const promises = chunks.map(chunk => {
                    const arr = new Uint8Array(chunk.buffer);
                    return serial.write(arr, 'binary');
                });
                return Promise.all(promises);
            };
            return bulk();
        };

        /* Send packet */
        const sendPacket = () => {
            if (seq < queue.length) {
                // make a packet (3 for packet header, YModem.PACKET_SIZE for payload, 2 for crc16)
                const packet = Buffer.alloc(3 + PACKET_SIZE + 2);
                // header
                packet[0] = STX;
                packet[1] = seq;
                packet[2] = 0xff - packet[1];
                // payload
                const payload = queue[seq];
                payload.copy(packet, 3);
                // crc16
                const crc = crc16(payload);
                packet.writeUInt16BE(crc, packet.byteLength - 2);
                // send
                sendBuffer(packet);
            } else if (sending) {
                // send EOT
                sendBuffer(Buffer.from([EOT]));
            }
        };

        /* Handler for data from Ymodem */
        let close = () => {};
        const handler = data => {
            for (let i = 0; i < data.byteLength; i++) {
                if (!finished) {
                    const ch = data[i];
                    if (ch === CRC16) {
                        if (!sending) {
                            sendPacket();
                            sending = true;
                        }
                    } else if (ch === ACK) {
                        if (!session) {
                            close();
                        }
                        if (sending) {
                            if (seq < queue.length) {
                                if (writtenBytes < totalBytes) {
                                    writtenBytes = (seq + 1) * PACKET_SIZE;
                                    if (writtenBytes > totalBytes) {
                                        writtenBytes = totalBytes;
                                    }
                                }
                                seq++;
                                sendPacket();
                            } else {
                                /* send complete */
                                if (session) {
                                    /* file sent successfully */
                                }
                                sending = false;
                                session = false;
                                // send null header for end of session
                                const endsession = Buffer.alloc(PACKET_SIZE + 5, 0x00);
                                endsession[0] = STX;
                                endsession[1] = 0x00;
                                endsession[2] = 0xff;
                                sendBuffer(endsession);
                            }
                        }
                    } else if (ch === NAK) {
                        sendPacket();
                    } else if (ch === CA) {
                        close();
                    }
                }
            }
        };

        /* Finish transmittion */
        close = () => {
            session = false;
            sending = false;
            serial.removeListener('data', handler);
            if (!finished) {
                const result = {
                    filePath: filename,
                    totalBytes: totalBytes,
                    writtenBytes: writtenBytes
                };
                resolve(result);
            }
            finished = true;
        };

        // Make file header payload
        totalBytes = buffer.byteLength;
        const headerPayload = makeFileHeader(filename, totalBytes);
        queue.push(headerPayload);

        // Make file data packets
        const payloads = splitBuffer(buffer, PACKET_SIZE, PACKET_SIZE);
        payloads.forEach(payload => {
            queue.push(payload);
        });

        // Start to transfer
        session = true;
        serial.on('data', handler);
    });
};

module.exports = transfer;
