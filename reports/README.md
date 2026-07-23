# Reports

Run evidence and E2E notes — **not** product docs (those live under `docs/`).

Naming: `reports/<project-slug>/`

| Folder | Product |
|--------|---------|
| `nanobrowser/` | Historical slug; product name is **持节**. Keep path for continuity. |

Inside each project folder:

- `README.md` - index
- `YYYY-MM-DD-topic.md` - dated run / decision notes
- optional `assets/` for small non-sensitive screenshots later
- `logs/` - local CDP captures (gitignored except README / .gitkeep)

Do not put API keys, cookies, or full local `/tmp` dumps here.
