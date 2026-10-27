# 移除 NapCat QQ 渠道

1. 停止该 NanoClaw 宿主，使监听器关闭。
2. 在保留的独立源码包根目录执行 `node scripts/channel.mjs uninstall --target "$NANOCLAW_TARGET" --dry-run`，处理报告的用户文件冲突，再去掉 `--dry-run` 执行。
3. 卸载器移除全部拥有的源码、注册测试、技能文档、配置示例、状态文件及 barrel import；移除由本渠道引入且没有其他源码使用的 ws 和 @types/ws，更新目标锁文件。原有依赖和仍被其他模块使用的依赖会保留。
4. 在目标 `.env` 手动删除 NAPCAT_ENABLED、NAPCAT_HOST、NAPCAT_PORT、NAPCAT_PATH、NAPCAT_ACCESS_TOKEN、NAPCAT_SELF_ID 六项；关闭 NapCat 对应 WebSocket 客户端。低层 channel 安装器不填写配置；setup 完整安装命令会写入配置，卸载器不读取或输出 Token。
5. 通过 `ncl wirings list`、`ncl messaging-groups list` 找到 qq 绑定，按需使用各资源 `delete` 删除绑定及会话地址；保留需要的历史记录和 agent 数据。先查看目标 `ncl <资源> help` 确定参数。
6. 目标执行 `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm run build`，确认原有渠道继续注册，再由用户选择启动服务。
## 自动部署的 NapCat

若使用 `npm run setup` 创建过 Docker 部署，先运行 `docker compose -f <NanoClaw绝对路径>/data/napcat/compose.yaml down` 停止对应容器。该操作保留 QQ 登录、配置与插件；渠道卸载也不会删除这些数据。只有用户明确要求清除账号数据时才删除目标 `data/napcat/`。
