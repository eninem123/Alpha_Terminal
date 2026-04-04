(function () {
  "use strict";

  const MAX_FREE_TRIES = 2;
  const STORAGE_KEY = "_u_limit";
  const LEVERAGE = 10;

  /** 项目根目录可选 unlock-secret.js：secretOk 且未 useUsageLimit 时不计次 */
  function isLocalUsageBypass() {
    const L = typeof window !== "undefined" ? window.__ALPHA_LOCAL : null;
    if (!L || typeof L !== "object") return false;
    if (L.secretOk !== true) return false;
    if (L.useUsageLimit === true) return false;
    return true;
  }

  const localUsageBypass = isLocalUsageBypass();

  /* ---------- A 股交易日历（法定节假日全天休市；每年按交易所公告更新） ---------- */
  function formatLocalYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function addClosedRange(set, ymdStart, ymdEnd) {
    const a = ymdStart.split("-").map(Number);
    const b = ymdEnd.split("-").map(Number);
    const cur = new Date(a[0], a[1] - 1, a[2], 12, 0, 0);
    const end = new Date(b[0], b[1] - 1, b[2], 12, 0, 0);
    while (cur <= end) {
      set.add(formatLocalYMD(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }

  /** 元旦、春节、清明、劳动节、端午、中秋、国庆等「按日」休市（沪/深/北交所同步口径，以交易所当年通知为准） */
  const CN_STOCK_FULL_DAY_HOLIDAYS = new Set();
  [
    ["2026-01-01", "2026-01-03"],
    ["2026-02-15", "2026-02-23"],
    ["2026-04-04", "2026-04-06"],
    ["2026-05-01", "2026-05-05"],
    ["2026-06-19", "2026-06-21"],
    ["2026-09-25", "2026-09-27"],
    ["2026-10-01", "2026-10-07"]
  ].forEach(function (se) {
    addClosedRange(CN_STOCK_FULL_DAY_HOLIDAYS, se[0], se[1]);
  });

  /** 周末因调休而仍开市的日期（逐年维护；空则仅按周六日+节假日判断） */
  const CN_STOCK_WEEKEND_WORKDAY = new Set([]);

  function sessionPhase(t) {
    const hm = t.getHours() * 60 + t.getMinutes();
    const am0 = 9 * 60 + 30;
    const am1 = 11 * 60 + 30;
    const pm0 = 13 * 60;
    const pm1 = 15 * 60;
    if (hm >= am0 && hm < am1) return { inSession: true, label: "上午连续竞价" };
    if (hm >= pm0 && hm < pm1) return { inSession: true, label: "下午连续竞价" };
    if (hm < am0) return { inSession: false, label: "盘前休市" };
    if (hm >= am1 && hm < pm0) return { inSession: false, label: "午间休市" };
    return { inSession: false, label: "盘后休市" };
  }

  function getAshareMarketState(now) {
    const t = now || new Date();
    const ymd = formatLocalYMD(t);
    const dow = t.getDay();

    if (CN_STOCK_WEEKEND_WORKDAY.has(ymd)) {
      const ph = sessionPhase(t);
      return ph.inSession
        ? { open: true, line: "当前：A股连续竞价时段（周末调休补班）。" }
        : {
            open: false,
            line: "当前：" + ph.label + "（周末调休补班日）；所示价格为行情快照，非实时撮合。"
          };
    }

    if (CN_STOCK_FULL_DAY_HOLIDAYS.has(ymd)) {
      return {
        open: false,
        line: "当前：法定节假日休市，A股不交易；所示价格为最近行情快照，非实时撮合。"
      };
    }

    if (dow === 0 || dow === 6) {
      return {
        open: false,
        line: "当前：周末休市，A股不交易；所示价格为最近行情快照，非实时撮合。"
      };
    }

    const ph = sessionPhase(t);
    if (!ph.inSession) {
      return {
        open: false,
        line: "当前：" + ph.label + "；非连续竞价时段，价格多为快照。"
      };
    }

    return {
      open: true,
      line: "当前：A股连续竞价时段，行情可能随撮合变动。"
    };
  }

  function allowLivePriceJitter(now) {
    return getAshareMarketState(now).open === true;
  }

  let _u_limit = Number(localStorage.getItem(STORAGE_KEY) || 0);
  let _s_data = {
    code: "",
    basePrice: 0,
    currentPrice: 0,
    anchorPrice: 0,
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

  const codeErrorModal = document.getElementById("codeErrorModal");
  const codeErrorTitleEl = document.getElementById("codeErrorTitle");
  const codeErrorMsgEl = document.getElementById("codeErrorMsg");
  const codeErrorOkBtn = document.getElementById("codeErrorOk");
  const marketStatusLineEl = document.getElementById("marketStatusLine");

  function updateMarketStatusLine() {
    if (!marketStatusLineEl) return;
    const st = getAshareMarketState(new Date());
    marketStatusLineEl.textContent = st.line;
    marketStatusLineEl.className =
      "text-[11px] mt-2 leading-snug " +
      (st.open ? "text-slate-500" : "text-amber-200/90");
  }

  function hideCodeErrorModal() {
    if (codeErrorModal) codeErrorModal.classList.add("hidden");
  }

  /** 股票代码类错误用弹层；无 DOM 时退回 alert */
  function showCodeErrorModal(title, message) {
    if (codeErrorModal && codeErrorTitleEl && codeErrorMsgEl) {
      codeErrorTitleEl.textContent = title;
      codeErrorMsgEl.textContent = message;
      codeErrorModal.classList.remove("hidden");
      return;
    }
    alert(title + "\n\n" + message);
  }

  function b64EncodeJson(obj) {
    const raw = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(raw)));
  }

  function b64DecodeJson(b64) {
    const raw = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(raw);
  }

  function updateTriesLeftUI() {
    if (localUsageBypass) {
      triesLeft.textContent = "不限";
      return;
    }
    const left = Math.max(0, MAX_FREE_TRIES - _u_limit);
    triesLeft.textContent = String(left);
  }

  function formatNum(v, digits = 2) {
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  /** 腾讯财经公开行情（CORS: *），文档见各开源解析；无效代码返回 v_pv_none_match */
  const QUOTE_URL = "https://qt.gtimg.cn/q=";

  /** 接口正文为 GBK；仅用 res.text() 在微信等环境常误判编码导致股票名乱码 */
  function decodeTencentQuoteBody(buffer) {
    const labels = ["gbk", "gb18030"];
    for (let i = 0; i < labels.length; i++) {
      try {
        return new TextDecoder(labels[i]).decode(buffer);
      } catch (e) {
        /* 当前环境不支持该 label 时换下一个 */
      }
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  function codeToSymbol(code) {
    if (!/^\d{6}$/.test(code)) return null;
    const p2 = code.slice(0, 2);
    const p3 = code.slice(0, 3);
    if (p2 === "60" || p2 === "68" || p2 === "69") return "sh" + code;
    if (p2 === "00" || p2 === "30") return "sz" + code;
    if (p3 === "430" || p3 === "830" || p3 === "870" || p3 === "880" || p3 === "920") return "bj" + code;
    return null;
  }

  function quoteError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /**
   * @returns {Promise<{code:string,symbol:string,name:string,basePrice:number,currentPrice:number,ts:number}>}
   */
  async function fetchQuoteObject(code) {
    const symbol = codeToSymbol(code);
    if (!symbol) throw quoteError("UNSUPPORTED_CODE", "UNSUPPORTED_CODE");

    const res = await fetch(QUOTE_URL + encodeURIComponent(symbol), {
      cache: "no-store"
    });
    if (!res.ok) throw quoteError("NETWORK", "NETWORK");

    const buf = await res.arrayBuffer();
    const text = decodeTencentQuoteBody(buf);
    if (!text || !text.trim()) throw quoteError("NOT_FOUND", "NOT_FOUND");
    if (/v_pv_none_match/i.test(text)) throw quoteError("NOT_FOUND", "NOT_FOUND");

    const m = text.match(/v_[a-z0-9]+="([^"]*)"/i);
    if (!m) throw quoteError("PARSE", "PARSE");

    const parts = m[1].split("~");
    if (parts.length < 5) throw quoteError("PARSE", "PARSE");

    const currentPrice = parseFloat(parts[3]);
    let basePrice = parseFloat(parts[4]);

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw quoteError("BAD_DATA", "BAD_DATA");
    }
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      basePrice = currentPrice;
    }

    const name = (parts[1] || "").trim();
    return {
      code,
      symbol,
      name,
      basePrice,
      currentPrice,
      ts: Date.now()
    };
  }

  function mockMetaByCode() {
    const vol = (14 + Math.random() * 22).toFixed(2) + "%";
    const flow = (Math.random() > 0.5 ? "+" : "-") + (8 + Math.random() * 32).toFixed(2) + "M";
    const ratio = "10x";
    return b64EncodeJson({ vol, flow, ratio });
  }

  async function fetchStockData(code) {
    const payload = await fetchQuoteObject(code);
    return b64EncodeJson(payload);
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
      const code = _s_data.code;
      if (!code) return;

      function tickFromBase(baseVal) {
        if (!(baseVal > 0)) return;
        const prev = _s_data.currentPrice;
        let next = baseVal;
        if (allowLivePriceJitter()) {
          const move = (Math.random() - 0.5) * 0.001;
          next = Math.max(0.01, baseVal * (1 + move));
        }
        _s_data.currentPrice = next;
        applyPriceUI(prev, next, _s_data.basePrice);
      }

      updateMarketStatusLine();

      fetchQuoteObject(code)
        .then((data) => {
          _s_data.anchorPrice = data.currentPrice;
          tickFromBase(data.currentPrice);
        })
        .catch(() => {
          const base =
            _s_data.anchorPrice > 0
              ? _s_data.anchorPrice
              : _s_data.currentPrice > 0
                ? _s_data.currentPrice
                : 0;
          tickFromBase(base);
        });
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
      showCodeErrorModal(
        "股票代码错误",
        "请输入 6 位数字代码（仅支持沪深北交所 A 股常见代码段）。"
      );
      return;
    }
    if (!(principal > 0)) {
      alert("请输入有效的基准数额");
      return;
    }

    if (!localUsageBypass) {
      if (_u_limit > MAX_FREE_TRIES) {
        setLockedState();
        return;
      }
      if (_u_limit >= MAX_FREE_TRIES) {
        _u_limit += 1;
        localStorage.setItem(STORAGE_KEY, String(_u_limit));
        updateTriesLeftUI();
        setLockedState();
        return;
      }
    }

    unlockState();
    queryBtn.disabled = true;
    queryBtn.textContent = "数据加载中...";

    try {
      const b64Packet = await fetchStockData(code);
      const data = b64DecodeJson(b64Packet);

      if (!localUsageBypass) {
        _u_limit += 1;
        localStorage.setItem(STORAGE_KEY, String(_u_limit));
        updateTriesLeftUI();
      }

      _s_data.code = data.code;
      _s_data.basePrice = data.basePrice;
      _s_data.currentPrice = data.currentPrice;
      _s_data.anchorPrice = data.currentPrice;
      _s_data.principal = principal;

      const label = data.name ? `${data.name} (${code})` : data.symbol.toUpperCase() + " " + code;
      stockCodeShow.textContent = label;
      notionalEl.textContent = formatNum(principal * LEVERAGE, 2);

      const metaB64 = mockMetaByCode();
      const meta = b64DecodeJson(metaB64);
      volatilityEl.textContent = meta.vol;
      netFlowEl.textContent = meta.flow;
      netFlowEl.className = "text-sm font-semibold mt-1 " + (meta.flow.startsWith("+") ? "ticker-up" : "ticker-down");
      levRatioEl.textContent = meta.ratio;

      applyPriceUI(data.basePrice, data.currentPrice, data.basePrice);
      updateMarketStatusLine();
      startLiveFeed();
    } catch (e) {
      const c = e && e.code;
      if (c === "UNSUPPORTED_CODE") {
        showCodeErrorModal(
          "股票代码错误",
          "该代码不属于当前支持的沪深北交所 A 股规则，请核对后重新输入。"
        );
      } else if (c === "NOT_FOUND" || c === "BAD_DATA" || c === "PARSE") {
        showCodeErrorModal(
          "股票代码错误",
          "行情源未返回该代码的有效数据，可能代码不存在或已退市，请核对后重试。"
        );
      } else if (c === "NETWORK") {
        alert("网络异常，请稍后重试");
      } else {
        alert("数据通道繁忙，请稍后再试");
      }
    } finally {
      queryBtn.disabled = false;
      queryBtn.textContent = "执行数据刷新";
    }
  }

  function init() {
    updateTriesLeftUI();

    if (localUsageBypass) {
      unlockState();
    } else if (_u_limit > MAX_FREE_TRIES) {
      setLockedState();
    }

    queryBtn.addEventListener("click", runQuery);

    if (codeErrorOkBtn && codeErrorModal) {
      codeErrorOkBtn.addEventListener("click", hideCodeErrorModal);
      codeErrorModal.addEventListener("click", function (ev) {
        if (ev.target === codeErrorModal) hideCodeErrorModal();
      });
    }

    updateMarketStatusLine();

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
