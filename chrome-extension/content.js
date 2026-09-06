(() => {
  if (window.__irisEkanyaInjected) return;
  window.__irisEkanyaInjected = true;

  const ROOT_ID = "iris-ekanya-root";
  const FOLLOWUP_FIXED = {
    chief: "矫正复诊",
    present: "矫正中",
    past: "体健。无特殊。否认系统性病史。",
    advice: "注意口腔卫生，勿咬硬物，不适随诊。"
  };
  const state = {
    record: null,
    recognition: null,
    recognizing: false,
    finalSpeech: "",
    currentUrl: location.href
  };

  function isLoginPage() {
    return /\/LogOn/i.test(location.href);
  }

  function sendToIris(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error(response?.message || "Iris 本地服务暂不可用。"));
          return;
        }
        resolve(response);
      });
    });
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    const host = document.createElement("div");
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = chrome.runtime.getURL("panel.css");
    shadow.appendChild(style);

    const launcher = document.createElement("button");
    launcher.className = "iris-launcher";
    launcher.type = "button";
    launcher.textContent = "Iris";
    launcher.title = "打开 Iris 病历助手";

    const panel = document.createElement("section");
    panel.className = "iris-panel";
    panel.innerHTML = `
      <div class="iris-head">
        <h2 class="iris-title">Iris 正畸复诊病历助手</h2>
        <button class="iris-close" type="button" title="收起">×</button>
      </div>
      <div class="iris-body">
        <div class="iris-mode-row">
          <label class="iris-label" for="iris-visit-mode">病历类型</label>
          <select id="iris-visit-mode" class="iris-select">
            <option value="initial">初诊</option>
            <option value="followup" selected>复诊</option>
          </select>
        </div>

        <div id="iris-followup-form" class="iris-block">
          <label class="iris-label" for="iris-notes">复诊要点</label>
          <textarea id="iris-notes" class="iris-textarea" placeholder="例如：口卫一般，换1725的不锈钢丝，继续二类牵引，告知皮筋佩戴。"></textarea>
          <div class="iris-row">
            <button id="iris-voice" class="iris-button ghost" type="button">开始语音</button>
            <button id="iris-generate" class="iris-button" type="button">生成病历</button>
            <button id="iris-clear" class="iris-button ghost" type="button">清空</button>
            <button id="iris-copy-notes" class="iris-button ghost" type="button">复制</button>
            <button id="iris-paste-notes" class="iris-button ghost" type="button">粘贴</button>
          </div>
        </div>

        <form id="iris-initial-form" class="iris-initial-form" hidden>
          <details class="iris-details" open>
            <summary>基本信息、主诉与既往史</summary>
            <div class="iris-details-body">
              <label class="iris-label">患者类型</label>
              <select id="iris-patient-type" class="iris-select">
                <option value="">请选择儿童或成人</option>
                <option value="child">儿童</option>
                <option value="adult">成人</option>
              </select>
              <label class="iris-label">主诉</label>
              <div id="iris-chief-options" class="iris-option-group">
                <button type="button" class="iris-option-button" data-chief-value="牙列不齐">牙列不齐</button>
                <button type="button" class="iris-option-button" data-chief-value="嘴凸">嘴凸</button>
                <button type="button" class="iris-option-button" data-chief-value="个别牙反合">个别牙反合</button>
                <button type="button" class="iris-option-button" data-chief-value="地包天">地包天</button>
                <button type="button" class="iris-option-button" data-chief-value="牙列间隙">牙列间隙</button>
              </div>
              <input id="iris-chief-other" class="iris-input" placeholder="其他主诉（可直接填写）" />
              <label class="iris-label">既往史（有具体病史时直接在右侧填写）</label>
              <div id="iris-history-grid" class="iris-form-grid">
                <label>正畸治疗史</label><button type="button" class="iris-option-button active" data-history-deny="orthodontic" aria-pressed="true">否认</button><input data-history-detail="orthodontic" class="iris-input compact" placeholder="具体正畸治疗史" />
                <label>系统性疾病史</label><button type="button" class="iris-option-button active" data-history-deny="systemic" aria-pressed="true">否认</button><input data-history-detail="systemic" class="iris-input compact" placeholder="具体系统性疾病史" />
                <label>传染性疾病史</label><button type="button" class="iris-option-button active" data-history-deny="infectious" aria-pressed="true">否认</button><input data-history-detail="infectious" class="iris-input compact" placeholder="具体传染性疾病史" />
                <label>遗传性疾病史</label><button type="button" class="iris-option-button active" data-history-deny="genetic" aria-pressed="true">否认</button><input data-history-detail="genetic" class="iris-input compact" placeholder="具体遗传性疾病史" />
                <label>药物过敏史</label><button type="button" class="iris-option-button active" data-history-deny="allergy" aria-pressed="true">否认</button><input data-history-detail="allergy" class="iris-input compact" placeholder="具体药物过敏史" />
              </div>
            </div>
          </details>

          <details class="iris-details">
            <summary>面部检查</summary>
            <div class="iris-details-body iris-choice-grid iris-face-grid">
              <select id="iris-face-proportion" class="iris-select"><option value="">面部比例</option><option>面部基本三等分</option><option>面部下1/3稍短</option><option>面部下1/3稍长</option></select>
              <select id="iris-face-fullness" class="iris-select"><option value="">面部丰满度</option><option>左右基本对称</option><option>左侧稍丰满</option><option>右侧稍丰满</option></select>
              <div id="iris-face-lips-options" class="iris-option-group">
                <span class="iris-option-caption">唇部及颏唇肌</span>
                <button type="button" class="iris-option-button" data-face-multi-value="开唇露齿">开唇露齿</button>
                <button type="button" class="iris-option-button" data-face-multi-value="颏唇肌紧张">颏唇肌紧张</button>
                <button type="button" class="iris-option-button" data-face-multi-value="上下唇肥厚">上下唇肥厚</button>
                <button type="button" class="iris-option-button" data-face-multi-value="上下唇较薄">上下唇较薄</button>
              </div>
              <select id="iris-face-mouth-line" class="iris-select"><option value="">口裂线</option><option value="口裂线平">口裂线平</option><option value="口裂线左高右低">左高右低</option><option value="口裂线左低右高">左低右高</option></select>
              <select id="iris-face-chin" class="iris-select"><option value="">颏点</option><option value="颏点正">颏点正</option><option value="颏点稍左偏">稍左偏</option><option value="颏点稍右偏">稍右偏</option></select>
              <select id="iris-face-profile" class="iris-select"><option value="">侧貌</option><option value="侧貌直面型">直面型</option><option value="侧貌凹面型">凹面型</option><option value="侧貌突面型">突面型</option></select>
              <select id="iris-face-eline" class="iris-select"><option value="">上下唇与E线</option><option value="上下唇在E线上">在E线上</option><option value="上下唇在E线内">在E线内</option><option value="上下唇在E线外">在E线外</option></select>
              <select id="iris-face-labiomental" class="iris-select"><option value="">颏唇沟</option><option value="颏唇沟深">深</option><option value="颏唇沟浅">浅</option></select>
              <select id="iris-face-mandible" class="iris-select"><option value="">下颌位置</option><option>下颌后缩</option><option>下颌后退</option></select>
              <textarea id="iris-face-other" class="iris-textarea small" placeholder="其他面部检查补充"></textarea>
            </div>
          </details>

          <details class="iris-details">
            <summary>TMJ 检查</summary>
            <div class="iris-details-body">
              <div class="iris-side-columns iris-tmj-side-columns">
                <div class="iris-side-card" data-tmj-side="left"><b>左侧 TMJ</b></div>
                <div class="iris-side-card" data-tmj-side="right"><b>右侧 TMJ</b></div>
              </div>
              <div class="iris-choice-grid iris-single-column">
                <select id="iris-opening-degree" class="iris-select"><option value="">开口度</option><option>开口度正常</option><option>张口受限</option></select>
                <div id="iris-opening-limit-fingers-wrap" class="iris-opening-limit-entry" hidden><span>张口不足</span><input id="iris-opening-limit-fingers" class="iris-input compact" inputmode="decimal" aria-label="张口不足横指标数" /><span>横指</span></div>
                <select id="iris-opening-path" class="iris-select"><option value="">开口型</option><option>开口型正常</option><option>开口型偏左</option><option>开口型偏右</option></select>
                <select id="iris-condyle-shape" class="iris-select"><option value="">双侧髁突形态</option><option>基本对称</option><option>不对称</option></select>
              </div>
              <textarea id="iris-tmj-other" class="iris-textarea small" placeholder="其他 TMJ 补充"></textarea>
            </div>
          </details>

          <details class="iris-details">
            <summary>口内检查</summary>
            <div class="iris-details-body">
              <div class="iris-choice-grid iris-single-column">
                <select id="iris-dentition" class="iris-select"><option value="">牙列期</option><option>恒牙列</option><option>乳牙列</option><option>混合牙列</option></select>
              </div>
              <label class="iris-label">咬合关系</label>
              <div class="iris-side-columns">
                <div class="iris-side-card"><b>左侧</b><select id="iris-canine-left" class="iris-select"><option value="">尖牙关系</option><option value="左侧尖牙近中关系">近中关系</option><option value="左侧尖牙中性关系">中性关系</option><option value="左侧尖牙远中关系">远中关系</option></select><select id="iris-molar-left" class="iris-select"><option value="">磨牙关系</option><option value="左侧磨牙近中关系">近中关系</option><option value="左侧磨牙中性关系">中性关系</option><option value="左侧磨牙远中关系">远中关系</option></select><div class="iris-terminal-plane-control" hidden><select id="iris-terminal-plane-left" class="iris-select"><option value="">乳磨牙末端平面</option><option value="左侧乳磨牙末端平面近中关系">近中关系</option><option value="左侧乳磨牙末端平面远中关系">远中关系</option><option value="左侧乳磨牙末端平面平齐">平齐</option></select></div></div>
                <div class="iris-side-card"><b>右侧</b><select id="iris-canine-right" class="iris-select"><option value="">尖牙关系</option><option value="右侧尖牙近中关系">近中关系</option><option value="右侧尖牙中性关系">中性关系</option><option value="右侧尖牙远中关系">远中关系</option></select><select id="iris-molar-right" class="iris-select"><option value="">磨牙关系</option><option value="右侧磨牙近中关系">近中关系</option><option value="右侧磨牙中性关系">中性关系</option><option value="右侧磨牙远中关系">远中关系</option></select><div class="iris-terminal-plane-control" hidden><select id="iris-terminal-plane-right" class="iris-select"><option value="">乳磨牙末端平面</option><option value="右侧乳磨牙末端平面近中关系">近中关系</option><option value="右侧乳磨牙末端平面远中关系">远中关系</option><option value="右侧乳磨牙末端平面平齐">平齐</option></select></div></div>
              </div>
              <div class="iris-choice-grid iris-single-column">
                <select id="iris-overbite" class="iris-select"><option value="">深覆合</option><option>I度深覆合</option><option>II度深覆合</option><option>III度深覆合</option><option>反覆合</option></select>
                <select id="iris-overjet" class="iris-select"><option value="">深覆盖</option><option>I度深覆盖</option><option>II度深覆盖</option><option>III度深覆盖</option><option>反覆盖</option></select>
                <div class="iris-midline-group" data-midline-group="upper"><span class="iris-option-caption">上颌中线</span><button type="button" class="iris-option-button" data-midline="upper" data-midline-value="正">正</button><button type="button" class="iris-option-button" data-midline="upper" data-midline-value="左偏">左偏</button><label class="iris-midline-entry" data-midline-entry="upper-left" hidden><span>左偏</span><input class="iris-input compact" data-midline-mm="upper" inputmode="decimal" />mm</label><button type="button" class="iris-option-button" data-midline="upper" data-midline-value="右偏">右偏</button><label class="iris-midline-entry" data-midline-entry="upper-right" hidden><span>右偏</span><input class="iris-input compact" data-midline-mm="upper" inputmode="decimal" />mm</label></div>
                <div class="iris-midline-group" data-midline-group="lower"><span class="iris-option-caption">下颌中线</span><button type="button" class="iris-option-button" data-midline="lower" data-midline-value="正">正</button><button type="button" class="iris-option-button" data-midline="lower" data-midline-value="左偏">左偏</button><label class="iris-midline-entry" data-midline-entry="lower-left" hidden><span>左偏</span><input class="iris-input compact" data-midline-mm="lower" inputmode="decimal" />mm</label><button type="button" class="iris-option-button" data-midline="lower" data-midline-value="右偏">右偏</button><label class="iris-midline-entry" data-midline-entry="lower-right" hidden><span>右偏</span><input class="iris-input compact" data-midline-mm="lower" inputmode="decimal" />mm</label></div>
                <select id="iris-upper-jaw-arch" class="iris-select"><option value="">上颌牙弓</option><option>方圆形</option><option>卵圆形</option><option>尖圆形</option><option>狭窄</option><option>宽大</option></select>
                <select id="iris-lower-jaw-arch" class="iris-select"><option value="">下颌牙弓</option><option>方圆形</option><option>卵圆形</option><option>尖圆形</option><option>狭窄</option><option>宽大</option></select>
                <select id="iris-upper-arch" class="iris-select"><option value="">上颌牙列</option><option value="不齐">牙列不齐</option><option value="散在间隙">散在间隙</option></select>
                <select id="iris-lower-arch" class="iris-select"><option value="">下颌牙列</option><option value="不齐">牙列不齐</option><option value="散在间隙">散在间隙</option></select>
                <select id="iris-hygiene" class="iris-select"><option value="">口腔卫生</option><option>口腔卫生一般</option><option>口腔卫生差</option></select>
              </div>
              <div class="iris-check-row">
                <label><input type="checkbox" id="iris-calculus" />牙石</label>
                <label><input type="checkbox" id="iris-plaque" />软垢</label>
                <label><input type="checkbox" id="iris-pigment" />色素沉着</label>
                <label><input type="checkbox" id="iris-gingiva" />部分牙龈红肿</label>
              </div>
              <div id="iris-rare-tooth-options" class="iris-option-group iris-rare-tooth-options">
                <span class="iris-option-caption">个别牙位情况（点选后在下方填写）</span>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="ectopia">牙齿异位</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="missing">牙齿缺失</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="defect">牙体缺损</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="micro">牙体形态异常</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="supernumerary">多生牙</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="retained-primary">滞留乳牙</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="crown">冠修复</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="oral-openbite">开合</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="oral-crossbite">反合</button>
                <button type="button" class="iris-option-button" data-oral-tooth-kind="oral-lockbite">正锁合</button>
              </div>
              <div id="iris-active-tooth-groups" class="iris-dynamic-groups"></div>
              <textarea id="iris-oral-other" class="iris-textarea small" placeholder="其他口内检查补充"></textarea>
            </div>
          </details>

          <details class="iris-details">
            <summary>辅助检查</summary>
            <div class="iris-details-body">
              <div id="iris-ceph-image-zone" class="iris-ceph-image-zone" tabindex="0">点击此处后直接粘贴头侧片截图</div>
              <div id="iris-ceph-values" class="iris-ceph-grid"></div>
            </div>
          </details>

          <details class="iris-details">
            <summary>诊断</summary>
            <div class="iris-details-body">
              <div class="iris-choice-grid iris-single-column">
                <select id="iris-diagnosis-stage" class="iris-select"><option value="">牙列期</option><option>乳牙期</option><option>替牙期</option><option>恒牙期</option></select>
                <select id="iris-angle-class" class="iris-select"><option value="">安氏分类</option><option>安氏I类</option><option>安氏II类</option><option>安氏III类</option></select>
                <select id="iris-skeletal-class" class="iris-select"><option value="">骨性分类</option><option>骨性I类</option><option>骨性II类</option><option>骨性III类</option></select>
                <select id="iris-vertical-class" class="iris-select"><option value="">垂直骨面型</option><option>低角</option><option>均角</option><option>高角</option></select>
                <select id="iris-diagnosis-overbite" class="iris-select"><option value="">深覆合</option><option>I度深覆合</option><option>II度深覆合</option><option>III度深覆合</option><option>反覆合</option></select>
                <select id="iris-diagnosis-overjet" class="iris-select"><option value="">深覆盖</option><option>I度深覆盖</option><option>II度深覆盖</option><option>III度深覆盖</option><option>反覆盖</option></select>
                <select id="iris-openbite-diagnosis" class="iris-select"><option value="">开合诊断</option><option>开合</option><option>水平性开合</option></select>
              </div>
              <div class="iris-option-group" id="iris-crossbite-options"><span class="iris-option-caption">反合</span><button type="button" class="iris-option-button" data-crossbite-type="individual">个别牙反合</button><button type="button" class="iris-option-button" data-crossbite-type="posterior">后牙反合</button><button type="button" class="iris-option-button" data-crossbite-type="full">全牙列反合</button></div>
              <div id="iris-individual-crossbite-teeth" class="iris-dynamic-groups" hidden><div><b>反合牙位</b><button class="iris-mini-button" type="button" data-add-row="crossbite">＋添加</button><div data-row-list="crossbite"></div></div></div>
              <div class="iris-option-group" id="iris-lockbite-options"><span class="iris-option-caption">正锁合</span><button type="button" class="iris-option-button" data-lockbite-type="individual">个别牙正锁合</button></div>
              <div id="iris-individual-lockbite-teeth" class="iris-dynamic-groups" hidden><div><b>正锁合牙位</b><button class="iris-mini-button" type="button" data-add-row="lockbite">＋添加</button><div data-row-list="lockbite"></div></div></div>
              <textarea id="iris-diagnosis-other" class="iris-textarea small" placeholder="其他诊断补充"></textarea>
            </div>
          </details>

          <details class="iris-details">
            <summary>治疗计划、处置与医嘱</summary>
            <div class="iris-details-body">
              <div id="iris-plan-list"></div>
              <button id="iris-add-plan" class="iris-button ghost" type="button">＋添加方案</button>
              <label class="iris-label">矫治风险</label>
              <div id="iris-risk-options" class="iris-risk-options">
                <label><input type="checkbox" data-initial-risk checked /><textarea class="iris-risk-text" data-initial-risk-text>患者全口牙周及牙槽骨，牙根在矫正过程中有可能继续吸收。</textarea></label>
                <label><input type="checkbox" data-initial-risk checked /><textarea class="iris-risk-text" data-initial-risk-text>矫治过程中应保持口腔卫生，维护牙体牙周组织健康。</textarea></label>
                <label><input type="checkbox" data-initial-risk checked /><textarea class="iris-risk-text" data-initial-risk-text>正畸术后前牙有可能出现黑三角矫正过程中难以避免。</textarea></label>
                <label><input type="checkbox" data-initial-risk checked /><textarea class="iris-risk-text" data-initial-risk-text>常规治疗既不会引起也不会阻止颞下颌关节吸收。如矫正过程中出现颞下颌关节疼痛等不适症状，须停止加力，关节科会诊及治疗，待关节情况稳定后再继续治疗。</textarea></label>
              </div>
              <textarea id="iris-risk-other" class="iris-textarea small" placeholder="其他风险补充（可选）"></textarea>
              <label class="iris-label" for="iris-initial-treatment">处置</label>
              <textarea id="iris-initial-treatment" class="iris-textarea small">今日签署知情同意书。</textarea>
              <label class="iris-label" for="iris-initial-advice">医嘱</label>
              <textarea id="iris-initial-advice" class="iris-textarea small">不适随诊，按约复诊。</textarea>
            </div>
          </details>

          <div class="iris-row">
            <button id="iris-initial-generate" class="iris-button" type="button">生成初诊病历</button>
            <button id="iris-initial-clear" class="iris-button ghost" type="button">清空初诊</button>
          </div>
          <div id="iris-initial-status" class="iris-status iris-initial-status" aria-live="polite"></div>
        </form>

        <div class="iris-block">
          <div id="iris-initial-preview" hidden>
            <label class="iris-label" for="iris-chief-preview">主诉</label>
            <textarea id="iris-chief-preview" class="iris-textarea small"></textarea>
            <label class="iris-label" for="iris-present-preview">现病史</label>
            <textarea id="iris-present-preview" class="iris-textarea small"></textarea>
            <label class="iris-label" for="iris-past-preview">既往史</label>
            <textarea id="iris-past-preview" class="iris-textarea small"></textarea>
          </div>
          <label class="iris-label" for="iris-exam">检查</label>
          <textarea id="iris-exam" class="iris-textarea small"></textarea>
          <div id="iris-initial-preview-extra" hidden>
            <label class="iris-label" for="iris-auxiliary-preview">辅助检查</label>
            <textarea id="iris-auxiliary-preview" class="iris-textarea small"></textarea>
            <label class="iris-label" for="iris-diagnosis-preview">诊断</label>
            <textarea id="iris-diagnosis-preview" class="iris-textarea small"></textarea>
            <label class="iris-label" for="iris-plan-preview">治疗计划</label>
            <textarea id="iris-plan-preview" class="iris-textarea plan-preview"></textarea>
          </div>
          <label class="iris-label" for="iris-treatment">处置</label>
          <textarea id="iris-treatment" class="iris-textarea small"></textarea>
          <label class="iris-label" for="iris-advice">医嘱</label>
          <textarea id="iris-advice" class="iris-textarea small"></textarea>
          <ul id="iris-flags" class="iris-flags"></ul>
          <div class="iris-row">
            <button id="iris-fill" class="iris-button blue" type="button" disabled>填入 E看牙</button>
            <button id="iris-copy" class="iris-button ghost" type="button" disabled>复制全文</button>
          </div>
        </div>

        <div id="iris-status" class="iris-status"></div>
      </div>
      <div class="iris-scroll-actions" aria-label="Iris 内容滚动">
        <button id="iris-scroll-top" type="button" title="回到顶部">↑ 顶部</button>
        <button id="iris-scroll-bottom" type="button" title="回到底部">↓ 底部</button>
      </div>
    `;

    shadow.appendChild(launcher);
    shadow.appendChild(panel);

    const $ = (selector) => shadow.querySelector(selector);
    const refs = {
      launcher,
      panel,
      head: $(".iris-head"),
      body: $(".iris-body"),
      title: $(".iris-title"),
      close: $(".iris-close"),
      visitMode: $("#iris-visit-mode"),
      followupForm: $("#iris-followup-form"),
      initialForm: $("#iris-initial-form"),
      initialGenerate: $("#iris-initial-generate"),
      initialClear: $("#iris-initial-clear"),
      notes: $("#iris-notes"),
      voice: $("#iris-voice"),
      generate: $("#iris-generate"),
      clear: $("#iris-clear"),
      copyNotes: $("#iris-copy-notes"),
      pasteNotes: $("#iris-paste-notes"),
      initialPreview: $("#iris-initial-preview"),
      initialPreviewExtra: $("#iris-initial-preview-extra"),
      chiefPreview: $("#iris-chief-preview"),
      presentPreview: $("#iris-present-preview"),
      pastPreview: $("#iris-past-preview"),
      exam: $("#iris-exam"),
      auxiliaryPreview: $("#iris-auxiliary-preview"),
      diagnosisPreview: $("#iris-diagnosis-preview"),
      planPreview: $("#iris-plan-preview"),
      treatment: $("#iris-treatment"),
      advice: $("#iris-advice"),
      flags: $("#iris-flags"),
      fill: $("#iris-fill"),
      copy: $("#iris-copy"),
      scrollTop: $("#iris-scroll-top"),
      scrollBottom: $("#iris-scroll-bottom"),
      status: $("#iris-status"),
      initialStatus: $("#iris-initial-status")
    };

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function constrainBoxPosition(left, top, width, height) {
      const margin = 10;
      return {
        left: clamp(left, margin, Math.max(margin, window.innerWidth - width - margin)),
        top: clamp(top, margin, Math.max(margin, window.innerHeight - height - margin))
      };
    }

    function launcherSize() {
      const rect = refs.launcher.getBoundingClientRect();
      return { width: rect.width || 58, height: rect.height || 58 };
    }

    function panelSize() {
      const rect = refs.panel.getBoundingClientRect();
      return {
        width: rect.width || refs.panel.offsetWidth || 410,
        height: rect.height || refs.panel.offsetHeight || Math.min(620, window.innerHeight - 116)
      };
    }

    function launcherPosition() {
      const rect = refs.launcher.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }

    function applyLauncherPosition(position) {
      if (!position || typeof position.left !== "number" || typeof position.top !== "number") return;
      const size = launcherSize();
      const next = constrainBoxPosition(position.left, position.top, size.width, size.height);
      refs.launcher.style.left = `${next.left}px`;
      refs.launcher.style.top = `${next.top}px`;
      refs.launcher.style.right = "auto";
      refs.launcher.style.bottom = "auto";
      return next;
    }

    function positionPanelFromLauncher() {
      if (!refs.panel.classList.contains("open")) return;
      const launcherRect = refs.launcher.getBoundingClientRect();
      const launcher = launcherSize();
      const panel = panelSize();
      const gap = 12;
      const margin = 10;
      const candidates = [
        {
          left: launcherRect.left - panel.width - gap,
          top: launcherRect.top - panel.height / 2 + launcher.height / 2
        },
        {
          left: launcherRect.right + gap,
          top: launcherRect.top - panel.height / 2 + launcher.height / 2
        },
        {
          left: launcherRect.right - panel.width,
          top: launcherRect.bottom + gap
        },
        {
          left: launcherRect.right - panel.width,
          top: launcherRect.top - panel.height - gap
        }
      ];
      const fits = (item) => (
        item.left >= margin
        && item.top >= margin
        && item.left + panel.width <= window.innerWidth - margin
        && item.top + panel.height <= window.innerHeight - margin
      );
      const preferred = candidates.find(fits) || candidates[0];
      const next = constrainBoxPosition(preferred.left, preferred.top, panel.width, panel.height);
      refs.panel.style.left = `${next.left}px`;
      refs.panel.style.top = `${next.top}px`;
      refs.panel.style.right = "auto";
      refs.panel.style.bottom = "auto";
    }

    function repositionPanelAfterLayout() {
      if (!refs.panel.classList.contains("open")) return;
      requestAnimationFrame(() => {
        positionPanelFromLauncher();
        requestAnimationFrame(positionPanelFromLauncher);
      });
    }

    function positionLauncherFromPanel() {
      const panelRect = refs.panel.getBoundingClientRect();
      const launcher = launcherSize();
      const gap = 12;
      const candidates = [
        { left: panelRect.right + gap, top: panelRect.bottom - launcher.height },
        { left: panelRect.left - launcher.width - gap, top: panelRect.bottom - launcher.height },
        { left: panelRect.right - launcher.width, top: panelRect.bottom + gap },
        { left: panelRect.right - launcher.width, top: panelRect.top - launcher.height - gap }
      ];
      const margin = 10;
      const fits = (item) => (
        item.left >= margin
        && item.top >= margin
        && item.left + launcher.width <= window.innerWidth - margin
        && item.top + launcher.height <= window.innerHeight - margin
      );
      applyLauncherPosition(candidates.find(fits) || candidates[0]);
    }

    function saveLauncherPosition() {
      chrome.storage.local.set({ irisLauncherPosition: launcherPosition() });
    }

    function setupIrisDrag() {
      const dragState = {
        active: false,
        moved: false,
        mode: "",
        offsetX: 0,
        offsetY: 0,
        startX: 0,
        startY: 0
      };

      chrome.storage.local.get(["irisLauncherPosition", "irisPanelPosition"], (data) => {
        if (chrome.runtime.lastError) return;
        if (data?.irisLauncherPosition) {
          applyLauncherPosition(data.irisLauncherPosition);
          return;
        }
        if (data?.irisPanelPosition) {
          const launcher = launcherSize();
          applyLauncherPosition({
            left: data.irisPanelPosition.left + 410 - launcher.width,
            top: data.irisPanelPosition.top + 520 + 12
          });
        }
      });

      function beginDrag(event, mode) {
        if (event.button !== 0) return;
        if (mode === "panel" && event.target.closest("button, input, textarea, select, a")) return;
        const source = mode === "panel" ? refs.panel : refs.launcher;
        const rect = source.getBoundingClientRect();
        dragState.active = true;
        dragState.moved = false;
        dragState.mode = mode;
        dragState.offsetX = event.clientX - rect.left;
        dragState.offsetY = event.clientY - rect.top;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
        refs.panel.classList.add("dragging");
        refs.launcher.classList.add("dragging");
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }

      function moveDrag(event) {
        if (!dragState.active) return;
        const dx = Math.abs(event.clientX - dragState.startX);
        const dy = Math.abs(event.clientY - dragState.startY);
        if (dx > 3 || dy > 3) dragState.moved = true;

        if (dragState.mode === "launcher") {
          applyLauncherPosition({
            left: event.clientX - dragState.offsetX,
            top: event.clientY - dragState.offsetY
          });
          positionPanelFromLauncher();
          return;
        }

        const panel = panelSize();
        const next = constrainBoxPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY, panel.width, panel.height);
        refs.panel.style.left = `${next.left}px`;
        refs.panel.style.top = `${next.top}px`;
        refs.panel.style.right = "auto";
        refs.panel.style.bottom = "auto";
        positionLauncherFromPanel();
      }

      function endDrag(event) {
        if (!dragState.active) return;
        const wasLauncherClick = dragState.mode === "launcher" && !dragState.moved;
        dragState.active = false;
        refs.panel.classList.remove("dragging");
        refs.launcher.classList.remove("dragging");
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        saveLauncherPosition();
        if (wasLauncherClick) {
          refs.panel.classList.toggle("open");
          if (refs.panel.classList.contains("open")) repositionPanelAfterLayout();
        }
      }

      refs.launcher.addEventListener("pointerdown", (event) => beginDrag(event, "launcher"));
      refs.launcher.addEventListener("pointermove", moveDrag);
      refs.launcher.addEventListener("pointerup", endDrag);
      refs.launcher.addEventListener("pointercancel", endDrag);
      refs.head.addEventListener("pointerdown", (event) => beginDrag(event, "panel"));
      refs.head.addEventListener("pointermove", moveDrag);
      refs.head.addEventListener("pointerup", endDrag);
      refs.head.addEventListener("pointercancel", endDrag);
      window.addEventListener("resize", () => {
        applyLauncherPosition(launcherPosition());
        positionPanelFromLauncher();
        saveLauncherPosition();
      });
    }

    function setStatus(text, type = "") {
      refs.status.textContent = text || "";
      refs.status.className = `iris-status ${type}`.trim();
    }

    function setInitialStatus(text, type = "") {
      refs.initialStatus.textContent = text || "";
      refs.initialStatus.className = `iris-status iris-initial-status ${type}`.trim();
    }

    function setHistoryDebug(lines) {
      state.lastHistoryDebug = (lines || []).filter(Boolean);
      console.info("[Iris history]", state.lastHistoryDebug.join(" | "));
    }

    function sleep(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    const CEPH_FIELDS = [
      { key: "sna", label: "SNA", normal: "82.8±4" },
      { key: "snb", label: "SNB", normal: "80.1±3.9" },
      { key: "anb", label: "ANB", normal: "2.7±2" },
      { key: "wits", label: "Wits", normal: "0±2" },
      { key: "mp-sn", label: "MP-SN", normal: "30±6" },
      { key: "fma", label: "FMA", normal: "31.1±5.6" },
      { key: "u1-sn", label: "U1-SN", normal: "105.7±6.3" },
      { key: "l1-mp", label: "L1-MP（IMPA）", normal: "92.6±7" }
    ];

    // 初诊当前采用无必填项模式；如后续需要恢复强制校验，只需改为 true。
    const INITIAL_REQUIRED_VALIDATION_ENABLED = false;

    function formValue(selector) {
      return ($(selector)?.value || "").trim();
    }

    function syncEnhancedSelect(select) {
      const group = select.nextElementSibling;
      if (!group?.classList.contains("iris-option-group")) return;
      group.querySelectorAll("[data-option-value]").forEach((button) => {
        const active = button.dataset.optionValue === select.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function enhanceSelect(select) {
      if (!select || select.dataset.irisEnhanced === "true") return;
      select.dataset.irisEnhanced = "true";
      select.classList.add("iris-native-select-hidden");
      const group = document.createElement("div");
      group.className = "iris-option-group";
      const placeholder = [...select.options].find((option) => !option.value);
      if (placeholder) {
        const caption = document.createElement("span");
        caption.className = "iris-option-caption";
        caption.textContent = placeholder.textContent;
        group.appendChild(caption);
      }
      [...select.options].filter((option) => option.value).forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "iris-option-button";
        button.dataset.optionValue = option.value;
        button.textContent = option.textContent;
        button.addEventListener("click", () => {
          const canClear = !!placeholder;
          select.value = canClear && select.value === option.value ? "" : option.value;
          syncEnhancedSelect(select);
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        group.appendChild(button);
      });
      select.insertAdjacentElement("afterend", group);
      syncEnhancedSelect(select);
    }

    function syncAllEnhancedSelects() {
      shadow.querySelectorAll("select[data-iris-enhanced='true']").forEach(syncEnhancedSelect);
    }

    function toggleOpeningLimitEntry(show) {
      const select = $("#iris-opening-degree");
      const group = select?.nextElementSibling;
      const entry = $("#iris-opening-limit-fingers-wrap");
      if (!group || !entry) return;
      const limitButton = [...group.querySelectorAll("[data-option-value]")]
        .find((button) => button.dataset.optionValue === "张口受限");
      if (show && limitButton) {
        limitButton.insertAdjacentElement("afterend", entry);
        entry.hidden = false;
      } else {
        group.insertAdjacentElement("afterend", entry);
        entry.hidden = true;
        $("#iris-opening-limit-fingers").value = "";
      }
    }

    function sentenceFromItems(items) {
      const values = items.map((item) => (item || "").trim()).filter(Boolean);
      return values.length ? `${values.join("，")}。` : "";
    }

    function planNumber(index) {
      const names = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
      return names[index] || String(index + 1);
    }

    function createPlan() {
      const card = document.createElement("div");
      card.className = "iris-plan-card";
      card.innerHTML = `
        <div class="iris-plan-head"><b class="iris-plan-title"></b><button type="button" class="iris-remove-button" data-remove-plan>删除</button></div>
        <select class="iris-select iris-plan-type"><option value="">选择矫治类型（可选）</option><option>拔牙矫治</option><option>非拔牙矫治</option></select>
        <textarea class="iris-textarea small iris-plan-text" placeholder="手动填写该方案的治疗计划"></textarea>
      `;
      $("#iris-plan-list").appendChild(card);
      enhanceSelect(card.querySelector(".iris-plan-type"));
      renumberPlans();
    }

    function renumberPlans() {
      [...$("#iris-plan-list").querySelectorAll(".iris-plan-card")].forEach((card, index) => {
        card.querySelector(".iris-plan-title").textContent = `方案${planNumber(index)}`;
        card.querySelector("[data-remove-plan]").hidden = $("#iris-plan-list").children.length === 1;
      });
    }

    function createToothRow(kind) {
      const suffixes = {
        ectopia: "牙位",
        missing: "缺失牙位",
        defect: "牙体缺损牙位",
        micro: "牙体形态异常牙位",
        supernumerary: "多生牙位置",
        "retained-primary": "滞留乳牙牙位",
        crown: "冠修复牙位",
        "oral-openbite": "开合牙位",
        crossbite: "反合牙位",
        lockbite: "正锁合牙位",
        "oral-crossbite": "反合牙位",
        "oral-lockbite": "正锁合牙位"
      };
      const row = document.createElement("div");
      row.className = "iris-dynamic-row";
      row.dataset.kind = kind;
      row.innerHTML = `<input class="iris-input compact" data-tooth placeholder="${suffixes[kind] || "牙位"}" />`;
      if (kind === "ectopia") {
        row.insertAdjacentHTML("beforeend", `<select class="iris-select compact" data-direction><option value="">异位方向</option><option>颊侧</option><option>腭侧</option><option>唇侧</option><option>舌侧</option></select>`);
      }
      row.insertAdjacentHTML("beforeend", `<button type="button" class="iris-remove-button" data-remove-row>删除</button>`);
      $(`[data-row-list="${kind}"]`).appendChild(row);
      enhanceSelect(row.querySelector("[data-direction]"));
    }

    function oralToothGroupLabel(kind) {
      return {
        ectopia: "牙齿异位",
        missing: "牙齿缺失",
        defect: "牙体缺损",
        micro: "牙体形态异常",
        supernumerary: "多生牙",
        "retained-primary": "滞留乳牙",
        crown: "冠修复",
        "oral-openbite": "开合",
        "oral-crossbite": "反合",
        "oral-lockbite": "正锁合"
      }[kind] || "牙位情况";
    }

    function addOralToothGroup(kind) {
      const target = $("#iris-active-tooth-groups");
      let group = target.querySelector(`[data-oral-tooth-group="${kind}"]`);
      if (!group) {
        group = document.createElement("div");
        group.dataset.oralToothGroup = kind;
        group.innerHTML = `<b>${oralToothGroupLabel(kind)}</b><button class="iris-mini-button" type="button" data-add-row="${kind}">＋添加</button><div data-row-list="${kind}"></div>`;
        target.appendChild(group);
        createToothRow(kind);
      }
      group.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return group;
    }

    function toothRowItems(kind, suffix) {
      const rows = [...shadow.querySelectorAll(`.iris-dynamic-row[data-kind="${kind}"]`)];
      return rows.map((row) => {
        const tooth = (row.querySelector("[data-tooth]")?.value || "").trim();
        if (!tooth) {
          if (INITIAL_REQUIRED_VALIDATION_ENABLED) throw new Error(`请填写${row.querySelector("[data-tooth]")?.placeholder || "牙位"}。`);
          return "";
        }
        if (kind === "ectopia") {
          const direction = (row.querySelector("[data-direction]")?.value || "").trim();
          if (!direction) {
            if (INITIAL_REQUIRED_VALIDATION_ENABLED) throw new Error(`请为${tooth}选择异位方向。`);
            return `${tooth}异位`;
          }
          return `${tooth}${direction}异位`;
        }
        if (kind === "supernumerary") return `${tooth}见一多生牙`;
        if (kind === "retained-primary") return `${tooth}乳牙滞留`;
        return `${tooth}${suffix}`;
      });
    }

    function bilateralValue(leftSelector, rightSelector, itemName) {
      const left = formValue(leftSelector);
      const right = formValue(rightSelector);
      if (!left && !right) return [];
      const leftResult = left.replace(new RegExp(`^左侧${itemName}`), "");
      const rightResult = right.replace(new RegExp(`^右侧${itemName}`), "");
      if (leftResult && rightResult && leftResult === rightResult) return [`双侧${itemName}${leftResult}`];
      return [left, right].filter(Boolean);
    }

    function bilateralJawValue(upperSelector, lowerSelector, itemName) {
      const upper = formValue(upperSelector);
      const lower = formValue(lowerSelector);
      if (!upper && !lower) return [];
      if (upper && lower && upper === lower) return [`上下颌${itemName}${upper}`];
      return [upper ? `上颌${itemName}${upper}` : "", lower ? `下颌${itemName}${lower}` : ""].filter(Boolean);
    }

    function currentCrossbiteTypes() {
      return [...shadow.querySelectorAll("[data-crossbite-type].active")].map((button) => button.dataset.crossbiteType);
    }

    function currentLockbiteSelected() {
      return !!shadow.querySelector("[data-lockbite-type].active");
    }

    function combinedToothItems(...groups) {
      return [...new Set(groups.flat().filter(Boolean))];
    }

    function syncCrossbiteType(type, active) {
      shadow.querySelectorAll(`[data-crossbite-type="${type}"]`).forEach((button) => {
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (type === "individual") {
        $("#iris-individual-crossbite-teeth").hidden = !active;
        if (!active) {
          $("[data-row-list=\"crossbite\"]").innerHTML = "";
        }
      }
    }

    function syncLockbite(active) {
      shadow.querySelectorAll("[data-lockbite-type]").forEach((button) => {
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      $("#iris-individual-lockbite-teeth").hidden = !active;
      if (!active) {
        $("[data-row-list=\"lockbite\"]").innerHTML = "";
      }
    }

    function tmjCardHtml(sideLabel) {
      return `
        <div class="iris-tmj-grid">
          <div class="iris-tmj-row-label">检查</div>
          <div class="iris-option-group">
            <button type="button" class="iris-option-button" data-tmj-positive="click">弹响</button>
            <button type="button" class="iris-option-button" data-tmj-positive="pain">疼痛</button>
            <button type="button" class="iris-option-button" data-tmj-positive="palpation">按压痛</button>
          </div>
          <div class="iris-check-row iris-click-positions" hidden>
            <label><input type="checkbox" value="开口初" data-tmj-position />开口初</label>
            <label><input type="checkbox" value="闭口初" data-tmj-position />闭口初</label>
            <label><input type="checkbox" value="开口末" data-tmj-position />开口末</label>
            <label><input type="checkbox" value="闭口末" data-tmj-position />闭口末</label>
          </div>
          <div class="iris-tmj-row-label">病史</div>
          <div class="iris-option-group">
            <button type="button" class="iris-option-button" data-tmj-history="click">弹响史</button>
            <button type="button" class="iris-option-button" data-tmj-history="pain">疼痛史</button>
            <button type="button" class="iris-option-button" data-tmj-history="limit">张口受限史</button>
          </div>
        </div>
      `;
    }

    function renderCephInputs() {
      $("#iris-ceph-values").innerHTML = `<div class="iris-ceph-heading"><span>项目</span><span>正常值</span><span>测量值</span></div>${CEPH_FIELDS.map((field) => `
        <label><span>${field.label}</span><span class="iris-ceph-normal">${field.normal}</span><input class="iris-input compact" data-ceph="${field.key}" inputmode="decimal" placeholder="测量值" /></label>
      `).join("")}`;
    }

    function cephLineMatches(line, key) {
      const patterns = {
        sna: /\bSNA\b/i,
        snb: /\bSNB\b/i,
        anb: /\bANB\b/i,
        wits: /\bWITS\b/i,
        "mp-sn": /MP\s*[-－–—]\s*SN/i,
        fma: /\bFMA\b/i,
        "u1-sn": /U1\s*[-－–—]\s*SN/i,
        "l1-mp": /IMPA|L1\s*[-－–—]\s*MP/i
      };
      if (!patterns[key].test(line)) return false;
      if (key === "l1-mp" && !/IMPA/i.test(line) && /\(\s*mm\s*\)/i.test(line)) return false;
      return true;
    }

    function parseCephTable(sourceText = "") {
      const text = String(sourceText || "").trim();
      if (!text) throw new Error("请先粘贴头侧片测量表。");
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const missing = [];
      CEPH_FIELDS.forEach((field) => {
        const matchingLines = lines.filter((item) => cephLineMatches(item, field.key));
        let line = matchingLines.slice().reverse().find((item) => {
          const afterLabel = item.includes(":") || item.includes("：") ? item.split(/[:：]/).slice(1).join(" ") : item;
          return /[-+]?\d/.test(afterLabel);
        }) || matchingLines.at(-1);
        if (!line && field.key === "u1-sn") {
          const fmaIndex = lines.findIndex((item) => cephLineMatches(item, "fma"));
          const nextKnownIndex = lines.findIndex((item, index) => index > fmaIndex && /U1\s*[-－–—]?\s*NA|U1\s*[-－–—]?\s*NA/i.test(item));
          if (fmaIndex >= 0 && nextKnownIndex > fmaIndex + 1) {
            line = lines.slice(fmaIndex + 1, nextKnownIndex).find((item) => /\d/.test(item)) || "";
          }
        }
        let value = "";
        if (line) {
          const normalizedLine = line.replace(/(?<=\d)\s*[．·]\s*(?=\d)/g, ".");
          const afterLabel = normalizedLine.includes(":") || normalizedLine.includes("：") ? normalizedLine.split(/[:：]/).slice(1).join(" ") : normalizedLine;
          const numbers = afterLabel.match(/[-+]?\d+(?:\.\d+)?/g) || [];
          value = numbers.at(-1) || "";
        }
        const input = $(`[data-ceph="${field.key}"]`);
        if (value) input.value = value;
        else missing.push(field.label);
      });
      return missing;
    }

    async function recognizeCephImage(file) {
      if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || "")) throw new Error("请选择 PNG、JPG 或 WebP 格式的头侧片截图。");
      if (file.size > 8 * 1024 * 1024) throw new Error("图片请控制在 8MB 以内。");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("读取图片失败。"));
        reader.readAsDataURL(file);
      });
      $("#iris-ceph-image-zone").textContent = "正在本地识别图片…";
      const response = await sendToIris({ type: "IRIS_OCR_CEPH", imageData: dataUrl });
      const recognized = String(response.text || "").trim();
      if (!recognized) throw new Error("未能识别图片中的文字，请改用更清晰截图或手动填写。");
      const missing = parseCephTable(recognized);
      $("#iris-ceph-image-zone").textContent = missing.length ? `已自动识别，可补充：${missing.join("、")}` : "已自动识别头侧片固定项目。";
    }

    function buildHistory() {
      const definitions = [
        ["orthodontic", "否认正畸治疗史"],
        ["systemic", "否认系统性疾病史"],
        ["infectious", "否认传染性疾病史"],
        ["genetic", "否认遗传性疾病史"],
        ["allergy", "否认药物过敏史"]
      ];
      const positive = [];
      const negative = [];
      definitions.forEach(([key, negativeText]) => {
        const detail = $(`[data-history-detail="${key}"]`).value.trim();
        if (detail) {
          positive.push(detail.replace(/[。；;]+$/, ""));
        } else {
          negative.push(negativeText);
        }
      });
      return `${[...positive, ...negative].join("，")}。`;
    }

    function buildTmjSide(side, sideLabel) {
      const card = $(`[data-tmj-side="${side}"]`);
      const examinationParts = [];
      const historyParts = [];
      const clicked = card.querySelector('[data-tmj-positive="click"]').classList.contains("active");
      if (clicked) {
        const positions = [...card.querySelectorAll("[data-tmj-position]:checked")].map((input) => input.value);
        examinationParts.push(positions.length ? `${positions.join("、")}弹响` : "弹响");
      }
      if (card.querySelector('[data-tmj-positive="pain"]').classList.contains("active")) examinationParts.push("疼痛");
      if (card.querySelector('[data-tmj-positive="palpation"]').classList.contains("active")) examinationParts.push("按压痛");
      if (!examinationParts.length) examinationParts.push("无弹响、疼痛、按压痛");
      if (card.querySelector('[data-tmj-history="click"]').classList.contains("active")) historyParts.push("有弹响史");
      if (card.querySelector('[data-tmj-history="pain"]').classList.contains("active")) historyParts.push("有疼痛史");
      if (card.querySelector('[data-tmj-history="limit"]').classList.contains("active")) historyParts.push("有张口受限史");
      return `${sideLabel}TMJ${examinationParts.join("、")}${historyParts.length ? `，${historyParts.join("、")}` : ""}`;
    }

    function tmjHasPositiveFinding(side) {
      const card = $(`[data-tmj-side="${side}"]`);
      return [...card.querySelectorAll("[data-tmj-positive].active, [data-tmj-history].active")].length > 0;
    }

    function buildInitialRecord() {
      const patientType = formValue("#iris-patient-type");
      const chiefItems = [...shadow.querySelectorAll("[data-chief-value].active")].map((button) => button.dataset.chiefValue);
      const otherChief = formValue("#iris-chief-other");
      if (otherChief) chiefItems.push(otherChief);
      const chief = chiefItems.join("，");
      if (INITIAL_REQUIRED_VALIDATION_ENABLED && !patientType) throw new Error("请选择儿童或成人。");
      if (INITIAL_REQUIRED_VALIDATION_ENABLED && !chiefItems.length) throw new Error("请至少选择或填写一项主诉。");
      const present = chief && patientType
        ? (patientType === "child"
          ? `患者家属诉患者${chief}，现至我院我科就诊，要求矫治。`
          : `患者自觉${chief}，现至我院我科就诊，要求矫治。`)
        : "";
      const past = buildHistory();

      const activeFaceItems = (selector) => [...shadow.querySelectorAll(`${selector} [data-face-multi-value].active`)]
        .map((button) => button.dataset.faceMultiValue);
      const faceItems = [
        formValue("#iris-face-proportion"), formValue("#iris-face-fullness"), ...activeFaceItems("#iris-face-lips-options"),
        formValue("#iris-face-mouth-line"), formValue("#iris-face-chin"), formValue("#iris-face-profile"),
        formValue("#iris-face-eline"), formValue("#iris-face-labiomental"),
        formValue("#iris-face-mandible"), formValue("#iris-face-other")
      ].filter(Boolean);
      const tmjItems = [
        tmjHasPositiveFinding("left") || tmjHasPositiveFinding("right")
          ? buildTmjSide("left", "左侧")
          : "双侧TMJ无弹响、疼痛、按压痛",
        tmjHasPositiveFinding("left") || tmjHasPositiveFinding("right") ? buildTmjSide("right", "右侧") : "",
        formValue("#iris-opening-degree") === "张口受限"
          ? `${formValue("#iris-opening-degree")}${formValue("#iris-opening-limit-fingers") ? `，张口不足${formValue("#iris-opening-limit-fingers")}横指` : ""}`
          : formValue("#iris-opening-degree"),
        formValue("#iris-opening-path"),
        formValue("#iris-condyle-shape") ? `全景片示双侧髁突形态${formValue("#iris-condyle-shape")}` : "",
        formValue("#iris-tmj-other")
      ].filter(Boolean);

      const oralItems = [
        formValue("#iris-dentition"),
        formValue("#iris-overbite"), formValue("#iris-overjet")
      ].filter(Boolean);
      oralItems.push(...bilateralValue("#iris-canine-left", "#iris-canine-right", "尖牙"));
      oralItems.push(...bilateralValue("#iris-molar-left", "#iris-molar-right", "磨牙"));
      oralItems.push(...bilateralValue("#iris-terminal-plane-left", "#iris-terminal-plane-right", "乳磨牙末端平面"));
      ["upper", "lower"].forEach((jaw) => {
        const selected = shadow.querySelector(`[data-midline="${jaw}"].active`)?.dataset.midlineValue || "";
        const label = jaw === "upper" ? "上颌中线" : "下颌中线";
        if (selected === "正") oralItems.push(`${label}正`);
        if (selected === "左偏" || selected === "右偏") {
          const mm = formValue(`[data-midline-mm="${jaw}"]`);
          if (!mm && INITIAL_REQUIRED_VALIDATION_ENABLED) throw new Error(`${label}${selected}时必须填写偏移毫米数。`);
          oralItems.push(`${label}${selected}${mm ? `${mm}mm` : ""}`);
        }
      });
      oralItems.push(...bilateralJawValue("#iris-upper-jaw-arch", "#iris-lower-jaw-arch", "牙弓"));
      oralItems.push(...bilateralJawValue("#iris-upper-arch", "#iris-lower-arch", "牙列"));
      oralItems.push(...toothRowItems("ectopia", ""));
      oralItems.push(...toothRowItems("missing", "缺失"));
      oralItems.push(...toothRowItems("defect", "牙体缺损"));
      oralItems.push(...toothRowItems("micro", "牙体形态异常"));
      oralItems.push(...toothRowItems("supernumerary", ""));
      oralItems.push(...toothRowItems("retained-primary", ""));
      oralItems.push(...toothRowItems("crown", "冠修复"));
      oralItems.push(...toothRowItems("oral-openbite", "开合"));
      oralItems.push(...toothRowItems("oral-crossbite", "反合"));
      oralItems.push(...toothRowItems("oral-lockbite", "正锁合"));
      const crossbiteTypes = currentCrossbiteTypes();
      oralItems.push(formValue("#iris-hygiene"));
      if ($("#iris-calculus").checked) oralItems.push("可见牙石");
      if ($("#iris-plaque").checked) oralItems.push("可见软垢");
      if ($("#iris-pigment").checked) oralItems.push("可见色素沉着");
      if ($("#iris-gingiva").checked) oralItems.push("部分牙龈红肿");
      oralItems.push(formValue("#iris-oral-other"));

      const examination = [
        faceItems.length ? `面部：${sentenceFromItems(faceItems)}` : "",
        tmjItems.length ? `TMJ：${sentenceFromItems(tmjItems)}` : "",
        oralItems.filter(Boolean).length ? `口内：${sentenceFromItems(oralItems.filter(Boolean))}` : ""
      ].filter(Boolean).join("\n");

      const cephItems = CEPH_FIELDS.map((field) => {
        const value = formValue(`[data-ceph="${field.key}"]`);
        if (!value) return "";
        return `${field.label}=${value}${field.key === "wits" ? "mm" : ""}`;
      }).filter(Boolean);
      const auxiliary = cephItems.join(" ");

      const diagnosisStage = formValue("#iris-diagnosis-stage");
      const angleClass = formValue("#iris-angle-class");
      const skeletalClass = formValue("#iris-skeletal-class");
      const verticalClass = formValue("#iris-vertical-class");
      if (INITIAL_REQUIRED_VALIDATION_ENABLED && (!diagnosisStage || !angleClass || !skeletalClass || !verticalClass)) {
        throw new Error("请完整选择诊断中的牙列期、安氏分类、骨性分类和垂直骨面型。");
      }
      const diagnosisItems = [
        `${diagnosisStage}${angleClass}${skeletalClass}` ? `${diagnosisStage}${angleClass}${skeletalClass}错颌畸形` : "",
        verticalClass,
        formValue("#iris-diagnosis-overbite"),
        formValue("#iris-diagnosis-overjet")
      ];
      if (crossbiteTypes.includes("individual")) {
        const individualTeeth = combinedToothItems(
          toothRowItems("crossbite", "反合")
        );
        diagnosisItems.push(individualTeeth.length ? individualTeeth.join("、") : "个别牙反合");
      }
      if (crossbiteTypes.includes("posterior")) diagnosisItems.push("后牙反合");
      if (crossbiteTypes.includes("full")) diagnosisItems.push("全牙列反合");
      diagnosisItems.push(formValue("#iris-openbite-diagnosis"));
      if (currentLockbiteSelected()) {
        const lockbiteTeeth = combinedToothItems(
          toothRowItems("lockbite", "正锁合")
        );
        diagnosisItems.push(lockbiteTeeth.length ? lockbiteTeeth.join("、") : "个别牙正锁合");
      }
      diagnosisItems.push(formValue("#iris-diagnosis-other"));
      const diagnosis = sentenceFromItems(diagnosisItems.filter(Boolean));

      const planCards = [...$("#iris-plan-list").querySelectorAll(".iris-plan-card")];
      const hasMultiplePlans = planCards.length > 1;
      const plans = planCards.map((card, index) => {
        const type = (card.querySelector(".iris-plan-type").value || "").trim();
        const text = (card.querySelector(".iris-plan-text").value || "").trim();
        if (!hasMultiplePlans && !type && !text) return "";
        const title = hasMultiplePlans ? `治疗方案${planNumber(index)}：` : "治疗方案：";
        return `${title}${type ? `${type}${text ? "\n" : ""}` : ""}${text}`;
      }).filter(Boolean);
      const riskItems = [...shadow.querySelectorAll("[data-initial-risk]:checked")]
        .map((input) => input.parentElement.querySelector("[data-initial-risk-text]")?.value.trim() || "")
        .filter(Boolean);
      const otherRisk = formValue("#iris-risk-other");
      if (otherRisk) riskItems.unshift(otherRisk);
      const plan = [plans.join("\n\n"), riskItems.length ? `矫治风险：\n${riskItems.join("\n")}` : ""]
        .filter(Boolean)
        .join("\n\n");

      return {
        source: "initial-local-template",
        template: "initial-visit",
        chief,
        present,
        past,
        examination,
        auxiliary,
        diagnosis,
        plan,
        treatment: formValue("#iris-initial-treatment") || "今日签署知情同意书。",
        advice: formValue("#iris-initial-advice") || "不适随诊，按约复诊。",
        flags: ["初诊病历已生成，保存前需医生审核。"]
      };
    }

    function clearOutputFields() {
      for (const field of [refs.chiefPreview, refs.presentPreview, refs.pastPreview, refs.exam, refs.auxiliaryPreview, refs.diagnosisPreview, refs.planPreview, refs.treatment, refs.advice]) {
        if (field) {
          field.value = "";
          field.style.removeProperty("height");
        }
      }
      refs.flags.innerHTML = "";
      refs.fill.disabled = true;
      refs.copy.disabled = true;
    }

    function syncVisitMode() {
      const initial = refs.visitMode.value === "initial";
      refs.followupForm.hidden = initial;
      refs.initialForm.hidden = !initial;
      refs.initialPreview.hidden = !initial;
      refs.initialPreviewExtra.hidden = !initial;
      refs.panel.classList.toggle("initial-mode", initial);
      refs.title.textContent = initial ? "Iris 正畸初诊病历助手" : "Iris 正畸复诊病历助手";
      repositionPanelAfterLayout();
      state.record = null;
      clearOutputFields();
      setInitialStatus("");
      setStatus(initial ? "请按顺序填写初诊模板。" : "");
    }

    function resetInitialForm() {
      refs.initialForm.reset();
      shadow.querySelectorAll("[data-chief-value]").forEach((button) => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      });
      shadow.querySelectorAll("[data-face-multi-value]").forEach((button) => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      });
      shadow.querySelectorAll("[data-tmj-positive], [data-tmj-history], [data-crossbite-type], [data-lockbite-type], [data-oral-tooth-kind]").forEach((button) => {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      });
      shadow.querySelectorAll("[data-midline]").forEach((button) => {
        button.hidden = false;
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
      });
      shadow.querySelectorAll(".iris-click-positions, #iris-opening-limit-fingers-wrap, #iris-individual-crossbite-teeth, #iris-individual-lockbite-teeth, [data-midline-entry], .iris-terminal-plane-control").forEach((element) => { element.hidden = true; });
      shadow.querySelectorAll("[data-history-deny]").forEach((button) => {
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
      });
      shadow.querySelectorAll("[data-row-list]").forEach((list) => { list.innerHTML = ""; });
      $("#iris-active-tooth-groups").innerHTML = "";
      $("#iris-plan-list").innerHTML = "";
      CEPH_FIELDS.forEach((field) => { $(`[data-ceph="${field.key}"]`).value = ""; });
      createPlan();
      syncAllEnhancedSelects();
      toggleOpeningLimitEntry(false);
      state.record = null;
      setInitialStatus("");
      clearOutputFields();
    }

    function initializeInitialForm() {
      $(`[data-tmj-side="left"]`).insertAdjacentHTML("beforeend", tmjCardHtml("左侧"));
      $(`[data-tmj-side="right"]`).insertAdjacentHTML("beforeend", tmjCardHtml("右侧"));
      renderCephInputs();
      createPlan();
      shadow.querySelectorAll(".iris-select").forEach(enhanceSelect);
      toggleOpeningLimitEntry(false);
    }

    function currentRecord() {
      const isInitial = state.record?.template === "initial-visit";
      return {
        template: state.record?.template || "",
        chief: isInitial ? refs.chiefPreview.value.trim() : (state.record?.chief || ""),
        present: isInitial ? refs.presentPreview.value.trim() : (state.record?.present || ""),
        past: isInitial ? refs.pastPreview.value.trim() : (state.record?.past || ""),
        auxiliary: isInitial ? refs.auxiliaryPreview.value.trim() : (state.record?.auxiliary || ""),
        diagnosis: isInitial ? refs.diagnosisPreview.value.trim() : (state.record?.diagnosis || ""),
        plan: isInitial ? refs.planPreview.value.trim() : (state.record?.plan || ""),
        examination: refs.exam.value.trim(),
        treatment: refs.treatment.value.trim(),
        advice: refs.advice.value.trim(),
        flags: [...refs.flags.querySelectorAll("li")].map((li) => li.textContent)
      };
    }

    function formatRecord(record) {
      if (record.template === "initial-visit") {
        return [
          ["主诉", record.chief], ["现病史", record.present], ["既往史", record.past],
          ["口腔检查", record.examination], ["辅助检查", record.auxiliary], ["诊断", record.diagnosis],
          ["治疗计划", record.plan], ["处置", record.treatment], ["医嘱", record.advice]
        ].map(([label, value]) => `【${label}】\n${value || ""}`).join("\n\n");
      }
      return `【检查】\n${record.examination || ""}\n\n【处置】\n${record.treatment || ""}\n\n【医嘱】\n${record.advice || ""}`;
    }

    function adviceWithFixedBase(advice) {
      const noFollowupDefault = state.record?.template === "retainer-followup" || state.record?.template === "initial-visit";
      const fixedAdvice = noFollowupDefault ? "" : FOLLOWUP_FIXED.advice;
      const parts = [advice, fixedAdvice]
        .map((item) => (item || "").trim())
        .filter(Boolean);
      return [...new Set(parts)].join("\n");
    }

    function renderRecord(record) {
      state.record = record;
      const isInitial = record.template === "initial-visit";
      refs.chiefPreview.value = isInitial ? (record.chief || "") : "";
      refs.presentPreview.value = isInitial ? (record.present || "") : "";
      refs.pastPreview.value = isInitial ? (record.past || "") : "";
      refs.exam.value = record.examination || "";
      refs.auxiliaryPreview.value = isInitial ? (record.auxiliary || "") : "";
      refs.diagnosisPreview.value = isInitial ? (record.diagnosis || "") : "";
      refs.planPreview.value = isInitial ? (record.plan || "") : "";
      refs.treatment.value = record.treatment || "";
      refs.advice.value = adviceWithFixedBase(record.advice);
      [refs.chiefPreview, refs.presentPreview, refs.pastPreview, refs.exam, refs.auxiliaryPreview, refs.diagnosisPreview, refs.planPreview, refs.treatment, refs.advice]
        .filter(Boolean)
        .forEach((field) => {
          field.style.height = "auto";
          field.style.height = `${field.scrollHeight}px`;
        });
      refs.flags.innerHTML = "";
      (record.flags || []).forEach((flag) => {
        const li = document.createElement("li");
        li.textContent = flag;
        refs.flags.appendChild(li);
      });
      refs.fill.disabled = false;
      refs.copy.disabled = false;
    }

    function resetIrisDraft({ closePanel = false, status = "" } = {}) {
      if (state.recognition && state.recognizing) state.recognition.stop();
      state.record = null;
      state.finalSpeech = "";
      refs.notes.value = "";
      if (refs.visitMode.value === "initial") resetInitialForm();
      else clearOutputFields();
      setStatus(status);
      if (closePanel) refs.panel.classList.remove("open");
    }

    // 填入 E看牙 成功后立即收起悬浮窗（不重置草稿，state.record 保留，医生可随时点开回看）。
    // 失败时不收起，让医生看到错误并原地修正。
    // 后续点击「完成治疗」仍会 resetIrisDraft({closePanel:true})，用于跨患者清空草稿。
    function closePanelAfterFill() {
      refs.panel.classList.remove("open");
    }

    function isFinishTreatmentClick(event) {
      if (host.contains(event.target)) return false;
      const clickable = event.target.closest?.("button, a, .btn, [role='button'], input[type='button'], input[type='submit']");
      if (!clickable) return false;
      const text = (clickable.innerText || clickable.textContent || clickable.value || clickable.title || "").replace(/\s+/g, "");
      return text === "完成治疗";
    }

    function setupAutoResetAfterFinish() {
      document.addEventListener("click", (event) => {
        if (!isFinishTreatmentClick(event)) return;
        window.setTimeout(() => {
          resetIrisDraft({ closePanel: true });
        }, 600);
      }, true);
    }

    function setValue(el, value) {
      el.scrollIntoView({ block: "center", inline: "center" });
      el.focus();
      if (el.matches("textarea, input")) {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
      } else {
        el.innerText = value;
        el.textContent = value;
      }
      for (const name of ["input", "change", "keyup", "blur"]) {
        el.dispatchEvent(new Event(name, { bubbles: true }));
      }
    }

    function visible(el) {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 30 && rect.height > 12;
    }

    function textOf(el) {
      return ((el && (el.innerText || el.textContent || el.value || el.placeholder || el.getAttribute("aria-label") || el.title)) || "").replace(/\s+/g, "");
    }

    function readableTextOf(el) {
      return ((el && (el.innerText || el.textContent || "")) || "").replace(/\r/g, "\n");
    }

    function previousRecordSourceDocuments() {
      const sources = [{ doc: document, rightPanelOnly: true }];
      for (const frame of document.querySelectorAll("iframe")) {
        try {
          const frameDoc = frame.contentDocument || frame.contentWindow?.document;
          const frameText = frameDoc?.body?.innerText || "";
          if (!frameDoc?.body || !/病历记录|病历详情|主诉|现病史|既往史|诊断|治疗计划/.test(frameText)) continue;
          sources.push({ doc: frameDoc, rightPanelOnly: false });
        } catch {
          // Cross-origin helper frames cannot be read; E看牙病历记录同源 iframe 可读取。
        }
      }
      return sources;
    }

    function previousRecordDetailTextFromDocument(rootDoc, rightPanelOnly) {
      const labels = ["主诉", "现病史", "既往史", "口腔检查", "辅助检查", "诊断", "治疗计划", "处置", "医嘱", "备注"];
      const labelPattern = new RegExp(`(${labels.join("|")})[:：]`, "g");
      const bodyText = readableTextOf(rootDoc.body).trim();
      if (!rightPanelOnly && /病历记录|病历详情/.test(bodyText)) return bodyText;
      const rootWindow = rootDoc.defaultView || window;
      const items = [...rootDoc.querySelectorAll("body *")]
        .filter((el) => rootDoc !== document || !host.contains(el))
        .filter(visible)
        .map((el) => ({ el, text: readableTextOf(el), rect: el.getBoundingClientRect() }))
        .filter((item) => {
          const text = item.text.trim();
          if (!text) return false;
          if (rightPanelOnly && item.rect.left < rootWindow.innerWidth * 0.58) return false;
          if (item.rect.width < 24 || item.rect.width > 680) return false;
          if (rightPanelOnly && item.rect.top < 120) return false;
          const labelCount = (text.match(labelPattern) || []).length;
          if (text.length > 260 && labelCount > 1) return false;
          if (text.length > 520) return false;
          return /病历详情|主诉|现病史|既往史|口腔检查|辅助检查|诊断|治疗计划|处置|医嘱|备注|面型|牙型|骨型/.test(text);
        })
        .sort((a, b) => {
          if (Math.abs(a.rect.top - b.rect.top) > 4) return a.rect.top - b.rect.top;
          return a.rect.left - b.rect.left;
        });
      const lines = [];
      const seen = new Set();
      for (const item of items) {
        const itemLines = item.text
          .split(/\n+/)
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        for (const line of itemLines) {
          const key = `${Math.round(item.rect.top / 3)}:${line}`;
          if (seen.has(key)) continue;
          if (lines[lines.length - 1] === line) continue;
          seen.add(key);
          lines.push(line);
        }
      }
      return lines.join("\n");
    }

    function previousRecordDetailText() {
      const texts = previousRecordSourceDocuments()
        .map((source) => previousRecordDetailTextFromDocument(source.doc, source.rightPanelOnly))
        .filter(Boolean);
      return texts.join("\n");
    }

    function cleanPreviousRecordSection(text) {
      return text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !/^[-+—_｜|]+$/.test(line))
        .join("\n")
        .trim();
    }

    function splitPreviousRecordChunks(text) {
      const chunks = [];
      let current = [];
      for (const line of text.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
        const startsRecord = !!recordDateFromText(line) || line === "病历详情";
        if (startsRecord && current.length) {
          chunks.push(current.join("\n"));
          current = [];
        }
        current.push(line);
      }
      if (current.length) chunks.push(current.join("\n"));
      return chunks.length ? chunks : [text];
    }

    function recordSectionFromText(text, label) {
      const labels = ["主诉", "现病史", "既往史", "口腔检查", "辅助检查", "诊断", "治疗计划", "处置", "医嘱", "备注"];
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const result = [];
      let capturing = false;
      for (const line of lines) {
        const match = line.match(/^(.{1,8}?)[\s　]*[:：]\s*(.*)$/);
        const pureLabel = labels.find((item) => line === item || line === `${item}:` || line === `${item}：`);
        const matchedLabel = match && labels.includes(match[1]) ? match[1] : pureLabel;
        if (matchedLabel) {
          if (capturing) break;
          if (matchedLabel === label) {
            capturing = true;
            if (match?.[2]) result.push(match[2]);
          }
          continue;
        }
        if (capturing) result.push(line);
      }
      return cleanPreviousRecordSection(result.join("\n"));
    }

    function isOrthodonticFollowupRecord(text) {
      const normalize = (value) => value.replace(/[，,。.;；\s]/g, "");
      const chief = normalize(recordSectionFromText(text, "主诉"));
      const present = normalize(recordSectionFromText(text, "现病史"));
      const past = normalize(recordSectionFromText(text, "既往史"));
      const fixedFollowup = chief === FOLLOWUP_FIXED.chief
        && present === FOLLOWUP_FIXED.present
        && past.includes("体健")
        && past.includes("无特殊")
        && past.includes("否认系统性病史");
      if (fixedFollowup) return true;

      const legacyChief = /^(复查|复诊|矫正复查|矫正复诊|正畸复查|正畸复诊)$/.test(chief);
      const legacyPresent = /(矫正|矫治|正畸)/.test(present) && /(复查|复诊|到院|来院)/.test(present);
      const legacyPast = /(体健|否认|系统性疾病|系统性病史|无正畸治疗史|药物过敏史|家族遗传史)/.test(past);
      if (legacyChief && legacyPresent && legacyPast) return true;

      const diagnosis = normalize(recordSectionFromText(text, "诊断"));
      const plan = normalize(recordSectionFromText(text, "治疗计划"));
      const orthodonticDiagnosis = /(面型|牙型|骨型|安氏|拥挤|均角|高角|低角|I类|II类|III类|Ⅰ类|Ⅱ类|Ⅲ类)/.test(diagnosis);
      const orthodonticPlan = /(矫治|正畸|拔牙|排齐|整平|关闭间隙|调整咬合|矫治器|牙套)/.test(plan);
      return legacyChief && (legacyPresent || orthodonticDiagnosis || orthodonticPlan) && (orthodonticDiagnosis || orthodonticPlan);
    }

    function previousRecordSummary(text) {
      const compact = (value) => (value || "").replace(/\s+/g, "").slice(0, 28);
      return {
        chief: compact(recordSectionFromText(text, "主诉")),
        present: compact(recordSectionFromText(text, "现病史")),
        past: compact(recordSectionFromText(text, "既往史")),
        diagnosis: compact(recordSectionFromText(text, "诊断")),
        plan: compact(recordSectionFromText(text, "治疗计划")),
        isOrthodontic: isOrthodonticFollowupRecord(text)
      };
    }

    function isLikelyOrthodonticFollowupWithoutPlan(text) {
      const normalize = (value) => value.replace(/[，,。.;；\s]/g, "");
      const chief = normalize(recordSectionFromText(text, "主诉"));
      const present = normalize(recordSectionFromText(text, "现病史"));
      const past = normalize(recordSectionFromText(text, "既往史"));
      const legacyChief = /^(复查|复诊|矫正复查|矫正复诊|正畸复查|正畸复诊)$/.test(chief);
      const legacyPresent = /(矫正|矫治|正畸)/.test(present) && /(复查|复诊|到院|来院)/.test(present);
      const legacyPast = /(体健|否认|系统性疾病|系统性病史|无正畸治疗史|药物过敏史|家族遗传史)/.test(past);
      return legacyChief && legacyPresent && legacyPast;
    }

    function previousFollowupRecordText() {
      const text = previousRecordDetailText();
      if (!text) return "";
      return splitPreviousRecordChunks(text).find(isOrthodonticFollowupRecord) || "";
    }

    function previousFollowupRecordFromVisibleText() {
      const text = previousRecordDetailText();
      if (!text) return null;
      const chunk = splitPreviousRecordChunks(text).find(isOrthodonticFollowupRecord);
      return chunk ? { text: chunk, source: "当前展开病历" } : null;
    }

    function recordDateFromText(text) {
      return (text || "").match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0] || "";
    }

    function clickableHistoryTarget(el) {
      return el.closest?.([
        "button",
        "a",
        "[role='button']",
        "[onclick]",
        "[ng-click]",
        "[data-ng-click]",
        "li",
        "[class*='header']",
        "[class*='title']",
        "[class*='collapse']",
        "[class*='record']",
        "[class*='history']",
        "[class*='item']"
      ].join(",")) || el;
    }

    async function realisticClick(el, point = null) {
      if (!el) return null;
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
      await sleep(120);
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const rect = el.getBoundingClientRect();
      const x = point?.x ?? Math.round(rect.left + rect.width / 2);
      const y = point?.y ?? Math.round(rect.top + rect.height / 2);
      const target = doc.elementFromPoint?.(x, y) || el;
      try {
        el.click?.();
        target.click?.();
      } catch {
        // Continue with event dispatch below.
      }
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: win,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0
        }));
      }
      try {
        HTMLElement.prototype.click.call(target);
      } catch {
        // Some SVG or framework nodes are not HTMLElements.
      }
      return target;
    }

    function uniqueElements(items) {
      const result = [];
      const seen = new Set();
      for (const item of items) {
        if (!item || seen.has(item)) continue;
        seen.add(item);
        result.push(item);
      }
      return result;
    }

    function historyClickTargets(item) {
      const targets = [item.clickTarget, item.el];
      let node = item.el;
      for (let i = 0; node && i < 5; i += 1, node = node.parentElement) {
        const text = readableTextOf(node).replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        if (text.includes(item.dateText) && rect.height <= 140 && rect.width <= 860) {
          targets.push(node);
          if (node.previousElementSibling) targets.push(node.previousElementSibling);
          if (node.firstElementChild) targets.push(node.firstElementChild);
          targets.push(...node.querySelectorAll?.("button,a,[role='button'],[onclick],[ng-click],[data-ng-click],span,div") || []);
        }
      }
      return uniqueElements(targets).filter((target) => {
        if (!visible(target)) return false;
        const rect = target.getBoundingClientRect();
        if (rect.width < 6 || rect.height < 6) return false;
        if (rect.width > 900 || rect.height > 170) return false;
        const targetText = readableTextOf(target).replace(/\s+/g, " ").trim();
        const sameRow = rowOverlap(rect, item.rect) > 0 || verticalDistance(rect, item.rect) <= 34;
        return targetText.includes(item.dateText) || sameRow;
      });
    }

    function describeElement(el) {
      if (!el) return "空";
      const cls = typeof el.className === "string" ? el.className : "";
      const text = readableTextOf(el).replace(/\s+/g, " ").trim().slice(0, 18);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : ""}:${text}`;
    }

    function historyRowElement(item) {
      let best = item.clickTarget || item.el;
      let node = item.el;
      for (let i = 0; node && i < 8; i += 1, node = node.parentElement) {
        const text = readableTextOf(node).replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        if (!text.includes(item.dateText)) continue;
        if (rect.height < 14 || rect.height > 92) continue;
        if (rect.width < item.rect.width || rect.width > 780) continue;
        best = node;
      }
      return best;
    }

    function previousRecordDateCandidates() {
      const seen = new Set();
      return previousRecordSourceDocuments()
        .flatMap((source) => {
          const rootDoc = source.doc;
          const rootWindow = rootDoc.defaultView || window;
          return [...rootDoc.querySelectorAll("body *")]
            .filter((el) => rootDoc !== document || !host.contains(el))
            .filter(visible)
            .map((el) => ({ el, source, text: readableTextOf(el).replace(/\s+/g, " ").trim(), rect: el.getBoundingClientRect(), rootWindow }))
            .filter((item) => {
              if (source.rightPanelOnly && item.rect.left < rootWindow.innerWidth * 0.58) return false;
              if (item.rect.top < 100) return false;
              if (item.rect.width < 70 || item.rect.width > 620) return false;
              if (item.rect.height < 12 || item.rect.height > 90) return false;
              return !!recordDateFromText(item.text);
            });
        })
        .sort((a, b) => {
          if (Math.abs(a.rect.top - b.rect.top) > 4) return a.rect.top - b.rect.top;
          return a.rect.left - b.rect.left;
        })
        .filter((item) => {
          item.dateText = recordDateFromText(item.text);
          item.clickTarget = clickableHistoryTarget(item.el);
          const key = item.dateText;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }

    function rightHistoryScrollContainers() {
      return previousRecordSourceDocuments()
        .flatMap((source) => {
          const rootDoc = source.doc;
          const rootWindow = rootDoc.defaultView || window;
          return [...rootDoc.querySelectorAll("body *")]
            .filter((el) => rootDoc !== document || !host.contains(el))
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              if (source.rightPanelOnly && rect.left < rootWindow.innerWidth * 0.58) return false;
              if (rect.top < 80) return false;
              if (rect.width < 100 || rect.height < 120) return false;
              if (el.scrollHeight <= el.clientHeight + 40) return false;
              const text = readableTextOf(el);
              return /病历记录|病历详情|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text);
            });
        })
        .sort((a, b) => (a.getBoundingClientRect().width - b.getBoundingClientRect().width));
    }

    function nearestScrollableContainer(el) {
      let node = el?.parentElement;
      while (node && node !== el.ownerDocument.body) {
        if (node.scrollHeight > node.clientHeight + 20) return node;
        node = node.parentElement;
      }
      return el?.ownerDocument?.scrollingElement || document.scrollingElement || document.documentElement;
    }

    function scrollHistoryDateToTop(dateText) {
      if (!dateText) return false;
      const item = previousRecordDateCandidates().find((candidate) => candidate.dateText === dateText);
      if (!item) return false;
      const row = historyRowElement(item);
      const containers = rightHistoryScrollContainers()
        .filter((container) => container.ownerDocument === row.ownerDocument && container.contains(row));
      const container = containers[0] || nearestScrollableContainer(row);
      if (!container) return false;
      const rowRect = row.getBoundingClientRect();
      const containerRect = container === row.ownerDocument.scrollingElement
        ? { top: 0 }
        : container.getBoundingClientRect();
      container.scrollTop += rowRect.top - containerRect.top - 6;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      return true;
    }

    async function waitForPreviousRecordTextChange(beforeText) {
      for (let i = 0; i < 8; i += 1) {
        await sleep(180);
        const afterText = previousRecordDetailText();
        if (afterText && afterText !== beforeText) return afterText;
      }
      return previousRecordDetailText();
    }

    function historyPanelText() {
      return previousRecordSourceDocuments()
        .map((source) => readableTextOf(source.doc.body))
        .join("\n");
    }

    function isHistoryLoading() {
      return /正在加载|加载中|loading/i.test(historyPanelText());
    }

    async function waitForHistoryReady(beforeText) {
      let latest = previousRecordDetailText();
      for (let i = 0; i < 24; i += 1) {
        await sleep(180);
        latest = previousRecordDetailText();
        if (!isHistoryLoading() && latest && latest !== beforeText) return latest;
      }
      for (let i = 0; i < 12; i += 1) {
        if (!isHistoryLoading()) break;
        await sleep(250);
      }
      return previousRecordDetailText();
    }

    async function scrollCurrentHistoryDetailForPlan(dateText) {
      const targets = rightHistoryScrollContainers();
      const scrollTargets = targets.length ? targets : [document.scrollingElement || document.documentElement];
      let bestText = previousRecordDetailText();
      for (let i = 0; i < 8; i += 1) {
        const chunks = splitPreviousRecordChunks(bestText);
        const chunk = chunks.find((item) => !dateText || item.includes(dateText)) || chunks.find(isLikelyOrthodonticFollowupWithoutPlan) || "";
        if (chunk && recordSectionFromText(chunk, "诊断") && recordSectionFromText(chunk, "治疗计划")) return chunk;
        const before = scrollTargets.map((el) => el.scrollTop).join("|");
        scrollTargets.forEach((el) => {
          el.scrollTop += Math.max(180, Math.floor(el.clientHeight * 0.65));
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await sleep(220);
        bestText = previousRecordDetailText();
        const after = scrollTargets.map((el) => el.scrollTop).join("|");
        if (before === after) break;
      }
      const chunks = splitPreviousRecordChunks(bestText);
      return chunks.find((item) => (!dateText || item.includes(dateText)) && isOrthodonticFollowupRecord(item))
        || chunks.find(isOrthodonticFollowupRecord)
        || "";
    }

    async function findPreviousFollowupRecord() {
      const visibleRecord = previousFollowupRecordFromVisibleText();
      if (visibleRecord) {
        const summary = previousRecordSummary(visibleRecord.text);
        setHistoryDebug([`当前展开病历匹配`, `主诉=${summary.chief}`, `诊断=${summary.diagnosis || "空"}`, `治疗计划=${summary.plan || "空"}`]);
        return { ...visibleRecord, checked: 0, debug: state.lastHistoryDebug };
      }

      let checked = 0;
      const checkedDates = new Set();
      const checkedLabels = [];
      const clickSummaries = [];
      const firstText = previousRecordDetailText();
      const firstSummary = firstText ? previousRecordSummary(firstText) : null;
      const firstChunkCount = firstText ? splitPreviousRecordChunks(firstText).length : 0;
      const containers = rightHistoryScrollContainers();
      const scrollTargets = containers.length ? containers : [document.scrollingElement || document.documentElement];
      for (let pass = 0; pass < 8 && checked < 18; pass += 1) {
        const candidates = previousRecordDateCandidates().filter((item) => !checkedDates.has(item.dateText));
        if (pass === 0) {
          setHistoryDebug([
            `当前展开病历未匹配`,
            firstSummary ? `主诉=${firstSummary.chief || "空"}` : "未读到详情",
            firstSummary ? `现病史=${firstSummary.present || "空"}` : "",
            `可见病历片段=${firstChunkCount}`,
            `候选日期=${candidates.length}`,
            `滚动容器=${containers.length}`
          ]);
        }
        for (const item of candidates) {
          if (checked >= 18) break;
          checkedDates.add(item.dateText);
          checked += 1;
          checkedLabels.push(item.dateText);
          if (/^[^\d]*(▲|▴|▵|△)/.test(item.text) && previousRecordDetailText()) {
            continue;
          }
          try {
            const row = historyRowElement(item);
            const targets = historyClickTargets(item);
            if (!targets.includes(row)) targets.unshift(row);
            let afterText = previousRecordDetailText();
            let clickedDescription = "";
            for (const target of targets.slice(0, 8)) {
              const beforeText = previousRecordDetailText();
              const actualTarget = await realisticClick(target);
              clickedDescription = `${describeElement(target)}=>${describeElement(actualTarget)}`;
              afterText = await waitForHistoryReady(beforeText);
              if (isHistoryLoading()) {
                setHistoryDebug([`打开${item.dateText}后仍在加载`, `已检查=${checked}`, `点击=${clickedDescription}`, `停止继续点击，避免重复加载`]);
                return { text: "", source: "", checked, debug: state.lastHistoryDebug };
              }
              const openedRecord = previousFollowupRecordFromVisibleText();
              if (openedRecord) {
                const summary = previousRecordSummary(openedRecord.text);
                scrollHistoryDateToTop(item.dateText);
                setHistoryDebug([`找到正畸复诊病历=${item.dateText}`, `已检查=${checked}`, `点击=${clickedDescription}`, `诊断=${summary.diagnosis || "空"}`, `治疗计划=${summary.plan || "空"}`]);
                return {
                  ...openedRecord,
                  source: item.dateText,
                  checked,
                  debug: state.lastHistoryDebug
                };
              }
              if (afterText && afterText !== beforeText) break;
              await sleep(120);
            }
            const openedChunks = splitPreviousRecordChunks(afterText);
            const currentChunk = openedChunks.find((chunk) => chunk.includes(item.dateText)) || "";
            if (currentChunk && isLikelyOrthodonticFollowupWithoutPlan(currentChunk)) {
              const fullChunk = await scrollCurrentHistoryDetailForPlan(item.dateText);
              if (fullChunk && isOrthodonticFollowupRecord(fullChunk)) {
                const summary = previousRecordSummary(fullChunk);
                scrollHistoryDateToTop(item.dateText);
                setHistoryDebug([`补全并识别正畸复诊病历=${item.dateText}`, `已检查=${checked}`, `点击=${clickedDescription}`, `诊断=${summary.diagnosis || "空"}`, `治疗计划=${summary.plan || "空"}`]);
                return {
                  text: fullChunk,
                  source: item.dateText,
                  checked,
                  debug: state.lastHistoryDebug
                };
              }
            }
            if (clickSummaries.length < 4) {
              const afterSummary = afterText ? previousRecordSummary(afterText) : null;
              clickSummaries.push(`${item.dateText}/${clickedDescription || "未点击"}->${afterSummary?.chief || "空"}`);
            }
          } catch {
            // Ignore individual history-row failures and continue checking older rows.
          }
        }
        const beforeScroll = scrollTargets.map((el) => el.scrollTop).join("|");
        scrollTargets.forEach((el) => {
          el.scrollTop += Math.max(160, Math.floor(el.clientHeight * 0.8));
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await sleep(350);
        const afterScroll = scrollTargets.map((el) => el.scrollTop).join("|");
        if (beforeScroll === afterScroll && !previousRecordDateCandidates().some((item) => !checkedDates.has(item.dateText))) break;
      }
      setHistoryDebug([
        `未找到正畸复诊病历`,
        firstSummary ? `当前主诉=${firstSummary.chief || "空"}` : "当前详情=空",
        firstSummary ? `当前现病史=${firstSummary.present || "空"}` : "",
        `可见病历片段=${firstChunkCount}`,
        `已检查=${checked}`,
        `候选=${checkedLabels.slice(0, 6).join("、") || "无"}`,
        clickSummaries.length ? `点击后=${clickSummaries.join("；")}` : "",
        `滚动容器=${containers.length}`
      ]);
      return { text: "", source: "", checked, debug: state.lastHistoryDebug };
    }

    function previousRecordSection(label) {
      const text = previousFollowupRecordText();
      if (!text) return "";
      return recordSectionFromText(text, label);
    }

    function fieldText(el) {
      const parts = [textOf(el), textOf(el.closest("label"))];
      let node = el;
      for (let i = 0; node && i < 5; i += 1, node = node.parentElement) {
        parts.push(textOf(node));
        if (node.previousElementSibling) parts.push(textOf(node.previousElementSibling));
      }
      return parts.join("|");
    }

    function textFields() {
      return [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], .ql-editor, .w-e-text')]
        .filter((el) => !host.contains(el))
        .filter(visible)
        .filter((el) => !/search|搜索|查询|手机号|电话|姓名|编号|验证码|账号|密码/.test(fieldText(el)));
    }

    function emrTextAreasByFixedOrder() {
      const textareas = [...document.querySelectorAll("textarea, [contenteditable='true'], .ql-editor, .w-e-text")]
        .filter((el) => !host.contains(el))
        .filter(visible)
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter((item) => {
          if (item.rect.left < 180) return false;
          if (item.rect.width < 260 || item.rect.height < 24) return false;
          return !/搜索|查询|姓名|手机|病历号/.test(fieldText(item.el));
        })
        .sort((a, b) => {
          if (Math.abs(a.rect.top - b.rect.top) > 8) return a.rect.top - b.rect.top;
          return a.rect.left - b.rect.left;
        })
        .map((item) => item.el);
      return textareas;
    }

    function findEkanyaEmrFieldsByFixedOrder() {
      const textareas = emrTextAreasByFixedOrder();
      if (textareas.length < 9) return null;
      return {
        fields: textareas,
        chief: textareas[0],
        present: textareas[1],
        past: textareas[2],
        exam: textareas[3],
        auxiliary: textareas[4],
        diagnosis: textareas[5],
        plan: textareas[6],
        treatment: textareas[7],
        advice: textareas[8],
        source: "fixed-order"
      };
    }

    function isEmrEditPage() {
      return /\/emr\/edit/i.test(location.hash || location.href);
    }

    function centerY(rect) {
      return rect.top + rect.height / 2;
    }

    function verticalDistance(a, b) {
      return Math.abs(centerY(a) - centerY(b));
    }

    function rowOverlap(a, b) {
      return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    }

    function labelCandidates(labels) {
      return [...document.querySelectorAll("body *")]
        .filter((el) => !host.contains(el))
        .filter((el) => !el.matches("textarea, input, select, option, button, [contenteditable='true']"))
        .filter(visible)
        .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
        .filter((item) => {
          if (!item.text || item.text.length > 24) return false;
          if (item.rect.width > 240 || item.rect.height > 72) return false;
          if (item.rect.left < 180) return false;
          return labels.some((label) => item.text === label);
        })
        .sort((a, b) => {
          const exactA = labels.some((label) => a.text === label) ? 0 : 1;
          const exactB = labels.some((label) => b.text === label) ? 0 : 1;
          if (exactA !== exactB) return exactA - exactB;
          return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
        });
    }

    function findFieldInNearbyContainer(labelEl, fields) {
      const labelRect = labelEl.getBoundingClientRect();
      let node = labelEl;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const nodeRect = node.getBoundingClientRect();
        const rowLike = nodeRect.height <= 120 || rowOverlap(labelRect, nodeRect) > 0;
        if (rowLike) {
          const inside = fields.find((field) => {
            if (!node.contains(field) || field === labelEl) return false;
            const fieldRect = field.getBoundingClientRect();
            return fieldRect.left > labelRect.right - 12 && verticalDistance(labelRect, fieldRect) <= 38;
          });
          if (inside) return inside;
        }
        const next = node.nextElementSibling;
        if (next) {
          const inNext = fields.find((field) => {
            if (!(next.contains(field) || field === next)) return false;
            const fieldRect = field.getBoundingClientRect();
            return fieldRect.left > labelRect.right - 12 && verticalDistance(labelRect, fieldRect) <= 38;
          });
          if (inNext) return inNext;
        }
      }
      return null;
    }

    function findFieldByRowLabel(labels, fields, used = new Set()) {
      const candidates = labelCandidates(labels);
      for (const candidate of candidates) {
        const labelRect = candidate.rect;
        const nearby = findFieldInNearbyContainer(candidate.el, fields.filter((field) => !used.has(field)));
        if (nearby) return nearby;

        const rowFields = fields
          .filter((field) => !used.has(field))
          .map((field) => ({ field, rect: field.getBoundingClientRect() }))
          .filter((item) => {
            if (item.rect.left < labelRect.right - 12) return false;
            const sameRow = rowOverlap(labelRect, item.rect) > 0 || verticalDistance(labelRect, item.rect) <= 30;
            return sameRow && item.rect.left - labelRect.right < 900;
          })
          .sort((a, b) => {
            const rowDelta = verticalDistance(labelRect, a.rect) - verticalDistance(labelRect, b.rect);
            if (Math.abs(rowDelta) > 2) return rowDelta;
            return a.rect.left - b.rect.left;
          });
        if (rowFields[0]) return rowFields[0].field;
      }
      return null;
    }

    function findEkanyaEmrFields() {
      const fixed = findEkanyaEmrFieldsByFixedOrder();
      if (fixed) return fixed;

      const fields = textFields();
      const used = new Set();
      const exam = findFieldByRowLabel(["口腔检查"], fields, used);
      if (exam) used.add(exam);
      const treatment = findFieldByRowLabel(["处置"], fields, used);
      if (treatment) used.add(treatment);
      const advice = findFieldByRowLabel(["医嘱"], fields, used);
      if (advice) used.add(advice);
      return { fields, exam, treatment, advice };
    }

    function canFillCurrentPage() {
      if (isLoginPage()) return false;
      const { fields, exam, treatment, advice } = findEkanyaEmrFields();
      if (exam || treatment || advice) return true;
      // E看牙初诊编辑页会按折叠区/滚动区域延后挂载文本框；在该页保留填入按钮，
      // 点击时再重新定位字段，避免已生成病历被误判为不可填入。
      if (isEmrEditPage()) return true;
      return fields.some((el) => /病历|病程|复诊|检查|处置|治疗|医嘱|记录/.test(fieldText(el))) || fields.length === 1;
    }

    function syncPageVisibility() {
      const onLogin = isLoginPage();
      refs.launcher.style.display = onLogin ? "none" : "block";
      if (onLogin) refs.panel.classList.remove("open");
    }

    async function fillEkanya() {
      const record = currentRecord();
      const combined = formatRecord(record);
      const { fields, chief, present, past, exam, auxiliary, diagnosis, plan, treatment, advice } = findEkanyaEmrFields();
      if (!fields.length) {
        return { ok: false, message: "未找到可填入的病历文本框。请打开病历编辑页后再试。" };
      }

      if (record.template === "initial-visit") {
        const fieldPairs = [
          ["主诉", chief, record.chief], ["现病史", present, record.present], ["既往史", past, record.past],
          ["口腔检查", exam, record.examination], ["辅助检查", auxiliary, record.auxiliary],
          ["诊断", diagnosis, record.diagnosis], ["治疗计划", plan, record.plan],
          ["处置", treatment, record.treatment], ["医嘱", advice, record.advice]
        ];
        const missing = [];
        fieldPairs.forEach(([label, field, value]) => {
          if (!field) missing.push(label);
          else setValue(field, value || "");
        });
        window.__irisLastRecordFilled = true;
        if (missing.length) {
          return { ok: true, message: `已填入可识别的初诊字段；未识别：${missing.join("、")}，请手动补充并审核后保存。` };
        }
        return { ok: true, message: "已填入完整初诊病历，请审核后手动保存。" };
      }

      if (exam || treatment || advice) {
        const isRetainerFollowup = record.template === "retainer-followup";
        if (chief) setValue(chief, isRetainerFollowup ? record.chief : FOLLOWUP_FIXED.chief);
        if (present) setValue(present, isRetainerFollowup ? record.present : FOLLOWUP_FIXED.present);
        if (past) setValue(past, isRetainerFollowup ? record.past : FOLLOWUP_FIXED.past);
        if (record.examination && exam) setValue(exam, record.examination);
        const previousRecord = isRetainerFollowup ? { text: "", source: "", checked: 0 } : await findPreviousFollowupRecord();
        const previousDiagnosis = isRetainerFollowup ? record.diagnosis : (previousRecord.text ? recordSectionFromText(previousRecord.text, "诊断") : "");
        const previousPlan = isRetainerFollowup ? record.plan : (previousRecord.text ? recordSectionFromText(previousRecord.text, "治疗计划") : "");
        const carried = [];
        if (previousDiagnosis && diagnosis) setValue(diagnosis, previousDiagnosis);
        if (previousDiagnosis && diagnosis) carried.push("诊断");
        if (previousPlan && plan) setValue(plan, previousPlan);
        if (previousPlan && plan) carried.push("治疗计划");
        if (record.treatment && treatment) setValue(treatment, record.treatment);
        if (advice) setValue(advice, adviceWithFixedBase(record.advice));
        window.__irisLastRecordFilled = true;
        const missing = [];
        if (!chief) missing.push("主诉");
        if (!present) missing.push("现病史");
        if (!past) missing.push("既往史");
        if (!exam) missing.push("口腔检查");
        if (!treatment) missing.push("处置");
        if (!advice) missing.push("医嘱");
        if (missing.length) {
          return { ok: true, message: `已填入可识别字段；未识别：${missing.join("、")}，请手动补充。` };
        }
        if (isRetainerFollowup) {
          return { ok: true, message: "已填入保持器复查固定模板，请审核后手动保存。" };
        }
        if (carried.length) {
          const checkedText = previousRecord.checked ? `，向前检查${previousRecord.checked}条记录` : "";
          return { ok: true, message: `已填入复诊病历字段，并从${previousRecord.source}${checkedText}复制${carried.join("、")}。请审核后手动保存。` };
        }
        const checkedText = previousRecord.checked ? `已向前检查${previousRecord.checked}条病历记录，` : "";
        return { ok: false, message: `已填入本次复诊病历字段；${checkedText}未找到可复制诊断/治疗计划的正畸复诊病历，请手动补充。` };
      }

      const examWords = /检查|口腔检查|病情|复诊|病程|病历|记录/;
      const treatmentWords = /处置|治疗|处理|操作|病程|病历|记录/;
      const adviceWords = /医嘱|宣教|注意事项|嘱/;
      const examField = fields.find((el) => examWords.test(fieldText(el)));
      const treatmentField = fields.find((el) => treatmentWords.test(fieldText(el)) && el !== examField);
      const adviceField = fields.find((el) => adviceWords.test(fieldText(el)) && el !== examField && el !== treatmentField);

      if (examField && treatmentField && adviceField) {
        setValue(examField, record.examination);
        setValue(treatmentField, record.treatment);
        setValue(adviceField, record.advice);
        window.__irisLastRecordFilled = true;
        return { ok: true, message: "已分字段填入检查、处置和医嘱，请审核后手动保存。" };
      }

      const recordField = fields.find((el) => /病历|病程|复诊|记录|处置|治疗|检查|医嘱/.test(fieldText(el)));
      if (recordField) {
        setValue(recordField, combined);
        window.__irisLastRecordFilled = true;
        return { ok: true, message: "已填入综合病历文本框，请审核后手动保存。" };
      }

      if (fields.length === 1) {
        setValue(fields[0], combined);
        window.__irisLastRecordFilled = true;
        return { ok: true, message: "已填入页面唯一文本框，请审核后手动保存。" };
      }

      return { ok: false, message: "页面有多个文本框，Iris 无法可靠判断病历字段。请复制全文后手动粘贴。" };
    }

    async function generate() {
      const notes = refs.notes.value.trim();
      if (!notes) {
        setStatus("请先输入复诊要点。", "error");
        return;
      }
      refs.generate.disabled = true;
      setStatus("正在生成病历。");
      try {
        const data = await sendToIris({ type: "IRIS_GENERATE", notes });
        renderRecord(data.record);
        setStatus("病历已生成，可编辑后填入 E看牙。", "ok");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        refs.generate.disabled = false;
      }
    }

    function generateInitial() {
      refs.initialGenerate.disabled = true;
      setInitialStatus("");
      setStatus("正在生成初诊病历。");
      try {
        const record = buildInitialRecord();
        renderRecord(record);
        setStatus("初诊病历已生成，可编辑后填入 E看牙。", "ok");
      } catch (error) {
        setStatus("");
        setInitialStatus(error.message || "初诊病历生成失败。", "error");
      } finally {
        refs.initialGenerate.disabled = false;
      }
    }

    function setupVoice() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        refs.voice.disabled = true;
        refs.voice.textContent = "语音不可用";
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      state.recognition = recognition;

      recognition.onstart = () => {
        state.recognizing = true;
        refs.voice.textContent = "停止语音";
        setStatus("正在听写。");
      };
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) state.finalSpeech += `${text}，`;
          else interim += text;
        }
        refs.notes.value = `${state.finalSpeech}${interim}`.trim();
      };
      recognition.onend = () => {
        state.recognizing = false;
        refs.voice.textContent = "开始语音";
        if (refs.notes.value.trim()) setStatus("语音已停止，可继续编辑。", "ok");
      };
      recognition.onerror = (event) => {
        setStatus(`语音识别失败：${event.error}`, "error");
      };
    }

    refs.close.addEventListener("click", () => refs.panel.classList.remove("open"));
    refs.scrollTop.addEventListener("click", () => refs.body.scrollTo({ top: 0, behavior: "smooth" }));
    refs.scrollBottom.addEventListener("click", () => refs.body.scrollTo({ top: refs.body.scrollHeight, behavior: "smooth" }));
    refs.visitMode.addEventListener("change", syncVisitMode);
    refs.generate.addEventListener("click", generate);
    refs.initialGenerate.addEventListener("click", generateInitial);
    refs.initialClear.addEventListener("click", () => {
      resetInitialForm();
      setStatus("初诊内容已清空。");
    });
    refs.clear.addEventListener("click", () => {
      resetIrisDraft();
    });
    refs.copyNotes.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(refs.notes.value || "");
        setStatus("已复制复诊要点。", "ok");
      } catch {
        setStatus("复制失败，请手动选择文本复制。", "error");
      }
    });
    refs.pasteNotes.addEventListener("click", async () => {
      try {
        refs.notes.value = await navigator.clipboard.readText();
        refs.notes.dispatchEvent(new Event("input", { bubbles: true }));
        setStatus("已粘贴到复诊要点。", "ok");
      } catch {
        setStatus("粘贴失败，请确认浏览器允许读取剪贴板。", "error");
      }
    });
    refs.fill.addEventListener("click", async () => {
      refs.fill.disabled = true;
      setStatus("正在填入，并查找上一条正畸复诊病历。");
      try {
        const result = await fillEkanya();
        setStatus(result.message, result.ok ? "ok" : "error");
        if (result.ok) closePanelAfterFill();
      } catch (error) {
        setStatus(error.message || "填入失败，请手动处理。", "error");
      } finally {
        refs.fill.disabled = !state.record || !canFillCurrentPage();
      }
    });
    refs.copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(formatRecord(currentRecord()));
        setStatus("已复制全文。", "ok");
      } catch {
        setStatus("复制失败，请手动选择文本复制。", "error");
      }
    });
    refs.voice.addEventListener("click", () => {
      if (!state.recognition) return;
      if (state.recognizing) {
        state.recognition.stop();
        return;
      }
      state.finalSpeech = refs.notes.value.trim();
      if (state.finalSpeech && !/[，。；;,\s]$/.test(state.finalSpeech)) state.finalSpeech += "，";
      state.recognition.start();
    });
    $("#iris-history-grid").addEventListener("input", (event) => {
      const key = event.target.dataset.historyDetail;
      if (!key) return;
      const deny = $(`[data-history-deny="${key}"]`);
      const denied = !event.target.value.trim();
      deny.classList.toggle("active", denied);
      deny.setAttribute("aria-pressed", denied ? "true" : "false");
    });
    refs.initialForm.addEventListener("change", (event) => {
      if (event.target.matches("#iris-opening-degree")) {
        toggleOpeningLimitEntry(event.target.value === "张口受限");
      }
      if (event.target.matches("#iris-dentition")) {
        const showTerminalPlane = ["乳牙列", "混合牙列"].includes(event.target.value);
        shadow.querySelectorAll(".iris-terminal-plane-control").forEach((control) => {
          control.hidden = !showTerminalPlane;
          if (!showTerminalPlane) {
            const select = control.querySelector("select");
            select.value = "";
            syncEnhancedSelect(select);
          }
        });
      }
    });
    refs.initialForm.addEventListener("click", (event) => {
      const chiefValue = event.target.dataset.chiefValue;
      if (chiefValue) {
        const active = !event.target.classList.contains("active");
        event.target.classList.toggle("active", active);
        event.target.setAttribute("aria-pressed", active ? "true" : "false");
        return;
      }
      const faceMultiValue = event.target.dataset.faceMultiValue;
      if (faceMultiValue) {
        const active = !event.target.classList.contains("active");
        event.target.classList.toggle("active", active);
        event.target.setAttribute("aria-pressed", active ? "true" : "false");
        return;
      }
      const tmjPositive = event.target.dataset.tmjPositive;
      if (tmjPositive) {
        const active = !event.target.classList.contains("active");
        event.target.classList.toggle("active", active);
        event.target.setAttribute("aria-pressed", active ? "true" : "false");
        if (tmjPositive === "click") {
          const positions = event.target.closest(".iris-tmj-grid").querySelector(".iris-click-positions");
          positions.hidden = !active;
          if (!active) positions.querySelectorAll("input").forEach((input) => { input.checked = false; });
        }
        return;
      }
      const tmjHistory = event.target.dataset.tmjHistory;
      if (tmjHistory) {
        const active = !event.target.classList.contains("active");
        event.target.classList.toggle("active", active);
        event.target.setAttribute("aria-pressed", active ? "true" : "false");
        return;
      }
      const midline = event.target.dataset.midline;
      if (midline) {
        const value = event.target.dataset.midlineValue;
        const group = event.target.closest("[data-midline-group]");
        const currentlyActive = event.target.classList.contains("active");
        group.querySelectorAll("[data-midline]").forEach((button) => {
          button.classList.remove("active");
          button.setAttribute("aria-pressed", "false");
          button.hidden = false;
        });
        group.querySelectorAll("[data-midline-entry]").forEach((entry) => { entry.hidden = true; });
        const input = group.querySelector("[data-midline-mm]");
        input.value = "";
        if (!currentlyActive) {
          event.target.classList.add("active");
          event.target.setAttribute("aria-pressed", "true");
          if (value === "左偏" || value === "右偏") {
            const side = value === "左偏" ? "left" : "right";
            const entry = group.querySelector(`[data-midline-entry="${midline}-${side}"]`);
            event.target.hidden = true;
            entry.hidden = false;
          }
        }
        return;
      }
      const crossbiteType = event.target.dataset.crossbiteType;
      if (crossbiteType) {
        const active = !event.target.classList.contains("active");
        syncCrossbiteType(crossbiteType, active);
        return;
      }
      const lockbiteType = event.target.dataset.lockbiteType;
      if (lockbiteType) {
        const active = !event.target.classList.contains("active");
        syncLockbite(active);
        return;
      }
      const oralToothKind = event.target.dataset.oralToothKind;
      if (oralToothKind) {
        const active = !event.target.classList.contains("active");
        event.target.classList.toggle("active", active);
        event.target.setAttribute("aria-pressed", active ? "true" : "false");
        if (active) {
          addOralToothGroup(oralToothKind);
        } else {
          const group = shadow.querySelector(`[data-oral-tooth-group="${oralToothKind}"]`);
          if (group) group.remove();
        }
        return;
      }
      const deniedHistory = event.target.dataset.historyDeny;
      if (deniedHistory) {
        const detail = $(`[data-history-detail="${deniedHistory}"]`);
        detail.value = "";
        event.target.classList.add("active");
        event.target.setAttribute("aria-pressed", "true");
        return;
      }
      const addKind = event.target.dataset.addRow;
      if (addKind) {
        createToothRow(addKind);
        return;
      }
      if (event.target.matches("[data-remove-row]")) {
        event.target.closest(".iris-dynamic-row").remove();
        return;
      }
      if (event.target.matches("[data-remove-plan]")) {
        event.target.closest(".iris-plan-card").remove();
        renumberPlans();
      }
    });
    $("#iris-add-plan").addEventListener("click", createPlan);
    $("#iris-ceph-image-zone").addEventListener("paste", async (event) => {
      const item = [...(event.clipboardData?.items || [])].find((entry) => /^image\//i.test(entry.type));
      if (!item) return;
      event.preventDefault();
      try {
        await recognizeCephImage(item.getAsFile());
        setStatus("头侧片截图已识别，请核对数值。", "ok");
      } catch (error) {
        $("#iris-ceph-image-zone").textContent = "点击此处后直接粘贴头侧片截图";
        setStatus(error.message || "头侧片截图识别失败。", "error");
      }
    });
    initializeInitialForm();
    syncVisitMode();
    setupIrisDrag();
    setupAutoResetAfterFinish();
    setupVoice();
    syncPageVisibility();
    setInterval(() => {
      const enabled = !!state.record && canFillCurrentPage();
      refs.fill.disabled = !enabled;
      if (state.currentUrl !== location.href) {
        state.currentUrl = location.href;
        syncPageVisibility();
      }
    }, 1500);
  }

  mount();
})();
