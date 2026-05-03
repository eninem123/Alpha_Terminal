(function () {
  "use strict";

  const MAX_FREE_TRIES = 10;
  const STORAGE_KEY = "_u_limit";
  const LEVERAGE = 10;
  const MAX_KB_QA_TRIES = 2;
  const KB_QA_STORAGE_KEY = "_kbqa_limit";

  function isLocalDevHost() {
    try {
      const h = String(location && location.hostname ? location.hostname : "").trim().toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1";
    } catch {
      return false;
    }
  }

  /** 项目根目录可选 unlock-secret.js：secretOk 且未 useUsageLimit 时不计次 */
  function isLocalUsageBypass() {
    if (!isLocalDevHost()) return false;
    const L = typeof window !== "undefined" ? window.__ALPHA_LOCAL : null;
    if (!L || typeof L !== "object") return false;
    if (L.secretOk !== true) return false;
    if (L.useUsageLimit === true) return false;
    return true;
  }

    // 获取微信WebView兼容的cookie
  function getAdminCookie() {
    const match = document.cookie.match(/(?:^|;)\s*_admin_c=([^;]*)/);
    return match ? match[1] : null;
  }

  function isAdminAuthed() {
    try {
      // 先检查localStorage
      const lsVal = localStorage.getItem("_admin_authed");
      console.log("[DEBUG] isAdminAuthed, localStorage=" + lsVal);
      if (lsVal === "1") return true;
      // 再检查cookie（微信WebView备选）
      const ckVal = getAdminCookie();
      console.log("[DEBUG] isAdminAuthed, cookie=" + ckVal);
      return ckVal === "1";
    } catch {
      console.log("[DEBUG] isAdminAuthed, exception");
      return false;
    }
  }

  const localUsageBypass = isLocalUsageBypass();
  const adminAuthed = isAdminAuthed();
  const localVipUnlimited = (() => {
    if (!isLocalDevHost()) return false;
    const L = typeof window !== "undefined" ? window.__ALPHA_LOCAL : null;
    if (!L || typeof L !== "object") return false;
    return L.vipUnlimited === true;
  })();
  let effectiveUsageBypass = localUsageBypass || adminAuthed;
  let effectiveVipUnlimited = localVipUnlimited || adminAuthed;

  function applyAdminAuthState(authed) {
    const ok = authed === true;
    const localAdminAuthed = isAdminAuthed(); // 从localStorage读取
    console.log("[DEBUG] applyAdminAuthState called, auth=" + auth + ", localAdminAuthed=" + localAdminAuthed);
    try {
      // 只有服务器确认authed=true时才更新localStorage
      // 如果服务器返回false，不清除localStorage（保留微信WebView的fallback）
      if (ok) localStorage.setItem("_admin_authed", "1");
      // else localStorage.removeItem("_admin_authed"); // 注释掉，避免清除备选状态
    } catch {}
    // 关键：effectiveUsageBypass应该同时考虑localStorage的fallback状态
    effectiveUsageBypass = localUsageBypass || localAdminAuthed;
    effectiveVipUnlimited = localVipUnlimited || localAdminAuthed;
    console.log("[DEBUG] effectiveUsageBypass=" + effectiveUsageBypass + ", localVipUnlimited=" + effectiveVipUnlimited);
    updateTriesLeftUI();
    updateKbQuotaUI();
  }

  async function syncAdminAuthStatus() {
    try {
      const r = await fetchWithTimeout(
        "/api/admin/status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        },
        20000
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return isAdminAuthed();
      }
      applyAdminAuthState(Boolean(j && j.authed === true));
      return Boolean(j && j.authed === true);
    } catch {
      return isAdminAuthed();
    }
  }

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
  let _kbqa_limit = Number(localStorage.getItem(KB_QA_STORAGE_KEY) || 0);
  let _s_data = {
    code: "",
    basePrice: 0,
    currentPrice: 0,
    anchorPrice: 0,
    timer: null,
    principal: 0,
    stockDisplayName: ""
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
  const newsTickerHintEl = document.getElementById("newsTickerHint");
  const newsMarqueeTrackEl = document.getElementById("newsMarqueeTrack");

  const kbQaOpenBtn = document.getElementById("kbQaOpenBtn");
  const kbQaModal = document.getElementById("kbQaModal");
  const kbQaCloseBtn = document.getElementById("kbQaCloseBtn");
  const kbMultiOptions = document.getElementById("kbMultiOptions");
  const kbMultiCount = document.getElementById("kbMultiCount");
  const kbPrevPageBtn2 = document.getElementById("kbPrevPageBtn2");
  const kbNextPageBtn2 = document.getElementById("kbNextPageBtn2");
  const kbPageLabel2 = document.getElementById("kbPageLabel2");
  const kbRefreshBtn = document.getElementById("kbRefreshBtn");
  const kbQuestion = document.getElementById("kbQuestion");
  const kbAskBtn = document.getElementById("kbAskBtn");
  const kbQaStatus = document.getElementById("kbQaStatus");
  const kbQuotaLine = document.getElementById("kbQuotaLine");
  const kbVipKey = document.getElementById("kbVipKey");
  const kbVipFetchKeyBtn = document.getElementById("kbVipFetchKeyBtn");
  const kbAnswer = document.getElementById("kbAnswer");
  const kbPrevPageBtn = document.getElementById("kbPrevPageBtn");
  const kbNextPageBtn = document.getElementById("kbNextPageBtn");

  // 多选 KB 状态
  let _kbListData = [];         // { id, name }
  let _selectedKbIds = new Set(); // 当前选中的 KB ID 集合
  const kbPageLabel = document.getElementById("kbPageLabel");
  const kbSources = document.getElementById("kbSources");

  const SINA_ROLL_URL =
    "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2515&num=28&page=";
  const QQ_FINANCE_CH = "https://news.qq.com/ch/finance/";

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
    if (effectiveUsageBypass) {
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
  const QUOTE_TIMEOUT_MS = 4500;
  const QUOTE_MAX_ATTEMPTS = 2;
  const QUOTE_CACHE_TTL_MS = 60 * 1000;
  const _quoteCache = new Map();

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

  async function fetchQuoteObjectViaServer(code) {
    const symbol = codeToSymbol(code);
    if (!symbol) throw quoteError("UNSUPPORTED_CODE", "UNSUPPORTED_CODE");
    const res = await fetchWithTimeout(
      "/api/quote?code=" + encodeURIComponent(code),
      { method: "GET", cache: "no-store" },
      3500
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw quoteError("NETWORK", "NETWORK");
    const q = data && data.quote ? data.quote : null;
    if (!q) throw quoteError("BAD_DATA", "BAD_DATA");
    const currentPrice = Number(q.currentPrice);
    const basePrice = Number(q.basePrice);
    const name = String(q.name || "").trim();
    const base = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : currentPrice;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw quoteError("BAD_DATA", "BAD_DATA");
    return {
      code,
      symbol,
      name,
      basePrice: base,
      currentPrice,
      ts: Date.now()
    };
  }

  /**
   * @returns {Promise<{code:string,symbol:string,name:string,basePrice:number,currentPrice:number,ts:number}>}
   */
  async function fetchQuoteObject(code) {
    const symbol = codeToSymbol(code);
    if (!symbol) throw quoteError("UNSUPPORTED_CODE", "UNSUPPORTED_CODE");

    const cacheKey = symbol;
    const cached = _quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) return cached;

    const url = QUOTE_URL + encodeURIComponent(symbol);
    let lastErrCode = "NETWORK";
    for (let attempt = 1; attempt <= QUOTE_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchWithTimeout(
          url,
          {
            cache: "no-store"
          },
          QUOTE_TIMEOUT_MS
        );
        if (!res.ok) {
          lastErrCode = "NETWORK";
          throw quoteError("NETWORK", "NETWORK");
        }

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
        const out = {
          code,
          symbol,
          name,
          basePrice,
          currentPrice,
          ts: Date.now()
        };
        _quoteCache.set(cacheKey, out);
        return out;
      } catch (e) {
        lastErrCode = e && e.code ? String(e.code) : "NETWORK";
        if (attempt >= QUOTE_MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 120 * attempt));
      }
    }

    try {
      const out = await fetchQuoteObjectViaServer(code);
      _quoteCache.set(cacheKey, out);
      return out;
    } catch {}

    if (cached) return cached;
    throw quoteError(lastErrCode, lastErrCode);
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

  const _enableSinaRoll = (() => {
    try {
      const L = typeof window !== "undefined" ? window.__ALPHA_LOCAL : null;
      if (L && typeof L === "object" && L.enableSinaRoll === true) return true;
    } catch {}
    return false;
  })();
  let _sinaRollDisabled = !_enableSinaRoll;
  let _newsRollPage = 1;

  function loadSinaRollJsonp(onOk, onFail) {
    if (_sinaRollDisabled) {
      onFail();
      return;
    }
    const cb = "_alphaNewsCb" + String(Date.now());
    const script = document.createElement("script");
    let settled = false;
    function doneOk(payload) {
      if (settled) return;
      settled = true;
      try {
        clearTimeout(tid);
      } catch (e0) {}
      try {
        delete window[cb];
        if (script.parentNode) script.parentNode.removeChild(script);
      } catch (e1) {}
      onOk(payload);
    }
    function doneFail() {
      if (settled) return;
      settled = true;
      try {
        clearTimeout(tid);
      } catch (e0b) {}
      try {
        delete window[cb];
      } catch (e2) {}
      try {
        if (script.parentNode) script.parentNode.removeChild(script);
      } catch (e3) {}
      onFail();
    }
    window[cb] = function (payload) {
      doneOk(payload);
    };
    script.onerror = doneFail;
    _newsRollPage = (_newsRollPage % 10) + 1;
    script.src =
      SINA_ROLL_URL +
      _newsRollPage +
      "&callback=" +
      cb +
      "&_=" +
      Date.now();
    const tid = setTimeout(doneFail, 12000);
    document.body.appendChild(script);
  }

  function parseSinaRoll(payload) {
    try {
      const arr = payload && payload.result && payload.result.data;
      if (!Array.isArray(arr)) return [];
      const out = [];
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const title = (it && it.title ? String(it.title) : "").trim();
        const url =
          (it && it.wapurl ? String(it.wapurl) : "") ||
          (it && it.url ? String(it.url) : "");
        if (!title || !url || !/^https?:\/\//i.test(url)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title: title, url: url, src: "sina" });
        if (out.length >= 22) break;
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function buildTencentHeadItems(code6, symbol) {
    const head = [];
    head.push({
      title: "腾讯财经 · 股票 / A 股综合资讯",
      url: QQ_FINANCE_CH,
      src: "qq"
    });
    if (symbol && /^\d{6}$/.test(code6)) {
      head.push({
        title: "腾讯自选股 · " + code6 + " 行情·资讯·公告",
        url: "https://gu.qq.com/" + symbol,
        src: "qq"
      });
    }
    return head;
  }

  function mergeAndRank(sinaItems, code6, symbol, displayName) {
    const head = buildTencentHeadItems(code6, symbol);
    let body = sinaItems.slice();
    const name = (displayName || "").trim();
    if (name.length >= 2) {
      const hit = [];
      const miss = [];
      for (let i = 0; i < body.length; i++) {
        if (body[i].title.indexOf(name) >= 0) hit.push(body[i]);
        else miss.push(body[i]);
      }
      body = hit.concat(miss);
    } else if (/^\d{6}$/.test(code6 || "")) {
      const c = code6;
      const hit = [];
      const miss = [];
      for (let j = 0; j < body.length; j++) {
        if (body[j].title.indexOf(c) >= 0) hit.push(body[j]);
        else miss.push(body[j]);
      }
      body = hit.concat(miss);
    }
    const all = head.concat(body);
    const out = [];
    const u = new Set();
    for (let k = 0; k < all.length; k++) {
      if (u.has(all[k].url)) continue;
      u.add(all[k].url);
      out.push(all[k]);
      if (out.length >= 24) break;
    }
    return out;
  }

  function renderNewsMarquee(items) {
    if (!newsMarqueeTrackEl) return;
    newsMarqueeTrackEl.innerHTML = "";
    newsMarqueeTrackEl.removeAttribute("style");

    if (!items.length) {
      const a = document.createElement("a");
      a.href = QQ_FINANCE_CH;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className =
        "text-xs text-emerald-300 hover:text-emerald-200 shrink-0 underline underline-offset-2 py-1";
      a.textContent = "打开腾讯财经 · 浏览 A 股资讯";
      newsMarqueeTrackEl.appendChild(a);
      newsMarqueeTrackEl.style.animation = "none";
      return;
    }

    const canAnimate =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      (window.innerWidth || 0) > 480;

    function appendList(target, list) {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const a = document.createElement("a");
        a.href = it.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const prefix = it.src === "qq" ? "腾讯 · " : "滚动 · ";
        a.textContent = prefix + it.title;
        a.title = it.title;
        a.className =
          "shrink-0 text-left text-xs leading-snug text-emerald-100/95 hover:text-emerald-300 max-w-[min(320px,88vw)] overflow-hidden text-ellipsis whitespace-nowrap border-r border-slate-700/60 pr-6 mr-2";
        target.appendChild(a);
      }
    }

    appendList(newsMarqueeTrackEl, items);
    if (canAnimate) appendList(newsMarqueeTrackEl, items);

    if (canAnimate) {
      const dur = Math.min(120, 28 + items.length * 4);
      newsMarqueeTrackEl.style.animationDuration = dur + "s";
    } else {
      newsMarqueeTrackEl.style.animation = "none";
    }
  }

  let _newsDebounce = null;
  function scheduleNewsRefresh() {
    if (_newsDebounce) clearTimeout(_newsDebounce);
    _newsDebounce = setTimeout(refreshNewsMarquee, 450);
  }

  function refreshNewsMarquee() {
    if (!newsMarqueeTrackEl) return;
    const rawCode = (codeInput && codeInput.value ? codeInput.value : "").trim();
    const code6 = /^\d{6}$/.test(rawCode) ? rawCode : "";
    const symbol = code6 ? codeToSymbol(code6) : null;
    const displayName =
      code6 && _s_data.code === code6 && _s_data.stockDisplayName
        ? _s_data.stockDisplayName
        : "";

    if (newsTickerHintEl) {
      if (!code6) {
        newsTickerHintEl.textContent =
          "未输入代码 · 下方先显示腾讯入口；新浪滚动加载后追加（若被拦截则仅腾讯链接）";
      } else if (displayName) {
        newsTickerHintEl.textContent =
          "已查询 " +
          displayName +
          " · 已优先腾讯入口；滚动加载后匹配相关标题";
      } else {
        newsTickerHintEl.textContent =
          "已输入 " + code6 + " · 已显示腾讯自选股入口；滚动加载中…";
      }
    }

    const preMerged = mergeAndRank([], code6, symbol, displayName);
    renderNewsMarquee(preMerged);

    if (_sinaRollDisabled) {
      if (newsTickerHintEl) {
        newsTickerHintEl.textContent = code6
          ? "新浪滚动已被浏览器拦截 · 请点下方腾讯自选股 / 腾讯财经"
          : "新浪滚动已被浏览器拦截 · 请点下方腾讯财经链接";
      }
      return;
    }

    loadSinaRollJsonp(
      function (payload) {
        const sina = parseSinaRoll(payload);
        const merged = mergeAndRank(sina, code6, symbol, displayName);
        renderNewsMarquee(merged);
        if (newsTickerHintEl && sina.length === 0) {
          newsTickerHintEl.textContent =
            (newsTickerHintEl.textContent || "").split("；")[0] + "；滚动接口无数据";
        }
      },
      function () {
        if (newsTickerHintEl) {
          newsTickerHintEl.textContent = code6
            ? "新浪滚动未加载（可能被浏览器拦截）· 请点下方腾讯自选股 / 腾讯财经"
            : "新浪滚动未加载（可能被浏览器拦截）· 请点下方腾讯财经链接";
        }
        renderNewsMarquee(preMerged);
      }
    );
  }

  function setKbQaStatus(text) {
    if (!kbQaStatus) return;
    kbQaStatus.textContent = text || "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return "";
  }

  function renderInlineMarkdown(s) {
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, "<code class=\"px-1 py-0.5 rounded bg-slate-800 text-slate-100\">$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, url) {
      const href = safeUrl(url);
      const t = escapeHtml(text);
      if (!href) return t;
      return "<a class=\"underline underline-offset-2 text-emerald-300 hover:text-emerald-200\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"" +
        escapeHtml(href) +
        "\">" +
        t +
        "</a>";
    });
    return out;
  }

  function renderMarkdownToHtml(md) {
    const raw = String(md || "");
    const blocks = raw.split(/\n```/);
    let html = "";
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (bi === 0) {
        html += renderMarkdownNoFences(b);
      } else {
        const idx = b.indexOf("\n");
        const fenceBody = idx >= 0 ? b.slice(idx + 1) : b;
        const restIdx = fenceBody.indexOf("\n```");
        const code = restIdx >= 0 ? fenceBody.slice(0, restIdx) : fenceBody;
        const tail = restIdx >= 0 ? fenceBody.slice(restIdx + 4) : "";
        html += "<pre class=\"mt-2 mb-2 overflow-auto rounded-xl bg-[#0b0f15] border border-slate-700/40 p-3 text-[12px] leading-relaxed\"><code>" +
          escapeHtml(code) +
          "</code></pre>";
        html += renderMarkdownNoFences(tail);
      }
    }
    return html;
  }

  function renderMarkdownNoFences(md) {
    const lines = String(md || "").split(/\r?\n/);
    let html = "";
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const m1 = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (m1) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        const level = m1[1].length;
        const cls =
          level === 1
            ? "text-base font-bold text-white mt-2"
            : level === 2
              ? "text-sm font-semibold text-white mt-2"
              : "text-sm font-semibold text-slate-200 mt-2";
        html += "<div class=\"" + cls + "\">" + renderInlineMarkdown(m1[2]) + "</div>";
        continue;
      }

      const m2 = trimmed.match(/^[-*]\s+(.*)$/);
      if (m2) {
        if (!inList) {
          html += "<ul class=\"list-disc pl-5 mt-2 space-y-1\">";
          inList = true;
        }
        html += "<li>" + renderInlineMarkdown(m2[1]) + "</li>";
        continue;
      }

      if (inList) {
        html += "</ul>";
        inList = false;
      }

      if (!trimmed) {
        html += "<div class=\"h-2\"></div>";
        continue;
      }

      html += "<p class=\"mt-1\">" + renderInlineMarkdown(trimmed) + "</p>";
    }
    if (inList) html += "</ul>";
    return html;
  }

  let _kbAnswerPages = [""];
  let _kbAnswerPageIndex = 0;

  function paginateMarkdown(md) {
    const text = String(md || "").trim();
    if (!text) return [""];
    const parts = text.split(/\n{2,}/);
    const pages = [];
    let cur = "";
    const maxChars = 850;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (!p) continue;
      const candidate = cur ? cur + "\n\n" + p : p;
      if (candidate.length > maxChars && cur) {
        pages.push(cur);
        cur = p;
      } else {
        cur = candidate;
      }
    }
    if (cur) pages.push(cur);
    return pages.length ? pages : [text];
  }

  function renderKbAnswerPage(index) {
    if (!kbAnswer) return;
    const i = Math.max(0, Math.min(index, _kbAnswerPages.length - 1));
    _kbAnswerPageIndex = i;
    kbAnswer.innerHTML = renderMarkdownToHtml(_kbAnswerPages[i] || "");
    if (kbPageLabel) kbPageLabel.textContent = String(i + 1) + "/" + String(_kbAnswerPages.length);
    if (kbPrevPageBtn) kbPrevPageBtn.disabled = i <= 0;
    if (kbNextPageBtn) kbNextPageBtn.disabled = i >= _kbAnswerPages.length - 1;
  }

  function setKbQaAnswer(text) {
    const md = String(text || "");
    _kbAnswerPages = paginateMarkdown(md);
    renderKbAnswerPage(0);
  }

  function updateKbQuotaUI() {
    if (!kbQuotaLine) return;
    if (effectiveUsageBypass || effectiveVipUnlimited) {
      kbQuotaLine.textContent = "问答次数：不限";
      return;
    }
    const used = Math.max(0, _kbqa_limit);
    const left = Math.max(0, MAX_KB_QA_TRIES - used);
    const vipFilled = kbVipKey && String(kbVipKey.value || "").trim();
    kbQuotaLine.textContent =
      "剩余问答次数：" +
      String(left) +
      "（总计 " +
      String(MAX_KB_QA_TRIES) +
      "）" +
      (vipFilled ? " · 已填写 VIP 密钥（由服务端校验）" : "");
  }

  function setKbQaSources(sources) {
    if (!kbSources) return;
    kbSources.innerHTML = "";
    const list = Array.isArray(sources) ? sources : [];
    if (!list.length) {
      kbSources.textContent = "—";
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      const line = document.createElement("div");
      line.className = "py-1 border-b border-slate-700/50 last:border-b-0";
      const title = String(it.title || it.media_id || "").trim();
      const snippet = String(it.snippet || "").trim();
      line.textContent = title + (snippet ? " · " + snippet : "");
      kbSources.appendChild(line);
    }
  }

  function openKbQaModal() {
    if (!kbQaModal) return;
    kbQaModal.classList.remove("hidden");
    kbQaModal.style.display = "block";
    if (kbQaOpenBtn) kbQaOpenBtn.textContent = "▼ 收起问答";
    // Auto-fetch KB list if not loaded yet
    if (_kbListData && !_kbListData.length) fetchKbList();
  }

  function closeKbQaModal() {
    if (!kbQaModal) return;
    kbQaModal.classList.add("hidden");
    kbQaModal.style.display = "none";
    if (kbQaOpenBtn) kbQaOpenBtn.textContent = "▶ 展开问答";
  }

  function stripHtmlToText(s) {
    const raw = String(s || "");
    return raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const ms = Number(timeoutMs || 0) > 0 ? Number(timeoutMs || 0) : 0;
    if (typeof AbortController === "function" && ms > 0) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => {
        try {
          ctrl.abort(new DOMException("timeout", "TimeoutError"));
        } catch {
          ctrl.abort();
        }
      }, ms);
      try {
        return await fetch(url, Object.assign({}, options || {}, { signal: ctrl.signal }));
      } finally {
        clearTimeout(tid);
      }
    }
    return await fetch(url, options || {});
  }

  // 分页状态
  let _kbPage = 0;
  const _kbPageSize = 5;

  // 更新 KB 已选计数 + 分页标签
  function updateKbMultiLabel() {
    const selected = Array.from(_selectedKbIds);
    if (kbMultiCount) kbMultiCount.textContent = "已选 " + selected.length + " 个";
    const totalPages = Math.max(1, Math.ceil((_kbListData.length || 1) / _kbPageSize));
    if (kbPageLabel2) kbPageLabel2.textContent = `${_kbPage + 1}/${totalPages}`;
    if (kbPrevPageBtn2) kbPrevPageBtn2.disabled = _kbPage <= 0;
    if (kbNextPageBtn2) kbNextPageBtn2.disabled = _kbPage >= totalPages - 1;
  }

  // 渲染当前页 KB 选项
  function renderKbPage() {
    if (!kbMultiOptions) return;
    kbMultiOptions.innerHTML = "";
    const list = _kbListData || [];
    if (!list.length) {
      kbMultiOptions.innerHTML = '<div style="padding:12px;font-size:13px;color:#64748b">未获取到知识库</div>';
      return;
    }
    const start = _kbPage * _kbPageSize;
    const pageItems = list.slice(start, start + _kbPageSize);
    pageItems.forEach(kb => {
      const div = document.createElement("label");
      div.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;color:#fff";
      div.onmouseover = () => { div.style.background = "rgba(51,65,85,.4)" };
      div.onmouseout = () => { div.style.background = "" };
      const checked = _selectedKbIds.has(kb.id);
      div.innerHTML = `
        <input type="checkbox" value="${kb.id}" style="accent-color:#3b82f6;flex-shrink:0" ${checked ? "checked" : ""} />
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.25">${kb.name}</span>
      `;
      const cb = div.querySelector("input");
      const MAX_KB = 2;
      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (_selectedKbIds.size >= MAX_KB) {
            cb.checked = false;
            setKbQaStatus(`最多只能选择 ${MAX_KB} 个知识库以避免超时`);
            return;
          }
          _selectedKbIds.add(kb.id);
        } else {
          _selectedKbIds.delete(kb.id);
        }
        updateKbMultiLabel();
      });
      kbMultiOptions.appendChild(div);
    });
    updateKbMultiLabel();
  }

  // 渲染 KB 列表（重置到第一页）
  function renderKbOptions(list) {
    _kbListData = Array.isArray(list) ? list : [];
    _kbPage = 0;
    renderKbPage();
  }

  async function fetchKbList() {
    try {
      setKbQaStatus("正在拉取知识库列表…");
      const res = await fetchWithTimeout("/api/kb/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }, 60000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((data && data.error) || ("HTTP_" + String(res.status))));
      const list = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : [];
      _kbListData = list;
      _selectedKbIds = new Set();
      if (list.length === 1) _selectedKbIds.add(list[0].id);
      renderKbOptions(list);
      updateKbMultiLabel();
      setKbQaStatus(list.length ? "知识库列表已更新（共 " + list.length + " 个相关知识库）。" : "没有可用的知识库。");
    } catch (e) {
      const msg = String(e && e.message ? e.message : "").trim();
      if (kbMultiOptions) kbMultiOptions.innerHTML = '<div style="padding:8px 12px;font-size:13px;color:#f87171">加载失败</div>';
      if (kbMultiOptions) kbMultiOptions.innerHTML = '<div style="padding:8px 12px;font-size:13px;color:#f87171">加载失败，请刷新</div>';
      setKbQaStatus(msg && msg !== "BAD_STATUS" && msg !== "AbortError" ? "问答服务错误：" + msg : "问答服务未响应，请稍后重试。");
    }
  }

  // KB 分页按钮
  if (kbPrevPageBtn2) {
    kbPrevPageBtn2.addEventListener("click", () => {
      if (_kbPage > 0) { _kbPage--; renderKbPage(); }
    });
  }
  if (kbNextPageBtn2) {
    kbNextPageBtn2.addEventListener("click", () => {
      const totalPages = Math.ceil((_kbListData.length || 1) / _kbPageSize);
      if (_kbPage < totalPages - 1) { _kbPage++; renderKbPage(); }
    });
  }

  async function askKbQuestion() {
    if (!kbQuestion) return;
    await syncAdminAuthStatus();
    const selectedIds = Array.from(_selectedKbIds);
    const q = (kbQuestion.value || "").trim();
    const vipKey = kbVipKey ? String(kbVipKey.value || "").trim() : "";
    const hasVip = Boolean(vipKey) || effectiveVipUnlimited;
    if (!hasVip && !effectiveUsageBypass && _kbqa_limit >= MAX_KB_QA_TRIES) {
      if (lockModal) lockModal.classList.remove("hidden");
      setKbQaStatus("问答次数已用尽，请联系高级顾问获取 VIP 增强密钥。");
      updateKbQuotaUI();
      return;
    }
    if (!selectedIds.length) {
      setKbQaStatus("请先选择至少一个知识库。");
      return;
    }
    if (!q) {
      setKbQaStatus("请输入问题。");
      return;
    }

    const isMulti = selectedIds.length > 1;
    if (kbAskBtn) {
      kbAskBtn.disabled = true;
      kbAskBtn.textContent = isMulti ? "多库检索+生成中…" : "检索+生成中…";
    }
    setKbQaAnswer("");
    setKbQaSources([]);
    setKbQaStatus("正在检索知识库 + 生成回答（DeepSeek模型响应需要10-40秒，请耐心等待）…");

    try {
      if (!effectiveVipUnlimited && vipKey && !effectiveUsageBypass && _kbqa_limit >= MAX_KB_QA_TRIES) {
        const vr = await fetchWithTimeout("/api/vip/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: vipKey })
        }, 6000);
        const vj = await vr.json().catch(() => ({}));
        if (!vj || vj.ok !== true) {
          if (lockModal) lockModal.classList.remove("hidden");
          setKbQaStatus("VIP 密钥无效或已过期，请联系高级顾问获取新的密钥。");
          return;
        }
      }

      const res = await fetchWithTimeout("/api/qa/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_base_ids: isMulti ? selectedIds : undefined,
          knowledge_base_id: !isMulti ? selectedIds[0] : undefined,
          question: q,
          trial_index: effectiveUsageBypass || effectiveVipUnlimited ? 0 : _kbqa_limit + 1,
          vip_key: vipKey,
          vip_unlimited: effectiveVipUnlimited
        })
      }, 120000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          if (lockModal) lockModal.classList.remove("hidden");
          setKbQaStatus("问答次数已用尽，请联系高级顾问获取 VIP 增强密钥。");
          return;
        }
        setKbQaStatus(String(data.error || "服务端返回错误"));
        return;
      }
      if (!hasVip && !effectiveUsageBypass) {
        _kbqa_limit += 1;
        localStorage.setItem(KB_QA_STORAGE_KEY, String(_kbqa_limit));
        updateKbQuotaUI();
      }
      setKbQaAnswer(String(data.answer || "").trim() || "（无回答）");
      const src = Array.isArray(data.sources) ? data.sources : [];
      setKbQaSources(
        src.map((x) => ({
          media_id: x.media_id,
          title: x.title,
          snippet: stripHtmlToText(x.highlight_content || x.snippet || "")
        }))
      );
      const srcNote = data.retrieval?.mode === "multi_kb" ? "（内容来自多知识源整合）" : "";
      setKbQaStatus("完成。" + srcNote);
    } catch (e) {
      const name = String(e && e.name ? e.name : "");
      const msg = String(e && e.message ? e.message : "").trim();
      const timedOut =
        name === "TimeoutError" ||
        name === "AbortError" ||
        /aborted|timeout/i.test(msg);
      if (timedOut) {
        setKbQaStatus("请求超时或已中断（知识库检索+生成可能较慢），请稍后重试；若经常发生可检查网络或联系服务端调大超时。");
      } else if (msg) {
        setKbQaStatus("请求失败：" + msg);
      } else {
        setKbQaStatus("请求失败，请稍后重试。");
      }
    } finally {
      if (kbAskBtn) {
        kbAskBtn.disabled = false;
        kbAskBtn.textContent = "提问";
      }
    }
  }

  async function fetchVipKeyFromServer() {
    if (lockModal) lockModal.classList.remove("hidden");
    setKbQaStatus("请联系高级顾问 wechat: XLN31689 获取 VIP 增强密钥。");
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

    if (!effectiveUsageBypass) {
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

      if (!effectiveUsageBypass) {
        _u_limit += 1;
        localStorage.setItem(STORAGE_KEY, String(_u_limit));
        updateTriesLeftUI();
      }

      _s_data.code = data.code;
      _s_data.basePrice = data.basePrice;
      _s_data.currentPrice = data.currentPrice;
      _s_data.anchorPrice = data.currentPrice;
      _s_data.principal = principal;
      _s_data.stockDisplayName = data.name || "";

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
      refreshNewsMarquee();
      startLiveFeed();

      // 更新K线图
      if (_klineCurrentCode !== code || !_klineChart) {
        _klineCurrentCode = code;
        updateKlineChart(code, _klineCurrentPeriod);
      }
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
    console.log("[DEBUG] init called, effectiveUsageBypass=" + effectiveUsageBypass + ", _u_limit=" + _u_limit + ", cookie=" + document.cookie);
    
    // 立即检查localStorage管理员状态并解锁（不等待网络请求）
    const localAdminAuthed = isAdminAuthed();
    if (localAdminAuthed) {
      console.log("[DEBUG] localStorage admin detected, unlocking immediately");
      unlockState();
    } else if (_u_limit > MAX_FREE_TRIES) {
      console.log("[DEBUG] no admin, _u_limit exceeded, locking");
      setLockedState();
    }
    
    // 异步同步服务器状态（不阻塞UI）
    syncAdminAuthStatus()
      .then(() => {
        console.log("[DEBUG] syncAdminAuthStatus done, effectiveUsageBypass=" + effectiveUsageBypass);
        if (effectiveUsageBypass) unlockState();
        else if (_u_limit > MAX_FREE_TRIES) setLockedState();
      })
      .catch(() => {});

    updateTriesLeftUI();

    queryBtn.addEventListener("click", runQuery);

    if (codeErrorOkBtn && codeErrorModal) {
      codeErrorOkBtn.addEventListener("click", hideCodeErrorModal);
      codeErrorModal.addEventListener("click", function (ev) {
        if (ev.target === codeErrorModal) hideCodeErrorModal();
      });
    }

    updateMarketStatusLine();

    window.addEventListener(
      "error",
      function (ev) {
        try {
          const file = String(ev && ev.filename ? ev.filename : "");
          const msg = String(ev && ev.message ? ev.message : "");
          if (file.indexOf("feed.mix.sina.com.cn/api/roll/get") >= 0) {
            if (msg.toLowerCase().indexOf("illegal") >= 0 || msg.indexOf("Unexpected identifier") >= 0) {
              _sinaRollDisabled = true;
              if (typeof ev.preventDefault === "function") ev.preventDefault();
            }
          }
        } catch {}
      },
      true
    );

    const runIdle =
      typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback
        : function (cb) {
            return setTimeout(cb, 0);
          };
    runIdle(function () {
      refreshNewsMarquee();
      setInterval(refreshNewsMarquee, 5 * 60 * 1000);
    });
    if (codeInput) {
      codeInput.addEventListener("input", scheduleNewsRefresh);
    }

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

    const adminModal = document.getElementById("adminModal");
    const adminCloseBtn = document.getElementById("adminCloseBtn");
    const adminUser = document.getElementById("adminUser");
    const adminPass = document.getElementById("adminPass");
    const adminLoginBtn = document.getElementById("adminLoginBtn");
    const adminStatus = document.getElementById("adminStatus");

    function openAdminModal() {
      if (!adminModal) return;
      adminModal.classList.remove("hidden");
      if (adminStatus) adminStatus.textContent = "";
      if (adminUser) adminUser.value = "";
      if (adminPass) adminPass.value = "";
    }

    function closeAdminModal() {
      if (!adminModal) return;
      adminModal.classList.add("hidden");
    }

    if (adminCloseBtn) adminCloseBtn.addEventListener("click", closeAdminModal);
    if (adminModal) {
      adminModal.addEventListener("click", function (ev) {
        if (ev.target === adminModal) closeAdminModal();
      });
    }

    if (wechatIdEl) {
      wechatIdEl.addEventListener("dblclick", function () {
        openAdminModal();
      });
    }

    if (adminLoginBtn) {
      adminLoginBtn.addEventListener("click", async function () {
        const u = adminUser ? String(adminUser.value || "").trim() : "";
        const p = adminPass ? String(adminPass.value || "").trim() : "";
        if (!u || !p) {
          if (adminStatus) adminStatus.textContent = "请输入账号和密码。";
          return;
        }
        if (adminStatus) adminStatus.textContent = "正在登录…";
        try {
          const res = await fetchWithTimeout(
            "/api/admin/login",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user: u, pass: p })
            },
            30000
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (adminStatus) adminStatus.textContent = String(data.error || "登录失败");
            return;
          }
          try {
            localStorage.setItem("_admin_authed", "1");
            // 设置cookie作为微信备选（有效期1年）
            document.cookie = "_admin_c=1; path=/; max-age=31536000";
            // 管理员登录成功后清除问答次数限制
            localStorage.removeItem(KB_QA_STORAGE_KEY);
            _kbqa_limit = 0;
            updateKbQuotaUI();
          } catch {}
          if (adminStatus) adminStatus.textContent = "已登录，已解锁不限次。";
          // 立即关闭所有弹窗
          if (lockModal) lockModal.classList.add("hidden");
          if (adminModal) adminModal.classList.add("hidden");
          unlockState();
          // 不reload页面，状态已保存在localStorage和cookie中
        } catch (e) {
          const name = String(e && e.name ? e.name : "");
          const msg = String(e && e.message ? e.message : "").trim();
          const slow =
            name === "TimeoutError" ||
            name === "AbortError" ||
            /timeout|aborted/i.test(msg);
          if (adminStatus) {
            adminStatus.textContent = slow
              ? "登录请求超时或网络中断，请稍后重试。"
              : "登录失败，请稍后重试。";
          }
        }
      });
    }

    if (kbQaOpenBtn && kbQaModal) {
      kbQaOpenBtn.addEventListener("click", async function () {
        await syncAdminAuthStatus();
        openKbQaModal();
        updateKbQuotaUI();
        setKbQaStatus("");
        setKbQaAnswer("");
        setKbQaSources([]);
        fetchKbList();
      });
    }
    if (kbQaCloseBtn && kbQaModal) {
      kbQaCloseBtn.addEventListener("click", closeKbQaModal);
      kbQaModal.addEventListener("click", function (ev) {
        if (ev.target === kbQaModal) closeKbQaModal();
      });
    }
    if (kbRefreshBtn) {
      kbRefreshBtn.addEventListener("click", fetchKbList);
    }
    if (kbAskBtn) {
      kbAskBtn.addEventListener("click", askKbQuestion);
    }
    if (kbVipFetchKeyBtn) {
      kbVipFetchKeyBtn.addEventListener("click", fetchVipKeyFromServer);
    }
    if (kbPrevPageBtn) {
      kbPrevPageBtn.addEventListener("click", function () {
        renderKbAnswerPage(_kbAnswerPageIndex - 1);
      });
    }
    if (kbNextPageBtn) {
      kbNextPageBtn.addEventListener("click", function () {
        renderKbAnswerPage(_kbAnswerPageIndex + 1);
      });
    }
    if (kbQuestion) {
      kbQuestion.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          askKbQuestion();
        }
      });
    }
  }

  // ===== K线图表 =====
  let _klineChart = null;
  let _klineCandleSeries = null;
  let _klineVolumeSeries = null;
  let _klineCurrentCode = null;
  let _klineCurrentPeriod = 20;

  // 转换 K线数据为 lightweight-charts 格式
  function convertKlineBar(dateStr, open, close, high, low, vol) {
    const d = new Date(dateStr);
    const t = Math.floor(d.getTime() / 1000); // Unix timestamp seconds
    return { time: t, open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close), value: parseFloat(vol) };
  }

  // 腾讯财经日K（主数据源）
  async function fetchKlineTencent(symbol, days) {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayhfq&param=${symbol},day,,,${days},qfq`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/kline_dayhfq=({.*})/);
    if (!m) return null;
    const json = JSON.parse(m[1]);
    const symbolData = json?.data?.[symbol];
    if (!symbolData) return null;
    const bars = symbolData.qfqday || symbolData.day || [];
    if (!Array.isArray(bars) || !bars.length) return null;
    return bars.map(b => convertKlineBar(b[0], b[1], b[2], b[3], b[4], b[5]));
  }

  // 新浪财经日K（备用数据源）
  async function fetchKlineSina(symbol, days) {
    // symbol 格式: sh600000 / sz000001
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=5&datalen=${days}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json) || !json.length) return null;
    return json.map(b => convertKlineBar(b.day, b.open, b.close, b.high, b.low, b.volume));
  }

  // 主入口：先腾讯，失败则新浪
  async function fetchKlineData(symbol, days) {
    let bars = await fetchKlineTencent(symbol, days);
    if (bars) return bars;
    // 备用：尝试新浪（symbol格式兼容）
    bars = await fetchKlineSina(symbol, days);
    if (bars) return bars;
    console.log("[KLINE] 所有数据源均失败");
    return null;
  }

  function initKlineChart() {
    const container = document.getElementById("klineChart");
    if (!container) return;
    // 防止重复初始化
    if (_klineChart) {
      _klineChart.remove();
      _klineChart = null;
      _klineCandleSeries = null;
      _klineVolumeSeries = null;
    }
    try {
      _klineChart = LightweightCharts.createChart(container, {
        width: container.clientWidth || container.offsetWidth || 320,
        height: 160,
        layout: {
          background: { type: "solid", color: "#0f172a" },
          textColor: "#94a3b8",
          fontSize: 11
        },
        grid: {
          vertLines: { color: "rgba(30,41,59,0.6)" },
          horzLines: { color: "rgba(30,41,59,0.6)" }
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: "rgba(96,165,250,0.5)", labelBackgroundColor: "#3b82f6" },
          horzLine: { color: "rgba(96,165,250,0.5)", labelBackgroundColor: "#3b82f6" }
        },
        timeScale: {
          timeVisible: false,
          borderColor: "rgba(30,41,59,0.8)"
        },
        rightPriceScale: {
          borderColor: "rgba(30,41,59,0.8)"
        }
      });

      _klineCandleSeries = _klineChart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444"
      });

      _klineVolumeSeries = _klineChart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
        color: "#3b82f6"
      });
      _klineVolumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 }
      });

      // 十字光标联动 legend
      _klineChart.subscribeCrosshairMove(function (param) {
        const legend = document.getElementById("klineLegend");
        if (!legend || !param || !param.seriesData) return;
        const candleData = param.seriesData.get(_klineCandleSeries);
        const volData = param.seriesData.get(_klineVolumeSeries);
        if (!candleData) return;
        const [o, h, l, c] = [candleData.open, candleData.high, candleData.low, candleData.close];
        const v = volData ? volData.value : 0;
        const fmtV = v >= 10000 ? (v / 10000).toFixed(1) + "万" : String(Math.round(v));
        legend.innerHTML = `<span>日K · </span><span>开 <span class="text-white">${o?.toFixed(2) ?? "--"}</span></span> <span>高 <span class="text-white">${h?.toFixed(2) ?? "--"}</span></span> <span>低 <span class="text-white">${l?.toFixed(2) ?? "--"}</span></span> <span>收 <span class="text-white">${c?.toFixed(2) ?? "--"}</span></span> <span>量 <span class="text-white">${fmtV}</span></span>`;
      });

      // resize 监听
      const ro = new ResizeObserver(() => {
        if (_klineChart && container) {
          _klineChart.applyOptions({ width: container.clientWidth || 320 });
        }
      });
      ro.observe(container);
    } catch (e) {
      console.log("[KLINE] init error:", e.message);
    }
  }

  async function updateKlineChart(code, period) {
    if (!code) return;
    const symbol = codeToSymbol(code);
    if (!symbol) return;
    if (!_klineChart) initKlineChart();
    if (!_klineChart || !_klineCandleSeries) return;

    _klineCurrentCode = code;
    const days = period || _klineCurrentPeriod;
    const data = await fetchKlineData(symbol, days);
    if (!data || !data.length) {
      console.log("[KLINE] no data for", symbol);
      return;
    }

    // 限制最大显示数量
    const maxBars = Math.max(days, 60);
    const trimmed = data.length > maxBars ? data.slice(-maxBars) : data;

    _klineCandleSeries.setData(trimmed.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    })));
    _klineVolumeSeries.setData(trimmed.map(d => ({
      time: d.time,
      value: d.value,
      color: d.close >= d.open ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"
    })));

    // 显示最新一根K线的光标（十字光标移到最新）
    const last = trimmed[trimmed.length - 1];
    if (last) {
      _klineChart.moveCrosshairTo(last.time);
      // 更新 legend 显示最新
      const legend = document.getElementById("klineLegend");
      if (legend) {
        const v = last.value;
        const fmtV = v >= 10000 ? (v / 10000).toFixed(1) + "万" : String(Math.round(v));
        legend.innerHTML = `<span>日K · </span><span>开 <span class="text-white">${last.open.toFixed(2)}</span></span> <span>高 <span class="text-white">${last.high.toFixed(2)}</span></span> <span>低 <span class="text-white">${last.low.toFixed(2)}</span></span> <span>收 <span class="text-white">${last.close.toFixed(2)}</span></span> <span>量 <span class="text-white">${fmtV}</span></span>`;
      }
    }
    _klineChart.timeScale().fitContent();
  }

  // ===== init 末尾添加 K线初始化 =====
  initKlineChart();

  // 周期按钮事件
  document.querySelectorAll(".kbtn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".kbtn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      _klineCurrentPeriod = parseInt(btn.getAttribute("data-p") || "20", 10);
      if (_klineCurrentCode) updateKlineChart(_klineCurrentCode, _klineCurrentPeriod);
    });
  });

  // runQuery 成功后自动更新K线
  const _origApplyPriceUI = applyPriceUI;

  init();
})();
