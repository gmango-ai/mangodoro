# Mangodoro — AI Agent Guidelines

Leave comments that help agents and developers understand non-obvious intent.
Ask clarifying questions before implementing new features.

## PostHog

Mangodoro uses `posthog-js` for product analytics.

Use `posthog-cli api` (not MCP OAuth / env scraping). Before the first PostHog
command in a session: `posthog-cli api --agent-help`. Before a PostHog task:
`posthog-cli api skill list` and install/follow any matching skill under
`.agents/skills/<id>/SKILL.md`.

Official PostHog skills are **not** auto-updated. A skill already on disk stays
pinned until you refresh it. To pick up PostHog’s latest:  
`posthog-cli api skill install <id> --force`, then re-read `SKILL.md`. Refresh
when the skill’s frontmatter `version` looks stale for the task, or on a
periodic (e.g. quarterly) hygiene pass.
