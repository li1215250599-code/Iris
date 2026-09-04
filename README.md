# Iris 正畸病历助手

Iris 是依托 E看牙 Chrome 登录环境的本地临床助手。它作为 Chrome 扩展嵌入 E看牙页面，支持正畸复诊的语音/手工要点整理，也支持初诊结构化模板、头侧片截图本地 OCR 与可编辑治疗方案。医生审核后才可填入 E看牙，保存必须由医生手动完成。

Iris 不做诊断或治疗决策；它只整理医生明确提供的信息。完整开发者说明与多 Agent 交接资料见 [`AGENTS.md`](AGENTS.md) 和 [`docs/`](docs/)。

## 当前能力

- 复诊本地规则、术语标准化、可选 AI 整理与 AI 失败回退。
- 保持器复查固定模板，不调用 AI。
- 初诊结构化表单、头侧片截图 OCR、可编辑风险告知与治疗方案。
- E看牙字段填入；普通复诊可从右侧历史病历栏复制诊断和治疗计划。
- 本地服务默认只监听 `127.0.0.1:9323`；密钥只从 Windows 用户环境变量读取。

项目没有 `package.json`、构建步骤、Python requirements 文件或自动化测试套件。

## 启动

1. 双击 `Run-Iris.cmd`。
2. Iris 会先启动本地服务，再复用现有 E看牙登录流程。
3. 首次使用前，请在 E看牙专用 Chrome 中手动安装 `chrome-extension` 扩展；安装后 Chrome 会记住。
4. 登录后，在 E看牙页面右下角点击 Iris 悬浮按钮。
5. 语音或手动输入复诊要点，生成“检查、处置、医嘱”三段式病历。
6. 在病历编辑页点击“填入 E看牙”，审核无误后手动保存。

## 插件安装

1. 用 `Run-Iris.cmd` 或 `Run-EKanYa.cmd` 打开 E看牙专用 Chrome。
2. 在地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `D:\DailyRootine\Iris\chrome-extension`。
6. 回到 E看牙页面并刷新，登录后右下角会出现 Iris 按钮。

## AI 配置

未配置 AI 时，Iris 使用本地模板生成病历。

需要接入 DeepSeek 时，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\DailyRootine\Iris\Set-IrisDeepSeek.ps1
```

需要接入 OpenAI GPT 模型时，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\DailyRootine\Iris\Set-IrisOpenAI.ps1
```

脚本会把 API Key 保存到 Windows 用户环境变量中，不会写入 Chrome 插件。保存后重启 Iris。

也可以手动在系统环境变量中配置：

- `IRIS_AI_API_KEY` 或 `OPENAI_API_KEY`
- `IRIS_AI_MODEL`
- 可选：`IRIS_AI_BASE_URL`
- 可选：`IRIS_AI_PROVIDER`

密钥不要写入项目文件。

Iris 接入的是模型 API 能力，不是把 ChatGPT 或 DeepSeek 网页嵌进插件。插件仍只负责页面交互和填入，模型调用由本机 Iris 服务完成。

DeepSeek 当前按 OpenAI 兼容格式调用，默认地址为 `https://api.deepseek.com`，默认模型为 `deepseek-v4-flash`。

## 术语表

常用口语和书面表达保存在 `terms.json`。例如：

- `1725的不锈钢丝` → `0.017 x 0.025 SS`
- `二类牵引` → `II类牵引`

也可以在 E看牙页面内的 Iris 悬浮窗里打开“术语表”，直接新增映射。Iris 生成病历前会先做术语标准化。

## 安全边界

- Iris 只整理医生输入，不替代诊断。
- 保存前必须由医生审核。
- 自动填入失败或字段不确定时，Iris 会停止并提示手动处理。
- 日志默认不记录完整病历原文。

## 目录关系

- `Iris`：病历书写助手项目。
- `..\EKanYa AutoLogin`：E看牙自动登录工具和专用 Chrome 配置。
- `chrome-extension`：嵌入 E看牙页面的 Iris Chrome 扩展，需要首次手动安装。
