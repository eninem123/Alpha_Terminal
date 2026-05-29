#!/usr/bin/env python3
"""backtest_api.py — 回测HTTP服务 v2
端口: 8787 (nginx /api/ 代理)
接口:
  GET /api/backtest?code=600795&strategy=ma_cross&start=20250101&end=20260529
  GET /api/strategies — 策略列表
"""
import sys, os, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))
sys.path.insert(0, "/root/.openclaw/workspace/猎手模拟交易/backtest")
from engine import fetch_klines_tencent, BacktestResult, Trade, strategy_atr_stop
from strategies import strategy_ma_cross

STRATEGIES = {
    "ma_cross": {
        "name": "均线交叉",
        "desc": "MA金叉买、死叉卖",
        "default_params": {"fast": 5, "slow": 20},
        "profiles": {
            "conservative": {"fast": 10, "slow": 30},
            "moderate": {"fast": 5, "slow": 20},
            "aggressive": {"fast": 3, "slow": 10},
        },
    },
    "atr_stop": {
        "name": "ATR止损",
        "desc": "ATR动态止损跟踪趋势",
        "default_params": {"atr_period": 14, "k": 2.0},
        "profiles": {
            "conservative": {"k": 3.0},
            "moderate": {"k": 2.0},
            "aggressive": {"k": 1.5},
        },
    },
}

def run_single_backtest(code, strategy_key, start, end, initial_capital=100000, user_params=None):
    """单只股票回测，返回带权益曲线的结果"""
    strat = STRATEGIES.get(strategy_key)
    if not strat:
        return {"error": f"unknown strategy: {strategy_key}"}

    # profile解析
    up = dict(user_params or {})
    profile = up.pop("profile", "moderate")
    profile_params = strat.get("profiles", {}).get(profile, {})
    params = {**strat["default_params"], **profile_params, **up}

    # 拉K线
    df = fetch_klines_tencent(code, start, end)
    if df is None or df.empty:
        return {"error": f"无法获取 {code} 的K线数据"}

    # 跑策略
    if strategy_key == "ma_cross":
        trades_raw = strategy_ma_cross(df, params)
    elif strategy_key == "atr_stop":
        atr_k = params.get("k", 2.0)
        trades_raw = strategy_atr_stop(code, code, df, atr_k=atr_k)
    else:
        return {"error": "strategy not implemented"}

    # 统一trades格式
    trades = []
    for t in trades_raw:
        if isinstance(t, dict):
            trades.append(t)
        elif isinstance(t, Trade):
            trades.append({
                "code": t.code, "name": t.name,
                "buy_date": t.buy_date, "buy_price": t.buy_price, "shares": t.shares,
                "sell_date": t.sell_date, "sell_price": t.sell_price,
                "pnl": t.pnl, "pnl_pct": t.pnl_pct,
                "hold_days": t.hold_days, "exit_reason": t.exit_reason,
            })

    if not trades:
        return {
            "code": code, "strategy": strat["name"],
            "start": start, "end": end,
            "trades": [], "metrics": None,
            "equity_curve": [{"date": start, "equity": initial_capital}],
        }

    # 计算权益曲线（逐日）
    equity_by_date = {}
    current_equity = initial_capital

    # 按买入日排序
    trades_sorted = sorted(trades, key=lambda x: x.get("buy_date", ""))

    # 简化：按交易顺序累加pnl
    equity_points = [{"date": trades_sorted[0].get("buy_date", start), "equity": initial_capital}]
    for t in trades_sorted:
        current_equity += t.get("pnl", 0)
        sell_date = t.get("sell_date", "")
        if sell_date:
            equity_points.append({"date": sell_date, "equity": round(current_equity, 2)})

    # 统计指标
    total_pnl = sum(t.get("pnl", 0) for t in trades)
    final = initial_capital + total_pnl
    wins = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) <= 0]

    # 最大回撤
    peak = initial_capital
    max_dd = 0
    max_dd_start = ""
    max_dd_end = ""
    dd_start = equity_points[0]["date"] if equity_points else start
    for ep in equity_points:
        eq = ep["equity"]
        if eq > peak:
            peak = eq
            dd_start = ep["date"]
        dd = (peak - eq) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
            max_dd_start = dd_start
            max_dd_end = ep["date"]

    # 年化
    days = (datetime.strptime(end, "%Y%m%d") - datetime.strptime(start, "%Y%m%d")).days
    annual_return = 0
    if days > 0:
        annual_return = round(((final / initial_capital) ** (365 / days) - 1) * 100, 2)

    # Sharpe（简化版，用交易收益率）
    returns = [t.get("pnl_pct", 0) / 100 for t in trades if t.get("pnl_pct")]
    if returns and len(returns) > 1:
        avg_r = sum(returns) / len(returns)
        std_r = (sum((r - avg_r)**2 for r in returns) / len(returns)) ** 0.5
        sharpe = round(avg_r / std_r * (252 ** 0.5), 2) if std_r > 0 else 0
    else:
        sharpe = 0

    metrics = {
        "initial_capital": initial_capital,
        "final_capital": round(final, 2),
        "total_return": round((final / initial_capital - 1) * 100, 2),
        "annual_return": annual_return,
        "max_drawdown": round(max_dd * 100, 2),
        "max_dd_period": f"{max_dd_start} ~ {max_dd_end}",
        "sharpe_ratio": sharpe,
        "total_trades": len(trades),
        "win_rate": round(len(wins) / len(trades) * 100, 2),
        "avg_hold_days": round(sum(t.get("hold_days", 0) for t in trades) / len(trades), 1),
        "profit_factor": round(
            sum(t.get("pnl", 0) for t in wins) / abs(sum(t.get("pnl", 0) for t in losses)),
            2
        ) if losses and sum(t.get("pnl", 0) for t in losses) != 0 else 999,
        "avg_win": round(sum(t.get("pnl", 0) for t in wins) / len(wins), 2) if wins else 0,
        "avg_loss": round(sum(t.get("pnl", 0) for t in losses) / len(losses), 2) if losses else 0,
    }

    return {
        "code": code,
        "strategy": strat["name"],
        "strategy_key": strategy_key,
        "start": start,
        "end": end,
        "params": params,
        "metrics": metrics,
        "trades": trades,
        "equity_curve": equity_points,
    }


class Handler(BaseHTTPRequestHandler):
    LEADS_FILE = "/var/www/zhuli/leads.json"

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/leads":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            try:
                lead = json.loads(body)
            except:
                self._json({"ok": False, "error": "invalid json"}, 400); return

            # Read existing leads
            leads = []
            if os.path.exists(self.LEADS_FILE):
                try:
                    with open(self.LEADS_FILE, "r") as f:
                        leads = json.load(f)
                except:
                    leads = []

            leads.append(lead)
            with open(self.LEADS_FILE, "w") as f:
                json.dump(leads, f, ensure_ascii=False, indent=2)

            self._json({"ok": True, "count": len(leads)})
        else:
            self._json({"error": "not found"}, 404)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/api/strategies":
            self._json({k: {"name": v["name"], "desc": v["desc"], "params": v["default_params"]}
                        for k, v in STRATEGIES.items()})

        elif parsed.path == "/api/backtest":
            code = params.get("code", [""])[0].strip()
            strat_key = params.get("strategy", ["ma_cross"])[0]
            start = params.get("start", ["20250101"])[0]
            end = params.get("end", [datetime.now(CST).strftime("%Y%m%d")])[0]
            initial = float(params.get("initial", ["100000"])[0])

            if not code:
                self._json({"error": "code is required"}); return

            # 用户自定义参数
            profile = params.get("profile", ["moderate"])[0]
            strat = STRATEGIES.get(strat_key, {})
            profile_params = strat.get("profiles", {}).get(profile, {})
            user_params = {}
            for k, v in params.items():
                if k not in ("code", "strategy", "start", "end", "initial", "profile"):
                    try: user_params[k] = float(v[0])
                    except: user_params[k] = v[0]
            # profile → default → user override
            merged = {**strat.get("default_params", {}), **profile_params, **user_params}

            result = run_single_backtest(code, strat_key, start, end, initial, merged)
            self._json(result)

        else:
            self._json({"error": "not found"}, 404)

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[api] {args[0]}")

if __name__ == "__main__":
    port = 8788
    print(f"🚀 Backtest API on :{port}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
