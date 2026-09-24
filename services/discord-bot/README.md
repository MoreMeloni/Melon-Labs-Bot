# Discord Bot

A Node.js bot built with discord.js. It keeps `/ping` and provides private
support tickets with a button panel, server-specific setup, access controls, and
creation/closure logs.

## Setup

1. Create a Discord application in the Discord Developer Portal and add a bot.
2. Store the bot token in Replit Secrets as `DISCORD_TOKEN`. Do not commit the
   token or put it in source code.
3. Invite the bot to your server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes.
4. Start the **Discord Bot** workflow. On startup it connects to Discord and
   registers `/ping` and `/ticket`.

## Configure tickets

In the server, a manager runs:

```text
/ticket setup category:<category> support_role:<role> log_channel:<text channel>
/ticket panel [channel:<text channel>]
```

Setup saves the server's category, support role, and log channel to
`data/ticket-config.json`. The bot denies `@everyone` access to each ticket and
grants access to its owner, the support role, and the bot. A member can have one
open ticket at a time.

Members open tickets with the panel's **Create a ticket** button. The ticket
channel includes a **Close ticket** button; the owner or support team can also
run `/ticket close [reason]` there. Closing locks the owner's ability to send
messages, marks and renames the channel, and records the closer and optional
reason in the log channel. `/ticket add` and `/ticket remove` manage additional
member access while a ticket is open.

The bot needs `Manage Channels` in the server, plus `View Channel`,
`Send Messages`, and `Embed Links` in the panel and log channels. Its OAuth2
invite needs the `bot` and `applications.commands` scopes.

## Commands

- `/ping` — replies `Pong!`
- `/ticket setup` — configure the category, support role, and log channel
- `/ticket panel` — post the ticket creation panel
- `/ticket close [reason]` — close the current ticket
- `/ticket add member:<member>` and `/ticket remove member:<member>` — manage access

Slash commands register globally by default. Global commands can take time to
appear in Discord. For faster development updates, set the non-secret
environment variable `DISCORD_GUILD_ID` to your test server's ID; the bot will
register its commands only in that server.

Ticket settings are stored in the workspace and survive bot restarts. Set
`TICKET_CONFIG_PATH` to use a different non-secret file path.

## Run and check

```sh
pnpm --filter @workspace/discord-bot start
pnpm --filter @workspace/discord-bot typecheck
```