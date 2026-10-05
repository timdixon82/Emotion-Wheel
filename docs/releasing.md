# Releasing Emotion Wheel

Emotion Wheel uses semantic version numbers in the form `major.minor.patch`.

The current version has one source of truth: `APP_VERSION` in `assets/version.js`. The value is displayed in the footer of the app and every rendered information page.

For every release:

1. Update `APP_VERSION` in `assets/version.js`.
2. Use a patch increase for fixes, a minor increase for backward-compatible features, or a major increase for breaking changes.
3. Run the repository and accessibility checks.
4. Commit the version change with the release changes.
5. Create a Git tag using the same version prefixed with `v`, for example `v1.1.0`.

The version workflow rejects a release tag when it does not match the version shown in the app.

## Preparing the Google Drive release

The Google Drive feature release is **1.3.0**. User-facing copy is in
[What’s new](whats-new-v1.3.0.md). Record schema and backup format remain
version 3; optional Drive sync metadata uses version 1. These versions are
independent of the application version.

GitHub Pages currently publishes the repository root from `main` at
`https://emotionwheel.timdixon.net/`. Merging or pushing release changes to
`main` therefore publishes them; passing checks should be a gate before merging.

1. Finish the real phone/computer tests: sync edits and deletions both ways,
   conflict choices, restore with unsynced changes on another device, backup
   comments and refresh after external deletion, owner/Viewer sharing and
   removal of access. Check keyboard use and iPhone VoiceOver, including Google
   sign-in and Picker. Mocked tests do not replace these checks.
2. Create a separate production Google Cloud project. Google requires testing
   and production projects to be separate. Enable Drive and Picker, configure
   the app’s support contact and branding, and verify the production domain.
   Provide the public home page and Privacy notice links. Complete the Google
   production/branding requirements before opening access to ordinary users.
   Keep the existing development project in Testing for local/private previews.
3. Create a production web OAuth client for
   `https://emotionwheel.timdixon.net`, without localhost or private preview
   origins. Use the existing minimal per-file and identity scopes; do not add
   broader Drive access. Restrict the production browser API key to Drive and
   Picker and the required site referrers, including Google’s Picker iframe
   referrer as described in the development guide.
4. Put the production public client ID, restricted browser API key, project
   number and allowed origin in `assets/google-drive-config.json`. These are
   browser configuration, not an OAuth client secret. Never commit a client
   secret, access token or the ignored local credentials file. Confirm the
   built site requests production configuration and that private preview
   credentials remain excluded from Git.
5. Update `assets/version.js` to 1.3.0 and finalise the What’s new copy. Review
   Privacy, Help, About and README against the final behaviour. Open a pull
   request with test evidence and run the repository’s CI, accessibility and
   security checks before approving the merge.
6. After Tim explicitly approves publication, merge to `main`. Create the
   matching `v1.3.0` tag on the release commit and use the approved What’s new
   text for the GitHub release. Check the Pages build and live version.
7. Verify production sign-in with a synthetic log, then saving, sync, backup
   restore and a second account’s Viewer access on the live site. Production
   per-file authorisation is separate from the test project; do not assume
   existing test-file access transfers automatically.

Google’s authoritative setup requirements:
[production policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance),
[production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
and [Drive per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
