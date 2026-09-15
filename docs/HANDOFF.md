# 当前交接

最后更新：2026-09-15（Z Code，Phase 02 修复轮推送后状态对齐）

## 当前项目状态

- Iris 可由 `Start-Iris.ps1` 启动；本地服务默认 `127.0.0.1:9323`。
- Chrome 扩展以解压方式加载，匹配 `https://myourhis.myourchina.cn/*`。
- 当前项目根目录是 `D:\DailyRootine\Iris`；**已纳入 Git，远端为 private 仓库 `li1215250599-code/Iris`**。
- **Phase 02（GLM 双草稿）**：分支 `feature/glm-dual-draft`，HEAD `cadc4a4` 已推送。VM 审阅（20260910-1255）的 4 项阻塞已在 `4cc7ec1` 修复（字段路由本地判定、保持器信号、默认模型 `glm-5.3-flash`、回归纳入统一验证）；`cadc4a4` 为面板性能与输入诊断（填入扫描节流、指针捕获加固、输入事件黑匣子）。**Draft PR #1 保持 draft，等待 VM 复审与用户合并授权，不得合并 main。**
- 统一验证入口 `verify.py`：语法 + JSON + JS + 服务回归（19）+ 双草稿回归（17）；GitHub Actions 在 PR 上直接运行它，失败阻止合并（已在新 HEAD 实跑通过）。
- 共享库交接材料：`D:\Nutstore\ObsidianVault\Projects\IRIS\phase-02-glm-dual-draft\`（最新交接单 `handoffs/to-vm/phase-02-handoff-20260914-1837.md`，含推送与 CI 结果）。
- 初诊和复诊功能都在 `chrome-extension/content.js`；复诊服务在 `iris_server.py`。
- E看牙自动登录在相邻目录，不纳入 Iris Git 仓库。

## Git 与认证（换 Agent / 换机器时先读）

- 仓库必须保持 **private**，不得改 public（涉及临床文书工具）。
- 本机（Windows 用户 1215）由 Git Credential Manager 托管 GitHub 凭据，账号 `li1215250599-code`；同一机器上的新 Agent 可直接 clone/push，无需重新认证。
- 换机器时：需用账号 `li1215250599-code` 完成一次 GitHub 登录（gh auth login 或 GCM），或把新账号加为仓库 collaborator。
- 提交身份已在仓库内配置（`li1215250599-code` / noreply 邮箱），无需全局配置。
- 已提交内容仅含源码与文档；`logs/`、`__pycache__/`、Chrome profile、`.env` 等一律不入库。

## 最近完成的工作

- 2026-09-15（Z Code）：用户授权后推送修复轮（`4cc7ec1` + `cadc4a4`），远端 `git ls-remote` 复核一致，CI verify job 在 GitHub runner 实跑 `verify.py` 全绿；用户实测通过（含重新加载扩展后的真实页面测试）。
- 2026-09-13/14（Z Code）：修复 VM 审阅 4 项阻塞 + E看牙 输入卡死四轮排查（现场取证指向 Chrome 145 分屏视图 + E看牙 modal-entry 弹页组合，非 Iris 缺陷；黑匣子 `logs/ext-input-events.log` 待复发取证，仅事件类型/时间戳，无文本内容）。
- 2026-09-10（Hermes）：GLM 双草稿三段提交（feat/test/docs）并创建 Draft PR #1；VM 审阅返回 changes_requested。
- 2026-09-06（Hermes）：填入 E看牙 成功后立即收起悬浮窗（D-011）——只移除 `.open` 类、不重置草稿。详见 CHANGELOG 与 DECISIONS D-011。
- 2026-09-04（Hermes）：建立多 Agent 协作文档和 Git 忽略规则；头侧片识别改用 DeepSeek 视觉模型并移除 Windows OCR 回退（D-010）。

## 当前正在进行的工作

- Phase 02 收尾：等待 VM 对 Draft PR #1 复审（针对 `4cc7ec1`/`cadc4a4`）；VM 结论供用户参考，合并需用户明确授权。
- E看牙 输入卡死问题暂行观察：用户实测暂未复现；若复发，读取 `logs/ext-input-events.log` 黑匣子流水定案。

## 当前已知问题

- E看牙字段/历史栏定位对网页 DOM 和加载状态敏感。
- OCR 对符号与小数不可靠，补偿覆盖有限布局。
- 服务端保留 `confirm-save`，但扩展 UI 未调用；不要接入。
- E看牙 输入卡死（点击失效/滚轮可用）疑似 Chrome 145 分屏视图 + modal-entry 组合问题，未最终定案；黑匣子在记录。

## 下一步建议

VM 复审通过并获用户授权后合并 PR #1，Phase 02 关闭；随后按共享库路线图进入 Phase 03（本地 Validator、歧义 UI 与安全回退）。期间可继续日常使用双草稿并积累问题记录（ISSUE-XXX 格式，见共享库）。

## 修改时特别注意

- 不要自动保存，不要将密钥写进扩展。
- 修改复诊规则前先阅读 `local_generate` 及其辅助函数，并用同类代表句验证。
- 修改 E看牙填入或历史复制前，必须在真实病历编辑页测试；失败时应保留手动复制路径。
- 修改初诊字段时检查：表单显示、输出、重置、预览、填入和样式。
- Chrome 页面刷新才加载新的 `content.js`；服务端改动后要重启 Iris。
