import type { InboundMessage, OutboundFile } from "../adapter.js";
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export interface Segment {
  type: string;
  data: Record<string, any>;
}
export const validId = (value: unknown): boolean =>
  (typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))) ||
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
const messageId = (v: unknown): boolean =>
  (typeof v === "string" &&
    /^-?\d+$/.test(v) &&
    Number.isSafeInteger(Number(v))) ||
  (typeof v === "number" && Number.isSafeInteger(v));
export function segments(value: unknown): Segment[] {
  if (typeof value === "string")
    return [{ type: "text", data: { text: value } }];
  return Array.isArray(value)
    ? value.filter(
        (s): s is Segment =>
          s &&
          typeof s.type === "string" &&
          s.data &&
          typeof s.data === "object",
      )
    : [];
}
export function textOf(parts: Segment[]): string {
  return parts
    .map((s) =>
      s.type === "text"
        ? String(s.data.text ?? "")
        : s.type === "at"
          ? `@${s.data.qq} `
          : s.type === "image"
            ? "[图片]"
            : "",
    )
    .join("");
}
export function imageType(
  data: Buffer,
): { mimeType: string; extension: string } | undefined {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mimeType: "image/png", extension: "png" };
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return { mimeType: "image/jpeg", extension: "jpg" };
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString()))
    return { mimeType: "image/gif", extension: "gif" };
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return { mimeType: "image/webp", extension: "webp" };
  return undefined;
}
export class ImageLoader {
  private controllers = new Set<AbortController>();
  private closed = false;
  constructor(private options: { timeoutMs?: number } = {}) {}
  async load(
    source: string,
  ): Promise<{
    data: string;
    mimeType: string;
    size: number;
    extension: string;
  }> {
    if (this.closed) throw new Error("Image loader closed");
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 15_000,
    );
    try {
      let url = new URL(source),
        response: Response | undefined;
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error("Unsupported image URL");
        response = await fetch(url, {
          signal: controller.signal,
          redirect: "manual",
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const next = response.headers.get("location");
          if (!next || redirects === 4)
            throw new Error("Invalid image redirect");
          url = new URL(next, url);
          continue;
        }
        break;
      }
      if (!response?.ok || !response.body) {
        await response?.body?.cancel();
        throw new Error("Image download failed");
      }
      if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
        await response.body.cancel();
        throw new Error("Image exceeds 20 MiB");
      }
      const reader = response.body.getReader(),
        chunks: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 20 MiB");
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks),
        type = imageType(bytes);
      if (!type) throw new Error("Unsupported image format");
      return { ...type, size, data: bytes.toString("base64") };
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  close(): void {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
}
export async function convertInbound(
  event: Record<string, any>,
  images: ImageLoader,
  getMessage: (id: string) => Promise<any>,
): Promise<{
  platformId: string;
  name: string;
  message: InboundMessage;
} | null> {
  if (
    event.post_type !== "message" ||
    !["private", "group"].includes(event.message_type) ||
    !validId(event.user_id) ||
    String(event.user_id) === String(event.self_id) ||
    !messageId(event.message_id)
  )
    return null;
  const isGroup = event.message_type === "group";
  if (isGroup && !validId(event.group_id)) return null;
  const platformId = `${isGroup ? "group" : "private"}:${isGroup ? event.group_id : event.user_id}`;
  const parts = segments(event.message);
  const sender = String(
    event.sender?.card || event.sender?.nickname || event.user_id,
  );
  const attachments: Record<string, unknown>[] = [];
  const text: string[] = [];
  for (const part of parts) {
    if (part.type === "text") text.push(String(part.data.text ?? ""));
    else if (part.type === "at") text.push(`@${part.data.qq} `);
    else if (part.type === "image") {
      try {
        const image = await images.load(String(part.data.url ?? ""));
        const { extension, ...attachment } = image;
        attachments.push({
          type: "image",
          name: `qq-${event.message_id}-${attachments.length}.${extension}`,
          ...attachment,
        });
      } catch {
        text.push("[图片不可用]");
      }
    }
  }
  let replyTo: Record<string, unknown> | undefined;
  const reply = parts.find((s) => s.type === "reply" && messageId(s.data.id));
  if (reply) {
    replyTo = { id: String(reply.data.id) };
    try {
      const original = await getMessage(String(reply.data.id));
      if (original) {
        replyTo.sender = String(
          original.sender?.card ||
            original.sender?.nickname ||
            original.sender?.user_id ||
            "",
        );
        replyTo.text = textOf(segments(original.message));
      }
    } catch {
      /* Keep the ID when NapCat no longer has the message. */
    }
  }
  const seconds = Number(event.time),
    time = Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
  return {
    platformId,
    name: isGroup ? `QQ群 ${event.group_id}` : sender,
    message: {
      id: String(event.message_id),
      kind: "chat",
      timestamp: Number.isNaN(time.getTime())
        ? new Date().toISOString()
        : time.toISOString(),
      isGroup,
      isMention:
        !isGroup ||
        parts.some(
          (s) => s.type === "at" && String(s.data.qq) === String(event.self_id),
        ),
      content: {
        senderId: `qq:${event.user_id}`,
        sender,
        senderName: sender,
        text: text.join(""),
        attachments,
        ...(replyTo ? { replyTo } : {}),
      },
    },
  };
}
export function outboundSegments(
  content: Record<string, any> | string,
  files: OutboundFile[] = [],
): Segment[] {
  const c = typeof content === "string" ? { text: content } : content;
  const result: Segment[] = [];
  if (c.replyTo?.id !== undefined) {
    if (!messageId(c.replyTo.id)) throw new Error("Invalid reply ID");
    result.push({ type: "reply", data: { id: String(c.replyTo.id) } });
  }
  const text = c.text ?? c.markdown ?? c.fallbackText ?? "";
  if (typeof text !== "string")
    throw new Error("Outbound text must be a string");
  if (text) result.push({ type: "text", data: { text } });
  for (const file of files) {
    if (file.data.length > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds 20 MiB");
    if (!imageType(file.data))
      throw new Error("Only PNG, JPEG, GIF and WebP image files are supported");
    result.push({
      type: "image",
      data: { file: `base64://${file.data.toString("base64")}` },
    });
  }
  if (!result.length) throw new Error("Empty or unsupported QQ message");
  return result;
}
