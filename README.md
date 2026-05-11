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
