# CT Transform

This workspace parses imported raw CT lines, normalizes domain observations,
matches them against conservative watchlists, writes alert feed rows, and flips
the active CT alert load only after a successful transform.

## Command

```bash
npm run ct:transform -- --dump-date 2025-11-24 --import-version ct-import-2025-11-24
```
