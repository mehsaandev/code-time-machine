# Contributing to Visual Code Time Machine

First off, thank you for considering contributing to Visual Code Time Machine! 🎉

## Table of Contents

- [Contributing to Visual Code Time Machine](#contributing-to-visual-code-time-machine)
  - [Table of Contents](#table-of-contents)
  - [Code of Conduct](#code-of-conduct)
  - [How Can I Contribute?](#how-can-i-contribute)
    - [Reporting Bugs](#reporting-bugs)
    - [Suggesting Features](#suggesting-features)
    - [Pull Requests](#pull-requests)
  - [Development Setup](#development-setup)
    - [Prerequisites](#prerequisites)
    - [Getting Started](#getting-started)
    - [Available Scripts](#available-scripts)
  - [Project Structure](#project-structure)
    - [Key Files](#key-files)
  - [Style Guidelines](#style-guidelines)
    - [TypeScript](#typescript)
    - [Code Formatting](#code-formatting)
    - [Comments](#comments)
  - [Commit Messages](#commit-messages)
    - [Types](#types)
    - [Examples](#examples)
  - [Questions?](#questions)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to providing a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/mehsaandev/code-time-machine/issues) to avoid duplicates.

When creating a bug report, please include:

- **Clear title** - A descriptive title that summarizes the issue
- **Steps to reproduce** - Detailed steps to reproduce the behavior
- **Expected behavior** - What you expected to happen
- **Actual behavior** - What actually happened
- **Screenshots** - If applicable, add screenshots to help explain the problem
- **Environment info**:
  - VS Code version
  - Extension version
  - Operating System

**Bug Report Template:**

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- VS Code: [e.g., 1.85.0]
- Extension: [e.g., 0.2.3]
- OS: [e.g., Windows 11]
```

### Suggesting Features

Feature suggestions are welcome! Please open an issue with:

- **Clear title** - A descriptive title for the feature
- **Problem statement** - What problem does this feature solve?
- **Proposed solution** - How do you envision this working?
- **Alternatives considered** - Any alternative solutions you've thought of
- **Additional context** - Any other context, mockups, or examples

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our style guidelines
3. **Test your changes** thoroughly
4. **Update documentation** if needed
5. **Submit a pull request**

**Pull Request Checklist:**

- [ ] Code compiles without errors (`npm run compile`)
- [ ] Code follows the project's style guidelines
- [ ] Self-review of the code completed
- [ ] Comments added for complex logic
- [ ] Documentation updated (if applicable)
- [ ] No new warnings introduced

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [VS Code](https://code.visualstudio.com/) (v1.75.0 or higher)
- [Git](https://git-scm.com/)

### Getting Started

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/mehsaandev/code-time-machine.git
   cd code-time-machine
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Compile TypeScript**

   ```bash
   npm run compile
   ```

4. **Run in development mode**

   - Open the project in VS Code
   - Press `F5` to launch the Extension Development Host
   - A new VS Code window will open with the extension loaded

5. **Make changes and test**

   - Edit the source files in `src/`
   - The extension will automatically recompile on save (if using `npm run watch`)
   - Reload the Extension Development Host to test changes (`Ctrl+R` or `Cmd+R`)

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch mode - recompile on file changes |
| `npm run lint` | Run ESLint to check code style |
| `npm run package` | Build the extension for production |

## Project Structure

```
code-time-machine/
├── src/
│   ├── extension.ts        # Extension entry point, activation logic
│   ├── historyManager.ts   # Core logic for snapshots and storage
│   └── timelineProvider.ts # WebView UI for the timeline panel
├── images/
│   └── icon.png            # Extension icon
├── out/                    # Compiled JavaScript (generated)
├── package.json            # Extension manifest and dependencies
├── tsconfig.json           # TypeScript configuration
└── build.js                # Build script for packaging
```

### Key Files

- **extension.ts** - Handles extension activation, registers commands, and sets up event listeners
- **historyManager.ts** - Manages snapshot creation, storage, retrieval, and restoration
- **timelineProvider.ts** - Creates the WebView UI for the sidebar timeline panel

## Style Guidelines

### TypeScript

- Use TypeScript for all source files
- Enable strict mode
- Use async/await instead of callbacks
- Prefer `const` over `let` where possible
- Use meaningful variable and function names

### Code Formatting

- Use 4 spaces for indentation
- Use single quotes for strings
- Add semicolons at the end of statements
- Keep lines under 120 characters when possible

### Comments

- Add JSDoc comments for public functions and classes
- Use inline comments sparingly, only for complex logic
- Keep comments up-to-date with code changes

**Example:**

```typescript
/**
 * Captures a snapshot of the current workspace state.
 * @param description - A brief description of what changed
 * @param changedFiles - Optional array of files that changed
 * @returns True if snapshot was created, false if skipped
 */
async captureSnapshot(description: string, changedFiles?: string[]): Promise<boolean> {
    // Implementation...
}
```

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat` - A new feature
- `fix` - A bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

### Examples

```
feat(timeline): add search functionality to timeline panel
fix(snapshot): resolve issue with file restoration on Windows
docs(readme): update installation instructions
refactor(storage): improve deduplication algorithm performance
```

---

## Questions?

Feel free to open an issue or reach out:

- **GitHub Issues:** [Report an issue](https://github.com/mehsaandev/code-time-machine/issues)
- **Email:** ehsaan2611@gmail.com
- 
Thank you for contributing! 🙏
