# Changelog

## 0.1.0 (preview)

First release.

- Status bar toggle: **Offhand: On/Off**.
- After a successful `git add` in VS Code's terminal: a suggested Conventional Commits message and a
  Y/N question. Y commits it; N lets you type your own.
- Works in bash, zsh, Git Bash, PowerShell and Command Prompt.
- Runs fully offline after the first start, which downloads the engine (llama.cpp, ~12-33 MB) and the
  model (~1 GB). GPU when available (NVIDIA, AMD, Intel, Apple Silicon), CPU otherwise.
- ✨ button in Source Control: puts a suggestion in the commit box.
- Windows: offers to install the Microsoft Visual C++ runtime when it's missing.
