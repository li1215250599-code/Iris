# 变更记录

> 规则：以后每项记录日期、Agent、目的、重要文件、验证结果和遗留问题。没有 Git 历史时，不推断作者或确切修改时间。

## 2026-09-10 — Hermes Agent — GLM 双草稿改用 GLM-5.3-Flash

- 目的：复诊影子提取是窄范围结构化任务；GLM-5.3 的默认思考在多要点输入时耗尽 2,000 token 预算，返回空正文，导致界面仅显示本地候选。
- 变更：`IRIS_GLM_MODEL` 设置为 `glm-5.3-flash`；`iris_server.py` 对 GLM-5.3 系列请求使用官方允许的 `thinking: enabled`、`reasoning_effort=low` 与 4,096 token 输出预算，其他 GLM 模型保持关闭 thinking。候选的极性由可追溯原文中的本地否定词确定，不再接受模型的极性标签；新增 validator 覆盖凭空牙位/颌别、缺失弓丝规格、错误字段/枚举和空事实数组；密钥仍只在 Windows 用户环境变量中保存。
- 验证：虚构多要点 POST `/api/generate-dual-draft` 返回 `GLM_STATUS=ok`、`GLM_CANDIDATE=True`；GLM 双草稿离线回归 13/13 通过；服务侧既有回归 19/19 通过；`python -m py_compile iris_server.py` 通过。
- 遗留：需 VM 审阅 diff；用户后续决定是否合并或继续真实病例抽样。

## 2026-09-06 — Hermes Agent — 填入 E看牙 成功后立即收起悬浮窗

- 目的：医生要求点击「填入 E看牙」成功后悬浮窗自动收起，不必等到点击「完成治疗」才关闭，减少每例复诊一次多余的点按。
- 变更：`chrome-extension/content.js` 新增 `closePanelAfterFill()`；`refs.fill` 点击处理在 `fillEkanya()` 返回 `result.ok` 后调用它移除 `.open`。**只收起不重置草稿**——`state.record`、要点文本与已填字段都保留，医生随时点开 Iris 悬浮钮即可回看/编辑/再次填入；填入失败或抛错时**不收起**，保留错误状态供原地修正。原「完成治疗」触发的 `resetIrisDraft({closePanel:true})` 保留，仍负责跨患者清空草稿。
- 业务代码：`chrome-extension/content.js`；`chrome-extension/manifest.json` 版本 0.1.25 → 0.1.26；`iris_server.py` 未修改。
- 验证：`node --check content.js background.js`、`python -m py_compile iris_server.py` 全部通过（ALL_OK）。面板显隐只依赖 `.iris-panel.open` 类（`display:none` → `display:grid`），移除类即收起；`positionLauncherFromPanel()`/`repositionPanelAfterLayout()` 在拖拽与重开时重新定位，收起态无残留副作用。
- 遗留：需医生在真实 E看牙编辑页刷新页面（重新加载未打包扩展后刷新）人工确认——成功填入后窗口收起且悬浮钮可重新点开；失败路径仍保持展开。

## 2026-09-04 — Hermes Agent — 文档同步：修正过时的 OCR / 术语表描述

- 目的：README 与架构/项目文档仍描述早已移除的“悬浮窗术语表”和已弃用的“本机 Windows OCR”，与实际代码脱节，会误导后续 Agent 与使用者。
- 变更：`README.md`（能力描述改 AI 视觉识别、AI 配置补充 `IRIS_CEPH_MODEL`、术语表改为直接编辑 `terms.json`、安全边界补充“数据离本机”说明）；`chrome-extension/README.md`（第一版边界 → 当前初诊/复诊全字段能力）；`docs/ARCHITECTURE.md`（模块职责、`/api/terms` 标注无 UI 调用、`/api/ceph-ocr` 标注 AI 识别）；`docs/PROJECT.md`（场景三与已知边界）。
- 业务代码：未修改。
- 验证：逐条对照当前代码（content.js 无术语表 UI；`/api/ceph-ocr` 仅视觉模型）核实后修改。
- 遗留：无。

## 2026-09-04 — Hermes Agent — 头侧片识别仅保留视觉模型（移除 Windows OCR 回退）

- 目的：医生实测后要求不再使用 Windows OCR——它会静默丢失负号并填入错误数值（如 Wits 2.6），且此前"负号仍错"症状实为服务未重启、仍在跑旧 Windows OCR 路径所致。
- 变更：`iris_server.py` 移除 `/api/ceph-ocr` 的 Windows OCR 回退，改为视觉模型 + 3 次自动重试 + 全部失败显式报错（绝不静默填错）；`Start-Iris.ps1` 用户环境导入列表新增 `IRIS_CEPH_MODEL`（此前缺失会导致该变量无法传入服务进程）。视觉调用对 DeepSeek 关闭 thinking 并把 `max_tokens` 提到 2000（实测发现 vision-exp 思考会耗尽 800 配额导致 content 为空）。
- 业务代码：`iris_server.py`、`Start-Iris.ps1`；复诊文字 AI 不受影响。
- 验证：`py_compile` 通过；关闭 thinking + max_tokens=2000 后真实截图连跑 4 次全部返回 `Wits -2.6`（负号正确，零空返回）；生产路径 POST 回归见提交后实测。
- 遗留：视觉 API 偶发空返回（已重试兜底，概率低）；识别结果仍需医生核对。

## 2026-09-04 — Hermes Agent — 头侧片识别改用 DeepSeek 视觉模型

- 目的：解决 Windows OCR 对测量值小数点/负号识别不准的问题。
- 变更：`iris_server.py` 新增 `call_ceph_vision_ocr`，`/api/ceph-ocr` 改为视觉模型优先（模型取新环境变量 `IRIS_CEPH_MODEL`=`deepseek-v4-flash-vision-exp`，复用原 key/baseUrl），失败自动回退本机 Windows OCR，响应新增 `source` 字段；前端零改动。
- 业务代码：仅 `iris_server.py`；复诊文字 AI（`IRIS_AI_MODEL`）不受影响。
- 验证：`py_compile` 通过；合成测量表（含 ANB -5.5、Wits -0.99）经视觉模型逐行识别，正负号/小数全部保留（PASS）。
- 遗留：真实 E看牙截图版式尚未验证（需医生在重启服务后粘贴实测）；患者图片现会发送至 DeepSeek 服务器（见 DECISIONS D-010，医生已授权）。

## 2026-09-04 — Hermes Agent — 新增 GitHub Actions 语法门禁

- 目的：任何 Agent 推送/开 PR 时自动执行语法验证，防止提交语法损坏的 `iris_server.py` 或扩展 JS/JSON。
- 变更：新增 `.github/workflows/syntax-check.yml`（py_compile + json.tool + node --check，仅语法检查，不跑业务）。
- 业务代码：未修改。
- 验证：推送后 Actions run 结论为 success。
- 遗留：无自动化行为回归测试；CI 不替代 AGENTS.md 要求的真实 E看牙页面人工验证。

## 2026-09-04 — Hermes Agent — 核查 GitHub 远端并同步交接文档

- 目的：为多 Agent 延续维护，确认远端仓库真实状态并修正过时的交接信息。
- 变更：确认 private 仓库 `li1215250599-code/Iris` 已存在（创建于 2026-09-04T02:51Z），首个提交 `3903c52` 已推送且本地与远端一致；扫描已提交文件，无密钥、日志或浏览器 profile 数据；更新 `docs/HANDOFF.md`（Git 与认证说明、状态、下一步建议）与本文件。
- 业务代码：未修改。
- 验证：`git ls-remote origin`（无提示成功）、GitHub API（private=True、HEAD 一致）、`git grep` 密钥扫描为空、`git diff --check`。
- 遗留：仓库无描述；无自动化测试（见 HANDOFF 下一步建议）；换机器需以账号 `li1215250599-code` 重新认证。

## 2026-09-04 — Codex — 项目审计与多 Agent 文档化

- 目的：为后续多 Agent 维护建立真实代码基础上的协作说明。
- 变更：新增 `AGENTS.md`、`docs/`、`.gitignore`；扩充顶层 README 的当前能力说明。
- 业务代码：未修改。
- 验证：检查目录、扩展声明、本地服务 API、启动脚本、E看牙交接文件、Git 状态和敏感目录边界。
- 遗留：未创建 GitHub 远端，未进行首次提交。

## 2026-07-30 — 历史修改（由当前代码与本次对话可确认）

- 头侧片 OCR 对 Wits 与 ANB 增加局部补偿，以保留 `-5.5`、`-0.99` 这类负数和小数。
- 重要文件：`iris_server.py`、`chrome-extension/content.js`。
- 验证：当时使用提供的截图进行本地识别验证；当前未发现自动化测试文件。

## 2026-07（具体日期/作者无法从 Git 确认）— 初诊模板扩展

- 当前代码显示已加入初诊/复诊切换、面部/TMJ/口内检查、头侧片 OCR、诊断、治疗方案、风险、处置和医嘱。
- 重要文件：`chrome-extension/content.js`、`chrome-extension/panel.css`。
- 设计详情以当前代码为准；具体每次修改的原因无法从当前项目确认。

## 2026-07（具体日期/作者无法从 Git 确认）— 复诊规则与 E看牙历史复制

- 当前代码显示本地复诊规则、保持器固定模板、AI 稳定化、E看牙字段填入及右侧历史病历诊断/计划复制已经存在。
- 重要文件：`iris_server.py`、`chrome-extension/content.js`。
- 具体演进顺序无法从当前项目确认。
