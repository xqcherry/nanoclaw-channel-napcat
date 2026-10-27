# NapCat Bootstrap Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 一条命令完成渠道及 NapCat 部署，并提供登录后绑定步骤。

**Architecture:** 新增独立 setup CLI 和部署模块，调用现有渠道安装器。Compose 数据独立持久化，运行配置只保存在目标忽略目录。

**Tech Stack:** Node.js 22+、Docker Compose、现有 TypeScript 测试工具。

**Spec:** docs/superpowers/specs/2026-10-27-napcat-bootstrap-design.md

## Global Constraints

- 保留微信及用户其他改动；不自动删除账号数据。
- Token 不写聊天、终端输出或 Git；WebUI 仅回环地址。
- 仅 Linux 自动部署；已部署可选择 external 模式。
- 复用现有 feature 分支原地实施；用户已授权本机安装。

## Review Focus

- 重复安装不更换密钥、不覆盖手工更改。
- 路径空格和符号链接不得导致覆盖无关文件。
- 失败后保持渠道禁用，不能错误声称在线。
- 缺少账号时可先启动 WebUI。
- 绑定不能意外授予 owner/admin 或修改微信。

### Task 1: 部署配置和安全写入

**Files:** scripts/napcat-deploy.mjs; tests/deploy.test.ts

**Interfaces:** prepareDeployment({target, selfId?, image?}) 返回部署目录；writeHostConfig(target, values) 保留其他环境变量。

- [x] 先写失败测试：重复执行密钥一致；网络配置正确；缺失账号禁用；冲突及符号链接拒绝。
- [x] 运行新测试确认失败。
- [x] 实现密钥、Compose、OneBot 和宿主配置的写入与所有权保护。
- [x] 运行新测试及全套测试。

### Task 2: 一条命令与绑定

**Files:** scripts/setup.mjs; package.json; README.md; skills/add-napcat/SKILL.md; skills/add-napcat/REMOVE.md

**Interfaces:** setup --target PATH [--self-id QQ --user-qq QQ --agent FOLDER --service UNIT] [--external-napcat] [--dry-run]

- [x] 增加参数及 dry-run 测试，确认失败。
- [x] 串联渠道安装、冻结依赖安装、构建、Compose 启动，账号齐全才启用；通过 ncl 幂等绑定。
- [x] 更新首次安装及卸载文档。
- [x] 全套测试、构建、宿主注册检查。

### Task 3: 本机部署

- [x] 使用真实 NanoClaw 运行 setup。
- [x] 确认容器、WebUI 回环响应、渠道禁用状态及微信服务状态。
- [x] 记录镜像 digest、验证结果和待扫码步骤。

## Execution ledger

原项目工作区干净，当前为 feat/napcat-channel；保留原地执行以交付到用户当前目录，不切换 NanoClaw 主分支或修改其无关文件。

实施结果（2026-10-27）：

- 新增 setup CLI、可恢复部署状态、端口归属检查和 WebUI 鉴权就绪检查；失败前不改写宿主 .env。
- 新增 7 项部署回归测试；全套 31 项测试通过，TypeScript 检查通过。
- 独立审查提出 3 项 Important（端口误判、中断恢复、提前改 .env），均已补充失败用例并修复。
- 本机真实宿主 setup 连续执行两次成功，第二次渠道 0 文件变更、容器保持 Running；宿主注册测试通过。
- 微信服务 MainPID 仍为 3228448，没有重启服务。QQ 当前保持禁用，等待用户扫码并提供 QQ 身份。
- 镜像固定为 mlikiowa/napcat-docker@sha256:b101b8968cc31ae428ec0f8e117386e4ced7773b2d8226ed9f7ddfcec55f1b7e。
- 英文 README 为默认入口，新增中文版、MIT License、npm CI 工作流和真实状态徽章；尚未发布 npm，未声称远程 CI 已通过。
