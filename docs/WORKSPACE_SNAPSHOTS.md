# Workspace snapshots and history

Snapshots save local versions of a plugin editor workspace, including files and
editor state. Use them before an experiment, a refactor or a visual change.
They are separate from deploying the plugin, Git commits and remote backups.

## Create and name a restore point

1. Open a plugin in the built-in editor.
2. Choose **Snapshot** in the editor toolbar, or open **Timeline** and choose
   **Create snapshot**.
3. Use **Recent** or the timeline's rename action to give the version a useful
   name, such as `Before changing the dashboard layout`.

## Review and switch versions

Open **Timeline** or **Open Snapshot Timeline…** in the Snapshots sidebar.
Search the saved versions, identify the current one and choose a version to switch
to. FDO restores its files and editor state. If you have changes since the last
snapshot, FDO asks you to create a snapshot before switching if you want to keep
those changes and open tabs. Follow the confirmation carefully; a snapshot switch
changes the editor workspace.

Renaming and deleting versions are explicit actions in the history controls.
Keep a version you may need rather than deleting it. Snapshots are local editor
history: retain your project in Git or a separate backup for durable recovery.

## Live UI drafts and snapshots

Live UI has its own draft Undo/Redo before changes are applied. Applying a reviewed
visual change creates a restore point in the connected workspace. Review the
reported restore point and use editor history if you need to revisit it.
See [Live UI](LIVE_UI_EDITOR.md) for preview support and draft recovery details.

Restoring source does not roll back a running deployment, a remote command,
provider data or cloud resources. Test the restored workspace and deploy it
explicitly when you want the installed plugin to use that version.
