# Alpha Terminal v2 — AI量化策略获客系统
<img width="431" height="877" alt="image" src="https://github.com/user-attachments/assets/8eccc63a-153b-46c1-b283-45f85eade56f" />

> 输入任意股票代码，看AI风控策略如何帮你"跌少亏、涨跟上"

## 🎯 项目定位

**获客工具**，不是交易系统。核心卖点：股票跌了不可怕，有策略只回撤一点点。

## 🏗️ 架构

```
用户输入股票 → 回测API(v4猎手引擎) → 持有vs策略对比 → 加微信留资获客
```

### 前端
- `index.html` — 主获客页面（移动端优先）
- `mini.html` — 小程序适配版（微信webview）
- 深色科技风 | 3步漏斗：输入→对比→留资

### 后端
- `backtest_api.py` — 回测HTTP服务 v4（端口8788）
  - 基于猎手ATR止损引擎
  - 3种策略：保守/稳健/激进
  - 持有vs策略双曲线对比
  - 留资API: POST /api/leads

### Nginx路由
| 路径 | 后端 |
|------|------|
| /zhuli/ | 静态页面 /var/www/zhuli/ |
| /xuequ/bt/ | 回测API :8788/api/ |
| /xuequ/api/ | 学区房API :8890 |

## 📱 获客漏斗

1. **输入** — 一个股票代码输入框 + 3策略选择
2. **对比** — 持有收益(红) vs 策略收益(绿) + 权益曲线
3. **留资** — 微信二维码(XLN31689) + 复制微信号 + 手机号提交

## 🔧 回测引擎 v4

基于猎手交易系统的ATR止损策略：

| 策略 | ATR倍数 | 止损 | 止盈 |
|------|---------|------|------|
| 🛡️保守 | 1.5x | 3% | 8% |
| ⚖️稳健 | 2.0x | 5% | 15% |
| 🚀激进 | 3.0x | 8% | 25% |

逻辑：
- 金叉(MA快线上穿慢线)→买入
- ATR止损线 / 固定止损线 / 趋势转弱 → 卖出
- 跌的时候止损离场少亏，涨的时候持有跟上

## 📊 API接口

```
GET /api/backtest?code=600519&profile=conservative
返回：策略收益、持有收益、回撤对比、权益曲线

POST /api/leads
Body: {"contact":"13800138000","stock":"600519","strategy":"moderate"}
存储：/var/www/zhuli/leads.json
```

## 🚀 部署

```bash
# 回测API
python3 backtest_api.py  # 端口8788

# Nginx
# 已配置在 /etc/nginx/sites-enabled/aialter
```

线上地址：https://www.aialter.site/zhuli/

## 📁 文件说明

| 文件 | 说明 |
|------|------|
| index.html | 主获客页面 |
| mini.html | 小程序 web-view 页面（合规版） |
| privacy.html | 用户隐私保护指引 |
| miniprogram/ | 微信小程序壳（web-view 加载 mini.html） |
| backtest_api.py | 回测API v4 |
| wechat.jpg | 微信二维码 |
| core.js | 旧版K线页面(保留) |
| README_v1.md | v1版README(归档) |

## 🌿 分支说明

本仓库远程有两个分支，用途不同，**日常开发与部署请只用 `main`**。

| 分支 | 状态 | 说明 |
|------|------|------|
| **`main`** | ✅ 活跃主线 | 当前产品代码：回测获客、mini.html、微信小程序、backtest_api 等。**所有新功能、修复、发布均提交并推送到此分支。** |
| **`master`** | 📦 历史备份 | 旧版 IMA 知识库问答相关代码（行情快照、知识库缓存等）。**项目已不再使用 IMA，此分支仅作备份保留，不合并、不维护、不部署。** |

```bash
# 克隆后默认在 main
git clone git@github.com:eninem123/Alpha_Terminal.git
cd Alpha_Terminal

# 日常：只在 main 上开发并推送
git checkout main
git pull origin main
# ... 修改代码 ...
git add .
git commit -m "your message"
git push origin main

# 如需查看旧 IMA 实现（只读参考，不要合并）
git fetch origin
git log origin/master --oneline
```

> **注意：** `main` 与 `master` 无共同 Git 历史（`master` 为独立根提交），请勿对 `master` 做 merge/rebase；需要旧代码时单独 checkout 查阅即可。

## ⚠️ 注意

- 留资数据存在服务器 `/var/www/zhuli/leads.json`
- 微信号: XLN31689
- 回测结果仅供获客展示，不构成投资建议
- 小程序页面：`miniprogram/` 上传微信开发者工具；线上 H5 需同步部署 `mini.html` 与 `privacy.html` 到 `/var/www/zhuli/`

---

*Powered by 猎手交易引擎 v4 | ATR止损+趋势跟踪*
