# ⏰ Code Time Machine

**Travel through your code history without Git.** Code Time Machine is a VS Code extension that automatically captures every change in your workspace, allowing you to jump back to any point in time with a single click.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-^1.75.0-007ACC.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 🔄 Automatic Change Tracking
- **Real-time monitoring** - Tracks every file edit, save, creation, and deletion
- **Smart throttling** - Captures changes after 3 seconds of inactivity or on save
- **Complete workspace snapshots** - Stores the entire state of your project at each point in time
- **No Git required** - Works independently of version control systems

### ⏮️ True Time Travel
- **Jump to any point** - Click any snapshot to restore your workspace to that exact moment
- **File restoration** - Files created after a snapshot are automatically removed when jumping back
- **Deleted file recovery** - Files deleted after a snapshot are automatically restored when jumping back
- **Perfect accuracy** - Every file is exactly as it was at that moment in time

### 🔍 Powerful Filtering
- **Search by description** - Find snapshots by typing keywords
- **Time period filters** - Quick filters for Today, Yesterday, This Week, This Month, or All Time
- **Live statistics** - See total snapshots and currently visible count at a glance
- **Real-time filtering** - Results update instantly as you type

### 💾 Smart Storage
- **Content-addressable storage** - Uses SHA-256 hashing like Git
- **Automatic deduplication** - Identical files are stored only once
- **Efficient disk usage** - Only unique content is saved, saving significant space
- **Local storage** - Everything stored in `.history_machine` folder

### 📸 Snapshot Management
- **View files** - See exactly which files existed in any snapshot
- **Export snapshots** - Extract any point in time to a separate folder
- **Clear history** - Remove all snapshots with a single click
- **Timeline visualization** - Beautiful timeline view with relative timestamps

## 🚀 Getting Started

### Installation

1. Open VS Code
2. Press `Ctrl+P` (or `Cmd+P` on Mac)
3. Type `ext install code-time-machine`
4. Press Enter

### First Use

1. Open any folder/workspace in VS Code
2. Look for the **⏰ Time Machine** panel in the Explorer sidebar
3. Start coding - snapshots are captured automatically!
4. Click any snapshot to jump back in time

## 📖 How It Works

### Automatic Capture

Code Time Machine captures snapshots in these scenarios:

- **On typing** - After 3 seconds of inactivity
- **On save** - Immediately when you save a file (`Ctrl+S`)
- **On file creation** - When you create new files or folders
- **On file deletion** - When you delete files or folders

### Storage Structure

```
your-workspace/
├── .history_machine/
│   ├── blobs/              # Content storage (deduplicated)
│   │   ├── abc123def...    # File content by hash
│   │   └── 456789ghi...
│   └── manifest.json       # Timeline index
├── src/
├── package.json
└── ... (your files)
```

### Time Travel Process

When you jump to a snapshot:

1. **Scan current state** - Identifies all current files
2. **Load snapshot state** - Retrieves files from that point in time
3. **Remove future files** - Deletes files that didn't exist yet
4. **Restore past files** - Recreates files that were deleted later
5. **Update content** - Overwrites all files with their historical versions

## 🎮 Usage Examples

### Example 1: Undo Multiple Changes

```
You're working on a feature and make several changes across multiple files.
Suddenly you realize you want to go back to before you started.

1. Open Time Machine panel
2. Find the snapshot from before you started (e.g., "30m ago")
3. Click "Jump Here"
4. Your workspace is instantly restored!
```

### Example 2: Recover Deleted Files

```
You accidentally delete an important file and save the changes.

1. Open Time Machine panel
2. Click "This Week" to filter recent snapshots
3. Find a snapshot from before the deletion
4. Click "Jump Here"
5. The deleted file is automatically restored!
```

### Example 3: Compare Different States

```
You want to see what files existed at different points in your project.

1. Open Time Machine panel
2. Click "View Files" on any snapshot
3. A new panel opens showing all files at that moment
4. Use the search box to find specific files
5. Compare with current state
```

### Example 4: Export a Snapshot

```
You want to extract a working version from 2 days ago.

1. Open Time Machine panel
2. Click "Yesterday" or search for the specific time
3. Click "Export" on the desired snapshot
4. Choose a folder location
5. Complete workspace state is exported!
```

## 🎨 Interface Guide

### Timeline Panel

```
┌─────────────────────────────┐
│ ⏰ Time Machine              │
│ Navigate your code history   │
├─────────────────────────────┤
│ Total: 45    Showing: 45    │ ← Statistics
├─────────────────────────────┤
│ 🔍 Search                    │
│ [Filter by description...]   │
│                              │
│ ⚡ Time Period               │
│ [Today] [Yesterday] [Week]  │
│ [Month] [All Time] [Clear]  │
├─────────────────────────────┤
│ [↻ Refresh] [🗑️ Clear]      │
└─────────────────────────────┘

Timeline:
├─ 5m ago                      ← Latest (Current State)
│  File saved
│  📁 15 files  [View] [Jump]
│
├─ 23m ago
│  Document changed
│  📁 15 files  [View] [Jump]
│
├─ 1h ago
│  Files created
│  📁 14 files  [View] [Jump]
```

### Snapshot Actions

Each snapshot has three actions:

- **View Files** - Opens a panel showing all files in that snapshot
- **Export** - Exports the snapshot to a folder
- **⏮️ Jump Here** - Restores your workspace to this snapshot

## ⚙️ Commands

Access these via Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- `Code Time Machine: Revert to Snapshot` - Jump to a specific snapshot
- `Code Time Machine: Clear History` - Delete all snapshots
- `Code Time Machine: Export Snapshot` - Export a snapshot to a folder
- `Code Time Machine: View Snapshot Files` - View files in a snapshot

## 🔧 Configuration

### Exclusions

By default, these folders are excluded from snapshots:
- `.history_machine/` (the extension's storage)
- `node_modules/`
- `.git/`

### Storage Location

All snapshots are stored in `.history_machine/` in your workspace root.

**Important:** Add `.history_machine/` to your `.gitignore` if you're using Git:

```bash
echo ".history_machine/" >> .gitignore
```

## 💡 Tips & Best Practices

### ✅ Do's

- **Use quick filters** - Fast way to find recent changes
- **Export important snapshots** - Create backups of working states
- **Search descriptions** - Find specific changes quickly
- **Review before jumping** - Click "View Files" to see what will change
- **Clear old history** - Periodically clean up to save disk space

### ❌ Don'ts

- **Don't rely solely on Time Machine** - Still use proper version control (Git) for team projects
- **Don't track large files** - The extension stores complete file contents
- **Don't delete `.history_machine`** - You'll lose all your history
- **Don't jump during unsaved work** - Save your work first to avoid losing changes

## 🛠️ Troubleshooting

### Snapshots Not Appearing

**Problem:** Changes aren't being captured

**Solutions:**
- Ensure you have a workspace/folder open (not just individual files)
- Check that the file is in the workspace (not an external file)
- Verify the extension is activated (check status bar or extension list)

### Timeline Empty After Jump

**Problem:** After jumping to a snapshot, the timeline appears empty

**Solutions:**
- Click the "Refresh" button in the timeline
- Close and reopen the Time Machine panel
- Restart VS Code if the issue persists

### Large Disk Usage

**Problem:** `.history_machine` folder is taking too much space

**Solutions:**
- Click "Clear All" to remove old snapshots
- Exclude large files/folders from your workspace
- Export important snapshots then clear history

### Jump Fails

**Problem:** Error when trying to jump to a snapshot

**Solutions:**
- Ensure no files are currently being edited
- Close all open editors
- Check that `.history_machine` folder exists and is readable
- Try refreshing the timeline

## 🔐 Privacy & Security

- **Local only** - All data stays on your machine
- **No cloud sync** - Nothing is sent to external servers
- **No telemetry** - The extension doesn't track or report usage
- **Full control** - You can delete all history anytime

## 🏗️ Technical Details

### Architecture

- **Language:** TypeScript
- **Storage:** File-based with content-addressable blobs
- **Hashing:** SHA-256 for content deduplication
- **UI:** WebView-based sidebar with VS Code theme integration

### Performance

- **Throttling:** 3-second debounce on typing changes
- **Deduplication:** Identical files stored only once
- **Lazy loading:** Snapshots loaded on-demand
- **Async operations:** Non-blocking capture and restoration

### Compatibility

- **VS Code:** Version 1.75.0 or higher
- **OS:** Windows, macOS, Linux
- **Node.js:** Built-in with VS Code

## 📦 Dependencies

- `fs-extra` - Enhanced file system operations
- `diff` - Content diffing for change detection

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Report bugs** - Open an issue with details and steps to reproduce
2. **Suggest features** - Share your ideas for improvements
3. **Submit PRs** - Fork, code, test, and submit pull requests
4. **Improve docs** - Help make the documentation clearer

### Development Setup

```bash
# Clone the repository
git clone https://github.com/mehsaandev/code-time-machine.git

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run in development
# Press F5 in VS Code to launch Extension Development Host
```

## 📝 Changelog

### Version 1.0.0 (Initial Release)

- ✨ Automatic snapshot capture on changes
- ⏮️ Time travel to any snapshot
- 🔍 Search and filter capabilities
- 📸 View files in snapshots
- 💾 Export snapshots to folders
- 🎨 Professional timeline UI
- 📊 Live statistics and counters

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Built with ❤️ for the VS Code community
- Inspired by the need for local, Git-independent version control
- Thanks to all contributors and users for feedback

## 📧 Support

- **Issues:** [GitHub Issues](https://github.com/mehsaandev/code-time-machine/issues)
- **Discussions:** [GitHub Discussions](https://github.com/mehsaandev/code-time-machine/discussions)
- **Email:** support@example.com

---

**Made with ⏰ by [Muhammad Ehsaan]** | [GitHub](https://github.com/mehsaandev) | [LinkedIn](https://linkedin.com/in/mehsaan) | [Website](https://mehsaan.vercel.app)

*"Because sometimes you need to go back in time without Git."*