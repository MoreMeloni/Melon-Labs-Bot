---
name: Discord command registration
description: Keep slash-command synchronization from removing commands managed outside this bot.
---

Register each command this bot owns with an individual create or update request. Do not bulk-replace the application's full command list.

**Why:** Discord's bulk-overwrite command endpoint removes any command omitted from the submitted list, including commands created by another tool or bot package.

**How to apply:** Fetch existing commands, match by name and type, then POST only new commands or PATCH the matching command. Leave unknown commands unchanged.