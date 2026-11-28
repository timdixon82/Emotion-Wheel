// Tests for the descriptions panel, the "Show and read descriptions" setting and the Description column.
// Runs the real functions from index.html against a small fake DOM and the real save functions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const descSource = fs.readFileSync(path.join(root, 'assets/emotion-descriptions.js'), 'utf8');
const D = new Function(`${descSource}\nreturn EMOTION_DESCRIPTIONS;`)();
const emotions = JSON.parse(html.match(/const emotions = (\[\[.*?\]\]);/)[1]);
const clone = value => JSON.parse(JSON.stringify(value));

let checks = 0;
function check(label, ok) { checks++; assert.ok(ok, label); }
const constant = name => (html.match(new RegExp(`^const ${name} = [\\s\\S]*?;$`, 'm')) || assert.fail(`const ${name} not found`))[0];
const func = name => (html.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n}`, 'm')) || assert.fail(`function ${name} not found`))[0];

// ---- Markup in index.html ----
const box = html.match(/<input type="checkbox" id="showDescriptionsBox"[^>]*>/);
check('the checkbox exists, is not ticked in the source and has a label', !!box && !/checked/.test(box[0]) && /<label class="descriptions-toggle"><input type="checkbox" id="showDescriptionsBox"[^>]*> Show and read descriptions<\/label>/.test(html));
check('the checkbox is described by its help text', /aria-describedby="showDescriptionsHelp"/.test(box[0]) && /id="showDescriptionsHelp"/.test(html));
check('the change is announced in a polite status region', /<p id="descriptionsStatus" class="visually-hidden" role="status"><\/p>/.test(html));
for (const name of ['inner', 'middle', 'outer']) {
  check(`${name}: panel is hidden from screen readers and starts hidden`, new RegExp(`<p id="${name}Panel" class="desc-panel" aria-hidden="true" hidden></p>`).test(html));
  check(`${name}: description texts container starts hidden and is aria-hidden (aria-describedby still resolves)`, new RegExp(`<div id="${name}Descs" class="visually-hidden" aria-hidden="true" hidden></div>`).test(html));
}
check('the panel sits below its step buttons', html.indexOf('id="innerButtons"') < html.indexOf('id="innerPanel"') && html.indexOf('id="outerButtons"') < html.indexOf('id="outerPanel"'));
check('the checkbox label has a target of at least 44 pixels (label min-height 2.75rem)', /label \{ display: inline-flex; align-items: center; gap: \.5rem; min-height: 2\.75rem; \}/.test(html));
check('the label is at least 44 pixels high', /\.descriptions-toggle \{ min-height: 44px; \}/.test(html));
const helpText = html.match(/<p id="showDescriptionsHelp"[^>]*>([^<]*)<\/p>/)[1];
check('the describedby text is short (two sentences or fewer, under 30 words)', helpText.split(/\s+/).length < 30 && (helpText.match(/\./g) || []).length <= 2);
check('the scrolling table wrapper is a labelled group, not a region', /<div class="scroll-table" tabindex="0" role="group" aria-labelledby="wheelTableCaption">/.test(html) && /<caption id="wheelTableCaption">/.test(html));
check('success is not announced, only an error is', /setShowDescriptions\(on\);\s*\/\/[^\n]*\n\s*descriptionsStatus\.textContent = '';/.test(html) && /could not be saved/.test(html) && !/Descriptions on\./.test(html));
check('the lookup uses the stored data label, not textContent', !/button\.textContent/.test(func('decorateStep')) && /dataset\.label/.test(func('decorateStep')));
check('the full table has four column headers including Description', /<th scope="col">Main feeling<\/th><th scope="col">More specific feeling<\/th><th scope="col">Most specific feeling<\/th><th scope="col">Description<\/th>/.test(html) && /<caption id="wheelTableCaption">All available emotion paths<\/caption>/.test(html));

// ---- Code hygiene ----
const panelCode = [func('getEmotionDescription'), func('refreshStepPanel'), func('applyDescriptionSetting'), func('decorateStep'), func('renderFullEmotionTable')].join('\n');
check('panel and table code never use innerHTML', !/innerHTML|insertAdjacentHTML|outerHTML/.test(panelCode));
check('panel and table code never touch storage directly', !/localStorage|sessionStorage|saveSettings|saveLog|JSON\.stringify/.test(panelCode));
check('the change handler goes through setShowDescriptions only', /showDescriptionsBox\.addEventListener\('change'[\s\S]*?setShowDescriptions\(on\)/.test(html) && !/localStorage\.setItem\([^)]*[dD]escription/.test(html));
check('descriptions are looked up by path key from the data object', /Object\.prototype\.hasOwnProperty\.call\(EMOTION_DESCRIPTIONS, path\)/.test(html));
check('Share and Copy of the full table still use getWheelRows (no description column)', func('getWheelRows').includes('...emotions') && !/Description/.test(func('getWheelRows')));

// ---- Fake DOM ----
class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || ''; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false;
    this.own = ''; this.dataset = {}; this.parent = null; this.checked = false;
  }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t) { (this.listeners[t] || []).forEach(f => f({})); }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  all(test, out = []) { this.children.forEach(c => { if (test(c)) out.push(c); c.all(test, out); }); return out; }
  querySelectorAll(sel) {
    return this.all(c => sel === 'button' ? c.tagName === 'button' : sel === 'button[data-description-id]' ? c.tagName === 'button' && 'descriptionId' in c.dataset : false);
  }
}
const nodes = {};
const documentStub = { getElementById: id => (nodes[id] = nodes[id] || new El('x', id)), activeElement: null };

const stepGlue = `
let captureSettings = {}, selectedInner = null, selectedMiddle = null, selectedOuter = null;
function saveSettings() { __saved.push(JSON.stringify(captureSettings)); }
function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
const descriptionSteps = ['inner', 'middle', 'outer'].map(name => ({ buttons: document.getElementById(name + 'Buttons'), panel: document.getElementById(name + 'Panel'), pool: document.getElementById(name + 'Descs') }));
const showDescriptionsBox = document.getElementById('showDescriptionsBox');
function __select(a, b, c) { selectedInner = a; selectedMiddle = b; selectedOuter = c; }
function __draw(level, labels) {
  const g = descriptionSteps[level - 1].buttons; clearNode(g);
  labels.forEach(l => { const b = document.createElement('button'); b.textContent = l; b.dataset.label = l; g.appendChild(b); });
  decorateStep(level);
}
`;
const saved = [];
documentStub.createElement = tag => new El(tag);
const ctx = vm.createContext({ document: documentStub, Object, JSON, Array, __saved: saved, EMOTION_DESCRIPTIONS: D });
vm.runInContext([stepGlue, func('getEmotionDescription'), func('refreshStepPanel'), func('applyDescriptionSetting'), func('decorateStep'), func('redrawAfterLoad'), func('getShowDescriptions'), func('setShowDescriptions')].join('\n'), ctx);
const panel = n => nodes[`${n}Panel`], pool = n => nodes[`${n}Descs`], group = n => nodes[`${n}Buttons`];
const buttons = n => group(n).children;

// Default off: panels and texts hidden, no aria-describedby.
ctx.__select(null, null, null);
ctx.__draw(1, ['Anger', 'Fear']);
check('default is off', vm.runInContext('getShowDescriptions()', ctx) === false);
check('off: panel and description texts are hidden, no aria-describedby', panel('inner').hidden && pool('inner').hidden && buttons('inner').every(b => b.getAttribute('aria-describedby') === null));
check('off: description texts still exist in the pool, each button has a data link', pool('inner').children.length === 2 && buttons('inner').every(b => b.dataset.descriptionId));

// On: panel shown, each button points at its own description text.
vm.runInContext('setShowDescriptions(true)', ctx);
ctx.applyDescriptionSetting();
check('on: the setting is saved through the helper (one save, key showDescriptions)', saved.length === 1 && JSON.parse(saved[0]).showDescriptions === true);
check('on: panel and texts are shown and the box is ticked', !panel('inner').hidden && !pool('inner').hidden && nodes.showDescriptionsBox.checked === true);
const anger = buttons('inner')[0], fear = buttons('inner')[1];
const targetText = b => pool('inner').children.filter(p => p.id === b.getAttribute('aria-describedby'))[0].textContent;
check('on: aria-describedby points at the button\'s own full-path description', targetText(anger) === D['Anger'] && targetText(fear) === D['Fear']);
check('on: description ids are unique', new Set(pool('inner').children.map(p => p.id)).size === 2);

// Focus, hover, blur and selection drive the panel text.
fear.fire('focus');
check('focus shows the focused button\'s description in the panel', panel('inner').textContent === D['Fear']);
fear.fire('blur');
check('blur with nothing selected empties the panel', panel('inner').textContent === '');
anger.fire('mouseenter');
check('hover shows the hovered description', panel('inner').textContent === D['Anger']);
documentStub.activeElement = null; anger.fire('mouseleave');
check('mouse leave restores the selected description (none)', panel('inner').textContent === '');
ctx.__select('Fear', null, null); ctx.__draw(1, ['Anger', 'Fear']);
check('the selected button\'s description shows when nothing is focused', panel('inner').textContent === D['Fear']);
documentStub.activeElement = buttons('inner')[0]; buttons('inner')[0].fire('mouseleave');
check('mouse leave shows the focused button text when the button still has focus', panel('inner').textContent === D['Anger']);

// Hovering another button then leaving restores the focused button's text, not a blank panel.
ctx.__select(null, null, null); ctx.__draw(1, ['Anger', 'Fear']);
const [a2, f2] = buttons('inner');
documentStub.activeElement = a2; a2.fire('focus'); f2.fire('mouseenter');
check('hover over another button shows its text', panel('inner').textContent === D['Fear']);
f2.fire('mouseleave');
check('leaving that button restores the focused button text, not the placeholder', panel('inner').textContent === D['Anger']);
f2.fire('mouseenter'); f2.listeners.mouseleave.forEach(f => f({ relatedTarget: panel('inner') }));
check('moving from a button onto the panel leaves the text alone', panel('inner').textContent === D['Fear']);
documentStub.activeElement = null; a2.fire('blur');
check('blur with nothing focused falls back to the selection (none)', panel('inner').textContent === '');

// Deeper steps use full path keys, never bare names (Abandoned and Inferior exist twice).
ctx.__select('Sad', 'Lonely', null); ctx.__draw(2, ['Guilty', 'Lonely']); ctx.__draw(3, ['Isolated', 'Abandoned']);
check('step 2 panel shows the selected middle description', panel('middle').textContent === D['Sad|Lonely']);
const ab = buttons('outer')[1]; ab.fire('focus');
check('step 3 uses the full path key for a duplicate word', panel('outer').textContent === D['Sad|Lonely|Abandoned'] && D['Sad|Lonely|Abandoned'] !== D['Sad|Abandoned']);
ctx.__select('Sad', 'Depressed', null); ctx.__draw(3, ['Inferior']);
buttons('outer')[0].fire('focus');
check('Inferior under Sad shows the Sad path description, not the Fear one', panel('outer').textContent === D['Sad|Depressed|Inferior']);

// Off again: attribute removed, panel hidden, texts hidden, text not exposed.
vm.runInContext('setShowDescriptions(false)', ctx);
ctx.applyDescriptionSetting();
check('off again: aria-describedby removed from every step button', ['inner', 'middle', 'outer'].every(n => buttons(n).every(b => b.getAttribute('aria-describedby') === null)));
check('off again: panels and texts hidden, box clear', ['inner', 'middle', 'outer'].every(n => panel(n).hidden && pool(n).hidden) && nodes.showDescriptionsBox.checked === false);
check('on then off stores no showDescriptions key', !('showDescriptions' in JSON.parse(saved[saved.length - 1])));

// An empty step hides its panel even when the setting is on; a missing description never breaks.
vm.runInContext('setShowDescriptions(true)', ctx);
ctx.__draw(2, []);
check('an empty step has a hidden panel when on', panel('middle').hidden === true);
ctx.__select('Nowhere', null, null); ctx.__draw(1, ['Nowhere']);
const nowhere = buttons('inner')[0];
nowhere.fire('focus');
check('a missing description gives an empty panel, no description element and no aria-describedby', panel('inner').textContent === '' && nowhere.getAttribute('aria-describedby') === null && pool('inner').children.length === 0);
const lookups = ['constructor', '__proto__', 'toString', 'Anger|Nope', ''].map(k => vm.runInContext(`getEmotionDescription(${JSON.stringify(k)})`, ctx));
check('inherited and unknown keys give an empty string', lookups.every(v => v === ''));
const noData = vm.createContext({ document: documentStub, Object });
vm.runInContext(func('getEmotionDescription'), noData);
check('without the data file the lookup returns an empty string', vm.runInContext('getEmotionDescription("Anger")', noData) === '');

// ---- The redraw after the page has loaded ----
ctx.__select('Sad', null, null);
const draws = { table: 0 };
const redrawLabels = ['Anger', 'Fear'];
ctx.renderInner = () => { ctx.__draw(1, redrawLabels); };
ctx.renderMiddle = () => {}; ctx.renderOuter = () => {};
ctx.renderFullEmotionTable = () => { draws.table++; };
documentStub.activeElement = null;
const before = buttons('inner').slice();
ctx.redrawAfterLoad();
const idsOk = new Set(pool('inner').children.map(p => p.id)).size === pool('inner').children.length;
check('redraw: selection is kept', vm.runInContext('selectedInner', ctx) === 'Sad' && draws.table === 1);
check('redraw: description ids are not duplicated', idsOk && pool('inner').children.length === 2 && buttons('inner').length === 2);
check('redraw: listeners are not doubled (new buttons, one listener each)', buttons('inner').every(b => !before.includes(b) && ['focus', 'blur', 'mouseenter', 'mouseleave'].every(t => b.listeners[t].length === 1)));
documentStub.activeElement = buttons('inner')[0];
ctx.redrawAfterLoad();
check('redraw: skipped while focus is inside a step', draws.table === 1 && buttons('inner')[0] === documentStub.activeElement);
documentStub.activeElement = null;

// ---- The full table ----
const tableSource = func('renderFullEmotionTable');
const rows = [];
const tableCtx = vm.createContext({
  document: { createElement: tag => new El(tag) }, emotions, EMOTION_DESCRIPTIONS: D, Object, editingEntry: null,
  clearNode: node => { node.children = []; }, labelTableCells() {}, appendEmotionCellContent(node, v) { node.textContent = v; },
  wheelTableBody: new El('tbody'), entryTab: {}, selectAppView() {}, renderAll() {}, liveStatus: {}, focusNextRecordingControl() {}
});
vm.runInContext([func('getEmotionDescription'), tableSource, 'renderFullEmotionTable();'].join('\n'), tableCtx);
const body = tableCtx.wheelTableBody;
check('the table has one row per emotion path (72 outer paths)', body.children.length === emotions.length && emotions.length === 72);
check('every row has the three path cells plus a Description cell', body.children.every(tr => tr.children.length === 4));
check('every Description cell holds the description for the full path key', body.children.every((tr, i) => tr.children[3].textContent === D[emotions[i].join('|')] && tr.children[3].textContent.length > 0));
check('Description cells are plain text, not buttons', body.children.every(tr => tr.children[3].tagName === 'td' && tr.children[3].children.length === 0));
const keys = new Set(body.children.map((tr, i) => emotions[i].join('|')));
check('the 72 outer keys plus 36 middle and 6 inner keys account for all 114 descriptions', keys.size === 72 && new Set(emotions.map(r => r[0])).size === 6 && new Set(emotions.map(r => r[0] + '|' + r[1])).size === 36 && Object.keys(D).length === 114);

// ---- Nothing described is ever stored: real save functions ----
const constantNames = ['storageKey', 'dataSchemaVersion', 'schemaVersionKey', 'settingsKey', 'defaultTags', 'valueFrameworks', 'valueCatalog', 'defaultSettings'];
const functionNames = ['parseLocalDataset', 'serializeDataset', 'dataSchemaMatches', 'normalizeSettings', 'normalizeTags', 'normalizeValues', 'valueKey',
  'isPhaseOneSettings', 'isPhaseTwoSettings', 'getAvailableTags', 'getIntensityComparison', 'getRecordedLevel', 'getSelectionLevel',
  'ensureEntryIdentity', 'loadRatingScale', 'saveLog', 'getBackupSnapshot', 'loadSettings', 'saveSettings', 'getShowDescriptions', 'setShowDescriptions'];
const glue = `
let ratingScale = 5, captureSettings = {}, logEntries = [];
function __set(settings, entries) { captureSettings = settings; logEntries = entries; }
`;
const store = new Map();
const appCtx = vm.createContext({
  crypto: require('node:crypto').webcrypto, Date, JSON,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
});
vm.runInContext([...constantNames.map(constant), ...functionNames.map(func), glue].join('\n'), appCtx);
const schemaKey = vm.runInContext('schemaVersionKey', appCtx);
const settingsKey = vm.runInContext('settingsKey', appCtx);
store.set(schemaKey, vm.runInContext('String(dataSchemaVersion)', appCtx));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/backup-schema5.json'), 'utf8'));
appCtx.__set(appCtx.loadSettings(), clone(fixture.entries));
check('setting round trip: absent means off', appCtx.getShowDescriptions() === false && !('showDescriptions' in appCtx.normalizeSettings(clone(fixture.settings))));
appCtx.setShowDescriptions(true);
check('setting round trip: on is stored through the helper and normalizeSettings keeps it', JSON.parse(store.get(settingsKey)).showDescriptions === true && appCtx.normalizeSettings(JSON.parse(store.get(settingsKey))).showDescriptions === true && appCtx.loadSettings().showDescriptions === true);
const savedSettingsKeys = [...store.keys()];
appCtx.saveLog();
const outputs = [
  ['local log', store.get(vm.runInContext('storageKey', appCtx))],
  ['backup and Drive snapshot', JSON.stringify(appCtx.getBackupSnapshot())],
  ['settings', store.get(settingsKey)]
];
const everyText = Object.values(D);
for (const [label, text] of outputs) {
  check(`${label} is not empty`, typeof text === 'string' && text.length > 0);
  check(`${label} holds no description text`, everyText.every(d => !text.includes(d)));
}
check('the backup snapshot carries the setting once, as true', appCtx.getBackupSnapshot().settings.showDescriptions === true);
check('turning the setting on adds no new storage key beyond the log, schema and settings keys', [...store.keys()].every(k => [vm.runInContext('storageKey', appCtx), schemaKey, settingsKey].includes(k)) && savedSettingsKeys.length <= 3);
appCtx.setShowDescriptions(false);
check('turning it off again removes the key from stored settings', !('showDescriptions' in JSON.parse(store.get(settingsKey))));

console.log(`descriptions-panel: ok (${checks} checks)`);
