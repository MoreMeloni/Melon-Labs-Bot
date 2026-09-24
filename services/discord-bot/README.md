# Discord Ping Bot

A small Node.js bot built with discord.js. It registers a `/ping` slash command
and replies with `Pong!`.

## Setup

1. Create a Discord application in the Discord Developer Portal and add a bot.
2. Store the bot token in Replit Secrets as `DISCORD_TOKEN`. Do not commit the
   token or put it in source code.
3. Invite the bot to your server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes.
4. Start the **Discord Bot** workflow. On startup it connects to Discord and
   registers `/ping`.

By default, `/ping` is registered globally. Global commands can take time to
appear in Discord. For faster development updates, set the non-secret
environment variable `DISCORD_GUILD_ID` to your test server's ID; the bot will
register the command only in that server.

## Run and check

```sh
pnpm --filter @workspace/discord-bot start
pnpm --filter @workspace/discord-bot typecheck
```