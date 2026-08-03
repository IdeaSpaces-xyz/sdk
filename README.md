# @ideaspaces/sdk

The IdeaSpaces platform transport package. It currently owns:

- the Keeper JSON-lines event vocabulary;
- the stateful Pi `AgentEvent` → Keeper event translator.

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
