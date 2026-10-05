# Privacy

## Your records and choices

You can use Emotion Wheel without an account. Your emotion records, notes, reflection fields, capture settings and theme are saved in this browser on this device. Emotion Wheel has no developer-operated service that receives your emotion records; GitHub hosts the app code, not your log.

Your emotion content leaves the browser when you export a file, copy information, share a chart or table, or choose Google Drive saving or sync. Exported and shared copies are stored wherever you send them. Anonymous pageview statistics are separate, as explained below.

## Connecting Google Drive

Google Drive is optional. Google scripts load when you open My Data, Share My Data, Data Shared with Me or a shared Drive link. Google receives the normal network information needed to serve those requests. Choose Connect Google Drive to sign in and authorise access. Google handles account selection and consent, using its own sign-in services and cookies.

The app requests permission to read, create, update and manage files it creates or you explicitly select, rather than access to all your Drive files. It also requests your verified email address to identify the connected account. Passwords are handled by Google and are not supplied to Emotion Wheel. Read [Google’s privacy policy](https://policies.google.com/privacy).

## Saving, sync and backups

Save to Drive checks and merges your local data with your current Drive file. The complete backup includes records, notes, tags, rating scale and capture settings. The current file is kept in the Emotion Wheel folder; separate dated backups are kept in its Backups folder. Backup names, dates and optional comments are stored in Drive file metadata as well as the filename, so they can appear on other devices. Anyone with access to a backup may see that information too.

Automatic sync starts only when you enable it. While the page is open and connected, it checks every 15 seconds and merges changes between this browser and your current Drive file. Temporary failures can be retried three times at 15-second intervals before sync pauses. Conflicting changes require your choice before they are applied. Reloading or disconnecting stops automatic sync.

To compare changes safely, this browser stores a full common copy of the data, the sync owner’s email, file ID, last successful sync and error details. Local recovery snapshots can also contain complete records. Deletion markers contain record IDs; deleting a record does not erase older backups, recovery copies or Drive revisions.

## Restoring and resolving conflicts

Before applying conflict choices or restoring a Drive backup, the app saves the original local and current Drive copies as recovery backups. Those copies may be stored both in this browser and in Google Drive. Backups before rating changes or data-format updates can also be saved to Drive.

Restoring replaces your local data and the current Drive file after recovery copies are saved. People viewing that current shared file can see the restored data when they refresh it. Sync stays paused after a restore. Another device with unsynced changes may need you to choose which data to keep. Supported older formats are checked and backed up before conversion; unsupported newer formats are not overwritten.

## Sharing and viewing someone’s data

Sharing gives the named recipient Viewer access to a Drive file. Their email address is sent to Google to set that permission; a Google email notification is optional. The app reads file-owner information from Drive to help identify shared files. When you manage sharing, it also reads the file’s permissions, including recipient names, email addresses and access levels. This list stays in memory and clears when you disconnect. Confirming Stop sharing asks Google to remove the selected permission. The sharing link contains a file ID, without an access token or emotion records. The recipient must connect an account with permission to read the file.

Shared data opens read-only in Logs and Charts, separately from your personal records and settings. Downloaded shared records stay in memory. This browser remembers file IDs and your local labels; a default label may include the owner’s name or email. Opening or refreshing a shared file checks access again. Removing it from Data Shared with Me removes its bookmark, not the Drive file. Switching back to local data, disconnecting or closing the page discards downloaded shared records.

You can remove someone’s access in Google Drive at any time. This prevents further authorised reads; it cannot remove copies they have already downloaded, exported or otherwise retained.

## Disconnecting and deleting data

Access tokens and the active connected-account display stay in memory and are cleared on disconnect. Disconnecting retains your local records, sync information, recovery snapshots, shared-file bookmarks and Drive files. It does not revoke Google authorisation. You can remove the app’s access separately in [your Google account connections](https://myaccount.google.com/connections).

Clear local log in My Data clears the active log, but does not erase local recovery snapshots, the saved sync comparison copy or Drive backups. If sync is running, deletions can be carried to the current Drive file. Clearing this site’s browser data removes its locally stored records, preferences, bookmarks and recovery information; save a backup first if you want to retain them. Other browsers and devices keep their own copies.

Drive backups are moved to Trash only after confirmation. The default limit keeps five dated backups; cleanup lists the oldest excess backups first and keeps the current file. To remove Drive copies permanently, manage the files and Trash in Google Drive. Clearing browser data or disconnecting does not delete them.

## Anonymous usage statistics

Emotion Wheel uses GoatCounter to count visits to its pages. When a page loads, your browser requests a small script from `gc.zgo.at` and sends a pageview to `emotionwheel.goatcounter.com`.

GoatCounter may process the page path and referrer, browser and operating-system category, language, screen width, and an approximate country derived from the network address. GoatCounter says it does not store IP addresses or full browser user-agent strings, and does not place cookies or use local storage in your browser. Its optional individual-pageview feature can retain a random session identifier; this is separate from your emotion records. Information used to recognise repeat visits is held temporarily in memory for up to eight hours.

The statistics do not include your emotion selections, reflection answers, intensity values, physical sensations, or notes. GoatCounter is operated from Ireland and its hosted service stores data on servers in Finland and Germany. You can prevent these statistics by blocking `goatcounter.com` and `gc.zgo.at`, including with a content blocker.

Read [GoatCounter's privacy information](https://www.goatcounter.com/help/privacy).


## Help and contact

Read [Help](help.html) for instructions on saving, restoring, sync and sharing. For questions about this app, use [Contact / feedback](https://www.timdixon.net/contact/).

## Important limitation

This is a personal reflection tool, not a medical service, emergency service or secure clinical record. Choose devices, Google accounts and sharing recipients you trust for the information you record.
