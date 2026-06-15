# Contributing to Island Explorer Ops Console

Thank you for your interest in contributing! This is a production tool used daily by the Island Explorer Birding Tours team in Port Blair.

## How to Contribute

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. Make your changes
4. Test thoroughly in Chrome, Firefox, and Safari
5. Commit with clear messages
6. Open a **Pull Request** with a detailed description

## Guidelines

- **Single-file constraint**: The main ops console (`src/island-explorer-ops.html`) is intentionally a single file. If adding features, include them inline. The Drive App (`drive-app.html`) is a separate file for modularity.
- **No external JS dependencies**: Do not add npm packages or CDN scripts. Use vanilla JavaScript.
- **Browser compatibility**: Target Chrome 90+, Firefox 88+, Safari 14+, Edge 90+.
- **Data model changes**: When modifying data structures, ensure backward compatibility with existing `localStorage` data.
- **Mobile-first**: The ops console is used on laptops in the field. Ensure it works at 1280px and above.

## Code Style

- Use 2-space indentation
- Use single quotes for strings
- Use `const` and `let`; avoid `var` in new code
- Use arrow functions for callbacks
- Prefix DOM-element variables with `$` (e.g., `$nav`, `$content`)

## Reporting Issues

When reporting a bug, please include:
- Browser and version
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots if applicable

## Contact

Dr. Sumit Rao &mdash; sumit@islandexplorer.in
