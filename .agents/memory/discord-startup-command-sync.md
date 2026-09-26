---
name: Discord startup command sync
description: Discord REST command updates can stall independently of the gateway connection.
---

Command registration must run in the background after the Discord gateway is online. A slow global REST update, especially for a large command definition, must not prevent `/ping`, existing interactions, or ticket timer recovery from starting.

**Why:** A large global command update can remain pending while the gateway is already usable; awaiting it during ClientReady makes the bot look offline and blocks unrelated functionality.

**How to apply:** Keep per-command registration and failure logging, but never make the bot's online state depend on the REST sync finishing.