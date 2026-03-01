# Adding Keyboard Shortcuts

This site now supports keyboard shortcuts. None of them are shown in the UI. There is no tooltip, no help modal, no hint badge. They follow conventions from Vim, VS Code, and Slack, so most of them should feel familiar if you have used any of those.

## Tab Navigation: 1 Through 5

Pressing **1** through **5** switches between the five sections (Home, Projects, CV, Updates, Links), matching the tab order left to right. No modifier key is needed. Since most pages have no text input fields, bare number keys work without conflicting with typing.

## Search: / and Cmd+K

Pressing **/** focuses the search bar on the current section. This matches the convention in GitHub and most Unix pagers.

**Cmd+K** (or Ctrl+K on Windows/Linux) opens a command palette: a floating search overlay that searches across everything at once. Pages, projects, links, CV entries, blog posts. Results are ranked by relevance with a type label on the right so you can tell what you are looking at. Enter navigates directly to the result.

The palette exists because section search only covers one tab at a time. If you are on Projects and want a blog post, you would have to switch tabs first. The palette skips that step entirely.

## Card Navigation: j and k

**j** moves focus to the next card. **k** moves to the previous one. A focus ring highlights the selected card. **Enter** opens it.

This is standard Vim vertical movement. It shows up in Gmail, Hacker News, and most keyboard-driven interfaces. Focus clears automatically when you move the mouse or switch tabs.

## Theme Toggle: t

**t** toggles dark and light mode. Same as clicking the button on the home page.

## Dismissal: Escape and Backspace

**Escape** is context-sensitive. It clears a focused search bar, closes the command palette, navigates back from a blog post, or clears card focus, depending on what is active.

**Backspace** navigates back from a blog post to the Updates list. Browsers used Backspace for back navigation for years before removing it, so the gesture still feels natural.

## Implementation

The shortcut system is roughly 220 lines of vanilla JavaScript with no dependencies. The command palette reuses the same scoring function and cached data that powers the per-section search bars. Opening the palette builds a unified index from data that is already in memory, scores each item, and returns the top eight matches. No additional network requests, no new data structures, no duplicated logic.

On mobile, none of this activates. No keyboard means the event listeners never fire.
