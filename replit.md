# Discord Ping Bot

A discord.js bot that connects to Discord and responds to the `/ping` slash command.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot start` — run the Discord bot
- `pnpm --filter @workspace/discord-bot typecheck` — typecheck the bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secret for the bot: `DISCORD_TOKEN`
- Optional non-secret bot env: `DISCORD_GUILD_ID` for immediate command updates in a test server

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Discord bot: Node.js, TypeScript, discord.js 14

## Where things live

- `services/discord-bot/src/index.ts` — Discord client, slash command registration, and `/ping` interaction
- `services/discord-bot/README.md` — Discord application and server setup

## Architecture decisions

- Slash commands register globally by default; set `DISCORD_GUILD_ID` to register only in a development server while iterating.

## Product

- `/ping` replies with `Pong!`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
