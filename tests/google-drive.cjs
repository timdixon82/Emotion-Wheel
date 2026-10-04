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
  let retriedReads = 0;
  const transient = new DriveClient({ fetch: async () => {
    retriedReads++;
    if (retriedReads === 1) throw new TypeError('Synthetic transient connection failure');
    return new Response(JSON.stringify({email_verified:true,email:'test@example.test'}));
  } });
  transient.setAccessToken({access_token:'synthetic',expires_in:60});
  assert.equal(await transient.getConnectedEmail(),'test@example.test'); assert.equal(retriedReads,2);
  let writesAttempted = 0;
  const ambiguous = new DriveClient({fetch:async()=>{ writesAttempted++; throw new TypeError('Synthetic response lost'); }});
  ambiguous.setAccessToken({access_token:'synthetic',expires_in:60});
  await assert.rejects(ambiguous.updateBackup(fileId,backup,'"baseline"'),/connection failed/);
  assert.equal(writesAttempted,1,'Ambiguous uploads must never retry automatically');
  console.log('PASS: transient reads retry within a bound; ambiguous writes are attempted only once.');
  const guardedCalls = [];
  let guardedReplies = [];
  const guarded = new DriveClient({ fetch: async (url, options) => { guardedCalls.push({url,options}); return guardedReplies.shift(); } });
  guarded.setAccessToken({access_token:'synthetic',expires_in:60});
  guardedReplies = [new Response(JSON.stringify({id:fileId,etag:'"baseline"',editable:true}))];
  assert.equal((await guarded.getUpdateState(fileId)).etag, '"baseline"');
  await assert.rejects(guarded.updateBackup(fileId,backup,'*'), /baseline/);
  guardedReplies = [new Response('',{status:412})];
  await assert.rejects(guarded.updateBackup(fileId,backup,'"baseline"'), error => error.code === 'drive-conflict');
  const guardedPut = guardedCalls.at(-1);
  assert.equal(guardedPut.options.method,'PUT'); assert.equal(guardedPut.options.headers.get('If-Match'),'"baseline"');
  assert(guardedPut.url.includes('newRevision=true&pinned=true'));
  assert.deepEqual(JSON.parse(guardedPut.options.body),backup);
  guardedReplies = [new Response(JSON.stringify({id:fileId,etag:'"next"'}))];
  assert.equal((await guarded.updateBackup(fileId,backup,'"baseline"')).etag,'"next"');
  guardedReplies = [new Response(JSON.stringify({id:fileId}))];
  await assert.rejects(guarded.getUpdateState(fileId), /baseline/);
  console.log('PASS: guarded updates require an exact ETag, preserve revisions and pause on stale or missing baselines.');
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
  assert(calls.every(call => call.options.credentials === 'omit'));
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'follow');
  assert(calls.every(call => !call.url.includes('synthetic-test-token')));
  assert(calls.every(call => call.options.headers.get('Authorization') === 'Bearer synthetic-test-token'));
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: connection is optional; Viewer reads use only GET; complete Unicode backup and extension fields retained; token stays out of URLs.');

  replies = [json({ id: fileId, name: 'Emotion Wheel backup.json' })];
  await client.createBackup(backup);
  const upload = calls.at(-1);
  assert.equal(upload.options.method, 'POST');
  assert.equal(upload.options.redirect, 'error');
  assert(upload.options.body.includes(original));
  assert(!upload.options.body.includes('synthetic-test-token'));
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: creation uploads complete backup including IDs, dates, settings, notes, tags and scale without changing local input.');

  const rootId = 'synthetic_folder_root_123', backupsId = 'synthetic_folder_backups_123';
  replies = [json({files:[]}),json({id:rootId}),json({files:[]}),json({id:backupsId})];
  assert.deepEqual(await client.getFolderTree(),{folderId:rootId,backupsId:backupsId});
  const folderPosts=calls.filter(call=>call.options.method==='POST' && call.url.includes('/files?'));
  assert.deepEqual(JSON.parse(folderPosts.at(-1).options.body).parents,[rootId]);
  assert.equal(JSON.parse(folderPosts.at(-1).options.body).appProperties.role,'backups-folder');
  replies=[json({files:[{id:rootId}]}),json({files:[{id:backupsId}]})];
  const beforeReuse=calls.length;
  await client.getFolderTree(); assert(calls.slice(beforeReuse).every(call=>!call.options.method),'Existing folders are reused');
  replies=[json({files:[{id:fileId},{id:'duplicate_current_123'}]})];
  await assert.rejects(client.findCurrent(rootId),/More than one current/);
  replies=[json({files:[],incompleteSearch:true})];
  await assert.rejects(client.listBackups(backupsId),/incomplete/);
  replies=[json({files:[{id:'old_backup_123'}],nextPageToken:'next'}),json({files:[{id:'new_backup_123'}]})];
  assert.equal((await client.listBackups(backupsId)).length,2);
  assert(new URL(calls.at(-1).url).searchParams.has('pageToken'));
  replies=[json({id:fileId})];
  await client.createBackup(backup,{name:'Named backup 2026.json',parentId:backupsId,role:'backup'});
  assert(calls.at(-1).options.body.includes('Named backup 2026.json'));
  assert(calls.at(-1).options.body.includes(backupsId));
  const baseline={id:fileId,etag:'"stable"',editable:true,owners:[{emailAddress:'owner@example.test'}]};
  const managed={id:fileId,mimeType:'application/json',parents:[backupsId],owners:[{emailAddress:'owner@example.test'}],appProperties:{application:'emotion-wheel',role:'backup'}};
  replies=[json(baseline),json({...managed,appProperties:{application:'emotion-wheel',role:'current'}}),json(backup),json(baseline)];
  const beforeDeniedTrash=calls.length;
  await assert.rejects(client.trashBackup(fileId,backupsId,'owner@example.test'),/Only your managed backups/);
  assert(calls.slice(beforeDeniedTrash).every(call=>!call.options.method));
  replies=[json(baseline),json(managed),json(backup),json(baseline),json({id:fileId,trashed:true})];
  await client.trashBackup(fileId,backupsId,'owner@example.test');
  assert.equal(calls.at(-1).options.method,'PATCH');
  assert.equal(calls.at(-1).options.headers.get('If-Match'),'"stable"');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{trashed:true});
  assert(!calls.some(call=>call.options.method==='DELETE'));
  console.log('PASS: managed folders reuse parents, current duplicates and incomplete lists stop; named backups paginate; cleanup excludes current files and uses conditional recoverable Trash only.');

  replies = [json({ email: 'owner@example.test', email_verified: true })];
  assert.equal(await client.getConnectedEmail(), 'owner@example.test');
  assert.equal(calls.at(-1).url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(calls.at(-1).options.headers.get('Authorization'), 'Bearer synthetic-test-token');
  replies = [json({ email: 'unverified@example.test', email_verified: false })];
  await assert.rejects(client.getConnectedEmail(), /verified/);
  const beforeInvalidRecipient = calls.length;
  await assert.rejects(client.shareWithViewer(fileId, 'bad\nrecipient@example.test'), /valid recipient/);
  assert.equal(calls.length, beforeInvalidRecipient);
  replies = [json({ type: 'user', role: 'reader', emailAddress: 'viewer@example.test' })];
  await client.shareWithViewer(fileId, 'viewer@example.test');
  const grant = calls.at(-1);
  assert.equal(grant.options.method, 'POST');
  assert(grant.url.includes('/permissions?sendNotificationEmail=false'));
  assert.deepEqual(JSON.parse(grant.options.body), { type: 'user', role: 'reader', emailAddress: 'viewer@example.test' });
  assert.equal(grant.options.redirect, 'error');
  assert.equal(grant.options.credentials, 'omit');
  replies = [json({ type: 'user', role: 'reader' })];
  await client.shareWithViewer(fileId, 'viewer@example.test', true);
  assert(calls.at(-1).url.includes('sendNotificationEmail=true'));
  replies = [json({ type: 'user', role: 'writer' })];
  await assert.rejects(client.shareWithViewer(fileId, 'viewer@example.test'), /confirm Viewer/);
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: account label comes from Google verified email; sharing grants only a named user Viewer access, defaults to no notification and requires a confirmed reader response.');

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

  for (const failedStage of ['metadata', 'download', 'upload']) {
    const failedClient = new DriveClient({ fetch: async url => {
      if (failedStage === 'download' && !url.includes('?alt=media')) return json({ mimeType: 'application/json' });
      throw new TypeError('Failed to fetch: synthetic-secret');
    } });
    failedClient.setAccessToken({ access_token: 'synthetic-secret', expires_in: 60 });
    await assert.rejects(failedStage === 'upload' ? failedClient.createBackup(backup) : failedClient.readBackup(fileId), error => {
      assert.equal(error.code, 'drive-network');
      assert.match(error.message, new RegExp(failedStage === 'metadata' ? 'checking file access' :
        failedStage === 'download' ? 'downloading the backup' : 'saving the backup'));
      assert(!error.message.includes('synthetic-secret'));
      return true;
    });
    assert.equal(JSON.stringify(backup), original);
  }
  console.log('PASS: connection failures identify the failed operation without exposing credential details or changing local data.');

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
  // Switching accounts while a response body is streaming must not send the
  // second request with the new account, or report an old upload as current.
  let bodyController;
  const stream = () => new Response(new ReadableStream({ start(controller) { bodyController = controller; } }));
  let streamingCalls = 0;
  const streaming = new DriveClient({ fetch: async () => { streamingCalls++; return stream(); } });
  streaming.setAccessToken({ access_token: 'first-account', expires_in: 60 });
  const metadataPending = streaming.readBackup(fileId);
  await new Promise(resolve => setImmediate(resolve));
  streaming.setAccessToken({ access_token: 'second-account', expires_in: 60 });
  bodyController.enqueue(new TextEncoder().encode(JSON.stringify({ mimeType: 'application/json' })));
  bodyController.close();
  await assert.rejects(metadataPending, /connection changed/);
  assert.equal(streamingCalls, 1, 'Account change must stop before the content request');
  const uploadPending = streaming.createBackup(backup);
  await new Promise(resolve => setImmediate(resolve));
  streaming.disconnect();
  bodyController.enqueue(new TextEncoder().encode(JSON.stringify({ id: fileId })));
  bodyController.close();
  await assert.rejects(uploadPending, /connection changed/);
  assert.equal(JSON.stringify(backup), original);
  console.log('PASS: file IDs validated; share link contains only file ID; disconnect and account changes discard in-flight requests and streamed responses.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
