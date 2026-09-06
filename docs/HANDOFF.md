# 当前交接

最后更新：2026-09-04（Hermes Agent，GitHub 状态核查）

## 当前项目状态

- Iris 可由 `Start-Iris.ps1` 启动；本地服务默认 `127.0.0.1:9323`。
- Chrome 扩展以解压方式加载，匹配 `https://myourhis.myourchina.cn/*`。
- 当前项目根目录是 `D:\DailyRootine\Iris`；**已纳入 Git，远端为 private 仓库 `li1215250599-code/Iris`**。首个提交 `3903c52`（main）已推送，本地与远端同步。
- 初诊和复诊功能都在 `chrome-extension/content.js`；复诊服务在 `iris_server.py`。
- E看牙自动登录在相邻目录，不纳入 Iris Git 仓库。

## Git 与认证（换 Agent / 换机器时先读）

- 仓库必须保持 **private**，不得改 public（涉及临床文书工具）。
- 本机（Windows 用户 1215）由 Git Credential Manager 托管 GitHub 凭据，账号 `li1215250599-code`；同一机器上的新 Agent 可直接 clone/push，无需重新认证。
- 换机器时：需用账号 `li1215250599-code` 完成一次 GitHub 登录（gh auth login 或 GCM），或把新账号加为仓库 collaborator。
- 提交身份已在仓库内配置（`li1215250599-code` / noreply 邮箱），无需全局配置。
- 已提交内容仅含源码与文档；`logs/`、`__pycache__/`、Chrome profile、`.env` 等一律不入库。

## 最近完成的工作

- 2026-09-06（Hermes）：填入 E看牙 成功后立即收起悬浮窗（D-011）——只移除 `.open` 类、不重置草稿；医生随时可点 Iris 悬浮钮回看/编辑/再次填入。填入失败或抛错时不收起。详见 CHANGELOG 与 DECISIONS D-011。
- 2026-09-04（Hermes）：建立多 Agent 协作文档和 Git 忽略规则；未改业务代码。
- 2026-09-04（Hermes）：核查 GitHub 远端状态并同步本文件与 CHANGELOG；未改业务代码。
- 2026-09-04（Hermes）：头侧片识别改用 DeepSeek 视觉模型并移除 Windows OCR 回退（D-010）。
- 2026-07-30（已知上下文）：ANB/Wits 的 OCR 补偿已添加并以一张截图验证；医生仍需核对值。

## 当前正在进行的工作

无。当前阶段明确结束于审计与文档化，等待用户决定后续开发任务。

## 当前已知问题

- 无自动化测试。
- E看牙字段/历史栏定位对网页 DOM 和加载状态敏感。
- OCR 对符号与小数不可靠，补偿覆盖有限布局。
- 服务端保留 `confirm-save`，但扩展 UI 未调用；不要接入。

## 下一步建议

GitHub 部分已完成（private 仓库 + 首次提交已推送 + 认证说明见上）。最合理的第一个开发任务是建立少量脱敏规则/OCR 回归样例和一键验证脚本：降低后续多个 Agent 修改临床规则或 OCR 时引入回归的风险，但不改变已有业务行为。之后可随时回到"按病历截图逐条加规则"的日常迭代。

## 修改时特别注意

- 不要自动保存，不要将密钥写进扩展。
- 修改复诊规则前先阅读 `local_generate` 及其辅助函数，并用同类代表句验证。
- 修改 E看牙填入或历史复制前，必须在真实病历编辑页测试；失败时应保留手动复制路径。
- 修改初诊字段时检查：表单显示、输出、重置、预览、填入和样式。
- Chrome 页面刷新才加载新的 `content.js`；服务端改动后要重启 Iris。
