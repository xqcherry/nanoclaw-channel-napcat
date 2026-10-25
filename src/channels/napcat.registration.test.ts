import { describe, it, expect } from "vitest";
import "./index.js";
import {
  getRegisteredChannelNames,
  getChannelDefaults,
  hasDeclaredChannelDefaults,
} from "./channel-registry.js";

describe("NapCat installed channel registration", () => {
  it("registers qq through the actual host barrel with offline defaults", () => {
    expect(getRegisteredChannelNames()).toContain("qq");
    expect(hasDeclaredChannelDefaults("qq")).toBe(true);
    expect(getChannelDefaults("qq")).toEqual({
      dm: {
        engageMode: "pattern",
        engagePattern: ".",
        threads: false,
        unknownSenderPolicy: "strict",
      },
      group: {
        engageMode: "mention",
        threads: false,
        unknownSenderPolicy: "strict",
      },
      mentions: "platform",
    });
  });
});
