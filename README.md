# Code Time Machine 🕰️

A VS Code extension that captures code changes as batched diffs and allows you to reconstruct files exactly as they existed at any point in time.

## Features

- **Session Management**: Automatically starts recording when you open a workspace or make your first edit
- **Batched Diff Capture**: Records changes every 2-5 seconds (not per keystroke) for efficiency
- **Local Storage**: All data stored locally in SQLite - nothing leaves your machine
- **Perfect File Reconstruction**: Rebuild any tracked file at any recorded timestamp
- **Privacy First**: Explicit opt-in required, with pause/resume controls

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18+ (for native SQLite binding)

## Getting Started

1. **Enable Recording** (Required - Opt-in):
   - Open VS Code Settings
   - Search for "Code Time Machine"
   - Enable the `visualCodeTimeMachine.enabled` setting

2. **Start Recording**:
   - Run command: `Code Time Machine: Start Session`
   - Or just start editing - sessions auto-start when enabled

3. **View Past States**:
   - Run command: `Code Time Machine: Rebuild File At Time`
   - Select a file from the list of tracked files
   - Choose a timestamp to view the file as it was at that moment

## Commands

| Command | Description |
|---------|-------------|
| `Code Time Machine: Start Session` | Manually start a recording session |
| `Code Time Machine: Stop Session` | End the current session |
| `Code Time Machine: Rebuild File At Time` | Reconstruct a file at a specific timestamp |
| `Code Time Machine: Pause Recording` | Temporarily pause diff capture |
| `Code Time Machine: Resume Recording` | Resume diff capture |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `visualCodeTimeMachine.enabled` | `false` | Enable code change recording (opt-in) |
| `visualCodeTimeMachine.batchIntervalMs` | `3000` | Batch interval for capturing diffs (ms) |
| `visualCodeTimeMachine.idleTimeoutMinutes` | `15` | Minutes of inactivity before session ends |

## Ignored Files

The following are automatically excluded from tracking:
- Binary files (images, PDFs, executables, etc.)
- `node_modules/` directory
- `.git/` directory
- Environment files (`.env`, `.env.*`)
- Secret/config files matching sensitive patterns

## Technical Details

### Storage
- Data stored in SQLite database in VS Code's global storage
- Append-only storage pattern ensures data integrity
- Indexed for efficient querying by file path and timestamp

### Diff Algorithm
- Uses `diff-match-patch` library for reliable patching
- Patches stored as text and can be applied in sequence
- Each diff event stores the base content for recovery

### Session Lifecycle
- Sessions auto-start on workspace open (if enabled) or first edit
- Sessions auto-end after 15 minutes of inactivity
- Git repository and branch information captured when available

## Privacy

- **100% Local**: All data stored on your machine
- **No Cloud**: Nothing is ever uploaded
- **Opt-in**: You must explicitly enable recording
- **Pausable**: Stop recording anytime with pause/resume commands

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch
```

## License

MIT
