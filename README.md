# NanoClaw NapCat QQ Channel

**English** | [简体中文](README.zh-CN.md)

[![npm CI](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Public beta](https://img.shields.io/badge/status-public%20beta-orange)
[![GitHub stars](https://img.shields.io/github/stars/xqcherry/nanoclaw-channel-napcat?style=flat)](https://github.com/xqcherry/nanoclaw-channel-napcat/stargazers)
![npm downloads](https://img.shields.io/badge/npm%20downloads-not%20published-lightgrey)

Connect QQ to NanoClaw v2 through NapCat. Supports private chats, group mentions, text, images, quoted replies, and text option responses. Includes automatic NapCat Docker setup and works alongside WeChat.

## Quick start

Requires a working NanoClaw v2 installation, Node.js 22+, the host's package manager, and Linux with Docker Compose. Distributed as source; not yet published to npm.

```bash
git clone https://github.com/xqcherry/nanoclaw-channel-napcat.git
cd nanoclaw-channel-napcat
npm ci --ignore-scripts
npm run setup -- --target /absolute/path/to/nanoclaw
```

Open **http://127.0.0.1:6099/webui/** and scan the QR code with the bot's QQ account. The WebUI token is in the NanoClaw host's `data/napcat/config/webui.json` (`token` field). Connection settings are generated automatically.

Then bind your personal QQ to an agent:

```bash
npm run setup -- --target /absolute/path/to/nanoclaw \
  --self-id 123456789 --user-qq 11223344 --agent my-agent \
  --service nanoclaw-example.service
```

Replace the example values:

- `--self-id`: bot QQ number.
- `--user-qq`: your personal QQ number, granted ordinary member access.
- `--agent`: folder or ID from `ncl groups list`.
- `--service`: NanoClaw systemd user service; omit to restart manually.

Send a private message to the bot to start chatting. Group chats require a group binding and a real @mention of the bot. One bot account is supported; voice, files, and group management are not supported.

## Configuration

Login data and configuration persist in the host's `data/napcat/`. WebUI access is local; for a remote server use `ssh -L 6099:127.0.0.1:6099 user@server`.

For an existing NapCat, add `--external-napcat` and set the host variables from [config.example.env](config.example.env). Configure its reverse WebSocket URL as `ws://127.0.0.1:3002/onebot/v11/ws`, with the matching token and `array` messages; adjust the address for your network.

For removal, see [the uninstall guide](skills/add-napcat/REMOVE.md).

## Acknowledgements

Built with [NanoClaw](https://github.com/nanocoai/nanoclaw), [NapCatQQ](https://github.com/NapNeko/NapCatQQ), [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker), and [OneBot 11](https://github.com/botuniverse/onebot-11). Thanks to their maintainers and contributors. [NapCat documentation](https://napneko.github.io/).

## License

[MIT](LICENSE). Upstream components retain their own licenses and terms.
