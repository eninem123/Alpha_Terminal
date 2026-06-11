<div align="center">

# 🖥️ Alpha Terminal

**AI 量化策略获客系统 · 跌少亏 · 涨跟上**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Production-00D26A?style=for-the-badge)]()

**猎手引擎 · ATR 止损 · 三档策略 · 多端获客**

</div>

---

## 🎯 项目简介

Alpha Terminal 是一套**AI 量化策略获客系统**，通过直观的回测对比展示策略优势，实现从流量到留资的完整转化漏斗。

用户只需输入股票代码，即可查看「持有不动」与「AI 策略」的收益对比，直观感受策略的风控能力，最终通过微信/手机号完成留资。

> ⚠️ **风险提示**：本项目仅供学习研究使用，不构成任何投资建议。股市有风险，入市需谨慎。

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端展示层                              │
│  H5 页面  │  小程序  │  微信机器人  │  分享海报              │
├─────────────────────────────────────────────────────────────┤
│                      业务逻辑层                              │
│  回测引擎  │  策略计算  │  数据缓存  │  留资管理            │
├─────────────────────────────────────────────────────────────┤
│                      数据服务层                              │
│  行情数据  │  财务数据  │  舆情数据  │  行业数据            │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ 核心特性

### 📈 智能回测引擎
- **ATR 动态止损**：基于市场波动率自动调整止损位
- **三档策略**：保守/稳健/激进，匹配不同风险偏好
- **双曲线对比**：持有收益(红) vs 策略收益(绿)，直观对比
- **实时计算**：秒级回测，无需等待

### 📱 多端获客矩阵
| 端 | 场景 | 转化率 |
|---|------|:------:|
| H5 主页面 | 公众号/朋友圈/社群分享 | ⭐⭐⭐ |
| 小程序版 | 微信生态内传播 | ⭐⭐⭐⭐ |
| 微信机器人 | 1对1 智能客服 | ⭐⭐⭐⭐⭐ |
| 分享海报 | 朋友圈裂变传播 | ⭐⭐ |

### 💰 获客漏斗
1. **吸引** — 「测测你的股票能少亏多少」
2. **参与** — 输入股票代码，3秒出结果
3. **震撼** — 策略 vs 持有 收益差距可视化
4. **留资** — 微信二维码 + 手机号提交

### 🤖 猎手策略引擎
- 基于 HunterClaw 同款 ATR 止损算法
- 自动识别趋势/震荡行情
- 动态仓位管理
- 熔断保护机制

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Python 3.10+
- 云服务器（推荐 2核4G 起步）

### 部署步骤

```bash
# 1. 克隆项目
git clone https://github.com/eninem123/Alpha_Terminal.git
cd Alpha_Terminal

# 2. 安装前端依赖
npm install

# 3. 安装 Python 依赖
pip install -r requirements.txt

# 4. 配置环境变量
cp unlock-secret.example.js unlock-secret.js
# 编辑 unlock-secret.js，填入行情源密钥等配置

# 5. 启动回测 API 服务
python backtest_api.py

# 6. 启动前端服务（或部署静态页面）
node server.js
```

---

## 📁 项目结构

```
Alpha_Terminal/
├── index.html              # 主获客页面（移动端优先）
├── mini.html               # 小程序适配版
├── zhuli.html              # 助理落地页
├── poster-generator.html   # 分享海报生成
├── privacy.html            # 隐私政策页
├── server.js               # Node.js 服务端
├── backtest_api.py         # 回测 API 服务（端口 8788）
├── fapai_api.py            # 发牌系统 API
├── fapai_crawler.py        # 发牌数据爬虫
├── fapai_playwright.py     # Playwright 自动化脚本
├── weixin_bot_creator.py   # 微信机器人生成器
├── oauth.py                # OAuth 认证模块
├── core.js                 # 前端核心逻辑
├── quote-utils.mjs         # 行情工具函数
├── gen_manual.mjs          # 说明书生成器
├── routes/                 # 路由模块
├── middleware/             # 中间件
├── miniprogram/            # 小程序源码
├── tests/                  # 测试文件
├── ScreenShot/             # 截图资源
├── package.json            # 项目配置
├── tailwind.config.cjs     # Tailwind 配置
├── .gitignore              # Git 忽略配置
└── README.md               # 项目说明
```

---

## 📊 策略参数

### 三档策略对比

| 策略类型 | ATR 倍数 | 止损幅度 | 目标收益 | 适用人群 |
|---------|:--------:|:--------:|:--------:|---------|
| 🛡️ 保守型 | 1.5x | 3% | 8% | 风险厌恶型 |
| ⚖️ 稳健型 | 2.0x | 5% | 15% | 平衡型投资者 |
| 🚀 激进型 | 3.0x | 8% | 25% | 风险偏好型 |

### 回测指标
- **回测周期**：近 3 年日 K 线数据
- **手续费**：单边 0.03% + 印花税 0.1%（卖出）
- **滑点**：0.1% 模拟真实交易冲击成本
- **基准**：沪深 300 指数对比

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端 | HTML5 + Tailwind CSS + 原生 JS |
| 后端 | Node.js + Express + Python Flask |
| 行情源 | 新浪财经 / 腾讯财经 / 通达信 |
| 回测引擎 | 自研 ATR 止损算法 |
| 数据存储 | JSON 文件 / SQLite |
| 部署方式 | Nginx + Systemd / Docker |
| 小程序 | 微信原生小程序 |
| 自动化 | Playwright |

---

## 📈 获客效果

> 以下为实测数据，仅供参考

| 指标 | 数值 |
|------|:----:|
| 页面访问 → 输入股票 转化率 | ~40% |
| 查看结果 → 加微信 转化率 | ~15% |
| 平均获客成本 | ¥5-15/人 |
| 单页面日活峰值 | 500+ |

---

## 🔧 API 接口

### 回测接口
```
POST /api/backtest
Content-Type: application/json

{
  "code": "600519",
  "strategy": "moderate"
}
```

### 留资接口
```
POST /api/leads
Content-Type: application/json

{
  "contact": "13800138000",
  "stock": "600519",
  "strategy": "moderate"
}
```

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

<div align="center">

**如果这个项目对你有帮助，别忘了点个 ⭐ Star 支持一下**

Made with ❤️ by eninem123

</div>
