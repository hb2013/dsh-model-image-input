# dsh-model-image-input

DeepSeek Harness (DSH) Web 插件：在「设置 → 模型」页的每个第三方提供方卡片（llm-pi-ai 适配器家族：OpenAI 兼容网关、自建端点等）上，为每个模型增加一个「支持图片」勾选框，声明该模型是否可以接收并识别图片附件。

English | 中文

## 工作方式

- 勾选框展示模型**当前生效**的图片输入能力，取值优先级与 `dsh-llm-pi-ai` 适配器一致：模型条目的 `input` → 内置目录的模态 → 路由 `defaultInput`。
- 勾选：把该模型的 `input` 写为 `["text","image"]`；取消勾选：写为 `["text"]`。
- 写入位置：
  - 提供方配置里有 `models` 列表时，重写该数组中对应条目的 `input`（与官方编辑器同一写入方式）；
  - 目录路由（无 `models` 列表）时，写入 `modelOverrides.<模型id>.input`，即 pi-ai 为「只调整目录中单个模型」提供的标准字段。
- 读写全部通过官方设置服务（`llm-pi-ai` 命名空间，`settings/describe` / `settings/mutate`）完成，带修订版本冲突检测；官方模型编辑器完全不受影响，改动即时生效、无需重启。

## 安装

Web GUI → 插件 → 添加插件 → 选择本目录；或让 Agent 执行
`dsh plugin --profile <profile> add <本目录绝对路径>`。

## 故障排查

勾选只是把「这个模型收图片」写进配置；请求是否被接受最终由服务端的模型与协议入口决定。上传图片后若服务端返回 4xx（如 GLM 的 `1210 messages.content.type 参数非法，取值范围 ['text']`），先确认走的是哪个协议入口：实测（2026-11，GLM Coding 端点）**OpenAI 兼容面**（`/api/coding/paas/v4` 与 `/api/paas/v4`）对旗舰 `glm-5.3` 只接受文本内容，而 **Anthropic 兼容面**（`https://open.bigmodel.cn/api/anthropic`，即 `x-api-key` + `/v1/messages`）对 `glm-5.3` 与 `glm-5.3-flash` 均接受图片。DSH 中把该提供方的 API 协议改为 Anthropic Messages、baseURL 改为 `https://open.bigmodel.cn/api/anthropic` 即可让旗舰识图（zcode 等客户端正是走此入口）。

## 说明与限制

- 「图片输入」面板与官方编辑器写入同一个 `input` 字段。面板的勾选立即保存；若此时官方编辑器里正打开着同一提供方的未保存草稿，编辑器稍后保存时可能提示「设置已被其他地方改动」，关闭重开编辑器即可。
- 该扩展位（`settings.models.provider-card`，键 `llm-pi-ai`）同一键位只容纳一个插件；若安装了另一个占用同一键位的插件（如其它模型能力面板），先启用者生效，本面板会被替换。
- 界面文案内置中文与英文，其余语言回退到英文。
- 官方 DeepSeek 提供方（第一方）不在此面板范围内，其输入类型由官方编辑器自带控件管理。

MIT License.
