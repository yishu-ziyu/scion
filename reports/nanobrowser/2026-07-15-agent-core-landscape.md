# Browser Agent Core landscape (2026-07-15)

Evidence grade: GitHub API star/push snapshots + public docs. Not a bake-off result.

## Durable product stance

- Quality first; replace execution core when quality demands it (`docs/decisions/002`).
- Keep Chrome extension shell and user login (`docs/decisions/001`).
- Keep Task / approval / verified completion / Skill as product contract (`docs/product/001`).

## Star / maintenance snapshot (gh api, ~2026-07-15)

| Repo | Stars | Last push | Role vs our PRD |
|---|---:|---|---|
| firecrawl/firecrawl | ~151k | active | Scrape/search layer, not form-commit agent |
| browser-use/browser-use | ~105k | active | Strongest agent framework ceiling; Python |
| vercel-labs/agent-browser | ~38k | active | CLI for coding agents |
| microsoft/playwright-mcp | ~35k | active | Deterministic control layer |
| lightpanda-io/browser | ~32k | active | Headless browser engine |
| alibaba/page-agent | ~26.6k | active | In-page agent; optional extension; not PaperAgent |
| browserbase/stagehand | ~23.5k | active | TS hybrid AI + code; best stack fit candidate |
| Skyvern-AI/skyvern | ~22.2k | active | Vision + workflows; license/weight caution |
| Alibaba-NLP/DeepResearch | ~19.7k | slower | Deep research, not click-to-submit product |
| nanobrowser/nanobrowser | ~13.5k | last real push 2025-11 | Extension shell valuable; core stale |
| steel-dev/steel-browser | ~7.3k | active | Browser sandbox infra |
| microsoft/Webwright | ~5.8k | cooler | Research-style long-horizon agent |
| browser-act/skills | ~4.4k | active | Agent skills / stealth CLI, not product shell |
| magnitudedev/browser-agent | ~4.1k | stale | Avoid as primary core |
| lmnr-ai/index | ~2.3k | archived | Exclude |

## Name correction

- **PaperAgent**: no Alibaba browser-action project by that name in public search; local hits are paper-writing tools.
- **PageAgent** (`alibaba/page-agent`): the Alibaba in-page GUI agent users usually mean.

## Bake-off shortlist

See `docs/product/002-agent-core-bakeoff.md`: P0 Nano+strong model, P1 Stagehand/Playwright-MCP, P2 Browser Use ceiling, optional P3 PageAgent.
