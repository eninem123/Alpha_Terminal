# Alpha Terminal（数据分析终端）

移动端 H5 单页：输入沪深北交所 A 股六位代码与基准数额后，拉取公开行情并做可视化展示。**纯静态资源**，可部署到任意静态托管（GitHub Pages、OSS、Nginx 等）。

## 功能概览

- **合规入口**：首次需点击「合规声明」后才会加载 `core.js` 与主逻辑。
- **行情数据**：使用腾讯财经公开接口 `qt.gtimg.cn`（`Access-Control-Allow-Origin: *`），支持浏览器内直接请求。
- **编码**：接口正文为 GBK，使用 `TextDecoder('gbk')` 解码，避免股票简称乱码。
- **代码校验**：格式错误、规则不支持或接口无数据时，通过页面弹层提示「股票代码错误」（微信内比 `alert` 更稳定）。
- **体验次数**：默认成功查询计次，用尽后弹出联系说明；可通过本地密钥文件关闭限制（见下文）。
- **知识库问答**：通过本地/服务器的 `server.js` 连接 IMA 知识库检索 + 模型生成回答（答案支持 Markdown 渲染与分页；默认免费 2 次，第二次会“模糊化”）。
- **休市与交易时段**：内置 **2026 年** 沪深北交所法定节假日全天休市日期（按当年交易所通知维护）；页头会提示「法定节假日 / 周末 / 盘前·午间·盘后」等状态。**仅在连续竞价时段**对展示价叠加微小波动；法定假日与周末等不撮合时段仅显示行情快照、不做随机跳动。
- **行情刷新**：定时拉取接口更新价格锚点。
- **合规资讯滚动**：横向滚动展示可点击标题；固定附带 **腾讯财经**、有代码时附带 **腾讯自选股（gu.qq.com）** 入口。正文快讯通过 **新浪财经公开滚动 JSONP** 拉取（浏览器可加载），成功查询某标的后会按简称/代码尽量把相关标题排在前面。

## 目录结构

| 文件 | 说明 |
|------|------|
| `index.html` | 页面结构、样式、合规遮罩、错误弹层、脚本加载顺序 |
| `core.js` | 行情请求、Base64 包一层后的数据解析、交互与定时刷新 |
| `server.js` | 本地/服务器服务端：知识库检索问答、VIP 校验、静态资源托管（可配合 Nginx 反代） |
| `agent.md` | VIP 增强模式下追加的智能体设定（会叠加到问答的系统提示词） |
| `unlock-secret.example.js` | 本地「无限次」配置模板，复制为 `unlock-secret.js` 使用 |
| `unlock-secret.js` | **勿提交仓库**（已在 `.gitignore`），存在则按配置绕过次数限制 |
| `wechat.jpg` | 可选，锁定时展示的二维码图片 |

仓库中另有 `poster-generator.html` 等与主终端无关的页面，可忽略。

## 本地运行

在项目根目录用任意静态服务打开即可（避免部分浏览器对 `file://` 的限制）：

```bash
# 示例：Python
python -m http.server 8080
```

浏览器访问 `http://localhost:8080/`。

## 构建样式（Tailwind 本地化）

为了避免移动端/微信环境对 `cdn.tailwindcss.com` 的拦截，本项目改为使用本地生成的 `tailwind.min.css`。

```bash
npm install
npm run build:css
```

## 自动化测试

```bash
npm test
```

## 本地无限次调试（`unlock-secret.js`）

1. 复制 `unlock-secret.example.js` 为 **`unlock-secret.js`**（与 `index.html` 同目录）。
2. 保持默认：

   ```js
   window.__ALPHA_LOCAL = {
     secretOk: true,
     useUsageLimit: false   // false = 不限次
   };
   ```

3. 需要**恢复与线上一致的次数限制**时，将 `useUsageLimit` 改为 `true`。

重要说明：

- `unlock-secret.js` 里的本地开关（如 `useUsageLimit`、`vipUnlimited`）**只在 `localhost / 127.0.0.1` 调试环境生效**。
- 即使你把 `unlock-secret.js` 上传到服务器，线上真实访客也**不会**因为这个文件直接获得不限次能力。
- 线上不限次/管理员权限请使用下面的“管理员登录（服务端）”方案。

未部署 `unlock-secret.js` 的环境（如线上）会自动走默认限次逻辑。

## 知识库问答（本地/服务器）

页面里的「知识库问答」需要启动 `server.js`（浏览器不直接持有 IMA/模型密钥）。

### 行情备用接口（服务端聚合）

为提升弱网/拦截环境下的稳定性，前端行情会优先直连腾讯 `qt.gtimg.cn`；若失败会尝试请求同源服务端接口：

- `GET /api/quote?code=600000`

服务端会按顺序尝试公开数据源（无 API Key）：

- 腾讯 `qt.gtimg.cn`
- 东方财富 `push2.eastmoney.com`
- 新浪 `hq.sinajs.cn`（不覆盖北交所代码时会自动跳过）

并做短缓存与失败回退，尽量保证页面能持续显示“最近一次快照”而不是直接报错。

### 关键环境变量

IMA（必需）：

- `IMA_OPENAPI_CLIENTID`
- `IMA_OPENAPI_APIKEY`

模型（二选一）：

- `DEEPSEEK_API_KEY`（默认使用 `https://api.deepseek.com/v1`，可用 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 覆盖）
- 或 `TENCENT_OAI_API_KEY`（OpenAI 兼容风格；可用 `TENCENT_OAI_BASE_URL` / `TENCENT_OAI_MODEL` 覆盖）

知识库固定（推荐）：

- `IMA_FIXED_KB_NAME=理财书籍`（服务端会先按名称查一次 OpenAPI 的 knowledge_base_id 并缓存；失效时自动重取）

### VIP（可选）

- `VIP_SECRET`：用于生成“当前北京时间 + 分钟”的动态密钥。它是密钥生成的私密种子，必须只保存在服务器，不要写到前端。
- `VIP_ADMIN_TOKEN`：用于保护管理员取密钥入口（不带 token 的外网请求会被拒绝）。
- `VIP_WINDOW_MINUTES`：密钥容忍窗口（默认 3）。管理员生成的密钥在短时间内有效，过期需刷新拿新密钥。

说明：

- `VIP_ADMIN_TOKEN` 只是“访问控制”，防止任何人直接打开管理员页面拿密钥。
- `VIP_SECRET` 决定“密钥本身不可猜”。如果只有 token 没有 secret，那么“密钥”无法绑定北京时间生成规则，也不具备加密意义。

管理员友好页面：

- `GET /vip?token=VIP_ADMIN_TOKEN`：打开即显示密钥，可一键复制。

注意：token 放在 URL 里可能会出现在服务器访问日志中。更安全的做法是给 `/vip` 增加 IP 白名单或额外 Basic Auth。

### 管理员登录（服务端，推荐）

如果你希望“永久不限次”并且**可以部署到线上**，不要把管理员账号密码写进前端文件；请改用服务端环境变量：

- `ADMIN_USER=你的管理员账号`
- `ADMIN_PASS=你的管理员密码`
- `ADMIN_SESSION_SECRET=一段随机长字符串`

生成随机串示例：

```bash
openssl rand -hex 32
```

说明：

- 管理员账号密码只保存在服务器 `.env`，前端不会暴露。
- 登录成功后，服务端会下发 `HttpOnly Cookie` 会话，前端只拿到“是否已登录”的状态。
- 管理员权限默认用于：**不限问答次数 / 不触发第二次模糊**。
- VIP 增强（叠加 `agent.md`）：有效 VIP 密钥、本地 `vip_unlimited`（仅本机请求）、或**已管理员登录**时均会启用；未登录的普通用户需填写密钥才走增强提示词。

当前页面中，双击“联系微信”的微信号可打开管理员登录框；实际校验在服务端完成。

### 启动（本地）

```bash
node server.js
```

## 服务器部署与更新（Ubuntu + Nginx）

建议架构：Nginx 托管静态页面，并把 `/api/` 反代到 Node（`127.0.0.1:8787`），不要把 Node 端口暴露到公网。

### 密钥文件

将服务端密钥放到服务器（例如）：

- `/root/.config/ima/.env`
- 权限建议：`chmod 600 /root/.config/ima/.env`

并在 systemd 中指定：

- `Environment=IMA_ENV_FILE=/root/.config/ima/.env`

### 更新代码

1. 上传覆盖 `/var/www/html/` 下的 `index.html` / `core.js` / `server.js` 等文件
2. 重启服务：`sudo systemctl restart alpha-terminal`
3. 健康检查：`curl -s -X POST http://127.0.0.1/api/health`
4. vip:curl -s "http://www.aialter.site/api/vip/key?token=tanchengjun"
### 常见排错

- **知识库问答弹窗显示“问答服务错误：xxx”**
  - 这是前端把服务端真实错误透出了；优先根据 `xxx` 排查 IMA/模型/反代问题。
- **管理员登录后前端看起来是“不限”，但实际请求仍受限**
  - 新版本已在页面初始化、打开问答前、提交提问前主动同步 `/api/admin/status`，确保以前端展示与服务端会话一致。
- **手机端样式错乱**
  - 确认同时上传了 `tailwind.min.css` 与最新 `index.html`。

- **实时行情获取失败（NETWORK / 超时 / 解析错误）**
  - 网络：检查手机是否拦截 `qt.gtimg.cn`，以及是否存在代理/企业网络阻断
  - 超时：弱网下会自动重试 2 次并回退到 60 秒内的缓存快照
  - 解析：腾讯接口偶发返回异常内容会被识别为 `PARSE/BAD_DATA`，同样会回退缓存

## 支持的证券代码规则

| 前缀规则 | 市场 |
|----------|------|
| `60` / `68` / `69` | 上海（含科创板等常见段） |
| `00` / `30` | 深圳（主板、创业板等常见段） |
| `430` / `830` / `870` / `880` / `920` | 北交所常见段 |

具体是否返回数据以接口为准；无效代码会提示错误，且**不会**消耗成功次数。

## 交易日历维护

`core.js` 内 `CN_STOCK_FULL_DAY_HOLIDAYS` 为按日休市集合（当前含 **2026** 年元旦、春节、清明、劳动节、端午、中秋、国庆等区间）。**每年**请根据沪、深、北交所当年公告增删日期。

若某日因国务院安排 **周末调休仍需开市**，把该日 `YYYY-MM-DD` 加入 `CN_STOCK_WEEKEND_WORKDAY`（默认可为空）。

## 免责声明

- 本页面仅作技术演示与数据展示练习，**不构成任何投资建议**。
- 行情来自第三方公开接口，延迟、准确性、可用性不做保证；请勿用于实盘决策依据。
- 使用须遵守当地法律法规及平台（含微信等）规则。

## 许可证

若仓库未单独声明许可证，以仓库内 `LICENSE` 为准；无则默认保留所有权利。
