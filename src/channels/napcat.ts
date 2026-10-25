import { readEnvFile } from "../env.js";
import { log } from "../log.js";
import { registerChannelAdapter } from "./channel-registry.js";
import { resolveQuestionRender } from "./question-render-registry.js";
import {
  ENV_KEYS,
  NAPCAT_DEFAULTS,
  NapCatAdapter,
  readConfig,
} from "./napcat/adapter.js";

registerChannelAdapter("qq", {
  defaults: NAPCAT_DEFAULTS,
  factory: () => {
    const env = readEnvFile(ENV_KEYS);
    for (const key of ENV_KEYS)
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    const config = readConfig(env);
    return config
      ? new NapCatAdapter(config, resolveQuestionRender, (message) =>
          log.warn(message),
        )
      : null;
  },
});
