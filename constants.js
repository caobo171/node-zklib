module.exports.COMMANDS = {
    CMD_CONNECT:1000,
    CMD_EXIT:1001,
    CMD_ENABLEDEVICE:1002,
    CMD_DISABLEDEVICE:1003,
    CMD_RESTART:1004,
    CMD_POWEROFF:1005,
    CMD_SLEEP:1006,
    CMD_RESUME:1007,
    CMD_CAPTUREFINGER:1009,
    CMD_TEST_TEMP:1011,
    CMD_CAPTUREIMAGE:1012,
    CMD_REFRESHDATA:1013,
    CMD_REFRESHOPTION:1014,
    CMD_TESTVOICE:1017,
    CMD_GET_VERSION:1100,
    CMD_CHANGE_SPEED:1101,
    CMD_AUTH:1102,
    CMD_PREPARE_DATA:1500,
    CMD_DATA:1501,
    CMD_FREE_DATA:1502,
    CMD_DATA_WRRQ:1503,
    CMD_DATA_RDY:1504,
    CMD_DB_RRQ:7,
    CMD_USER_WRQ:8,
    CMD_USERTEMP_RRQ:9,
    CMD_USERTEMP_WRQ:10,
    CMD_OPTIONS_RRQ:11,
    CMD_OPTIONS_WRQ:12,
    CMD_ATTLOG_RRQ:13,
    CMD_CLEAR_DATA:14,
    CMD_CLEAR_ATTLOG:15,
    CMD_DELETE_USER:18,
    CMD_DELETE_USERTEMP:19,
    CMD_CLEAR_ADMIN:20,
    CMD_USERGRP_RRQ:21,
    CMD_USERGRP_WRQ:22,
    CMD_USERTZ_RRQ:23,
    CMD_USERTZ_WRQ:24,
    CMD_GRPTZ_RRQ:25,
    CMD_GRPTZ_WRQ:26,
    CMD_TZ_RRQ:27,
    CMD_TZ_WRQ:28,
    CMD_ULG_RRQ:29,
    CMD_ULG_WRQ:30,
    CMD_UNLOCK:31,
    CMD_CLEAR_ACC:32,
    CMD_CLEAR_OPLOG:33,
    CMD_OPLOG_RRQ:34,
    CMD_GET_FREE_SIZES:50,
    CMD_ENABLE_CLOCK:57,
    CMD_STARTVERIFY:60,
    CMD_STARTENROLL:61,
    CMD_CANCELCAPTURE:62,
    CMD_STATE_RRQ:64,
    CMD_WRITE_LCD:66,
    CMD_CLEAR_LCD:67,
    CMD_GET_PINWIDTH:69,
    CMD_SMS_WRQ:70,
    CMD_SMS_RRQ:71,
    CMD_DELETE_SMS:72,
    CMD_UDATA_WRQ:73,
    CMD_DELETE_UDATA:74,
    CMD_DOORSTATE_RRQ:75,
    CMD_WRITE_MIFARE:76,
    CMD_EMPTY_MIFARE:78,
    CMD_VERIFY_WRQ:79,
    CMD_VERIFY_RRQ:80,
    CMD_TMP_WRITE:87,
    CMD_CHECKSUM_BUFFER:119,
    CMD_DEL_FPTMP:134,
    CMD_GET_TIME:201,
    CMD_SET_TIME:202,
    CMD_REG_EVENT:500,
    CMD_ACK_OK:2000,
    CMD_ACK_ERROR:2001,
    CMD_ACK_DATA:2002,
    CMD_ACK_RETRY:2003,
    CMD_ACK_REPEAT:2004,
    CMD_ACK_UNAUTH:2005,
    CMD_ACK_UNKNOWN:65535,
    CMD_ACK_ERROR_CMD:65533,
    CMD_ACK_ERROR_INIT:65532,
    CMD_ACK_ERROR_DATA:65531,
    EF_ATTLOG:1,
    EF_FINGER:2,
    EF_ENROLLUSER:4,
    EF_ENROLLFINGER:8,
    EF_BUTTON:16,
    EF_UNLOCK:32,
    EF_VERIFY:128,
    EF_FPFTR:256,
    EF_ALARM:512
}

module.exports.USHRT_MAX = 65535

module.exports.MAX_CHUNK = 65472

module.exports.REQUEST_DATA = {
    DISABLE_DEVICE :  Buffer.from([0,0,0,0]),
    GET_REAL_TIME_EVENT: Buffer.from([0x01,0x00,0x00, 0x00]),
    GET_ATTENDANCE_LOGS : Buffer.from([0x01, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    GET_USERS : Buffer.from([ 0x01, 0x09, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
}

// === Wire-format primitives ===
// "PP\x82}" — the fixed 4-byte marker every ZK TCP frame starts with.
// Source: https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md
module.exports.PROTOCOL = {
    TCP_MAGIC_PREFIX: Buffer.from([0x50, 0x50, 0x82, 0x7d]),
    TCP_PREFIX_LEN: 8,         // magic(4) + reserved(2) + payloadLen(2)
    ZK_HEADER_LEN: 8,          // command(2) + checksum(2) + sessionId(2) + replyId(2)
    TCP_FULL_HEADER_LEN: 16,   // TCP_PREFIX_LEN + ZK_HEADER_LEN
    UDP_MIN_DATA_REPLY: 13,    // smallest UDP payload that carries a usable reply
}

// === Record sizes (bytes per record) returned by the device. ===
// USER_TCP vs USER_UDP differ because older UDP-only firmwares emit a
// compact 28-byte user record; modern firmwares over TCP emit 72 bytes.
module.exports.PACKET_SIZES = {
    USER_TCP: 72,
    USER_UDP: 28,
    ATT_LOG_TCP: 40,
    ATT_LOG_UDP_FULL: 16,
    ATT_LOG_UDP_COMPACT: 8,    // some UDP devices emit half-width records
    REALTIME_LOG_TCP: 52,
    REALTIME_LOG_UDP: 18,
}

// === Byte offsets inside the CMD_GET_FREE_SIZES reply. ===
// Each value is a little-endian uint32 at the given offset.
module.exports.FREE_SIZES_OFFSETS = {
    USER_COUNT: 24,
    LOG_COUNT: 40,
    LOG_CAPACITY: 72,
}

// === Comm-key derivation (makeCommKey). ===
// Matches the reference implementation at zk-protocol/auth.md.
module.exports.AUTH = {
    COMM_KEY_TICKS: 50,
    COMM_KEY_XOR: ['Z', 'K', 'S', 'O'],
}

// === Timeouts (milliseconds). ===
// CONNECT is intentionally shorter than the user-supplied timeout because
// CMD_CONNECT/CMD_EXIT should fail fast — the device is either reachable or not.
module.exports.TIMEOUTS = {
    CONNECT: 2000,
    CLOSE_SOCKET: 2000,
    CHUNK_TCP: 10000,
    CHUNK_UDP: 3000,
    PACKET_END: 1000,
}