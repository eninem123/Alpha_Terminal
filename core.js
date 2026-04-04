(function () {
  "use strict";

  const MAX_FREE_TRIES = 2;
  const STORAGE_KEY = "_u_limit";
  const LEVERAGE = 10;

  let _u_limit = Number(localStorage.getItem(STORAGE_KEY) || 0);
  let _s_data = {
    code: "",
    basePrice: 0,
    currentPrice: 0,
    timer: null,
    principal: 0
  };

  const appMain = document.getElementById("appMain");
  const lockModal = document.getElementById("lockModal");
  const triesLeft = document.getElementById("triesLeft");

  const codeInput = document.getElementById("codeInput");
  const principalInput = document.getElementById("principalInput");
  const queryBtn = document.getElementById("queryBtn");

  const stockCodeShow = document.getElementById("stockCodeShow");
  const priceEl = document.getElementById("price");
  const changePctEl = document.getElementById("changePct");

  const volatilityEl = document.getElementById("volatility");
  const netFlowEl = document.getElementById("netFlow");
  const levRatioEl = document.getElementById("levRatio");

  const notionalEl = document.getElementById("notional");
  const efficiencyEl = document.getElementById("efficiency");
  const pnlLabelEl = document.getElementById("pnlLabel");
  const profitPathEl = document.getElementById("profitPath");

  const copyWxBtn = document.getElementById("copyWxBtn");
  const wechatIdEl = document.getElementById("wechatId");

  function b64EncodeJson(obj) {
    const raw = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(raw)));
  }

  function b64DecodeJson(b64) {
    const raw = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(raw);
  }

  function updateTriesLeftUI() {
    const left = Math.max(0, MAX_FREE_TRIES - _u_limit);
    triesLeft.textContent = String(left);
  }

  function formatNum(v, digits = 2) {
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function getBasePriceByCode(code) {
    if (code === "600519") return 1700 + Math.random() * 80;
    if (code === "000001") return 10 + Math.random() * 2;
    return 20 + Math.random() * 200;
  }

  function mockMetaByCode(code) {
    const vol = (14 + Math.random() * 22).toFixed(2) + "%";
    const flow = (Math.random() > 0.5 ? "+" : "-") + (8 + Math.random() * 32).toFixed(2) + "M";
    const ratio = "10x";
    return b64EncodeJson({ vol, flow, ratio });
  }

  function fetchStockData(code) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const base = getBasePriceByCode(code);
        const payload = {
          code,
          basePrice: base,
          currentPrice: base,
          ts: Date.now()
        };
        resolve(b64EncodeJson(payload));
      }, 420 + Math.random() * 480);
    });
  }

  function stopLiveTimer() {
    if (_s_data.timer) {
      clearInterval(_s_data.timer);
      _s_data.timer = null;
    }
  }

  function applyPriceUI(prev, next, base) {
    const pct = ((next - base) / base) * 100;
    const isUp = next >= prev;

    priceEl.textContent = formatNum(next, 2);
    changePctEl.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(3) + "%";
    changePctEl.className = "text-xs " + (pct >= 0 ? "ticker-up" : "ticker-down");

    priceEl.classList.remove("flicker", "ticker-up", "ticker-down");
    void priceEl.offsetWidth;
    priceEl.classList.add(isUp ? "ticker-up" : "ticker-down");
    priceEl.classList.add("flicker");

    const scaledPct = pct * LEVERAGE;
    const delta = _s_data.principal * (scaledPct / 100);
    const sign = scaledPct >= 0 ? "+" : "";
    pnlLabelEl.textContent = `浮动：${sign}${formatNum(scaledPct, 2)}%  (${sign}${formatNum(delta, 2)})`;
    pnlLabelEl.className = "text-sm font-semibold " + (scaledPct >= 0 ? "ticker-up" : "ticker-down");

    const clamped = Math.max(-20, Math.min(20, scaledPct));
    const end = 82 - ((clamped + 20) / 40) * 64;
    profitPathEl.style.setProperty("--path-end", end.toFixed(1) + "%");

    efficiencyEl.textContent = `${sign}${formatNum(scaledPct, 2)}% 预估`;
    efficiencyEl.className = "text-sm font-semibold mt-1 " + (scaledPct >= 0 ? "ticker-up" : "ticker-down");
  }

  function startLiveFeed() {
    stopLiveTimer();
    _s_data.timer = setInterval(() => {
      const prev = _s_data.currentPrice;
      const move = (Math.random() - 0.5) * 0.001;
      const next = Math.max(0.01, prev * (1 + move));
      _s_data.currentPrice = next;
      applyPriceUI(prev, next, _s_data.basePrice);
    }, 2000);
  }

  function setLockedState() {
    appMain.classList.add("locked");
    lockModal.classList.remove("hidden");
    stopLiveTimer();
  }

  function unlockState() {
    appMain.classList.remove("locked");
    lockModal.classList.add("hidden");
  }

  async function runQuery() {
    const code = (codeInput.value || "").trim();
    const principal = Number(principalInput.value || 0);

    if (!/^\d{6}$/.test(code)) {
      alert("请输入6位标的代码");
      return;
    }
    if (!(principal > 0)) {
      alert("请输入有效的基准数额");
      return;
    }

    _u_limit += 1;
    localStorage.setItem(STORAGE_KEY, String(_u_limit));
    updateTriesLeftUI();

    if (_u_limit > MAX_FREE_TRIES) {
      setLockedState();
      return;
    }

    unlockState();
    queryBtn.disabled = true;
    queryBtn.textContent = "数据加载中...";

    try {
      const b64Packet = await fetchStockData(code);
      const data = b64DecodeJson(b64Packet);
      _s_data.code = data.code;
      _s_data.basePrice = data.basePrice;
      _s_data.currentPrice = data.currentPrice;
      _s_data.principal = principal;

      stockCodeShow.textContent = `SSE/SZSE ${code}`;
      notionalEl.textContent = formatNum(principal * LEVERAGE, 2);

      const metaB64 = mockMetaByCode(code);
      const meta = b64DecodeJson(metaB64);
      volatilityEl.textContent = meta.vol;
      netFlowEl.textContent = meta.flow;
      netFlowEl.className = "text-sm font-semibold mt-1 " + (meta.flow.startsWith("+") ? "ticker-up" : "ticker-down");
      levRatioEl.textContent = meta.ratio;

      applyPriceUI(data.basePrice, data.currentPrice, data.basePrice);
      startLiveFeed();
    } catch (e) {
      alert("数据通道繁忙，请稍后再试");
    } finally {
      queryBtn.disabled = false;
      queryBtn.textContent = "执行数据刷新";
    }
  }

  function init() {
    updateTriesLeftUI();

    if (_u_limit > MAX_FREE_TRIES) {
      setLockedState();
    }

    queryBtn.addEventListener("click", runQuery);

    copyWxBtn.addEventListener("click", async () => {
      const txt = wechatIdEl.textContent.trim();
      try {
        await navigator.clipboard.writeText(txt);
        copyWxBtn.textContent = "已复制";
        setTimeout(() => (copyWxBtn.textContent = "复制微信号"), 1200);
      } catch {
        const input = document.createElement("input");
        input.value = txt;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        copyWxBtn.textContent = "已复制";
        setTimeout(() => (copyWxBtn.textContent = "复制微信号"), 1200);
      }
    });
  }

  init();
})();
