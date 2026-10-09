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

// Daily congratulations follow local dates, with persistent suppression across reloads.
const output = { hidden: true, textContent: '' };
const stored = new Map();
context.document = { getElementById: () => output };
context.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
context.dailyLogCongratulationsKey = 'daily';
context.lastCongratulatedDay = '';
for (const name of ['getLocalLoggingDate', 'showDailyLogCongratulations']) {
  vm.runInContext(html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))[0], context);
}
function celebrate(now, loggedTodayBeforeSave = false) {
  const date = new Date(now);
  context.logEntries = [record(date.toISOString())];
  context.showDailyLogCongratulations(loggedTodayBeforeSave, date);
}
celebrate('2026-10-05T22:59:59Z');
assert.equal(output.hidden, false); assert.match(output.textContent, /now 1 day/);
celebrate('2026-10-05T23:00:00Z'); // Local midnight starts a new calendar day.
assert.equal(output.hidden, false);
assert.equal(stored.get('daily'), '2026-10-06');
context.lastCongratulatedDay = ''; // Simulate reopening the app.
celebrate('2026-10-06T20:00:00+01:00');
assert.equal(output.hidden, true); assert.equal(output.textContent, '');
celebrate('2026-10-07T12:00:00+01:00', true); // An existing/imported log already covers today.
assert.equal(output.hidden, true);
celebrate('2026-10-08T12:00:00+01:00'); // A gap starts a new 1-day streak.
assert.equal(output.hidden, false); assert.match(output.textContent, /now 1 day/);
celebrate('2026-10-25T00:30:00+01:00');
assert.equal(output.hidden, false);
celebrate('2026-10-25T01:30:00Z'); // Clock change does not start a second calendar day.
assert.equal(output.hidden, true);
celebrate('2026-10-26T00:00:00Z');
assert.equal(output.hidden, false);
for (const timezone of ['America/Los_Angeles', 'Pacific/Auckland']) {
  process.env.TZ = timezone;
  stored.clear(); context.lastCongratulatedDay = '';
  const midnight = new Date(2026, 9, 9);
  celebrate(new Date(midnight.getTime() - 1).toISOString());
  assert.equal(output.hidden, false);
  celebrate(midnight.toISOString());
  assert.equal(output.hidden, false);
  celebrate(new Date(midnight.getTime() + 1000).toISOString());
  assert.equal(output.hidden, true);
}
process.env.TZ = 'Europe/London';
console.log('PASS: daily message suppression, local midnight on both sides of UTC, DST repeated hour, reloads, existing logs and gap restarts.');
