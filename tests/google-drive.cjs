// Synthetic Drive responses: no network calls, Google account or real records.
'use strict';
const assert = require('node:assert/strict');
const { DriveClient, sharingUrl, MAX_BACKUP_BYTES } = require('../assets/google-drive.js');

async function main() {
  const fileId = 'test_emotion_wheel_file_123';
  const backup = { version: 3, schemaVersion: 3, ratingScale: 5,
    settings: { captureMode: 'phase3' }, tags: ['Work'], entries: [{
      id: '7a79b411-8c4e-4ef1-823d-d97157c3a67f', createdAt: '2026-10-04T10:00:00Z',
      modifiedAt: '2026-10-04T11:00:00Z', timestamp: '2026-10-04T10:00:00Z',
      inner: 'Happy', comment: 'Synthetic note: café 🙂', tags: ['Work'], bucketLevel: 5,
      extension: { retained: true }
    }] };
  const original = JSON.stringify(backup);
  const calls = [];
  let time = 0;
  let replies = [];
  const client = new DriveClient({ now: () => time, fetch: async (url, options) => {
    calls.push({ url, options });
    const reply = replies.shift();
    assert(reply, 'Unexpected request');
    return reply;
  } });
  const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(client.readBackup(fileId), /Reconnect/);
  assert.equal(calls.length, 0);
  assert.throws(() => client.setAccessToken({ access_token: 'synthetic' }), /valid authorisation/);
  client.setAccessToken({ access_token: 'synthetic-test-token', expires_in: 60 });
  replies = [json({ id: fileId, mimeType: 'application/json', capabilities: { canDownload: true, canEdit: false } }), json(backup)];
  const loaded = await client.readBackup(fileId);
  assert.deepEqual(loaded.backup, backup);
  assert.equal(loaded.metadata.capabilities.canEdit, false);
  assert(calls.every(call => call.options.method === undefined), 'Read-only access must make only GET requests');
  assert(calls.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error'));
  assert(calls.every(call => !call.url.includes('synthetic-test-token')));
  assert(calls.every(call => call.options.headers.get('Authorization') === 'Bearer synthetic-test-token'));
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: connection is optional; Viewer reads use only GET; complete Unicode backup and extension fields retained; token stays out of URLs.');

  replies = [json({ id: fileId, name: 'Emotion Wheel backup.json' })];
  await client.createBackup(backup);
  const upload = calls.at(-1);
  assert.equal(upload.options.method, 'POST');
  assert(upload.options.body.includes(original));
  assert(!upload.options.body.includes('synthetic-test-token'));
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: creation uploads complete backup including IDs, dates, settings, notes, tags and scale without changing local input.');

  time = 56000;
  const beforeExpiry = calls.length;
  await assert.rejects(client.createBackup(backup), /Reconnect/);
  assert.equal(calls.length, beforeExpiry);
  time = 0;
  client.setAccessToken({ access_token: 'synthetic', expires_in: 60 });
  replies = [new Response('', { status: 401 })];
  await assert.rejects(client.readBackup(fileId), /Reconnect/);
  assert.equal(client.connected, false);
  client.setAccessToken({ access_token: 'synthetic', expires_in: 60 });
  for (const status of [403, 404, 429, 500]) {
    replies = [new Response('', { status })];
    await assert.rejects(client.readBackup(fileId), /cannot access|busy|could not complete/);
  }
  console.log('PASS: expired credentials block calls; unauthorised tokens are cleared; denied, missing, busy and failed requests preserve local input.');

  for (const metadata of [{ mimeType: 'text/html' }, { mimeType: 'application/json', size: MAX_BACKUP_BYTES + 1 },
    { mimeType: 'application/json', capabilities: { canDownload: false } }]) {
    replies = [json(metadata)];
    await assert.rejects(client.readBackup(fileId), /backup file|too large|disabled downloads/);
    assert.equal(replies.length, 0);
  }
  replies = [json({ mimeType: 'application/json' }), new Response('not JSON')];
  await assert.rejects(client.readBackup(fileId), SyntaxError);
  replies = [json({ mimeType: 'application/json' }), json({ unrelated: true })];
  await assert.rejects(client.readBackup(fileId), /not an Emotion Wheel/);
  replies = [json({ mimeType: 'application/json' }), new Response('{}', { headers: { 'Content-Length': String(MAX_BACKUP_BYTES + 1) } })];
  await assert.rejects(client.readBackup(fileId), /too large/);
  replies = [json({ mimeType: 'application/json' }), new Response(new Uint8Array(MAX_BACKUP_BYTES + 1))];
  await assert.rejects(client.readBackup(fileId), /too large/);
  console.log('PASS: non-JSON, invalid, download-restricted and oversized files are rejected before import, including missing/false size metadata.');

  const link = new URL(sharingUrl('http://localhost:8765/?old=value#old', fileId));
  assert.equal(link.origin, 'http://localhost:8765');
  assert.equal(link.search, '');
  assert.equal(link.hash, `#drive=${fileId}`);
  assert.throws(() => sharingUrl('javascript:alert(1)', fileId), /Unsupported/);
  const beforeInvalid = calls.length;
  await assert.rejects(client.readBackup('../files?token=bad'), /Invalid/);
  assert.equal(calls.length, beforeInvalid);
  client.disconnect();
  assert.equal(client.connected, false);
  await assert.rejects(client.readBackup(fileId), /Reconnect/);

  // Account switches/disconnect during an in-flight request must discard its result.
  let finish;
  const delayed = new DriveClient({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  delayed.setAccessToken({ access_token: 'synthetic', expires_in: 60 });
  const pending = delayed.readBackup(fileId);
  delayed.disconnect();
  finish(json({ mimeType: 'application/json' }));
  await assert.rejects(pending, /connection changed/);
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: file IDs validated; share link contains only file ID; disconnect clears access and discards in-flight results.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
