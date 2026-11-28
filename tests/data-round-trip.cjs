// Round trip: load each schema 5 fixture through the app's real code, save it again, and check nothing stored is lost, renamed or changed.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { reconcile, prepareSchemas } = require('../assets/google-drive-sync.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const readFixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
// Sorted-key JSON so key order never hides or causes a difference.
const canon = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
const withoutExportedAt = value => { const copy = clone(value); delete copy.exportedAt; return copy; };

// Read the real code out of index.html, as tests/google-drive-sync.cjs does.
const constant = name => (html.match(new RegExp(`^const ${name} = [\\s\\S]*?;$`, 'm')) || assert.fail(`const ${name} not found in index.html`))[0];
const func = name => (html.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n}`, 'm')) || assert.fail(`function ${name} not found in index.html`))[0];
const constants = ['storageKey', 'dataSchemaVersion', 'schemaVersionKey', 'settingsKey', 'defaultTags', 'valueFrameworks', 'valueCatalog', 'defaultSettings'].map(constant);
const functions = ['parseLocalDataset', 'serializeDataset', 'dataSchemaMatches', 'normalizeSettings', 'normalizeTags', 'normalizeValues', 'valueKey',
  'isPhaseOneSettings', 'isPhaseTwoSettings', 'getAvailableTags', 'getIntensityComparison', 'getRecordedLevel', 'getSelectionLevel',
  'ensureEntryIdentity', 'normalizeLoadedEntry', 'getBackupEntriesFromText', 'getBackupSnapshot', 'applyDriveSyncSnapshot', 'loadSettings', 'saveSettings'].map(func);
const glue = `
let ratingScale = 5, captureSettings = {}, logEntries = [], editingEntry = null, pendingRatingScaleChange = null;
let selectedInner = null, selectedMiddle = null, selectedOuter = null;
function adoptRatingScale(value) { ratingScale = value; }
function renderAll() {}
function __set(settings, entries, scale) { captureSettings = settings; logEntries = entries; ratingScale = scale; }
function __get() { return { captureSettings, logEntries, ratingScale }; }
function __select(inner, middle, outer) { selectedInner = inner; selectedMiddle = middle; selectedOuter = outer; }
`;

function makeApp() {
  const store = new Map();
  const ctx = vm.createContext({
    crypto: require('node:crypto').webcrypto, Date, JSON,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
  });
  vm.runInContext([...constants, ...functions, glue].join('\n'), ctx);
  return { ctx, store, keys: { log: vm.runInContext('storageKey', ctx), schema: vm.runInContext('schemaVersionKey', ctx), settings: vm.runInContext('settingsKey', ctx) } };
}

// One known, existing behaviour: loading a backup or Drive record turns a null middle or outer emotion into an empty string.
// The local log is not normalised on load, so it keeps null. Pinned here so any other change fails.
const asNormalised = entry => ({ ...clone(entry), ...(entry.middle === null ? { middle: '' } : {}), ...(entry.outer === null ? { outer: '' } : {}) });

const localFixture = JSON.parse(readFixture('local-log-schema5.json'));
const backupFixture = JSON.parse(readFixture('backup-schema5.json'));
const driveFixture = JSON.parse(readFixture('drive-file-schema5.json'));
const expectedLoaded = backupFixture.entries.map(asNormalised);

// Fixture sanity: the same fake records in all three files, and the fixtures cover required and optional fields.
assert.equal(canon(localFixture.entries), canon(backupFixture.entries));
assert.equal(canon(driveFixture.entries), canon(backupFixture.entries));
const covered = new Set(backupFixture.entries.flatMap(entry => Object.keys(entry)));
['tags', 'values', 'physicalSensations', 'sensationGuide', 'bucketLevel', 'appropriate', 'expectedIntensity', 'actualIntensity', 'intensityAlignment', 'comment'].forEach(field => assert(covered.has(field), `fixtures cover ${field}`));
assert(backupFixture.entries.some(entry => !('comment' in entry) && !('tags' in entry) && !('bucketLevel' in entry)), 'fixtures include a record lacking optional fields');

// 1. Local log: load with the real parser, save with the real serialiser. Byte identical.
{
  const raw = readFixture('local-log-schema5.json');
  const { ctx } = makeApp();
  const dataset = ctx.parseLocalDataset(raw);
  assert.equal(ctx.serializeDataset(dataset.entries, dataset.ratingScale), JSON.stringify(JSON.parse(raw)), 'local log re-saves exactly');
  console.log('PASS: local log fixture loads and re-saves with no change.');
}

// 2. Backup file: real backup reader, then the real backup writer.
function backupRoundTrip(fixture) {
  const app = makeApp();
  const parsed = app.ctx.getBackupEntriesFromText(JSON.stringify(fixture));
  assert.equal(parsed.skipped, 0, 'no record skipped');
  assert.equal(canon(parsed.validEntries), canon(fixture.entries.map(asNormalised)), 'loaded records differ only by the pinned null-to-empty rule');
  app.ctx.__set(app.ctx.normalizeSettings(clone(fixture.settings)), parsed.validEntries, parsed.ratingScale);
  const saved = JSON.parse(JSON.stringify(app.ctx.getBackupSnapshot()));
  const expected = withoutExportedAt(fixture);
  expected.entries = fixture.entries.map(asNormalised);
  assert.equal(canon(withoutExportedAt(saved)), canon(expected), 'backup re-saves with no stored field lost, renamed or changed');
  // A second load and save changes nothing at all.
  const again = makeApp();
  const reparsed = again.ctx.getBackupEntriesFromText(JSON.stringify(saved));
  again.ctx.__set(again.ctx.normalizeSettings(clone(saved.settings)), reparsed.validEntries, reparsed.ratingScale);
  assert.equal(canon(withoutExportedAt(JSON.parse(JSON.stringify(again.ctx.getBackupSnapshot())))), canon(withoutExportedAt(saved)), 'second round trip is stable');
  return saved;
}
backupRoundTrip(backupFixture);
console.log('PASS: backup fixture loads and re-saves with no stored field lost, renamed or changed.');

// Settings: absent means off, and a stored showDescriptions flag (planned later) is carried through untouched.
{
  const { ctx } = makeApp();
  assert(!('showDescriptions' in ctx.normalizeSettings({})), 'empty settings gain no showDescriptions key');
  assert(!('showDescriptions' in ctx.normalizeSettings(clone(backupFixture.settings))), 'fixture settings gain no showDescriptions key');
  const flagged = clone(backupFixture); flagged.settings.showDescriptions = true;
  assert.equal(backupRoundTrip(flagged).settings.showDescriptions, true, 'showDescriptions true survives a backup round trip');
  console.log('PASS: settings gain no extra key, and an optional showDescriptions flag survives.');
}

// Saved settings: real load and save code.
{
  const app = makeApp();
  app.store.set(app.keys.settings, JSON.stringify(backupFixture.settings));
  const loaded = app.ctx.loadSettings();
  assert.equal(canon(loaded), canon(backupFixture.settings), 'settings load unchanged');
  app.ctx.__set(loaded, [], 5);
  app.store.set(app.keys.schema, '5'); app.store.set(app.keys.log, readFixture('local-log-schema5.json'));
  app.ctx.saveSettings();
  assert.equal(canon(JSON.parse(app.store.get(app.keys.settings))), canon(backupFixture.settings), 'settings save unchanged');
  console.log('PASS: capture settings load and save with no change.');
}

// 3. Drive file: schema check, three-way merge with itself, and the real local apply step.
(async () => {
  const prepared = await prepareSchemas(driveFixture, driveFixture, driveFixture, 5);
  assert.equal(prepared.upgraded, false, 'a schema 5 Drive file needs no upgrade');
  for (const copy of [prepared.base, prepared.local, prepared.remote]) assert.equal(canon(copy), canon(driveFixture), 'prepareSchemas changes nothing');
  const merged = reconcile(prepared.base, prepared.local, prepared.remote);
  assert.equal(canon(withoutExportedAt(merged)), canon(withoutExportedAt(driveFixture)), 'reconcile with itself changes nothing');

  const app = makeApp();
  app.store.set(app.keys.schema, '5'); app.store.set(app.keys.log, readFixture('local-log-schema5.json'));
  const parsed = app.ctx.getBackupEntriesFromText(JSON.stringify(driveFixture));
  app.ctx.__set(app.ctx.normalizeSettings(clone(driveFixture.settings)), parsed.validEntries, parsed.ratingScale);
  const expectedLocal = JSON.parse(JSON.stringify(app.ctx.getBackupSnapshot()));
  app.ctx.applyDriveSyncSnapshot(merged, expectedLocal);
  const storedLog = JSON.parse(app.store.get(app.keys.log));
  assert.equal(storedLog.schemaVersion, 5); assert.equal(storedLog.ratingScale, 5);
  assert.equal(canon(storedLog.entries), canon(driveFixture.entries.map(asNormalised)), 'Drive apply stores every field');
  assert.equal(canon(JSON.parse(app.store.get(app.keys.settings))), canon(driveFixture.settings), 'Drive apply stores settings unchanged');
  console.log('PASS: Drive fixture survives schema check, self merge and local apply with no change.');

  // 4. Stored level text. Heading renames must never touch these strings.
  const levels = ['Inner circle', 'Middle circle', 'Outer circle'];
  const { ctx } = makeApp();
  assert.deepEqual([ctx.getRecordedLevel({ inner: 'Sad' }), ctx.getRecordedLevel({ inner: 'Sad', middle: 'Guilty' }), ctx.getRecordedLevel({ inner: 'Sad', middle: 'Guilty', outer: 'Ashamed' })], levels);
  ctx.__select('Sad', null, null); assert.equal(ctx.getSelectionLevel(), levels[0]);
  ctx.__select('Sad', 'Guilty', null); assert.equal(ctx.getSelectionLevel(), levels[1]);
  ctx.__select('Sad', 'Guilty', 'Ashamed'); assert.equal(ctx.getSelectionLevel(), levels[2]);
  assert.equal(ctx.getRecordedLevel({ level: 'Middle circle', inner: 'Sad' }), 'Middle circle', 'a stored level is kept as stored');
  for (const entry of backupFixture.entries) assert(levels.includes(entry.level), `fixture level ${entry.level} is a stored level string`);
  for (const entry of ctx.getBackupEntriesFromText(JSON.stringify(backupFixture)).validEntries) assert(levels.includes(entry.level));
  levels.forEach(text => assert(html.includes(`'${text}'`), `index.html still stores '${text}'`));
  console.log('PASS: stored level strings are Inner circle, Middle circle and Outer circle.');
})().catch(error => { console.error(error); process.exit(1); });
