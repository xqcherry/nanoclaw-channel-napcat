# NanoClaw NapCat QQ 渠道

[English](README.md) | **简体中文**

[![npm CI](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Public beta](https://img.shields.io/badge/status-public%20beta-orange)
[![GitHub stars](https://img.shields.io/github/stars/xqcherry/nanoclaw-channel-napcat?style=flat)](https://github.com/xqcherry/nanoclaw-channel-napcat/stargazers)
![npm downloads](https://img.shields.io/badge/npm%20downloads-not%20published-lightgrey)

通过 NapCat 为 NanoClaw v2 接入 QQ，支持私聊、群聊 @、文字、图片、引用及文字选项回复。提供 NapCat Docker 自动安装，可与微信渠道同时使用。

## 快速开始

需要已可用的 NanoClaw v2、Node.js 22+、宿主使用的包管理器，以及 Linux Docker Compose。目前使用源码安装，尚未发布 npm 包。

```bash
git clone https://github.com/xqcherry/nanoclaw-channel-napcat.git
cd nanoclaw-channel-napcat
npm ci --ignore-scripts
npm run setup -- --target /absolute/path/to/nanoclaw
```

打开 **http://127.0.0.1:6099/webui/**，使用机器人 QQ 扫码登录。WebUI Token 位于 NanoClaw 目录的 `data/napcat/config/webui.json`，字段名为 `token`。连接配置由安装器自动生成。

随后将个人 QQ 绑定到 agent：

```bash
npm run setup -- --target /absolute/path/to/nanoclaw \
  --self-id 123456789 --user-qq 11223344 --agent my-agent \
  --service nanoclaw-example.service
```

将示例值替换为实际信息：

- `--self-id`：机器人 QQ 号。
- `--user-qq`：你的个人 QQ 号，授予普通成员访问权限。
- `--agent`：`ncl groups list` 中的 folder 或 ID。
- `--service`：NanoClaw 的 systemd 用户服务名；省略则手动重启。

完成后私聊机器人即可使用。群聊需要另行绑定，并真正 @ 机器人。当前支持单账号，暂不支持语音、文件及群管理。

## 配置

登录状态和配置保存在宿主的 `data/napcat/`。WebUI 仅限本机访问；远程服务器可使用 `ssh -L 6099:127.0.0.1:6099 user@server` 转发。

已有 NapCat 时增加 `--external-napcat`，并按 [配置示例](config.example.env) 填写宿主环境变量。NapCat 反向 WebSocket 地址使用 `ws://127.0.0.1:3002/onebot/v11/ws`，Token 与宿主一致，消息格式为 `array`；按实际网络调整地址。

卸载请参考 [卸载说明](skills/add-napcat/REMOVE.md)。

## 致谢

感谢 [NanoClaw](https://github.com/nanocoai/nanoclaw)、[NapCatQQ](https://github.com/NapNeko/NapCatQQ)、[NapCat-Docker](https://github.com/NapNeko/NapCat-Docker) 和 [OneBot 11](https://github.com/botuniverse/onebot-11) 的维护者与贡献者。NapCat 使用说明见 [官方文档](https://napneko.github.io/)。

## 许可证

本项目采用 [MIT License](LICENSE)。上游组件保留各自许可证和使用条款。
