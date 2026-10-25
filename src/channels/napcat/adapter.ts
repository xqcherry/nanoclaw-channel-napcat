import type {
  ChannelAdapter,
  ChannelDefaults,
  ChannelSetup,
  OutboundMessage,
} from "../adapter.js";
import { ReverseConnection, type ConnectionConfig } from "./connection.js";
import {
  convertInbound,
  ImageLoader,
  outboundSegments,
  segments,
  validId,
} from "./messages.js";

export const ENV_KEYS = [
  "NAPCAT_ENABLED",
  "NAPCAT_HOST",
  "NAPCAT_PORT",
  "NAPCAT_PATH",
  "NAPCAT_ACCESS_TOKEN",
  "NAPCAT_SELF_ID",
];
export const NAPCAT_DEFAULTS: ChannelDefaults = {
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
};
export function readConfig(
  env: Record<string, string | undefined>,
): ConnectionConfig | null {
  if (env.NAPCAT_ENABLED !== "true") return null;
  const token = env.NAPCAT_ACCESS_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token))
    throw new Error(
      "NAPCAT_ACCESS_TOKEN is required and must be a single line",
    );
  const selfId = env.NAPCAT_SELF_ID?.trim();
  if (!validId(selfId))
    throw new Error("NAPCAT_SELF_ID must be a positive QQ ID");
  const port = Number(env.NAPCAT_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("NAPCAT_PORT must be 1..65535");
  const path = env.NAPCAT_PATH ?? "/onebot/v11/ws";
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(path))
    throw new Error("NAPCAT_PATH must be an absolute URL path");
  const host = env.NAPCAT_HOST ?? "127.0.0.1";
  if (!host.trim()) throw new Error("NAPCAT_HOST is required");
  return { host, port, path, token, selfId: selfId! };
}
export interface Question {
  title: string;
  question?: string;
  options: { label: string; value: string }[];
  renderMessage?: unknown;
}
export type ResolveQuestion = (id: string) => Promise<Question | undefined>;

export class NapCatAdapter implements ChannelAdapter {
  readonly name = "NapCat QQ";
  readonly channelType = "qq";
  readonly instance = "qq";
  readonly supportsThreads = false;
  readonly defaults = NAPCAT_DEFAULTS;
  readonly connection: ReverseConnection;
  private setupConfig?: ChannelSetup;
  private images = new ImageLoader();
  private stopped = true;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private seen = new Map<string, number>();
  constructor(
    config: ConnectionConfig,
    private resolveQuestion: ResolveQuestion,
    private report: (message: string) => void = () => {},
  ) {
    this.connection = new ReverseConnection(config);
    this.connection.onEvent = (event) => this.enqueue(event);
    this.connection.onError = () => this.report("NapCat listener error");
  }
  async setup(config: ChannelSetup): Promise<void> {
    if (!this.stopped) throw new Error("NapCat already initialized");
    this.setupConfig = config;
    this.stopped = false;
    this.images = new ImageLoader();
    try {
      await this.connection.listen();
    } catch (error) {
      this.stopped = true;
      throw error;
    }
  }
  isConnected(): boolean {
    return !this.stopped && this.connection.connected;
  }
  async openDM(handle: string): Promise<string> {
    const id = handle.startsWith("qq:") ? handle.slice(3) : handle;
    if (!validId(id)) throw new Error("Invalid QQ user ID");
    return `private:${id}`;
  }
  private enqueue(event: Record<string, any>): void {
    if (
      this.stopped ||
      event.post_type !== "message" ||
      String(event.user_id) === this.connection.config.selfId
    )
      return;
    const key = `${event.message_type}:${event.group_id ?? event.user_id}:${event.message_id}`;
    const now = Date.now();
    for (const [id, at] of this.seen) {
      if (now - at > 300_000) this.seen.delete(id);
      else break;
    }
    if (this.seen.has(key)) return;
    if (this.queued >= 128) {
      this.report("NapCat inbound queue full; event dropped");
      return;
    }
    this.seen.set(key, now);
    if (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value!);
    this.queued++;
    this.queue = this.queue
      .then(async () => {
        if (this.stopped) return;
        const config = this.setupConfig!;
        const parts = segments(event.message);
        const commandText = parts
          .filter((s) => s.type === "text")
          .map((s) => String(s.data.text ?? ""))
          .join("")
          .trim();
        const command = /^\/nc-answer\s+(\S+)\s+([1-9]\d*)$/.exec(commandText);
        if (
          command &&
          validId(event.user_id) &&
          (event.message_type === "private" ||
            (event.message_type === "group" && validId(event.group_id)))
        ) {
          const render = await this.resolveQuestion(command[1]);
          const option = render?.options[Number(command[2]) - 1];
          if (option && !this.stopped)
            config.onAction(command[1], option.value, `qq:${event.user_id}`, {
              instance: this.instance,
              platformId: `${event.message_type === "group" ? "group" : "private"}:${event.message_type === "group" ? event.group_id : event.user_id}`,
              threadId: null,
            });
          return;
        }
        if (commandText.startsWith("/nc-answer")) return;
        const result = await convertInbound(event, this.images, (id) =>
          this.connection.call("get_msg", { message_id: Number(id) }),
        );
        if (!result || this.stopped) return;
        config.onMetadata(
          result.platformId,
          result.name,
          result.message.isGroup,
        );
        await config.onInbound(result.platformId, null, result.message);
      })
      .catch(() => {
        this.seen.delete(key);
        this.report("NapCat inbound processing failed");
      })
      .finally(() => {
        this.queued--;
      });
  }
  async deliver(
    platformId: string,
    _threadId: string | null,
    message: OutboundMessage,
  ): Promise<string | undefined> {
    const address = /^(private|group):([1-9]\d*)$/.exec(platformId);
    if (!address || !validId(address[2]))
      throw new Error("Invalid QQ conversation address");
    let content = message.content as Record<string, any> | string;
    if (
      !content ||
      (typeof content !== "object" && typeof content !== "string")
    )
      throw new Error("Invalid QQ message content");
    if (typeof content === "object") {
      if (content.operation === "edit") {
        // OneBot has no text-edit API. Publish the terminal state as a new message.
        const terminal = content.terminalCard;
        content = {
          text: terminal
            ? `${terminal.title ?? ""}\n${terminal.question ?? ""}\n${terminal.resolution ?? ""}`
            : (content.text ?? content.markdown ?? ""),
        };
      } else if (content.operation)
        throw new Error("Unsupported QQ message operation");
      else if (content.type === "ask_question") {
        if (
          typeof content.questionId !== "string" ||
          !/^\S+$/.test(content.questionId)
        )
          throw new Error("Invalid QQ question ID");
        if (content.requirePresentation)
          throw new Error("QQ does not support custom approval presentations");
        const options = content.options;
        if (!Array.isArray(options) || !options.length)
          throw new Error("Question options are required");
        const text = [
          content.title ?? "",
          content.question ?? "",
          ...options.map(
            (o: any, i: number) =>
              `${i + 1}. ${typeof o === "string" ? o : o.label}`,
          ),
          `回复 /nc-answer ${content.questionId} <选项序号>（例如 /nc-answer ${content.questionId} 1）`,
        ].join("\n");
        content = { text };
      } else if (content.type === "card") {
        content = {
          text:
            content.fallbackText ??
            [content.card?.title, content.card?.description]
              .filter(Boolean)
              .join("\n"),
        };
      }
    }
    const parts = outboundSegments(content, message.files);
    const data = await this.connection.call(
      address[1] === "group" ? "send_group_msg" : "send_private_msg",
      {
        [address[1] === "group" ? "group_id" : "user_id"]: Number(address[2]),
        message: parts,
        auto_escape: true,
      },
    );
    return data?.message_id !== undefined ? String(data.message_id) : undefined;
  }
  async teardown(): Promise<void> {
    this.stopped = true;
    this.images.close();
    await this.connection.close();
    await this.queue;
    this.seen.clear();
    this.setupConfig = undefined;
  }
}
