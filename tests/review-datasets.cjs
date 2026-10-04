// Production review renderers exercised with distinct synthetic local/shared data.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
class Node {
  constructor(id = '', tag = 'div') { this.id = id; this.tagName = tag; this.children = []; this.value = ''; this._text = ''; this.attributes = {}; this.handlers = {}; this.style = { setProperty() {} }; }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  get options() { return this.children; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  click() { this.handlers.click?.(); }
  focus() {}
  closest(tag) { return this.tagName === tag ? this : this.parent?.closest(tag); }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
    if (selector === 'input:checked') return descendants.filter(child => child.tagName === 'input' && child.checked);
    if (selector === 'input') return descendants.filter(child => child.tagName === 'input');
    if (selector === 'select') return descendants.filter(child => child.tagName === 'select');
    return descendants.filter(child => child.tagName === selector);
  }
}
const nodes = new Map(), plots = new Map();
const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
const local = [{ id: 'local', timestamp: '2026-10-01T10:00:00Z', inner: 'Sad', comment: 'Local private synthetic', tags: ['Local'], bucketLevel: 5, expectedIntensity: 4, actualIntensity: 4, intensityAlignment: 'Aligned' }];
const before = JSON.stringify(local);
const ctx = vm.createContext({
  Intl, Event, reviewDataset: null, logEntries: local, ratingScale: 5, captureSettings: { tags: ['Local'] }, defaultTags: [],
  currentAppView: 'logs', emotionColours: {}, emotions: [['Happy'], ['Sad'], ['Fear']],
  innerSeriesCheckboxes: ['Happy', 'Sad', 'Fear'].map(value => ({ value, checked: true })),
  document: { getElementById: node, createElement: tag => new Node('', tag), createTextNode: text => { const n = new Node('', '#text'); n.textContent = text; return n; }, dispatchEvent() {} },
  renderBarChart(container, _summary, rows) { plots.set(container.id, JSON.parse(JSON.stringify(rows))); },
  renderLineChart(container, series) { plots.set(container.id, JSON.parse(JSON.stringify(series))); },
  interactiveBars(container, _summary, rows) { plots.set(container.id, JSON.parse(JSON.stringify(rows))); },
  renderChartKey() {}, labelTableCells() {}, renderChartPeriodControls() {}, queueDisplayedChartImages() {},
  selectAppView() { throw new Error('Must not navigate to Entry while switching datasets'); },
  renderAll() { ctx.renderReviewScale(); ctx.renderLog(); ctx.renderCharts(); },
  clearNode: n => n.replaceChildren()
});
for (const match of html.matchAll(/const (\w+) = document.getElementById\('([^']+)'\)/g)) ctx[match[1]] = node(match[2]);
const names = ['unique', 'getReviewDataset', 'getReviewEntries', 'getReviewScale', 'getReviewTags', 'setReviewDataset', 'resetLogFilters', 'resetChartFilters', 'getAvailableTags', 'normalizeTags', 'formatDateTime', 'displayValue', 'getRecordedLevel', 'getEntryPathLabel', 'getDateKey', 'getCheckedFilterValues', 'setCheckedFilterValues', 'getFilteredLogEntries', 'getTally', 'getTallyRows', 'countValues', 'sortCountRows', 'getLevelCounts', 'startOfPeriod', 'addPeriod', 'getPeriodKey', 'formatPeriodLabel', 'formatDateOnly', 'getDateFromWeekInput', 'getSelectedChartDate', 'chartUsesAdvancedFilters', 'getChartFilterValues', 'getChartEntries', 'getPreviousChartEntries', 'getChartPeriodLabel', 'getRecordsOverTime', 'getInnerEmotionSeries', 'getAppropriateCounts', 'getAlignmentCounts', 'getIntensityAverages', 'getSensationCounts', 'getTopEmotionRows', 'getVisibleAppropriateRows', 'getVisibleAlignmentRows', 'getContextCounts', 'getLogRows', 'appendEmotionCellContent', 'renderReviewScale', 'renderLog', 'addTableRows', 'renderMetricCards', 'renderTimeTable', 'entriesForTag', 'renderContextAnalysis', 'renderCharts', 'getChartShareData', 'prepareEntry'];
for (const name of names) {
  const source = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`));
  assert(source, name); vm.runInContext(source[0], ctx);
}
ctx.timeGrouping.value = 'day'; ctx.timeGrouping.selectedIndex = 0; ctx.timeGrouping.appendChild(Object.assign(new Node(), { textContent: 'Day' }));
ctx.timeMeasure.value = 'all'; ctx.chartPeriod.value = 'all';
const remote = { fileId: 'synthetic_shared_001', label: 'Friend’s log', state: 'loaded', ratingScale: 10, tags: ['Shared'], entries: [
  { id: 'remote1', timestamp: '2026-10-02T10:00:00Z', inner: 'Happy', tags: ['Shared'], bucketLevel: 10, expectedIntensity: 9, actualIntensity: 8, intensityAlignment: 'Not aligned', appropriate: 'Yes', physicalSensations: ['Warm'], comment: '<img synthetic>' },
  { id: 'remote2', timestamp: '2026-10-03T10:00:00Z', inner: 'Fear', tags: ['Shared'], bucketLevel: 9, expectedIntensity: 7, actualIntensity: 8, intensityAlignment: 'Not aligned', comment: 'Another shared note' }
] };
const remoteBefore = JSON.stringify(remote);
ctx.setReviewDataset(remote);
assert.equal(ctx.entryTab.disabled, true);
assert.equal(ctx.getReviewScale(), 10);
assert.equal(ctx.getReviewEntries().length, 2);
assert.equal(ctx.logSummary.textContent, '2 shared emotion records.');
assert.equal(node('log-heading').textContent, 'Friend’s log — read-only log');
assert.equal(ctx.logBody.querySelectorAll('button').length, 0);
assert(ctx.logBody.children.every(row => row.lastChild.textContent === 'Read only'));
assert(ctx.logBody.textContent.includes('<img synthetic>'));
assert.deepEqual(plots.get('bucketChart').map(row => row.label), ['9', '10']);
assert.equal(plots.get('appropriateChart').find(row => row.label === 'Yes').count, 1);
assert.equal(plots.get('alignmentChart').find(row => row.label === 'Not aligned').count, 2);
assert.equal(plots.get('sensationsChart')[0].label, 'Warm');
assert.equal(plots.get('tagsChart')[0].label, 'Shared');
assert.equal(plots.get('emotionChart').reduce((sum, row) => sum + row.count, 0), 2);
assert.equal(plots.get('levelChart').reduce((sum, row) => sum + row.count, 0), 2);
assert.equal(plots.get('timeChart')[0].rows.reduce((sum, row) => sum + row.count, 0), 2);
assert(node('bucketEmotionHead').textContent.includes('10 — Full'));
assert(node('bucketChartSummary').textContent.includes('out of 10'));
assert(node('intensityMetrics').textContent.includes('(1–10)'));
assert(ctx.getChartShareData('reflection').sections.flatMap(section => section.rows).some(row => row.label?.includes('(1–10)')));
assert.equal(ctx.getTallyRows()[1][1], 'Sad', 'Maintenance exports must keep using the local dataset');
ctx.prepareEntry(remote.entries[0], 'Must not edit', true);
assert.equal(JSON.stringify(local), before);
ctx.logSearch.value = 'Another'; assert.equal(ctx.getFilteredLogEntries()[0].id, 'remote2');
ctx.chartPeriod.value = 'day'; ctx.chartDayInput.value = '2026-10-03'; assert.equal(ctx.getChartEntries()[0].id, 'remote2');
assert.equal(ctx.getPreviousChartEntries()[0].id, 'remote1');
ctx.chartPeriod.value = 'custom'; node('chartlogSearch').value = 'Another'; assert.equal(ctx.getChartEntries()[0].id, 'remote2');
ctx.setReviewDataset({ ...remote, label: 'Another person', ratingScale: 5, entries: [{ ...remote.entries[1], id: 'other', bucketLevel: 5, expectedIntensity: 5, actualIntensity: 5 }] });
assert.equal(ctx.chartPeriod.value, 'all'); assert.equal(ctx.logSearch.value, '');
assert(node('bucketEmotionHead').textContent.includes('5 — Full'));
assert(!node('bucketEmotionHead').textContent.includes('10 — Full'));
assert.equal(ctx.getChartEntries()[0].id, 'other');
ctx.setReviewDataset(null);
assert.equal(ctx.entryTab.disabled, false);
assert(ctx.logBody.querySelectorAll('button').length >= 3, 'Returning to local data restores the local row actions');
assert.equal(ctx.getReviewScale(), 5);
assert.equal(ctx.getChartEntries()[0].id, 'local');
assert.equal(JSON.stringify(local), before); assert.equal(JSON.stringify(remote), remoteBefore);
assert.equal(ctx.ratingScale, 5); assert.deepEqual(ctx.captureSettings.tags, ['Local']);
console.log('PASS: all production chart families, period comparisons, advanced filters, scales, shared read-only log rows and local exports switch datasets without changing personal data or settings.');
