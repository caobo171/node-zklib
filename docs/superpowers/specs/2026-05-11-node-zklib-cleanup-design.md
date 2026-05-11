# node-zklib cleanup & integration-hardening — Design

**Date:** 2026-05-11
**Scope:** Option B (moderate) — fix unambiguous bugs, extract magic numbers into named constants, add load-bearing comments and JSDoc, rewrite README. Public API of `ZKLib` is preserved.

## Goals

1. Eliminate latent bugs that misreport errors, crash auth, or pollute installs.
2. Replace wire-format magic numbers with named constants so future contributors can map code to the ZK protocol spec without guessing.
3. Add comments that explain *why* (hidden invariants, protocol quirks), not *what*.
4. Make the README accurately describe the constructor, API surface, return shapes, and protocol behavior.

## Non-goals

- No restructuring into a shared base transport class (that's Option C).
- No new typed error hierarchy.
- No new public methods.
- No changes to the wire protocol or packet parsing logic.

## Section 1 — Bug fixes

All fixes preserve current happy-path behavior; they correct error paths or remove tautologies.

| # | File:Line | Issue | Fix |
|---|-----------|-------|-----|
| 1 | `zklibtcp.js:76` | `new Error("error de authenticacion", responseCMD)` — `responseCMD` is undefined; throws `ReferenceError` instead of an auth-failure error. | `reject(new Error('AUTH_FAILED: 0x' + reply.readUInt16LE(0).toString(16)))` |
| 2 | `package.json:28` | Self-dependency `"node-zklib": "^1.0.0"` causes install loops / yarn warnings. | Remove the line. |
| 3 | `helpers/errorLog.js:11,18` | Timestamp string uses `second` in the minute position; filename order `DDMMYYYY` doesn't sort chronologically. | Capture `minute` too; format `HH:MM:SS`; rename log file to `YYYY-MM-DD.err.log`. |
| 4 | `zklibudp.js:266` | Timeout message formats `(size - buffer.length) / size` as a "%" without `* 100`. | `Math.round((1 - buffer.length / size) * 100) + '%'` |
| 5 | `zklibtcp.js:208` | `if (rReply && rReply.length && rReply.length >= 0)` — `>= 0` is always true. | Replace with `if (rReply && rReply.length >= PROTOCOL.ZK_HEADER_LEN)`. |
| 6 | `zklibudp.js:156` | UDP `executeCmd` has no connect-gate; TCP rejects pre-connect commands. Inconsistency hides bugs in caller code. | Add the same `is_connect` check used by TCP. |
| 7 | `utils.js:233` | `checkNotEventUDP` calls `this.decodeUDPHeader` — relies on `module.exports` binding order. | Call `decodeUDPHeader` via a local `const`. |
| 8 | `utils.js:221`, `utils.js:233` and callsites in `zklibtcp.js`/`zklibudp.js` | `checkNotEventTCP` / `checkNotEventUDP` return `true` when the packet **is** an event — names read inverted. | Rename to `isEventPacketTCP` / `isEventPacketUDP`. Callsites (`if (checkNotEventTCP(data)) return;`) are updated to `if (isEventPacketTCP(data)) return;` — same semantics, clearer reading. |
| 9 | `zklib.js:7`, `zklib.js:59` | `protocol` default is `undefined`; `functionWrapper`'s `default:` rejects with empty `command` and a vague message. | Default to `null`; improve message to `"Socket isn't connected — call createSocket() first"`. |
| 10 | `zklibtcp.js:192` | `throw new ZKError("instance are not connected")` — wrong constructor signature (`ZKError(err, command, ip)`) so `.err` becomes a string. | `reject(new ZKError(new Error('NOT_CONNECTED'), 'executeCmd', this.ip))` |

### Verification

- `package.json`: `npm install` runs cleanly with no self-reference warning.
- Auth bug (#1): cannot reproduce without a device that rejects auth, but the fix removes the undefined-variable path; manual review only.
- Inverted-name rename (#8): grep for `checkNotEvent` — must return zero hits after.
- Magic-number replacements (Section 2): grep for the literal sequences must return zero hits in `zklibtcp.js` / `zklibudp.js` / `utils.js`.

## Section 2 — Magic-number extraction

Add a new top-level export object `PROTOCOL` (and siblings `PACKET_SIZES`, `FREE_SIZES_OFFSETS`, `AUTH`, `TIMEOUTS`) to `constants.js`. No new file — keeps the module surface flat.

```js
// === Wire format ===
PROTOCOL = {
  TCP_MAGIC_PREFIX: Buffer.from([0x50, 0x50, 0x82, 0x7d]), // "PP\x82}" — ZK TCP frame marker
  TCP_PREFIX_LEN: 8,        // magic(4) + reserved(2) + payloadLen(2)
  ZK_HEADER_LEN: 8,         // command(2) + checksum(2) + sessionId(2) + replyId(2)
  TCP_FULL_HEADER_LEN: 16,  // TCP_PREFIX_LEN + ZK_HEADER_LEN
}

// === Record sizes per firmware family ===
PACKET_SIZES = {
  USER_TCP: 72,              // modern firmwares (CMD_USERTEMP_RRQ over TCP)
  USER_UDP: 28,              // legacy / compact UDP firmwares
  ATT_LOG_TCP: 40,
  ATT_LOG_UDP_FULL: 16,
  ATT_LOG_UDP_COMPACT: 8,    // some UDP devices emit half-width records
  REALTIME_LOG_TCP: 52,
  REALTIME_LOG_UDP: 18,
}

// === Offsets in CMD_GET_FREE_SIZES reply ===
FREE_SIZES_OFFSETS = {
  USER_COUNT: 24,
  LOG_COUNT: 40,
  LOG_CAPACITY: 72,
}

// === Auth (comm-key derivation) ===
AUTH = {
  COMM_KEY_TICKS: 50,
  COMM_KEY_XOR: ['Z', 'K', 'S', 'O'],
}

// === Timeouts (ms) ===
TIMEOUTS = {
  CONNECT: 2000,
  CLOSE_SOCKET: 2000,
  CHUNK_TCP: 10000,
  CHUNK_UDP: 3000,
  PACKET_END: 1000,
}
```

### Callsite replacement table

| File | Before | After |
|------|--------|-------|
| `utils.js` `createTCPHeader` | `Buffer.from([0x50, 0x50, 0x82, 0x7d, 0x13, 0x00, 0x00, 0x00])` | `Buffer.concat([PROTOCOL.TCP_MAGIC_PREFIX, Buffer.from([0x13,0,0,0])])` (the `0x13` byte is a fixed protocol constant; keep it but commented) |
| `utils.js` `removeTcpHeader` | `compare(Buffer.from([0x50,0x50,0x82,0x7d]), 0, 4, 0, 4)` | `compare(PROTOCOL.TCP_MAGIC_PREFIX, ...)` and `slice(PROTOCOL.TCP_PREFIX_LEN)` |
| `utils.js` `decodeTCPHeader` | `header.subarray(8)` | `header.subarray(PROTOCOL.TCP_PREFIX_LEN)` |
| `utils.js` `makeCommKey` | `ticks = 50`, `["Z","K","S","O"]` | `ticks = AUTH.COMM_KEY_TICKS`, `AUTH.COMM_KEY_XOR` |
| `zklibtcp.js` `getUsers` | `const USER_PACKET_SIZE = 72` | `PACKET_SIZES.USER_TCP` |
| `zklibtcp.js` `getAttendances` | `const RECORD_PACKET_SIZE = 40` | `PACKET_SIZES.ATT_LOG_TCP` |
| `zklibtcp.js` `getRealTimeLogs` | `data.length > 16` | `data.length > PROTOCOL.TCP_FULL_HEADER_LEN` |
| `zklibtcp.js` `requestData` / `readWithBuffer` | `subarray(0, 16)` / `subarray(16)` | `PROTOCOL.TCP_FULL_HEADER_LEN` |
| `zklibtcp.js` `getInfo` | `(24,4)`, `(40,4)`, `(72,4)` | `FREE_SIZES_OFFSETS.*` |
| `zklibtcp.js` timeouts | `2000`, `1000`, `10000` | `TIMEOUTS.CONNECT`, `TIMEOUTS.PACKET_END`, `TIMEOUTS.CHUNK_TCP` |
| `zklibudp.js` `getUsers` | `const USER_PACKET_SIZE = 28` | `PACKET_SIZES.USER_UDP` |
| `zklibudp.js` `getAttendances` | `RECORD_PACKET_SIZE = 8` / `16` | `PACKET_SIZES.ATT_LOG_UDP_COMPACT` / `ATT_LOG_UDP_FULL` |
| `zklibudp.js` `getRealTimeLogs` | `data.length === 18` | `PACKET_SIZES.REALTIME_LOG_UDP` |
| `zklibudp.js` `requestData` | `data.length >= 13` | A new named constant `PROTOCOL.UDP_MIN_DATA_REPLY = 13` (or inline-comment if no other use) |
| `zklibudp.js` `getInfo` | offsets | `FREE_SIZES_OFFSETS.*` |
| `zklibudp.js` timeouts | `2000`, `3000` | `TIMEOUTS.CONNECT`, `TIMEOUTS.CHUNK_UDP` |

### Verification

After change, the following greps must return zero hits in `zklibtcp.js`, `zklibudp.js`, `utils.js`:

```
\b72\b   \b40\b   \b28\b   \b52\b   \b18\b   \b16\b   \b13\b
0x50,\s*0x50,\s*0x82,\s*0x7d
```

(Allowing for legitimate hits like `replyId` math; review case-by-case.)

## Section 3 — Comments policy

### What we add

1. **File header (one short block per file)** — purpose and link to ZK protocol reference where relevant.
2. **Protocol-shape one-liners** on each non-obvious offset/size, citing the wire field (e.g., `// byte 24..27 (LE u32): enrolled user count`).
3. **Why-comments** for the following hidden invariants:
   - TCP-first / UDP-fallback policy in `zklib.js#createSocket`.
   - Why `replyId` increments before send and wraps modulo `USHRT_MAX`.
   - Why `closeSocket` has the 2-second fallback timer.
   - Why `getUsers` / `getAttendances` bracket the read with `freeData()` calls.
   - Why UDP `EADDRINUSE` during bind is treated as success.
   - Why TCP user records are 72 bytes and UDP user records are 28 bytes (firmware family difference).
4. **JSDoc on every public method of `ZKLib`** — `@param`, `@returns`, what gets rejected. This is the user-facing surface.

### What we do not add

- Line-by-line narration (`// increment replyId`).
- Historical / change notes (`// fixed bug X`).
- Re-statements of identifier meaning that the name already conveys.
- Multi-paragraph docstrings.

## Section 4 — README rewrite

New `README.md` sections, in order:

1. **Title + tagline** — one-sentence purpose.
2. **Install** — `npm` and `yarn`.
3. **Quick start** — updated runnable example with explicit `'tcp'` protocol arg and a comment on `comm_code`.
4. **Constructor reference table** — every argument: type, default, description.
5. **API reference** — every method on `ZKLib`: signature, return shape, what it rejects with, notes.
6. **Data shapes** — `User` (TCP variant + UDP variant), `Record`, realtime event.
7. **Protocol selection** — explanation of TCP-first/UDP-fallback, when each is used, why `comm_code` matters.
8. **Error handling** — describes `ZKError`, its fields, and common codes.
9. **Extending** — `executeCmd` for arbitrary opcodes; link to opcode reference.
10. **Tested devices** — stub for the maintainer to fill in.
11. **License**.

## Files changed

- `constants.js` — add `PROTOCOL`, `PACKET_SIZES`, `FREE_SIZES_OFFSETS`, `AUTH`, `TIMEOUTS`.
- `utils.js` — bug #7, #8 rename, magic-number replacements, comments.
- `zklibtcp.js` — bug #1, #5, #10, magic-number replacements, comments, JSDoc.
- `zklibudp.js` — bug #4, #6, #7 rename callsites, magic-number replacements, comments.
- `zklib.js` — bug #9, JSDoc on all public methods, file-header comment.
- `zkerror.js` — JSDoc on `ZKError` methods.
- `helpers/errorLog.js` — bug #3.
- `package.json` — bug #2.
- `README.md` — full rewrite.

## Risk

- The `checkNotEvent*` rename touches every caller; one missed callsite would change real-time event detection. Mitigation: grep for `checkNotEvent` post-change must be zero.
- The `getInfo` offsets are deduced from device replies, not documented; if a user runs a device family where these differ, the constants give a clearer fix path but the values themselves are unchanged.
- No automated tests exist (`test.js` is a manual probe), so verification is by inspection + the user running `node test.js` against a real device.

## Open questions

None — Option B scope is fully specified.
