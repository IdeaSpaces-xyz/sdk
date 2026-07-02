import { describe, it, expect } from "vitest";
import * as sdk from "./index.js";
import {
  KEEPER_STREAM_EVENT_TYPES,
  emptyWorkspaceSurface,
  zeroUsage,
  type KeeperStreamEvent,
} from "./keeper-events.js";

// Guards the Keeper transport contract so it can't drift silently from the
// clients (desktop keeper-types, sw_space Keeper) that must speak the same shape.

describe("Keeper event contract", () => {
  it("declares exactly the nine stream event types", () => {
    expect([...KEEPER_STREAM_EVENT_TYPES]).toEqual([
      "message_start",
      "thinking_delta",
      "text_delta",
      "tool_start",
      "tool_result",
      "message_delta",
      "turn_complete",
      "cancelled",
      "error",
    ]);
  });

  it("re-exports the contract + bridge from the SDK entrypoint", () => {
    expect(Array.isArray(sdk.KEEPER_STREAM_EVENT_TYPES)).toBe(true);
    expect(typeof sdk.KeeperTranslator).toBe("function");
    expect(typeof sdk.emptyWorkspaceSurface).toBe("function");
    expect(typeof sdk.zeroUsage).toBe("function");
    expect(typeof sdk.defaultToolResultPreview).toBe("function");
  });

  it("emptyWorkspaceSurface is the five-list zero value", () => {
    expect(emptyWorkspaceSurface()).toEqual({ created: [], modified: [], deleted: [], read: [], mentioned: [] });
  });

  it("zeroUsage carries the tier and zeros the rest", () => {
    const u = zeroUsage("haiku");
    expect(u.model_tier).toBe("haiku");
    expect(u.total_tokens).toBe(0);
    expect(u.cost_usd).toBe(0);
  });

  it("turn_complete result composes the contract types (compile + runtime shape)", () => {
    const ev: KeeperStreamEvent = {
      type: "turn_complete",
      result: {
        response: "hi",
        usage: zeroUsage("opus"),
        tool_calls: [],
        iterations: 1,
        position: "",
        workspace: emptyWorkspaceSurface(),
      },
    };
    expect(ev.type).toBe("turn_complete");
  });
});
