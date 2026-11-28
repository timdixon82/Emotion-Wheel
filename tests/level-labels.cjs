// Check the display names for the three levels, and that stored level strings did not change.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Stored strings still exist as values and as mapping keys.
assert.match(html, /const labels = \{ 'Inner circle': 'Main feeling', 'Middle circle': 'More specific feeling', 'Outer circle': 'Most specific feeling' \}/);
for (const s of ["return 'Outer circle'", "return 'Middle circle'", "return 'Inner circle'"]) {
  assert.ok(html.includes(s), `stored string still returned: ${s}`);
}
assert.match(html, /<option value="Inner circle">Main feeling<\/option><option value="Middle circle">More specific feeling<\/option><option value="Outer circle">Most specific feeling<\/option>/);
assert.match(html, /function levelLabel\(value\)/);

// New names appear in column headings and CSV headings.
for (const name of ['Main feeling', 'More specific feeling', 'Most specific feeling']) {
  assert.ok(html.includes(`<th scope="col">${name}</th>`), `column heading ${name}`);
  assert.ok(html.includes(`'${name}'`), `CSV heading ${name}`);
}

// No visible old name in headings or in CSV heading arrays.
assert.ok(!/<th[^>]*>\s*(Inner|Middle|Outer) circle/.test(html), 'no old column headings');
assert.ok(!/'Recorded level', '(Inner|Middle) circle'/.test(html), 'no old names in CSV headers');

// Recorded level values are mapped for display.
assert.ok(html.includes('levelLabel(getRecordedLevel(entry))'));
assert.ok(html.includes('levelLabel(item.level)'));

// Behaviour of the mapping helper, run from the page source.
const labels = { 'Inner circle': 'Main feeling', 'Middle circle': 'More specific feeling', 'Outer circle': 'Most specific feeling' };
const levelLabel = v => labels[v] || v;
assert.equal(levelLabel('Middle circle'), 'More specific feeling');
assert.equal(levelLabel('Something else'), 'Something else');
console.log('PASS: level display names mapped, stored strings unchanged.');

// No old wording in visible text (alt text, option values and code keys are excluded).
{
  const pages = [['index.html', html]];
  for (const f of fs.readdirSync(path.join(__dirname, '../pages')).filter(n => n.endsWith('.html'))) {
    pages.push([`pages/${f}`, fs.readFileSync(path.join(__dirname, '../pages', f), 'utf8')]);
  }
  for (const [name, src] of pages) {
    assert.ok(!/inner[- ]circle (categor|emotion)/i.test(src), `${name}: no old inner-circle wording`);
    assert.ok(!/inner, middle,? and outer rings/i.test(src), `${name}: no old rings wording`);
  }
}
