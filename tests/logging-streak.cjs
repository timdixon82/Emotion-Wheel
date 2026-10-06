// Verify production streak rules across calendar, timezone and record edge cases.
'use strict';
process.env.TZ = 'Europe/London';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const context = vm.createContext({ Date });
vm.runInContext(html.match(/function getLoggingStreak\([\s\S]*?\n}/)[0], context);
const record = timestamp => ({ timestamp });
const count = (timestamps, now) => context.getLoggingStreak(timestamps.map(record), new Date(now));
assert.equal(count([], '2026-10-06T12:00:00+01:00').count, 0);
let result = count(['2026-10-06T10:00:00+01:00', '2026-10-06T11:00:00+01:00', '2026-10-05T20:00:00+01:00', '2026-10-04T22:00:00+01:00'], '2026-10-06T12:00:00+01:00');
assert.equal(result.count, 3); assert.equal(result.loggedToday, true);
result = count(['2026-10-05T23:59:59+01:00', '2026-10-04T10:00:00+01:00'], '2026-10-06T00:00:00+01:00');
assert.equal(result.count, 2); assert.equal(result.loggedToday, false);
assert.equal(count(['2026-10-04T10:00:00+01:00'], '2026-10-06T12:00:00+01:00').count, 0);
assert.equal(count(['2026-10-06T10:00:00+01:00', '2026-10-04T10:00:00+01:00'], '2026-10-06T12:00:00+01:00').count, 1);
// Records near UTC midnight belong to their local calendar date.
assert.equal(count(['2026-10-05T23:30:00Z', '2026-10-04T23:30:00Z'], '2026-10-06T12:00:00+01:00').count, 2);
// Spring and autumn clock changes must not create 23/25-hour gaps.
assert.equal(count(['2026-03-28T12:00:00Z', '2026-03-29T12:00:00+01:00', '2026-03-30T12:00:00+01:00'], '2026-03-30T13:00:00+01:00').count, 3);
assert.equal(count(['2026-10-24T12:00:00+01:00', '2026-10-25T12:00:00Z', '2026-10-26T12:00:00Z'], '2026-10-26T13:00:00Z').count, 3);
assert.equal(count(['2028-02-28T12:00:00Z', '2028-02-29T12:00:00Z', '2028-03-01T12:00:00Z'], '2028-03-01T13:00:00Z').count, 3);
assert.equal(count(['2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z'], '2026-01-01T13:00:00Z').count, 2);
assert.equal(count(['invalid', undefined, null, '2026-10-07T12:00:00Z', '2026-10-06T23:00:00+01:00'], '2026-10-06T12:00:00+01:00').count, 0);
const entries = [record('2026-10-06T10:00:00+01:00'), record('2026-10-05T10:00:00+01:00')];
const original = JSON.stringify(entries); context.getLoggingStreak(entries, new Date('2026-10-06T12:00:00+01:00')); assert.equal(JSON.stringify(entries), original);
console.log('PASS: one day per calendar date, today/yesterday anchoring, gaps, local timezone, DST, leap/year boundaries, invalid/future timestamps and immutable records.');
