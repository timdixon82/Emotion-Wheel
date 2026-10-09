// Exercise production settings, independent ratings and the save/celebration lifecycle.
'use strict';
process.env.TZ = 'Europe/London';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', focus() {} });
  return nodes.get(id);
};
const stored = new Map();
let failSave = false;
let renderCount = 0;
const context = vm.createContext({
  Date, crypto: require('node:crypto').webcrypto,
  document: { getElementById: node, querySelector: () => ({ value: 'No' }) },
  localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
  dailyLogCongratulationsKey: 'daily', lastCongratulatedDay: '', editingEntry: null,
  expectedIntensity: { value: '3' }, actualIntensity: { value: '3' },
  logEntries: [], selectedInner: 'Happy', selectedMiddle: null, selectedOuter: null,
  entryComment: { value: '' }, liveStatus: node('liveStatus'),
  recordConfirmation: node('confirmation'), recordConfirmationHeading: node('heading'),
  recordConfirmationText: node('confirmationText'), undoRecordButton: node('undo'),
  lastRecordedEntry: null, getReviewDataset: () => null,
  getSelectionLevel: () => 'Inner circle', getEntryPathLabel: entry => entry.inner,
  saveLog() { if (failSave) throw new Error('Storage full'); stored.set('records', JSON.stringify(context.logEntries)); },
  clearEntryForm() { context.selectedInner = null; context.entryComment.value = ''; },
  renderAll() { renderCount++; }
});
vm.runInContext(html.match(/const defaultSettings = \{[\s\S]*?\n};/)[0], context);
for (const name of ['normalizeTags', 'normalizeSettings', 'isPhaseOneSettings', 'isPhaseTwoSettings', 'getIntensityComparison', 'getRecordingAlignment', 'applyRecordingRatings', 'getLoggingStreak', 'getLocalLoggingDate', 'showDailyLogCongratulations']) {
  vm.runInContext(html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))[0], context);
}
const normalize = settings => context.normalizeSettings(settings);
for (const enabled of [true, false]) {
  const legacy = { collectIntensity: enabled, collectAppropriate: true, tags: ['My tag'], extension: 'keep' };
  const original = JSON.stringify(legacy);
  const result = normalize(legacy);
  assert.equal(result.collectExpectedIntensity, enabled);
  assert.equal(result.collectActualIntensity, enabled);
  assert.equal(result.collectAppropriate, true);
  assert.equal(result.extension, 'keep');
  assert.equal(JSON.stringify(legacy), original);
}
assert.equal(normalize({}).captureMode, 'phase1');
assert.equal(normalize({ collectIntensity: true, collectAppropriate: true, collectSensations: true }).captureMode, 'phase2');
for (const expected of [false, true]) for (const actual of [false, true]) {
  const settings = normalize({ collectIntensity: true, collectExpectedIntensity: expected, collectActualIntensity: actual });
  assert.equal(settings.collectExpectedIntensity, expected);
  assert.equal(settings.collectActualIntensity, actual);
  assert.equal(settings.collectIntensity, expected && actual);
  const reopened = normalize(JSON.parse(JSON.stringify(settings)));
  assert.equal(reopened.collectExpectedIntensity, expected);
  assert.equal(reopened.collectActualIntensity, actual);
  context.captureSettings = settings;
  const entry = { inner: 'Happy' };
  context.applyRecordingRatings(entry);
  assert.equal(entry.expectedIntensity, expected ? 3 : undefined);
  assert.equal(entry.actualIntensity, actual ? 3 : undefined);
  assert.equal(entry.intensityAlignment, expected && actual ? 'Aligned' : undefined);
}
const original = { id: 'keep-id', timestamp: '2026-10-08T10:00:00Z', expectedIntensity: 3, actualIntensity: 4, intensityAlignment: 'Aligned', appropriate: 'No', tags: ['Work'], extension: { keep: true } };
for (const expected of [false, true]) for (const actual of [false, true]) {
  context.captureSettings = normalize({ collectExpectedIntensity: expected, collectActualIntensity: actual });
  const unchanged = { ...original };
  context.actualIntensity.value = '4';
  context.applyRecordingRatings(unchanged, original);
  assert.equal(JSON.stringify(unchanged), JSON.stringify(original), 'An unchanged legacy alignment must survive edits');
  context.actualIntensity.value = '3';
}
context.captureSettings = normalize({ collectExpectedIntensity: true });
context.expectedIntensity.value = '5';
let edited = { ...original };
context.applyRecordingRatings(edited, original);
assert.equal(edited.actualIntensity, 4);
assert.equal(edited.expectedIntensity, 5);
assert.equal(edited.intensityAlignment, 'Not aligned');
assert.equal(edited.extension, original.extension);
context.captureSettings = normalize({ collectActualIntensity: true });
edited = { ...original };
context.applyRecordingRatings(edited, original);
assert.equal(edited.expectedIntensity, 3);
assert.equal(edited.intensityAlignment, 'Aligned');
const missing = { actualIntensity: '', intensityAlignment: 'stale' };
context.captureSettings = normalize({ collectExpectedIntensity: true });
context.applyRecordingRatings(missing);
assert.equal(missing.intensityAlignment, undefined);
console.log('PASS: legacy settings, all independent combinations, reload compatibility, saved field/metadata preservation and alignment after one-rating edits.');

// Run the production click handler, including failure and edit paths.
const handler = html.match(/recordButton\.addEventListener\('click', \(\) => \{([\s\S]*?)\n}\);/)[1];
vm.runInContext(`function record() {${handler}\n}`, context);
context.captureSettings = normalize({ collectExpectedIntensity: true, collectActualIntensity: true, collectAppropriate: true });
context.expectedIntensity.value = '3';
context.entryComment.value = 'Retain this answer';
context.selectedInner = 'Happy';
failSave = true;
context.record();
assert.equal(context.logEntries.length, 0);
assert.equal(context.selectedInner, 'Happy');
assert.equal(context.entryComment.value, 'Retain this answer');
assert.equal(stored.has('daily'), false);
assert.equal(node('confirmation').hidden, true);
assert.equal(renderCount, 0);
assert.match(node('liveStatus').textContent, /could not be saved/);
failSave = false;
const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
context.logEntries = [{ timestamp: yesterday.toISOString(), inner: 'Fear' }];
context.record();
assert.equal(context.logEntries.length, 2);
assert.equal(context.logEntries[1].appropriate, 'No');
assert.equal(node('dailyLogCongratulations').hidden, false);
assert.match(node('dailyLogCongratulations').textContent, /Congratulations!.*today.*2 days.*Keep logging/);
assert.equal(node('recordedAlignment').textContent, 'Emotion levels: Aligned.');
assert.equal(context.selectedInner, null);
context.selectedInner = 'Happy'; context.record();
assert.equal(node('dailyLogCongratulations').hidden, true);
assert.equal(context.logEntries.length, 3);
// An edit of an old record must never count as a new log today.
context.logEntries = [{ ...original, inner: 'Fear' }];
context.editingEntry = context.logEntries[0]; context.selectedInner = 'Fear';
const celebrationDate = stored.get('daily');
context.record();
assert.equal(node('dailyLogCongratulations').hidden, true);
assert.equal(context.logEntries[0].timestamp, original.timestamp);
assert.equal(stored.get('daily'), celebrationDate);
// After undo/deletion/reload, the date marker still suppresses a same-day save.
context.logEntries = []; context.editingEntry = null; context.lastCongratulatedDay = '';
context.selectedInner = 'Happy'; context.record();
assert.equal(node('dailyLogCongratulations').hidden, true);
console.log('PASS: failed writes preserve answers/records, successful first save updates streak, repeat saves/edits/reloads/deletions suppress congratulations.');
