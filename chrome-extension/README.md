# Iris E看牙 Chrome 扩展

这个扩展把 Iris 悬浮窗嵌入 E看牙页面。

## 使用

1. 运行 `D:\DailyRootine\Iris\Run-Iris.cmd`，启动 Iris 本地服务和 E看牙专用 Chrome。
2. 第一次使用时，在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开“开发者模式”，点击“加载已解压的扩展程序”。
4. 选择 `D:\DailyRootine\Iris\chrome-extension`。
5. 回到 E看牙页面并刷新，登录后页面右下角会出现 Iris 按钮。
6. 点击 Iris，语音或手动输入复诊要点，生成后填入 E看牙。

## 第一版边界

- 只填入，不自动保存。
- 当前优先识别 E看牙病历编辑页的 `口腔检查`、`处置`、`医嘱` 三个字段。
- 字段无法可靠识别时停止，并提示复制全文。
- 术语表保存在 `D:\DailyRootine\Iris\terms.json`。
- 病历格式为三段式：检查、处置、医嘱。
