# Adding Keyboard Shortcuts

Most personal websites are built for scrolling and clicking. That works, but it is slow if you visit frequently. Keyboard shortcuts turn a browsing experience into a navigating one. You stop reaching for the mouse and start moving through content the way you move through a code editor or a terminal.

This site now has a full set of shortcuts. None of them are advertised in the UI. There is no tooltip, no help modal, no floating hint badge. The shortcuts follow conventions that already exist in tools like Vim, VS Code, and Slack, so if you have used any of those, most of these will feel familiar without explanation.

## Tab Navigation: 1 Through 5

The site has five sections: Home, Projects, CV, Updates, and Links. Pressing **1** through **5** switches between them instantly. The mapping follows the tab order in the navigation bar, left to right.

This is borrowed from terminal multiplexers and browser tab switching (Cmd+1 through Cmd+9 in most browsers). The difference here is that no modifier key is needed. Since the site has no text input fields on most pages, bare number keys are safe to use as shortcuts without conflicting with typing.

## Search: / and Cmd+K

Pressing **/** focuses the search bar on whichever section you are currently viewing. This matches the convention in GitHub, Google Docs, and most Unix pagers.

**Cmd+K** (or Ctrl+K on Windows/Linux) opens a command palette. This is a floating search overlay that searches across everything on the site at once: all five pages, every project, every link, every CV entry, and every blog post. Results appear ranked by relevance with a type label on the right side so you can tell whether a result is a Project, Link, Post, or CV entry. Pressing Enter on a result navigates directly to it.

The command palette exists because section search only covers one tab at a time. If you are on the Projects page and want to find a blog post, you would have to switch tabs first and then search. The palette removes that friction. It is a single entry point for everything.

## Card Navigation: j and k

Pressing **j** moves focus to the next card on the current page. Pressing **k** moves to the previous one. A blue focus ring appears around the selected card. Pressing **Enter** opens it, the same as clicking.

This is the Vim convention for vertical movement, and it shows up in tools ranging from Gmail to Hacker News. It is particularly useful on the Links and Projects pages where there are dozens of cards to scan through.

Focus clears automatically when you move the mouse, so the two input modes never conflict. If you switch tabs with a number key, focus resets as well.

## Theme Toggle: t

Pressing **t** toggles between light and dark mode. It is equivalent to clicking the Dark/Light button on the home page, just faster.

## Dismissal: Escape and Backspace

**Escape** is context-sensitive. If a search bar is focused, it clears the search and unfocuses. If the command palette is open, it closes it. If you are reading a blog post, it navigates back to the post list. If a card has keyboard focus, it clears the focus ring.

**Backspace** navigates back from a blog post to the Updates list. This is a narrower shortcut than Escape, and it exists because Backspace feels like a natural "go back" gesture (browsers used it for back navigation for years before it was removed for safety reasons).

## Why No Visible Guide

Shortcut hints in the UI create visual noise for the majority of visitors who will never use them. On a minimal site, a floating "?" badge or a keyboard icon in the corner would be the loudest element on the page. The shortcuts are designed to be discoverable through muscle memory. If you instinctively press Cmd+K or /, it works. If you never press either, nothing about the interface changes.

## Why This Works on a Static Site

The entire shortcut system is roughly 220 lines of vanilla JavaScript, with no dependencies. All the data it searches through (projects, links, CV entries, posts) is already fetched and cached for normal tab navigation. The command palette reuses the same scoring function that powers the per-page search bars. Opening the palette builds a unified index from the cached data, scores each item against the query, and returns the top eight results. There is no additional network request, no new data structure, and no duplicated logic.

On mobile, none of this code activates. Phones do not have keyboards, so the event listeners exist silently and never fire. The palette overlay is never injected into the visible DOM until a keyboard event triggers it.
