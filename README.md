# @ideaspaces/sdk

The IdeaSpaces platform transport package. It currently owns:

- the Keeper JSON-lines event vocabulary;
- the stateful Pi `AgentEvent` → Keeper event translator;
- the stateful Claude Code `stream-json` → Keeper event translator.

The package is ESM-only and has no runtime dependencies.

## Install

```bash
npm install @ideaspaces/sdk
```

## Usage

```ts
import {
  KeeperTranslator,
  type KeeperStreamEvent,
} from "@ideaspaces/sdk";

const translator = new KeeperTranslator({
  conversationId: "conversation-123",
  modelTier: "sonnet",
});

const events: KeeperStreamEvent[] = translator.translate({
  type: "agent_start",
});
```

The same nine events from a headless Claude Code run
(`claude -p --output-format stream-json --include-partial-messages`), one
stdout line at a time:

```ts
import { ClaudeTranslator, parseClaudeStreamLine } from "@ideaspaces/sdk";

const claude = new ClaudeTranslator(); // conversation id and model come from the run's `system.init`
for (const line of stdoutLines) {
  const record = parseClaudeStreamLine(line);
  if (record) emit(claude.translate(record));
}
if (!claude.isEnded) emit(claude.error("claude_exit", "Claude Code exited without a result."));
```

`normalizeClaudeInvocation` rewrites Claude's `Write`/`Edit`/`Read` calls into
the pi-shaped `write`/`edit`/`read` with `path`, so one workspace harvest serves
both runtimes.

## Migrating to 0.2

Version 0.2 ends the transitional protocol compatibility barrel and removes
`@ideaspaces/sdk/tool-contract`.

Import portable repository shape directly from the protocol:

```ts
import {
  assembleContentAwareness,
  renderPosition,
} from "@ideaspaces/protocol";
```

Keep concrete tool schemas and cross-field validation in the MCP, Pi, or Claude
harness that exposes them. The SDK does not currently provide auth, sync,
spaces, graph, or API-client abstractions; those require an evidenced platform
consumer before joining this package.
