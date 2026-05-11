# node-zklib cleanup & integration-hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Option B cleanup to node-zklib: fix latent bugs, extract wire-format magic numbers into named constants, add load-bearing comments and JSDoc, and rewrite the README — without changing the public API.

**Architecture:** Edits are confined to the existing 8-file Node.js library. A single `constants.js` gains four new export groups (`PROTOCOL`, `PACKET_SIZES`, `FREE_SIZES_OFFSETS`, `AUTH`, `TIMEOUTS`); every other file is edited in-place to consume those names and to fix the bugs catalogued in the spec. There is no test suite — verification is by `node -c` syntax check, targeted `grep` audits for residual magic numbers, and read-back of changed regions.

**Tech Stack:** Node.js (>=10), pure stdlib (`net`, `dgram`, `fs`, `Buffer`). No deps.

**Spec:** `docs/superpowers/specs/2026-05-11-node-zklib-cleanup-design.md`

---

## File Structure

Files modified (no new files):
- `constants.js` — adds `PROTOCOL`, `PACKET_SIZES`, `FREE_SIZES_OFFSETS`, `AUTH`, `TIMEOUTS`.
- `utils.js` — magic-number replacements; rename `checkNotEvent*` → `isEventPacket*`; fix `this.decodeUDPHeader` reference; file header + protocol-shape comments.
- `zklibtcp.js` — fix auth-error reference; fix tautological length check; fix `ZKError` mis-construction; magic-number replacements; JSDoc on public methods; why-comments.
- `zklibudp.js` — fix timeout-percent formatting; add connect-gate to `executeCmd`; update rename callsites; magic-number replacements; why-comments.
- `zklib.js` — fix `protocol` default + connect-error message; full JSDoc on every public method; file header.
- `zkerror.js` — JSDoc.
- `helpers/errorLog.js` — fix minute/second mix-up; ISO filename.
- `package.json` — remove self-dependency.
- `README.md` — full rewrite per spec Section 4.

---

## Task 1: Add named constants to `constants.js`

**Files:**
- Modify: `constants.js`

- [ ] **Step 1: Read the current `constants.js`**

Run: `cat constants.js | head -120`
Expected: file ends at line 105 with `REQUEST_DATA` export and no other groups.

- [ ] **Step 2: Append the new constant groups**

Append the following block to the end of `constants.js`:

```js
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
```

- [ ] **Step 3: Syntax-check the file**

Run: `node -c constants.js`
Expected: exits 0, no output.

- [ ] **Step 4: Verify the new exports load**

Run: `node -e "const c = require('./constants'); console.log(Object.keys(c).sort().join(','))"`
Expected output (order-independent): `AUTH,COMMANDS,FREE_SIZES_OFFSETS,MAX_CHUNK,PACKET_SIZES,PROTOCOL,REQUEST_DATA,TIMEOUTS,USHRT_MAX`

- [ ] **Step 5: Commit**

```bash
git add constants.js
git commit -m "constants: add PROTOCOL, PACKET_SIZES, FREE_SIZES_OFFSETS, AUTH, TIMEOUTS"
```

---

## Task 2: Remove self-dependency from `package.json`

**Files:**
- Modify: `package.json:27-29`

- [ ] **Step 1: Read current `dependencies` block**

Run: `cat package.json`
Expected: contains `"dependencies": { "node-zklib": "^1.0.0" }`.

- [ ] **Step 2: Replace the `dependencies` object with an empty one**

Edit `package.json` so the block reads:

```json
  "dependencies": {}
```

- [ ] **Step 3: Verify**

Run: `node -e "console.log(require('./package.json').dependencies)"`
Expected: `{}`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "package: remove self-dependency (caused install loops)"
```

---

## Task 3: Fix `helpers/errorLog.js` timestamp and filename

**Files:**
- Modify: `helpers/errorLog.js`

- [ ] **Step 1: Replace the file contents entirely**

Write `helpers/errorLog.js`:

```js
const fs = require('fs')

// Diagnostic logger used by transports. Writes to a per-day file in the cwd.
// File name uses ISO-8601 date (YYYY-MM-DD) so files sort chronologically.
// Timestamps include HH:MM:SS — the previous version logged seconds where
// minutes should have been, making time-of-day diagnostics misleading.
const pad2 = (n) => String(n).padStart(2, '0')

const parseCurrentTime = () => {
    const t = new Date()
    return {
        year: t.getFullYear(),
        month: t.getMonth() + 1,
        day: t.getDate(),
        hour: t.getHours(),
        minute: t.getMinutes(),
        second: t.getSeconds(),
    }
}

module.exports.log = (text) => {
    const t = parseCurrentTime()
    const filename = `${t.year}-${pad2(t.month)}-${pad2(t.day)}.err.log`
    const stamp = `${pad2(t.hour)}:${pad2(t.minute)}:${pad2(t.second)}`
    fs.appendFile(filename, `\n[${stamp}] ${text}`, () => {})
}
```

- [ ] **Step 2: Syntax-check**

Run: `node -c helpers/errorLog.js`
Expected: exits 0.

- [ ] **Step 3: Smoke-test the log function**

Run: `node -e "require('./helpers/errorLog').log('plan-task-3-smoke'); setTimeout(()=>{},200)"`
Then run: `ls *.err.log`
Expected: a file matching `YYYY-MM-DD.err.log` exists in the cwd.

Clean up the test log: `rm *.err.log`

- [ ] **Step 4: Commit**

```bash
git add helpers/errorLog.js
git commit -m "helpers: fix log timestamp (minute slot) and ISO date filename"
```

---

## Task 4: Update `utils.js` — magic numbers, rename, fix `this.` reference

**Files:**
- Modify: `utils.js`

This task touches several discrete spots. Apply edits in order.

- [ ] **Step 1: Update the require to pull in new constants**

Replace line 1:

```js
const { USHRT_MAX , COMMANDS } = require('./constants')
```

With:

```js
const { USHRT_MAX, COMMANDS, PROTOCOL, AUTH } = require('./constants')
const { log } = require('./helpers/errorLog')
```

(The second line already exists at line 2; leave that line alone — i.e., only edit line 1.)

- [ ] **Step 2: Add a file-header comment**

Insert at the very top of the file, above line 1:

```js
/**
 * Protocol primitives for node-zklib.
 *
 * Contains: checksum, header (de)serialization for both TCP and UDP framings,
 * comm-key derivation (makeCommKey), and the fixed-width record decoders
 * (decodeUserData*, decodeRecordData*, decodeRecordRealTimeLog*) that parse
 * the device's binary reply payloads.
 *
 * Wire-format reference:
 *   https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md
 */
```

- [ ] **Step 3: Replace the TCP-prefix literal in `createTCPHeader`**

Find this line (currently line 87):

```js
    const prefixBuf = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0x13, 0x00, 0x00, 0x00])
```

Replace with:

```js
    // Frame: <magic 4B> <0x13 fixed byte> <reserved 1B> <payloadLen 2B LE>
    // The 0x13 byte is a fixed protocol constant required by the device.
    const prefixBuf = Buffer.concat([
        PROTOCOL.TCP_MAGIC_PREFIX,
        Buffer.from([0x13, 0x00, 0x00, 0x00]),
    ])
```

- [ ] **Step 4: Replace literals in `removeTcpHeader`**

Find:

```js
    if (buf.length < 8) {
      return buf;
    }
  
    if (buf.compare(Buffer.from([0x50, 0x50, 0x82, 0x7d]), 0, 4, 0, 4) !== 0) {
      return buf;
    }
  
    return buf.slice(8);
```

Replace with:

```js
    if (buf.length < PROTOCOL.TCP_PREFIX_LEN) {
      return buf;
    }

    // If the magic prefix isn't present, the buffer wasn't TCP-framed — leave it alone.
    if (buf.compare(PROTOCOL.TCP_MAGIC_PREFIX, 0, 4, 0, 4) !== 0) {
      return buf;
    }

    return buf.slice(PROTOCOL.TCP_PREFIX_LEN);
```

- [ ] **Step 5: Replace literal in `decodeTCPHeader`**

Find:

```js
    const recvData = header.subarray(8)
```

Replace with:

```js
    const recvData = header.subarray(PROTOCOL.TCP_PREFIX_LEN)
```

- [ ] **Step 6: Replace literals in `makeCommKey`**

Find:

```js
module.exports.makeCommKey = (key, sessionId, ticks = 50) => {
```

Replace with:

```js
module.exports.makeCommKey = (key, sessionId, ticks = AUTH.COMM_KEY_TICKS) => {
```

And find:

```js
  const xorKey = ["Z", "K", "S", "O"].map(c => c.charCodeAt(0));
```

Replace with:

```js
  const xorKey = AUTH.COMM_KEY_XOR.map(c => c.charCodeAt(0));
```

- [ ] **Step 7: Fix `this.decodeUDPHeader` in `checkNotEventUDP` (bug #7)**

Find (currently lines 233-236):

```js
module.exports.checkNotEventUDP = (data)=>{
  const commandId = this.decodeUDPHeader(data.subarray(0,8)).commandId
  return commandId === COMMANDS.CMD_REG_EVENT
}
```

Replace with the renamed function (also addresses bug #8 — see next step which renames `checkNotEventTCP`):

```js
// True when the packet is an unsolicited real-time event (CMD_REG_EVENT) rather
// than a reply to our last request. Used to skip event packets while waiting on
// a data reply — they would otherwise be parsed as part of the data stream.
module.exports.isEventPacketUDP = (data) => {
  const commandId = decodeUDPHeader(data.subarray(0, PROTOCOL.ZK_HEADER_LEN)).commandId
  return commandId === COMMANDS.CMD_REG_EVENT
}
```

- [ ] **Step 8: Promote `decodeUDPHeader` to a local const so Step 7 can call it**

This file currently assigns `decodeUDPHeader` as `module.exports.decodeUDPHeader = (header) => { ... }`. Step 7's rewrite calls `decodeUDPHeader(...)` directly. Change the assignment so a local binding exists.

Find:

```js
module.exports.decodeUDPHeader = (header)=> {
    const commandId = header.readUIntLE(0,2)
    const checkSum = header.readUIntLE(2,2)
    const sessionId = header.readUIntLE(4,2)
    const replyId = header.readUIntLE(6,2)
    return { commandId , checkSum , sessionId , replyId }
}
```

Replace with:

```js
// Header layout (8 bytes, little-endian):
//   0..1  commandId
//   2..3  checksum
//   4..5  sessionId
//   6..7  replyId
const decodeUDPHeader = (header) => {
    const commandId = header.readUIntLE(0, 2)
    const checkSum = header.readUIntLE(2, 2)
    const sessionId = header.readUIntLE(4, 2)
    const replyId = header.readUIntLE(6, 2)
    return { commandId, checkSum, sessionId, replyId }
}
module.exports.decodeUDPHeader = decodeUDPHeader
```

- [ ] **Step 9: Rename `checkNotEventTCP` → `isEventPacketTCP` (bug #8)**

Find:

```js
module.exports.checkNotEventTCP = (data)=> {
  try{
    data = removeTcpHeader(data)
    const commandId = data.readUIntLE(0,2)
    const event = data.readUIntLE(4,2)
    return event === COMMANDS.EF_ATTLOG && commandId === COMMANDS.CMD_REG_EVENT
  }catch(err){
    log(`[228] : ${err.toString()} ,${data.toString('hex')} `)
    return false 
  }
}
```

Replace with:

```js
// True when the packet is an unsolicited real-time attendance event.
// Mirror of isEventPacketUDP but on TCP frames; checks both the command and
// the event flag because TCP frames carry a wider envelope.
module.exports.isEventPacketTCP = (data) => {
  try {
    data = removeTcpHeader(data)
    const commandId = data.readUIntLE(0, 2)
    const event = data.readUIntLE(4, 2)
    return event === COMMANDS.EF_ATTLOG && commandId === COMMANDS.CMD_REG_EVENT
  } catch (err) {
    log(`[isEventPacketTCP] ${err.toString()} ${data.toString('hex')}`)
    return false
  }
}
```

- [ ] **Step 10: Syntax-check**

Run: `node -c utils.js`
Expected: exits 0.

- [ ] **Step 11: Verify exports**

Run: `node -e "const u = require('./utils'); console.log('isEventPacketTCP=' + typeof u.isEventPacketTCP, 'isEventPacketUDP=' + typeof u.isEventPacketUDP, 'old=' + typeof u.checkNotEventTCP)"`
Expected: `isEventPacketTCP=function isEventPacketUDP=function old=undefined`

- [ ] **Step 12: Commit**

```bash
git add utils.js
git commit -m "utils: extract magic numbers, rename checkNotEvent → isEventPacket, fix this.decodeUDPHeader"
```

Note: `zklibtcp.js` and `zklibudp.js` still import the old names — they will fail to load until Tasks 5 and 6 update them. That's acceptable because the test script doesn't run between tasks; if you want to verify mid-plan, do it after Task 6.

---

## Task 5: Update `zklibtcp.js` — bug fixes, magic numbers, JSDoc

**Files:**
- Modify: `zklibtcp.js`

- [ ] **Step 1: Update the require lines (top of file)**

Replace lines 4 and 5-13:

```js
const { MAX_CHUNK, COMMANDS, REQUEST_DATA } = require('./constants')
const { createTCPHeader,
  exportErrorMessage,
  removeTcpHeader,
  decodeUserData72,
  decodeRecordData40,
  decodeRecordRealTimeLog52,
  checkNotEventTCP,
  decodeTCPHeader,
  makeCommKey} = require('./utils')
```

With:

```js
const {
  MAX_CHUNK,
  COMMANDS,
  REQUEST_DATA,
  PROTOCOL,
  PACKET_SIZES,
  FREE_SIZES_OFFSETS,
  TIMEOUTS,
} = require('./constants')
const {
  createTCPHeader,
  exportErrorMessage,
  removeTcpHeader,
  decodeUserData72,
  decodeRecordData40,
  decodeRecordRealTimeLog52,
  isEventPacketTCP,
  decodeTCPHeader,
  makeCommKey,
} = require('./utils')
```

- [ ] **Step 2: Add file header**

Insert at the very top of the file:

```js
/**
 * TCP transport for node-zklib.
 *
 * Implements the same operation surface as zklibudp.js but over a streamed
 * net.Socket connection. Owns sessionId/replyId handshake state and chunks
 * large data replies into MAX_CHUNK-sized requests. All operations require a
 * prior successful connect(); methods called before connect reject through
 * the executeCmd gate.
 */
```

- [ ] **Step 3: Fix bug #10 — `ZKError` mis-construction in `executeCmd`**

Find (currently line 191-193):

```js
      if (![COMMANDS.CMD_CONNECT, COMMANDS.CMD_AUTH].includes(command) && !this.is_connect) {
        throw new ZKError("instance are not connected")
      }
```

Replace with:

```js
      if (![COMMANDS.CMD_CONNECT, COMMANDS.CMD_AUTH].includes(command) && !this.is_connect) {
        // Reject (not throw) so the surrounding Promise resolves correctly.
        // Use the ZKError constructor signature: (err, command, ip).
        return reject(new ZKError(new Error('NOT_CONNECTED'), 'executeCmd', this.ip))
      }
```

- [ ] **Step 4: Fix bug #1 — undefined `responseCMD` in auth error**

Find (currently line 76):

```js
            reject(new Error("error de authenticacion", responseCMD))
```

Replace with:

```js
            reject(new Error('AUTH_FAILED: 0x' + reply.readUInt16LE(0).toString(16)))
```

- [ ] **Step 5: Fix bug #5 — tautological length check**

Find (currently line 208):

```js
        if (rReply && rReply.length && rReply.length >= 0) {
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = rReply.readUInt16LE(4);
          }
        }
```

Replace with:

```js
        // Only parse the session id when the reply is at least one full ZK header.
        if (rReply && rReply.length >= PROTOCOL.ZK_HEADER_LEN) {
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = rReply.readUInt16LE(4);
          }
        }
```

- [ ] **Step 6: Replace `checkNotEventTCP` callsites**

This is a literal rename. There are three callsites; do a `replace_all` on `checkNotEventTCP` → `isEventPacketTCP` within this file.

Affected lines: 140, 299, 510.

- [ ] **Step 7: Replace `closeSocket` timeout**

Find (currently lines 100-102):

```js
      const timer = setTimeout(() => {
        resolve(true)
      }, 2000)
```

Replace with:

```js
      // Devices occasionally don't send FIN — resolve anyway after the fallback.
      const timer = setTimeout(() => {
        resolve(true)
      }, TIMEOUTS.CLOSE_SOCKET)
```

- [ ] **Step 8: Replace `writeMessage` connect timeout**

Find (currently lines 118-122):

```js
          timer = await setTimeout(() => {
            clearTimeout(timer)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? 2000 : this.timeout)
```

Replace with:

```js
          // Connect/exit commands get a fixed short window; data commands honor user timeout.
          timer = setTimeout(() => {
            clearTimeout(timer)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? TIMEOUTS.CONNECT : this.timeout)
```

(Also removes the spurious `await` in front of `setTimeout`, which returned a Timeout object the await unwrapped to itself — harmless but misleading.)

- [ ] **Step 9: Replace `requestData` magic numbers**

Find (currently line 142):

```js
        const header = decodeTCPHeader(replyBuffer.subarray(0,16));
```

Replace with:

```js
        const header = decodeTCPHeader(replyBuffer.subarray(0, PROTOCOL.TCP_FULL_HEADER_LEN));
```

Find (currently lines 145-147):

```js
        if(header.commandId === COMMANDS.CMD_DATA){
          timer = setTimeout(()=>{
            internalCallback(replyBuffer)
          }, 1000)
```

Replace with:

```js
        if (header.commandId === COMMANDS.CMD_DATA) {
          // After a CMD_DATA frame we wait a short quiet period before resolving,
          // because the device sometimes splits the payload across two writes.
          timer = setTimeout(() => {
            internalCallback(replyBuffer)
          }, TIMEOUTS.PACKET_END)
```

- [ ] **Step 10: Replace `readWithBuffer` magic numbers**

Find (currently line 257):

```js
      const header = decodeTCPHeader(reply.subarray(0, 16))
```

Replace with:

```js
      const header = decodeTCPHeader(reply.subarray(0, PROTOCOL.TCP_FULL_HEADER_LEN))
```

Find (currently line 260):

```js
          resolve({ data: reply.subarray(16), mode: 8 })
```

Replace with:

```js
          resolve({ data: reply.subarray(PROTOCOL.TCP_FULL_HEADER_LEN), mode: 8 })
```

Find (currently line 267):

```js
          const recvData = reply.subarray(16)
```

Replace with:

```js
          const recvData = reply.subarray(PROTOCOL.TCP_FULL_HEADER_LEN)
```

Find (currently lines 283-286):

```js
          const timeout = 10000
          let timer = setTimeout(() => {
            internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)
```

Replace with:

```js
          const timeout = TIMEOUTS.CHUNK_TCP
          let timer = setTimeout(() => {
            internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)
```

Find (currently lines 308-311):

```js
            if (totalBuffer.length >= 8 + packetLength) {

              realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8 + packetLength)])
              totalBuffer = totalBuffer.subarray(8 + packetLength)
```

Replace with:

```js
            if (totalBuffer.length >= PROTOCOL.TCP_PREFIX_LEN + packetLength) {

              realTotalBuffer = Buffer.concat([
                realTotalBuffer,
                totalBuffer.subarray(PROTOCOL.TCP_FULL_HEADER_LEN, PROTOCOL.TCP_PREFIX_LEN + packetLength),
              ])
              totalBuffer = totalBuffer.subarray(PROTOCOL.TCP_PREFIX_LEN + packetLength)
```

Find (currently lines 313-318):

```js
              if ((totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + 8)
                || (totalPackets === 1 && realTotalBuffer.length === remain + 8)) {

                replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)])
```

Replace with:

```js
              if ((totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + PROTOCOL.ZK_HEADER_LEN)
                || (totalPackets === 1 && realTotalBuffer.length === remain + PROTOCOL.ZK_HEADER_LEN)) {

                replyData = Buffer.concat([replyData, realTotalBuffer.subarray(PROTOCOL.ZK_HEADER_LEN)])
```

- [ ] **Step 11: Replace `getUsers` packet-size literal**

Find (currently lines 390-399):

```js
    const USER_PACKET_SIZE = 72

    let userData = data.data.subarray(4)

    let users = []

    while (userData.length >= USER_PACKET_SIZE) {
      const user = decodeUserData72(userData.subarray(0, USER_PACKET_SIZE))
      users.push(user)
      userData = userData.subarray(USER_PACKET_SIZE)
```

Replace with:

```js
    // TCP firmwares emit 72-byte user records. The first 4 bytes of the reply
    // payload are a count header — skip them before record parsing.
    const recordSize = PACKET_SIZES.USER_TCP

    let userData = data.data.subarray(4)
    const users = []

    while (userData.length >= recordSize) {
      users.push(decodeUserData72(userData.subarray(0, recordSize)))
      userData = userData.subarray(recordSize)
```

- [ ] **Step 12: Replace `getAttendances` packet-size literal**

Find (currently lines 442-450):

```js
    const RECORD_PACKET_SIZE = 40

    let recordData = data.data.subarray(4)
    let records = []
    while (recordData.length >= RECORD_PACKET_SIZE) {
      const record = decodeRecordData40(recordData.subarray(0, RECORD_PACKET_SIZE))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(RECORD_PACKET_SIZE)
    }
```

Replace with:

```js
    // First 4 bytes of payload = count header; remainder is fixed-width records.
    const recordSize = PACKET_SIZES.ATT_LOG_TCP

    let recordData = data.data.subarray(4)
    const records = []
    while (recordData.length >= recordSize) {
      const record = decodeRecordData40(recordData.subarray(0, recordSize))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(recordSize)
    }
```

- [ ] **Step 13: Replace `getInfo` offset literals**

Find (currently lines 486-491):

```js
      return {
        userCounts: data.readUIntLE(24, 4),
        logCounts: data.readUIntLE(40, 4),
        logCapacity: data.readUIntLE(72, 4)
      }
```

Replace with:

```js
      // CMD_GET_FREE_SIZES reply layout — see FREE_SIZES_OFFSETS.
      return {
        userCounts: data.readUIntLE(FREE_SIZES_OFFSETS.USER_COUNT, 4),
        logCounts: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_COUNT, 4),
        logCapacity: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_CAPACITY, 4),
      }
```

- [ ] **Step 14: Replace `getRealTimeLogs` magic number**

Find (currently lines 510-514):

```js
    this.socket.listenerCount('data') === 0 && this.socket.on('data', (data) => {

      if (!checkNotEventTCP(data)) return;
      if (data.length > 16) {
        cb(decodeRecordRealTimeLog52(data))
      }
```

Replace with:

```js
    this.socket.listenerCount('data') === 0 && this.socket.on('data', (data) => {

      // Only forward real-time event packets; ignore replies to other in-flight commands.
      if (!isEventPacketTCP(data)) return;
      if (data.length > PROTOCOL.TCP_FULL_HEADER_LEN) {
        cb(decodeRecordRealTimeLog52(data))
      }
```

- [ ] **Step 15: Remove the dead `getSmallAttendanceLogs` stub**

Find (currently lines 354-356):

```js
  async getSmallAttendanceLogs(){

  }
```

Delete those three lines. (It's an empty unreachable method.)

- [ ] **Step 16: Syntax-check**

Run: `node -c zklibtcp.js`
Expected: exits 0.

- [ ] **Step 17: Audit residual magic numbers**

Run:
```bash
grep -nE '\b(72|40|28|52|16)\b' zklibtcp.js | grep -vE '(// |readUIntLE\([A-Z_.]+, 4\)|getMaxListeners)' || echo "OK"
```
Expected: only references that legitimately use those literals (e.g., none after the rewrites). Manually verify any remaining hits are intentional.

- [ ] **Step 18: Commit**

```bash
git add zklibtcp.js
git commit -m "zklibtcp: fix auth-error, ZKError ctor, length check; extract magic numbers"
```

---

## Task 6: Update `zklibudp.js` — bug fixes, rename callsites, magic numbers

**Files:**
- Modify: `zklibudp.js`

- [ ] **Step 1: Update requires**

Replace lines 4-14:

```js
const {
  createUDPHeader,
  decodeUserData28,
  decodeRecordData16,
  decodeRecordRealTimeLog18,
  decodeUDPHeader,
  exportErrorMessage,
  checkNotEventUDP
} = require('./utils')

const { MAX_CHUNK, REQUEST_DATA, COMMANDS } = require('./constants')
```

With:

```js
const {
  createUDPHeader,
  decodeUserData28,
  decodeRecordData16,
  decodeRecordRealTimeLog18,
  decodeUDPHeader,
  exportErrorMessage,
  isEventPacketUDP,
} = require('./utils')

const {
  MAX_CHUNK,
  REQUEST_DATA,
  COMMANDS,
  PROTOCOL,
  PACKET_SIZES,
  FREE_SIZES_OFFSETS,
  TIMEOUTS,
} = require('./constants')

const { ZKError } = require('./zkerror')
```

- [ ] **Step 2: Add file header**

Insert at the very top:

```js
/**
 * UDP transport for node-zklib.
 *
 * Parallels zklibtcp.js but talks to the device over dgram. Owns its own
 * sessionId/replyId handshake state and reassembles chunked data replies.
 * UDP firmwares are typically older and use compact (28-byte user, 16-byte
 * attendance) record layouts — see PACKET_SIZES.
 */
```

- [ ] **Step 3: Add `is_connect` field and connect-gate to `executeCmd` (bug #6)**

Find (currently lines 19-28):

```js
  constructor(ip, port, timeout, inport, comm_key) {
    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.socket = null
    this.sessionId = null
    this.replyId = 0
    this.inport = inport
    this.comm_key = comm_key
  }
```

Replace with:

```js
  constructor(ip, port, timeout, inport, comm_key) {
    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.socket = null
    this.sessionId = null
    this.replyId = 0
    this.inport = inport
    this.comm_key = comm_key
    // Mirrors zklibtcp's gate — set true after a successful CMD_CONNECT.
    this.is_connect = false
  }
```

Find the `connect()` method (currently lines 55-68):

```js
  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')
        if (reply) {
          resolve(true)
        } else {
          reject(new Error('NO_REPLY_ON_CMD_CONNECT'))
        }
      } catch (err) {
        reject(err)
      }
    })
  }
```

Replace with:

```js
  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')
        if (reply) {
          this.is_connect = true
          resolve(true)
        } else {
          reject(new Error('NO_REPLY_ON_CMD_CONNECT'))
        }
      } catch (err) {
        reject(err)
      }
    })
  }
```

Find `executeCmd` opening (currently lines 156-164):

```js
  executeCmd(command, data) {
    return new Promise(async (resolve, reject) => {
      try {
        if (command === COMMANDS.CMD_CONNECT) {
          this.sessionId = 0
          this.replyId = 0
        } else {
          this.replyId++
        }
```

Replace with:

```js
  executeCmd(command, data) {
    return new Promise(async (resolve, reject) => {
      try {
        // Mirror TCP behavior: reject pre-connect calls. CMD_CONNECT/CMD_AUTH bypass the gate.
        if (![COMMANDS.CMD_CONNECT, COMMANDS.CMD_AUTH].includes(command) && !this.is_connect) {
          return reject(new ZKError(new Error('NOT_CONNECTED'), 'executeCmd', this.ip))
        }

        if (command === COMMANDS.CMD_CONNECT) {
          this.sessionId = 0
          this.replyId = 0
        } else {
          this.replyId++
        }
```

- [ ] **Step 4: Fix bug #4 — timeout-percent formatting**

Find (currently lines 264-267):

```js
            timer = setTimeout(() => {
              internalCallback(totalBuffer,
                new Error(`TIMEOUT !! ${(size - totalBuffer.length) / size} % REMAIN !  `))
            }, timeout)
```

Replace with:

```js
            timer = setTimeout(() => {
              const pct = Math.round((1 - totalBuffer.length / size) * 100)
              internalCallback(totalBuffer, new Error(`TIMEOUT — ${pct}% REMAIN`))
            }, timeout)
```

- [ ] **Step 5: Rename `checkNotEventUDP` callsites**

Do a `replace_all` on `checkNotEventUDP` → `isEventPacketUDP` within this file.

Affected lines: 121, 262, 474.

- [ ] **Step 6: Replace `closeSocket` and `writeMessage` magic timeouts**

Find (currently lines 83-86):

```js
      const timer = setTimeout(() => {
        resolve(true)
      }, 2000)
```

Replace with:

```js
      const timer = setTimeout(() => {
        resolve(true)
      }, TIMEOUTS.CLOSE_SOCKET)
```

Find (currently lines 101-106):

```js
        if (this.timeout) {
          sendTimeoutId = setTimeout(() => {
            clearTimeout(sendTimeoutId)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? 2000 : this.timeout)
        }
```

Replace with:

```js
        if (this.timeout) {
          sendTimeoutId = setTimeout(() => {
            clearTimeout(sendTimeoutId)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? TIMEOUTS.CONNECT : this.timeout)
        }
```

- [ ] **Step 7: Replace `requestData` magic number**

Find (currently line 127):

```js
        if (data.length >= 13) {
          internalCallback(data)
        }
```

Replace with:

```js
        if (data.length >= PROTOCOL.UDP_MIN_DATA_REPLY) {
          internalCallback(data)
        }
```

- [ ] **Step 8: Replace `readWithBuffer` magic numbers**

Find (currently line 222):

```js
      const header = decodeUDPHeader(reply.subarray(0, 8))
```

Replace with:

```js
      const header = decodeUDPHeader(reply.subarray(0, PROTOCOL.ZK_HEADER_LEN))
```

Find (currently line 226):

```js
          resolve({ data: reply.subarray(8), mode: 8, err: null })
```

Replace with:

```js
          resolve({ data: reply.subarray(PROTOCOL.ZK_HEADER_LEN), mode: 8, err: null })
```

Find (currently line 233):

```js
          const recvData = reply.subarray(8)
```

Replace with:

```js
          const recvData = reply.subarray(PROTOCOL.ZK_HEADER_LEN)
```

Find (currently lines 244-247):

```js
          const timeout = 3000
          let timer = setTimeout(() => {
            internalCallback(totalBuffer, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)
```

Replace with:

```js
          const timeout = TIMEOUTS.CHUNK_UDP
          let timer = setTimeout(() => {
            internalCallback(totalBuffer, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)
```

Find (currently line 275):

```js
                totalBuffer = Buffer.concat([totalBuffer, reply.subarray(8)])
```

Replace with:

```js
                totalBuffer = Buffer.concat([totalBuffer, reply.subarray(PROTOCOL.ZK_HEADER_LEN)])
```

- [ ] **Step 9: Replace `getUsers` packet-size literal**

Find (currently lines 339-347):

```js
    const USER_PACKET_SIZE = 28
    let userData = data.data.subarray(4)
    let users = []

    while (userData.length >= USER_PACKET_SIZE) {
      const user = decodeUserData28(userData.subarray(0, USER_PACKET_SIZE))
      users.push(user)
      userData = userData.subarray(USER_PACKET_SIZE)
    }
```

Replace with:

```js
    // UDP firmwares use compact 28-byte user records (no password/cardno).
    const recordSize = PACKET_SIZES.USER_UDP
    let userData = data.data.subarray(4)
    const users = []

    while (userData.length >= recordSize) {
      users.push(decodeUserData28(userData.subarray(0, recordSize)))
      userData = userData.subarray(recordSize)
    }
```

- [ ] **Step 10: Replace `getAttendances` packet-size literals**

Find (currently lines 387-413):

```js
    if (data.mode) {
      // Data too small to decode in a normal way  => we need a parameter to indicate this case 
      const RECORD_PACKET_SIZE = 8
      let recordData = data.data.subarray(4)

      let records = []
      while (recordData.length >= RECORD_PACKET_SIZE) {
        const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
        records.push({ ...record, ip: this.ip })
        recordData = recordData.subarray(RECORD_PACKET_SIZE)
      }

      return { data: records, err: data.err }

    } else {
      const RECORD_PACKET_SIZE = 16
      let recordData = data.data.subarray(4)

      let records = []
      while (recordData.length >= RECORD_PACKET_SIZE) {
        const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
        records.push({ ...record, ip: this.ip })
        recordData = recordData.subarray(RECORD_PACKET_SIZE)
      }

      return { data: records, err: data.err }
    }
```

Replace with:

```js
    // `data.mode` is set when the device returned a small (CMD_DATA inline) reply
    // — those use half-width 8-byte records. Otherwise the records are 16 bytes.
    const recordSize = data.mode ? PACKET_SIZES.ATT_LOG_UDP_COMPACT : PACKET_SIZES.ATT_LOG_UDP_FULL
    let recordData = data.data.subarray(4)
    const records = []

    while (recordData.length >= recordSize) {
      const record = decodeRecordData16(recordData.subarray(0, recordSize))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(recordSize)
    }

    return { data: records, err: data.err }
```

- [ ] **Step 11: Replace `getInfo` offset literals**

Find (currently lines 430-434):

```js
      return {
        userCounts: data.readUIntLE(24, 4),
        logCounts: data.readUIntLE(40, 4),
        logCapacity: data.readUIntLE(72, 4)
      }
```

Replace with:

```js
      return {
        userCounts: data.readUIntLE(FREE_SIZES_OFFSETS.USER_COUNT, 4),
        logCounts: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_COUNT, 4),
        logCapacity: data.readUIntLE(FREE_SIZES_OFFSETS.LOG_CAPACITY, 4),
      }
```

- [ ] **Step 12: Replace `getRealTimeLogs` magic number**

Find (currently lines 472-478):

```js
    this.socket.listenerCount('message') < 2 && this.socket.on('message', (data) => {

      if (!checkNotEventUDP(data)) return;
      if (data.length === 18) {
        cb(decodeRecordRealTimeLog18(data))
      }
    })
```

Replace with:

```js
    this.socket.listenerCount('message') < 2 && this.socket.on('message', (data) => {

      if (!isEventPacketUDP(data)) return;
      if (data.length === PACKET_SIZES.REALTIME_LOG_UDP) {
        cb(decodeRecordRealTimeLog18(data))
      }
    })
```

- [ ] **Step 13: Update `disconnect` to clear `is_connect`**

Find (currently lines 454-460):

```js
  async disconnect() {
    try {
      await this.executeCmd(COMMANDS.CMD_EXIT, '')
    } catch (err) {
    }
    return await this.closeSocket()
  }
```

Replace with:

```js
  async disconnect() {
    try {
      await this.executeCmd(COMMANDS.CMD_EXIT, '')
    } catch (err) {
      // CMD_EXIT errors are non-fatal — we still want to close the socket.
    }
    this.is_connect = false
    return await this.closeSocket()
  }
```

- [ ] **Step 14: Syntax-check**

Run: `node -c zklibudp.js`
Expected: exits 0.

- [ ] **Step 15: Verify the library still loads end-to-end**

Run: `node -e "const Z = require('./zklib'); console.log(typeof Z, typeof Z.prototype.createSocket)"`
Expected: `function function`

- [ ] **Step 16: Commit**

```bash
git add zklibudp.js
git commit -m "zklibudp: add connect-gate, fix timeout-pct, extract magic numbers, rename callsites"
```

---

## Task 7: Update `zklib.js` — protocol default, error message, JSDoc

**Files:**
- Modify: `zklib.js`

- [ ] **Step 1: Add file header and fix `protocol` default (bug #9)**

Find (currently lines 1-17):

```js
const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError , ERROR_TYPES } = require('./zkerror')

class ZKLib {
    constructor(ip, port, timeout , inport, comm_code = 0, protocol){
        this.connectionType = protocol

        this.zklibTcp = new ZKLibTCP(ip,port,timeout, comm_code) 
        this.zklibUdp = new ZKLibUDP(ip,port,timeout , inport, comm_code) 
        this.interval = null 
        this.timer = null
        this.isBusy = false
        this.ip = ip
        this.comm_code = comm_code || undefined
    }
```

Replace with:

```js
/**
 * node-zklib — public client class.
 *
 * Owns one ZKLibTCP and one ZKLibUDP transport. Every public method delegates
 * through functionWrapper(), which dispatches based on connectionType
 * ('tcp' | 'udp') and wraps thrown errors as ZKError instances.
 *
 * Connection strategy: createSocket() always tries TCP first; on ECONNREFUSED
 * it falls back to UDP. UDP EADDRINUSE during bind is treated as success
 * (socket already bound from a previous run).
 */
const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError, ERROR_TYPES } = require('./zkerror')

class ZKLib {
    /**
     * @param {string} ip          Device IP address.
     * @param {number} port        Device TCP/UDP port (typically 4370).
     * @param {number} timeout     Per-request timeout in milliseconds.
     * @param {number} inport      Local UDP bind port (used only on UDP fallback).
     * @param {number} [comm_code] Device communication password (0 = disabled).
     * @param {string} [protocol]  'tcp' | 'udp'. Omit to auto-detect (TCP, then UDP).
     */
    constructor(ip, port, timeout, inport, comm_code = 0, protocol = null) {
        // null until createSocket() succeeds; functionWrapper rejects calls before then.
        this.connectionType = protocol

        this.zklibTcp = new ZKLibTCP(ip, port, timeout, comm_code)
        this.zklibUdp = new ZKLibUDP(ip, port, timeout, inport, comm_code)
        this.interval = null
        this.timer = null
        this.isBusy = false
        this.ip = ip
        this.comm_code = comm_code || undefined
    }
```

- [ ] **Step 2: Improve the `default:` error message in `functionWrapper`**

Find (currently lines 59-65):

```js
            default:
                return Promise.reject(new ZKError(
                    new Error( `Socket isn't connected !`),
                    '',
                    this.ip
                ))
        }
```

Replace with:

```js
            default:
                return Promise.reject(new ZKError(
                    new Error("Socket isn't connected — call createSocket() first"),
                    command || 'functionWrapper',
                    this.ip
                ))
        }
```

- [ ] **Step 3: Add JSDoc to every public method**

For each method below, insert the JSDoc block immediately above its existing signature.

`createSocket`:
```js
    /**
     * Open the device connection. Tries TCP first, falls back to UDP on ECONNREFUSED.
     * @param {(err: Error) => void} [cbErr]   Optional socket-error callback.
     * @param {(transport: 'tcp' | 'udp') => void} [cbClose] Optional close callback.
     * @returns {Promise<void>} Rejects with ZKError if neither transport connects.
     */
```

`getUsers`:
```js
    /**
     * @returns {Promise<{ data: object[], err: Error|null }>}
     *   `data` is an array of users; shape differs by transport (see README).
     */
```

`getAttendances`:
```js
    /**
     * @param {(received: number, total: number) => void} [cb]
     *   Progress callback fired as chunks arrive.
     * @returns {Promise<{ data: object[], err: Error|null }>} Attendance records.
     */
```

`getRealTimeLogs`:
```js
    /**
     * Subscribe to real-time attendance events. Resolves immediately after
     * registering; events arrive via the callback until disconnect().
     * @param {(event: { userId: string, attTime: Date }) => void} cb
     */
```

`disconnect`:
```js
    /**
     * Send CMD_EXIT and close the socket. Safe to call when already disconnected.
     * @returns {Promise<boolean>}
     */
```

`freeData`:
```js
    /**
     * Tell the device to release its internal data buffer. Called automatically
     * before and after getUsers/getAttendances; rarely needed directly.
     */
```

`getTime`:
```js
    /** @returns {Promise<Date>} The device's current local time. */
```

`disableDevice`:
```js
    /** Put the device into a disabled state (no keyboard, no fingerprint). */
```

`enableDevice`:
```js
    /** Re-enable the device after disableDevice(). */
```

`getInfo`:
```js
    /**
     * @returns {Promise<{ userCounts: number, logCounts: number, logCapacity: number }>}
     */
```

`clearAttendanceLog`:
```js
    /**
     * Delete all attendance records on the device. Irreversible.
     * Recommended when the device approaches `logCapacity`; large logs slow it down.
     */
```

`executeCmd`:
```js
    /**
     * Send an arbitrary ZK protocol command. Use this for opcodes not covered
     * by a first-class method. Opcode reference:
     * https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md
     * @param {number} command  Numeric opcode (see COMMANDS in constants.js).
     * @param {Buffer|string} [data] Optional payload.
     */
```

(Skip `setIntervalSchedule` / `setTimerSchedule` / `getSocketStatus` — these are minor helpers and the spec only requires JSDoc on the user-facing surface. Leave them as is.)

- [ ] **Step 4: Syntax-check**

Run: `node -c zklib.js`
Expected: exits 0.

- [ ] **Step 5: Verify the library still loads**

Run: `node -e "const Z = require('./zklib'); const z = new Z('1.2.3.4', 4370, 1000, 4000); console.log(z.connectionType, z.ip)"`
Expected: `null 1.2.3.4`

- [ ] **Step 6: Commit**

```bash
git add zklib.js
git commit -m "zklib: default protocol to null, clarify connect error, add JSDoc"
```

---

## Task 8: Add JSDoc to `zkerror.js`

**Files:**
- Modify: `zkerror.js`

- [ ] **Step 1: Replace the file contents**

Write `zkerror.js`:

```js
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
```

- [ ] **Step 2: Syntax-check**

Run: `node -c zkerror.js`
Expected: exits 0.

- [ ] **Step 3: Verify exports**

Run: `node -e "const { ZKError, ERROR_TYPES } = require('./zkerror'); const e = new ZKError(new Error('x'), 'cmd', '1.2.3.4'); console.log(e.toast(), e.getError().ip)"`
Expected: `x 1.2.3.4`

- [ ] **Step 4: Commit**

```bash
git add zkerror.js
git commit -m "zkerror: add JSDoc, normalize formatting"
```

---

## Task 9: Rewrite `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the entire file**

Write `README.md`:

````markdown
# node-zklib

Lightweight Node.js client for ZKTeco biometric attendance terminals. Speaks the ZK binary protocol over TCP or UDP (default port 4370). No native dependencies.

## Install

```bash
npm install node-zklib
# or
yarn add node-zklib
```

## Quick start

```javascript
const ZKLib = require('node-zklib')

async function main() {
    // ip, port, timeout, udpInPort, comm_code, protocol
    const zk = new ZKLib('192.168.1.201', 4370, 10000, 4000, 0, 'tcp')

    try {
        await zk.createSocket()

        // Snapshot of device state — useful as a health check.
        console.log(await zk.getInfo())
        // → { userCounts, logCounts, logCapacity }

        const users = await zk.getUsers()
        console.log(`users: ${users.data.length}`)

        const logs = await zk.getAttendances((received, total) => {
            console.log(`progress: ${received}/${total}`)
        })
        console.log(`logs: ${logs.data.length}`)

        const now = await zk.getTime()
        console.log(`device time: ${now.toISOString()}`)

        // Real-time event subscription — fires on every check-in until disconnect.
        zk.getRealTimeLogs(event => console.log('event:', event))
    } catch (err) {
        console.error(err)
    } finally {
        // Skip this if you want the real-time subscription to keep running.
        await zk.disconnect()
    }
}

main()
```

## Constructor

```javascript
new ZKLib(ip, port, timeout, inport, comm_code, protocol)
```

| Argument    | Type    | Default     | Description                                                       |
|-------------|---------|-------------|-------------------------------------------------------------------|
| `ip`        | string  | —           | Device IP address.                                                |
| `port`      | number  | `4370`      | Device TCP/UDP port.                                              |
| `timeout`   | number  | `10000`     | Per-request timeout in milliseconds.                              |
| `inport`    | number  | —           | Local UDP bind port (used only on UDP fallback).                  |
| `comm_code` | number  | `0`         | Device "Comm Key" password. `0` disables auth; set if configured. |
| `protocol`  | string  | auto-detect | `'tcp'`, `'udp'`, or omit to try TCP then fall back to UDP.       |

## API

| Method | Returns | Notes |
|---|---|---|
| `createSocket(onErr?, onClose?)` | `Promise<void>` | Opens the connection. Tries TCP first, then UDP on `ECONNREFUSED`. Rejects with `ZKError` if neither works. |
| `getInfo()` | `Promise<{ userCounts, logCounts, logCapacity }>` | Device counters. |
| `getUsers()` | `Promise<{ data: User[], err }>` | Shape of `User` differs by transport — see Data shapes. |
| `getAttendances(onProgress?)` | `Promise<{ data: Record[], err }>` | `onProgress(received, total)` fires as chunks arrive. |
| `getRealTimeLogs(onEvent)` | `void` | `onEvent({ userId, attTime })` fires on every check-in. |
| `getTime()` | `Promise<Date>` | Device's local time. |
| `clearAttendanceLog()` | `Promise<*>` | Deletes every attendance record. Irreversible. |
| `disableDevice()` / `enableDevice()` | `Promise<*>` | Locks/unlocks the device UI. |
| `freeData()` | `Promise<*>` | Releases device buffer; rarely needed — wrappers call it automatically. |
| `executeCmd(command, data?)` | `Promise<Buffer>` | Sends an arbitrary opcode. |
| `disconnect()` | `Promise<boolean>` | Sends `CMD_EXIT` then closes the socket. Safe to call twice. |

All methods reject with a `ZKError` (see Error handling).

## Data shapes

**User (TCP firmwares — `getUsers()`):**
```javascript
{ uid, role, password, name, cardno, userId }
```

**User (UDP firmwares — older devices, compact 28-byte records):**
```javascript
{ uid, role, name, userId }
```

**Attendance record:**
```javascript
{ userSn, deviceUserId, recordTime: Date, ip }
```
On UDP the `userSn` field may be absent depending on firmware (records are 16 or 8 bytes vs. 40 on TCP).

**Real-time event:**
```javascript
{ userId: string, attTime: Date }
```

## Protocol selection

`createSocket()` always tries TCP first. TCP is preferred because:

- Frames are length-prefixed, so chunk reassembly is more reliable.
- The TCP path supports the modern 72-byte user record (includes password, card number).
- No local-port collision risk.

UDP is used when TCP `connect()` fails with `ECONNREFUSED` (i.e., the device only speaks UDP). On bind, UDP `EADDRINUSE` is treated as success — the underlying socket is already bound from a previous run.

**`comm_code`:** if the device has "Comm Key" set in its admin menu (a numeric password, typically 1–999999), pass it as `comm_code`. The library will derive an auth packet with `makeCommKey()` and send `CMD_AUTH` after `CMD_CONNECT`. Passing `0` (the default) skips auth and works on devices where Comm Key is disabled.

## Error handling

Every rejection is a `ZKError`:

```javascript
{
    err: { message, code },  // underlying transport error
    ip,                       // device IP — useful when polling many devices
    command,                  // e.g. "[TCP] getUsers"
}
```

Helpers:

```javascript
err.toast()      // → human-readable summary
err.getError()   // → structured object for logging
```

Common `err.code` values: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EADDRINUSE`.

## Extending

For opcodes not covered by a first-class method, use `executeCmd()` with constants from `constants.js`:

```javascript
const ZKLib = require('node-zklib')
const { COMMANDS } = require('node-zklib/constants')

// Unlock the door
await zk.executeCmd(COMMANDS.CMD_UNLOCK, '')
```

Full opcode reference: <https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md>

## Tested devices

| Model | Transport | Notes |
|---|---|---|
| _(maintainers: please open a PR to add your device)_ | | |

## License

ISC
````

- [ ] **Step 2: Verify the file is non-empty and renders**

Run: `wc -l README.md`
Expected: substantially larger than the original (~150-180 lines).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with API table, data shapes, protocol guide"
```

---

## Task 10: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Confirm no stale `checkNotEvent*` references remain**

Run: `grep -rn 'checkNotEvent' --include='*.js' .`
Expected: no output.

- [ ] **Step 2: Confirm wire-prefix literal is gone from transports**

Run: `grep -nE '0x50, ?0x50, ?0x82, ?0x7d' zklibtcp.js zklibudp.js utils.js`
Expected: only one hit — in `utils.js` where `PROTOCOL.TCP_MAGIC_PREFIX` is *defined* (via `constants.js` actually) or in `createTCPHeader` if you chose to leave the inline `0x13` companion. `zklibtcp.js`/`zklibudp.js` should be clean.

(Note: the magic prefix definition lives in `constants.js`, so a hit there is expected.)

- [ ] **Step 3: Confirm transports compile and the library still loads**

Run:
```bash
node -c utils.js && \
node -c zklibtcp.js && \
node -c zklibudp.js && \
node -c zklib.js && \
node -c constants.js && \
node -c zkerror.js && \
node -c helpers/errorLog.js && \
echo OK
```
Expected: `OK`

- [ ] **Step 4: Confirm instantiation and method surface**

Run:
```bash
node -e "
const Z = require('./zklib');
const z = new Z('1.2.3.4', 4370, 1000, 4000, 0, 'tcp');
const methods = ['createSocket','getInfo','getUsers','getAttendances','getRealTimeLogs','getTime','clearAttendanceLog','disableDevice','enableDevice','freeData','executeCmd','disconnect'];
console.log(methods.map(m => m + '=' + typeof z[m]).join(' '));
"
```
Expected: every method shows `=function`.

- [ ] **Step 5: Final commit (if anything was tweaked during verification)**

If Steps 1-4 surfaced anything, fix it now and:

```bash
git add -A
git commit -m "fix: residual cleanup from verification pass"
```

Otherwise: skip.

- [ ] **Step 6: Manual integration test (optional, requires a device)**

If a real device is reachable, edit `test.js` with its IP and run:

```bash
npm test
```

Expected: `getInfo`, `getUsers`, `getAttendances` all return data without throwing. This step is optional because the spec has no automated test infrastructure.

---

## Self-review notes

- **Spec coverage:** All 10 bug fixes (Section 1) mapped to specific tasks. All magic-number replacements (Section 2) mapped to specific find/replace steps. Comments policy (Section 3) applied across Tasks 4-8. README (Section 4) is Task 9. No spec section is unaddressed.
- **Placeholders:** None — every code block contains the actual replacement.
- **Type consistency:** Renamed functions are referenced consistently (`isEventPacketTCP` / `isEventPacketUDP`) in their declaration and at all callsites. New constant names (`PROTOCOL.*`, `PACKET_SIZES.*`, etc.) are declared in Task 1 and referenced thereafter exactly as declared.
- **No tests added:** This repo has no test suite (per CLAUDE.md). Each task substitutes `node -c` syntax checks and targeted `node -e` probes for the TDD red/green cycle. Behavior-changing bug fixes are verified by reading code paths, not by tests.
