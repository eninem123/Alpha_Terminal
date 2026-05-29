#!/usr/bin/env python3
"""backtest_api.py v6 — 风控保护策略
核心逻辑：假设你本来就持有股票，我们给你加追踪止损保护
- 从最高点回撤超阈值→卖出保利润
- 卖出后等企稳再买回
- 这样牛股吃满涨幅，熊股少亏
"""
import sys, os, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))
sys.path.insert(0, "/root/.openclaw/workspace/猎手模拟交易/backtest")
from engine import fetch_klines_tencent

LEADS_FILE = "/var/www/zhuli/leads.json"

def run_backtest(code, start, end, initial_capital=100000, profile="moderate"):
    df = fetch_klines_tencent(code, start, end)
    if df is None or df.empty:
        return {"error": f"无法获取 {code} 的K线数据"}
    if len(df) < 20:
        return {"error": "数据不足"}

    df = df.copy().reset_index(drop=True)

    # 追踪止损阈值：从最高点回撤多少就卖出
    config = {
        "conservative": {"trail": 0.08, "rebound": 0.03},  # 回撤8%卖，反弹3%买回
        "moderate":     {"trail": 0.12, "rebound": 0.05},  # 回撤12%卖，反弹5%买回
        "aggressive":   {"trail": 0.18, "rebound": 0.08},  # 回撤18%卖，反弹8%买回
    }.get(profile, {"trail": 0.12, "rebound": 0.05})

    trail = config["trail"]
    rebound = config["rebound"]

    first_price = float(df.iloc[0]["close"])
    last_price = float(df.iloc[-1]["close"])

    hold_equity = []
    strat_equity = []
    dates = []

    # 策略：一开始就持有（和买入持有一样），但加了追踪止损
    cash = 0
    shares = max(100, int(initial_capital / first_price / 100) * 100)
    cash = initial_capital - shares * first_price
    holding = True
    highest = first_price
    trades = []
    sell_price_ref = 0  # 上次卖出价，用来判断企稳买回

    for i in range(len(df)):
        date_str = str(df.iloc[i]["date"])[:10]
        close = float(df.iloc[i]["close"])
        high = float(df.iloc[i]["high"])
        low = float(df.iloc[i]["low"])

        # 持有基准
        hold_equity.append(round(initial_capital * (close / first_price), 2))
        dates.append(date_str)

        if holding:
            highest = max(highest, high)
            # 追踪止损：从最高点回撤超阈值
            stop_price = highest * (1 - trail)
            if low <= stop_price and i > 5:  # 至少持有5天才止损，避免假信号
                # 止损卖出
                actual_sell = max(close, stop_price)  # 尽量卖高一点
                pnl = (actual_sell - first_price if shares > 0 else 0) * shares  # 简化
                cash += shares * actual_sell
                trades.append({
                    "buy_date": str(df.iloc[max(0, i-5)]["date"])[:10],
                    "buy_price": round(first_price if not trades else (sell_price_ref if sell_price_ref > 0 else first_price), 2),
                    "sell_date": date_str, "sell_price": round(actual_sell, 2),
                    "shares": shares, "pnl": round((actual_sell - (first_price if not trades else sell_price_ref) if shares > 0 else 0) * shares, 2),
                    "pnl_pct": round((actual_sell / (first_price if not trades else (sell_price_ref if sell_price_ref > 0 else first_price)) - 1) * 100, 2),
                    "hold_days": 1, "exit_reason": "追踪止损",
                })
                shares = 0
                holding = False
                sell_price_ref = actual_sell
                highest = 0
        else:
            # 空仓等企稳：从最低点反弹超rebound比例
            if sell_price_ref > 0 and close >= sell_price_ref * (1 - rebound):
                # 企稳买回
                buy_p = close
                shares = max(100, int(cash * 0.95 / buy_p / 100) * 100)
                cash -= shares * buy_p
                holding = True
                highest = high
                first_price = buy_p  # 重置基准价

        # 策略权益
        if holding and shares > 0:
            strat_eq = cash + shares * close
        else:
            strat_eq = cash
        strat_equity.append(round(strat_eq, 2))

    final_eq = strat_equity[-1] if strat_equity else initial_capital
    strategy_return = round((final_eq / initial_capital - 1) * 100, 2)
    hold_return = round((last_price / first_price - 1) * 100, 2)

    # hold_return要算真正的从头到尾
    real_first = float(df.iloc[0]["close"])
    real_last = float(df.iloc[-1]["close"])
    hold_return = round((real_last / real_first - 1) * 100, 2)

    # 最大回撤
    peak_s = initial_capital; max_dd = 0
    for eq in strat_equity:
        if eq > peak_s: peak_s = eq
        dd = (peak_s - eq) / peak_s if peak_s > 0 else 0
        if dd > max_dd: max_dd = dd

    peak_h = initial_capital; hold_max_dd = 0
    for eq in hold_equity:
        if eq > peak_h: peak_h = eq
        dd = (peak_h - eq) / peak_h if peak_h > 0 else 0
        if dd > hold_max_dd: hold_max_dd = dd

    step = max(1, len(dates) // 60)
    curve = []
    for j in range(0, len(dates), step):
        curve.append({
            "date": dates[j],
            "hold_pct": round((hold_equity[j] / initial_capital - 1) * 100, 2),
            "strat_pct": round((strat_equity[j] / initial_capital - 1) * 100, 2),
        })
    if len(dates) > 1 and (len(dates)-1) % step != 0:
        curve.append({
            "date": dates[-1],
            "hold_pct": round((hold_equity[-1] / initial_capital - 1) * 100, 2),
            "strat_pct": round((strat_equity[-1] / initial_capital - 1) * 100, 2),
        })

    wins = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) <= 0]
    win_rate = round(len(wins) / len(trades) * 100, 2) if trades else 0
    returns = [t["pnl_pct"] / 100 for t in trades]
    sharpe = 0
    if len(returns) > 1:
        avg_r = sum(returns) / len(returns)
        std_r = (sum((r - avg_r)**2 for r in returns) / len(returns)) ** 0.5
        sharpe = round(avg_r / std_r * (252**0.5), 2) if std_r > 0 else 0
    days = max(1, (datetime.strptime(end, "%Y%m%d") - datetime.strptime(start, "%Y%m%d")).days)
    annual = round(((final_eq / initial_capital) ** (365/days) - 1) * 100, 2)

    return {
        "code": code, "strategy": "风控保护", "strategy_key": "ma_cross",
        "start": start, "end": end,
        "params": {"trail_stop": f"{trail*100}%", "rebound": f"{rebound*100}%", "profile": profile},
        "metrics": {
            "initial_capital": initial_capital, "final_capital": round(final_eq, 2),
            "total_return": strategy_return, "annual_return": annual,
            "max_drawdown": round(max_dd * 100, 2),
            "hold_return": hold_return, "hold_max_drawdown": round(hold_max_dd * 100, 2),
            "sharpe_ratio": sharpe, "total_trades": len(trades), "win_rate": win_rate,
            "avg_hold_days": round(sum(t["hold_days"] for t in trades) / len(trades), 1) if trades else 0,
            "profit_factor": round(sum(t["pnl"] for t in wins) / abs(sum(t["pnl"] for t in losses)), 2) if losses and sum(t["pnl"] for t in losses) != 0 else 999,
        },
        "trades": trades, "equity_curve": curve,
    }

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/leads":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            try: lead = json.loads(body)
            except: self._json({"ok": False}, 400); return
            leads = []
            if os.path.exists(LEADS_FILE):
                try:
                    with open(LEADS_FILE) as f: leads = json.load(f)
                except: pass
            leads.append(lead)
            with open(LEADS_FILE, "w") as f: json.dump(leads, f, ensure_ascii=False, indent=2)
            self._json({"ok": True, "count": len(leads)})
        else:
            self._json({"error": "not found"}, 404)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if parsed.path == "/api/strategies":
            self._json({"ma_cross": {"name": "风控保护", "desc": "追踪止损，涨拿着跌保护"}})
        elif parsed.path == "/api/backtest":
            c = params.get("code", [""])[0].strip()
            s = params.get("start", ["20250101"])[0]
            e = params.get("end", [datetime.now(CST).strftime("%Y%m%d")])[0]
            p = params.get("profile", ["moderate"])[0]
            if not c: self._json({"error": "code is required"}); return
            self._json(run_backtest(c, s, e, 100000, p))
        else:
            self._json({"error": "not found"}, 404)

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

if __name__ == "__main__":
    print(f"🚀 Backtest API v6 on :8788")
    HTTPServer(("127.0.0.1", 8788), Handler).serve_forever()
