# NapCat 自动部署

用户已确认：新用户默认通过 Docker 安装 NapCat，已有部署可以复用。保留微信渠道。

新增 `npm run setup -- --target <NanoClaw>`，串联渠道安装、宿主依赖和构建、NapCat Compose 部署。低层 `channel.mjs` 保持源码安装职责，避免破坏已有脚本。

Docker 方案使用上游镜像，首次拉取后固定实际 digest；持久保存 QQ 登录状态、配置和插件。WebUI 仅绑定本机，自动生成独立 WebUI 和 OneBot Token，Token 不输出到终端或 Git。Linux 使用 host 网络让 NapCat 连接宿主回环监听，其他系统明确拒绝自动部署并提示使用已有 NapCat。

首次无机器人 QQ 号时启动登录界面，渠道保持禁用。用户扫码后再次运行 setup，提供机器人号、聊天用户号及要绑定的 agent，配置精确账号、最小成员权限、私聊 wiring；仅显式指定服务才重启。已有部署使用 `--external-napcat`，配置由用户已有服务提供。

重复执行复用密钥和数据，不重置账号。安装失败保留可诊断状态，禁止覆盖非本工具创建的 Compose 文件；移除渠道不删除 QQ 数据。自动流程不处理扫码或登录验证。

替代方案：原生 Shell 安装需要额外管理 QQ 系统依赖；默认依赖用户手装不能满足完整安装目标。因此本次选 Docker。
