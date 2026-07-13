# Spec

## Product sentence

Navigator stays on a real content page even when an extension page is the active Chrome tab.

## Acceptance

- `BrowserContext.getCurrentPage()` skips an active `chrome-extension://` tab when an allowed content tab exists.
- `BrowserContext.getTabInfos()` does not expose forbidden tabs to the Navigator prompt.
- Existing URL/firewall policy remains the single source of truth.
- Targeted tests, extension type-check, production build, and one main-Chrome side-panel task pass.
