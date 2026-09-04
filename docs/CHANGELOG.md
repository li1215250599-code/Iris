# 变更记录

> 规则：以后每项记录日期、Agent、目的、重要文件、验证结果和遗留问题。没有 Git 历史时，不推断作者或确切修改时间。

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
