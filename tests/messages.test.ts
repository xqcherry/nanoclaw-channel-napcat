import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  convertInbound,
  ImageLoader,
  outboundSegments,
  MAX_IMAGE_BYTES,
} from "../src/channels/napcat/messages.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const event = (extra = {}) => ({
  post_type: "message",
  message_type: "private",
  self_id: 123,
  user_id: 456,
  message_id: 8,
  time: 1700000000,
  sender: { nickname: "Alice" },
  message: [{ type: "text", data: { text: "hello [CQ:at,qq=123]" } }],
  ...extra,
});

test("maps private/group identity, exact platform mention, replies and literal CQ text", async () => {
  const images = new ImageLoader();
  const dm = await convertInbound(event(), images, async () => {
    throw Error("missing");
  });
  assert.equal(dm?.platformId, "private:456");
  assert.equal(dm?.message.isMention, true);
  assert.equal((dm?.message.content as any).senderId, "qq:456");
  assert.equal((dm?.message.content as any).text, "hello [CQ:at,qq=123]");
  const group = await convertInbound(
    event({
      message_type: "group",
      group_id: 789,
      message: [
        { type: "at", data: { qq: "all" } },
        { type: "text", data: { text: "@123" } },
        { type: "reply", data: { id: 3 } },
      ],
    }),
    images,
    async () => {
      throw Error("missing");
    },
  );
  assert.equal(group?.platformId, "group:789");
  assert.equal(group?.message.isMention, false);
  assert.deepEqual((group?.message.content as any).replyTo, { id: "3" });
  const reply = await convertInbound(
    event({
      message_type: "group",
      group_id: 789,
      message: [
        { type: "at", data: { qq: "123" } },
        { type: "reply", data: { id: "4" } },
      ],
    }),
    images,
    async () => ({
      sender: { nickname: "Bob" },
      message: [{ type: "text", data: { text: "quoted" } }],
    }),
  );
  assert.equal(reply?.message.isMention, true);
  assert.deepEqual((reply?.message.content as any).replyTo, {
    id: "4",
    sender: "Bob",
    text: "quoted",
  });
  assert.equal(
    await convertInbound(event({ user_id: 123 }), images, async () => null),
    null,
  );
});
test("downloads image to Base64 and keeps text for unavailable, oversized or non-image responses", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/big") {
      res.writeHead(200, { "content-length": String(MAX_IMAGE_BYTES + 1) });
      res.end();
    } else if (req.url === "/invalid") {
      res.end("not an image");
    } else if (req.url === "/slow") {
      return;
    } else {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const images = new ImageLoader({ timeoutMs: 2000 });
  const result = await convertInbound(
    event({
      message: [
        { type: "text", data: { text: "caption" } },
        { type: "image", data: { url: base + "/ok" } },
      ],
    }),
    images,
    async () => null,
  );
  const content = result?.message.content as any;
  assert.equal(content.attachments[0].data, png.toString("base64"));
  assert.equal(content.attachments[0].mimeType, "image/png");
  for (const url of ["/big", "/invalid", "/slow"]) {
    const r = await convertInbound(
      event({
        message: [
          { type: "text", data: { text: "caption" } },
          { type: "image", data: { url: base + url } },
        ],
      }),
      url === "/slow" ? new ImageLoader({ timeoutMs: 40 }) : images,
      async () => null,
    );
    assert.match((r?.message.content as any).text, /caption.*图片不可用/s);
  }
  await assert.rejects(images.load("file:///etc/passwd"));
  const pending = assert.rejects(images.load(base + "/slow"));
  images.close();
  await pending;
});
test("outbound uses structured plain text, reply and Base64 images; rejects unsupported files", () => {
  const segments = outboundSegments(
    { text: "[CQ:at,qq=all]", replyTo: { id: "3" } },
    [{ filename: "tiny.png", data: png }],
  );
  assert.deepEqual(segments, [
    { type: "reply", data: { id: "3" } },
    { type: "text", data: { text: "[CQ:at,qq=all]" } },
    { type: "image", data: { file: "base64://" + png.toString("base64") } },
  ]);
  assert.throws(
    () =>
      outboundSegments({ text: "x" }, [
        { filename: "large.png", data: Buffer.alloc(MAX_IMAGE_BYTES + 1) },
      ]),
    /20 MiB/,
  );
  assert.throws(
    () =>
      outboundSegments({ text: "x" }, [
        { filename: "a.txt", data: Buffer.from("text") },
      ]),
    /image/,
  );
});
