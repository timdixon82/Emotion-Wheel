// Check the renamed step headings, the skip links, and that stored level strings did not change.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

const heading = id => html.match(new RegExp(`<h2 id="${id}"[^>]*>([^<]*)</h2>`))?.[1];
assert.equal(heading('inner-heading'), 'Step 1: Main feeling');
assert.equal(heading('middle-heading'), 'Step 2: More specific feeling (optional)');
assert.equal(heading('outer-heading'), 'Step 3: Most specific feeling (optional)');

for (const old of ['Step 1: Inner circle', 'Step 2: Middle circle', 'Step 3: Outer circle']) {
  assert.ok(!html.includes(old), `old heading text gone: ${old}`);
}

// Skip links come first in the body, in order, and target ids that exist.
const body = html.slice(html.indexOf('<body>') + 6);
const links = [...body.matchAll(/<a class="skip-link" href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)];
assert.equal(links.length, 2, 'two skip links');
assert.deepEqual(links.map(l => l[2]), ['Skip to main content', 'Skip to Record this emotion']);
assert.ok(body.trimStart().startsWith(links[0][0]), 'first skip link is the first element in body');
assert.ok(body.indexOf(links[1][0]) < body.indexOf('<header'), 'both skip links come before the header');
for (const [, id] of links) assert.match(html, new RegExp(`id="${id}"`), `skip target #${id} exists`);
assert.match(html, /<main id="main-content" tabindex="-1">/, 'main is programmatically focusable');

// Record skip link is hidden outside the Entry view.
assert.match(html, /getElementById\('skipToRecord'\)\.hidden = currentAppView !== 'entry'/, 'Record skip link hidden outside Entry view');

// Disabled Record gives a polite status message, for both cases.
assert.match(html, /<p id="liveStatus" aria-live="polite"/, 'status region is polite');
assert.ok(html.includes('Record is unavailable until you choose an emotion'), 'no-selection message');
assert.ok(html.includes('Record is unavailable while reviewing a shared dataset'), 'review dataset message');

// Focused headings use the page focus ring.
assert.match(html, /#inner-heading:focus, #current-selection-heading:focus \{ outline: 4px solid var\(--focus\)/, 'heading focus ring');

// Drive sync script is cache-busted like version.js.
assert.match(html, /assets\/google-drive-sync\.js\?v=\d+\.\d+\.\d+"/, 'sync script has version query');

// Stored level strings in code are unchanged.
for (const level of ["'Inner circle'", "'Middle circle'", "'Outer circle'"]) {
  assert.ok(html.includes(`return ${level};`), `stored level ${level} still returned by code`);
}
console.log('PASS: step headings, skip links and stored level strings.');
