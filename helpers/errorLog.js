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