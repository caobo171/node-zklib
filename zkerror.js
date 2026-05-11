
/**
 * ZKError — wraps a transport-level Error with the device IP and command name
 * that produced it, so callers can correlate failures across multiple devices.
 *
 * All ZKLib public methods reject with a ZKError, never a raw Error.
 */

const ERROR_TYPES = {
    ECONNRESET: 'ECONNRESET',
    ECONNREFUSED: 'ECONNREFUSED',
    EADDRINUSE: 'EADDRINUSE',
    ETIMEDOUT: 'ETIMEDOUT',
}

class ZKError {
    /**
     * @param {Error} err     The underlying error.
     * @param {string} command  Logical command name (e.g. "[TCP] getUsers").
     * @param {string} ip       Device IP for correlation.
     */
    constructor(err, command, ip) {
        this.err = err
        this.ip = ip
        this.command = command
    }

    /**
     * Human-readable summary suitable for surfacing to end users.
     * @returns {string}
     */
    toast() {
        if (this.err.code === ERROR_TYPES.ECONNRESET) {
            return 'Another device is connecting to the device so the connection is interrupted'
        } else if (this.err.code === ERROR_TYPES.ECONNREFUSED) {
            return 'IP of the device is refused'
        } else {
            return this.err.message
        }
    }

    /**
     * Structured form for logging / serialization.
     * @returns {{ err: { message: string, code: string }, ip: string, command: string }}
     */
    getError() {
        return {
            err: {
                message: this.err.message,
                code: this.err.code,
            },
            ip: this.ip,
            command: this.command,
        }
    }
}

module.exports = {
    ZKError,
    ERROR_TYPES,
}