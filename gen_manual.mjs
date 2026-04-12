import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat, ExternalHyperlink
} from "docx";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const SHOT_DIR = path.join(__dirname, "ScreenShot");

function loadImg(filename) {
  try {
    const p = path.join(SHOT_DIR, filename);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch {}
  return null;
}

// 加载截图
const imgMain     = loadImg("screenshot_main.png");
const imgMobile   = loadImg("screenshot_mobile.png");
const imgScreen1  = loadImg("ScreenShot_2026-04-11_132524_943.png");
const imgScreen2  = loadImg("ScreenShot_2026-04-11_132547_569.png");
const imgScreen3  = loadImg("ScreenShot_2026-04-11_132657_937.png");
const imgScreen4  = loadImg("ScreenShot_2026-04-11_132826_696.png");

const PAGE_W = 11906;  // A4 width DXA
const PAGE_H = 16838;
const MARGIN = 1200;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const HEADER_SHADING = { fill: "1E3A5F", type: ShadingType.CLEAR };
const ALT_SHADING = { fill: "F0F4FA", type: ShadingType.CLEAR };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, color: "1E3A5F", font: "微软雅黑" })],
    spacing: { before: 240, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "1E6FBF", space: 6 } }
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, color: "2563EB", font: "微软雅黑" })],
    spacing: { before: 180, after: 120 }
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 22, color: "374151", font: "微软雅黑" })],
    spacing: { before: 120, after: 80 }
  });
}

function body(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, font: "微软雅黑", ...options })],
    spacing: { after: 80 }
  });
}

function code(lines, lang = "") {
  const allLines = Array.isArray(lines) ? lines : [lines];
  return allLines.map((line, i) =>
    new Paragraph({
      children: [new TextRun({
        text: line,
        font: "Courier New",
        size: 17,
        color: "D4D4D4"
      })],
      spacing: { after: 0, before: 0, line: 240 },
      shading: { fill: "1E1E1E", type: ShadingType.CLEAR },
      indent: { left: 300, right: 300 },
      ...(i === 0 ? { spacing: { before: 100, after: 0 } } : {}),
      ...(i === allLines.length - 1 ? { spacing: { after: 100, before: 0 } } : {})
    })
  );
}

function imgPara(data, w = 500, h = 280, title = "界面截图") {
  if (!data) {
    return new Paragraph({ children: [new TextRun({ text: "[截图：" + title + "]", size: 18, color: "999999", italics: true })], alignment: AlignmentType.CENTER });
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({
      type: "png",
      data,
      transformation: { width: w, height: h },
      altText: { title, description: title, name: title }
    })],
    spacing: { before: 120, after: 120 }
  });
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, size: 17, italics: true, color: "666666", font: "微软雅黑" })],
    spacing: { after: 120 }
  });
}

function tableRow(cells, isHeader = false) {
  return new TableRow({
    children: cells.map((c, i) =>
      new TableCell({
        borders: BORDERS,
        width: { size: Math.floor(CONTENT_W / cells.length), type: WidthType.DXA },
        shading: isHeader ? HEADER_SHADING : (i === 0 ? ALT_SHADING : { fill: "FFFFFF", type: ShadingType.CLEAR }),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: c, size: 18, bold: isHeader, color: isHeader ? "FFFFFF" : "374151", font: "微软雅黑" })]
        })]
      })
    )
  });
}

function makeTable(headers, rows) {
  const colW = Math.floor(CONTENT_W / headers.length);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: headers.map(() => colW),
    rows: [
      tableRow(headers, true),
      ...rows.map(r => tableRow(r, false))
    ]
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function spacer(n = 1) {
  return Array.from({ length: n }, () => new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
}

// ─────────── 正文内容 ───────────

const children = [];

// ===== 封面页 =====
children.push(
  new Paragraph({ children: [new TextRun("")], spacing: { before: 1800 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "智博优 Alpha_Terminal", bold: true, size: 56, color: "1E3A5F", font: "微软雅黑" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "智能终端系统 V1.0", bold: true, size: 44, color: "2563EB", font: "微软雅黑" })]
  }),
  new Paragraph({ children: [new TextRun("")], spacing: { after: 200 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "用  户  操  作  说  明  书", size: 36, color: "374151", font: "微软雅黑", bold: true })]
  }),
  new Paragraph({ children: [new TextRun("")], spacing: { after: 300 } }),

  // 封面信息表格
  new Table({
    width: { size: 7200, type: WidthType.DXA },
    columnWidths: [2400, 4800],
    alignment: AlignmentType.CENTER,
    rows: [
      ["软件名称", "智博优 Alpha_Terminal 智能终端系统"],
      ["版本号", "V1.0"],
      ["开发完成日期", "2026-04-01  15:48:35"],
      ["发表状态", "已发表"],
      ["发表日期", "2026-04-01"],
      ["发表地点", "中国 / 深圳"],
      ["开发方式", "独立开发"],
      ["权利范围", "全部权利"],
      ["运行域名", "http://www.aialter.site"],
    ].map(([k, v]) => new TableRow({
      children: [
        new TableCell({
          borders: BORDERS,
          width: { size: 2400, type: WidthType.DXA },
          shading: ALT_SHADING,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: k, size: 20, bold: true, font: "微软雅黑", color: "1E3A5F" })] })]
        }),
        new TableCell({
          borders: BORDERS,
          width: { size: 4800, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: v, size: 20, font: "微软雅黑" })] })]
        })
      ]
    }))
  }),
  new Paragraph({ children: [new TextRun("")], spacing: { after: 400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "编制单位：智博优科技（深圳）", size: 22, color: "666666", font: "微软雅黑" })]
  }),
  pageBreak()
);

// ===== 第1页：目录 =====
children.push(
  h1("目  录"),
  ...["1. 软件概述 …………………………………………………… 3",
    "2. 软件运行环境 ………………………………………………… 4",
    "3. 安装与部署 ………………………………………………… 5",
    "4. 用户界面说明 ……………………………………………… 6",
    "5. A股行情查询功能 …………………………………………… 7",
    "6. 知识库问答功能 …………………………………………… 8",
    "7. 核心代码解析——行情数据模块 ………………………… 9",
    "8. 核心代码解析——交易日历模块 ………………………… 10",
    "9. 核心代码解析——知识库问答前端 ……………………… 11",
    "10. 服务端核心逻辑——IMA接口与认证 …………………… 12",
    "11. 服务端核心逻辑——行情聚合与VIP快照 ……………… 13",
    "12. 管理员与VIP权限体系 …………………………………… 14",
    "13. 常见问题排查 …………………………………………… 15",
    "14. 技术特点与版权声明 …………………………………… 16",
  ].map(line => new Paragraph({
    children: [new TextRun({ text: line, size: 20, font: "微软雅黑", color: "374151" })],
    spacing: { after: 100 }
  })),
  pageBreak()
);

// ===== 第2页：软件概述 =====
children.push(
  h1("1. 软件概述"),
  h2("1.1 软件简介"),
  body('智博优 Alpha_Terminal 智能终端系统（以下简称"本软件"）是一款面向移动端的 H5 单页应用，运行于浏览器环境，无需安装任何客户端。软件通过接入腾讯财经公开行情接口，为用户提供沪深北交所 A 股实时行情查询、盈亏可视化计算、财经资讯滚动，以及基于 AI 大模型的知识库智能问答服务。'),
  body("系统已成功部署于互联网，官方运行域名为："),
  new Paragraph({
    children: [
      new TextRun({ text: "  http://www.aialter.site", size: 20, bold: true, color: "2563EB", font: "Courier New" })
    ],
    spacing: { after: 100 }
  }),

  imgPara(imgMain, 500, 280, "系统主界面（aialter.site）"),
  caption("图 1-1  智博优 Alpha_Terminal 系统主界面（aialter.site）"),

  h2("1.2 核心功能列表"),
  makeTable(
    ["功能模块", "说明"],
    [
      ["合规入口", "首次打开需点击合规声明，确认后才加载核心逻辑"],
      ["A股行情查询", "支持沪深北交所6位股票代码，实时拉取腾讯财经公开行情"],
      ["杠杆收益计算", "输入基准金额，自动计算10倍杠杆下的浮动盈亏与效率指标"],
      ["财经资讯滚动", "横向滚动展示腾讯财经、新浪财经等实时快讯标题"],
      ["交易日历", "内置2026年全年法定节假日，智能提示当前市场交易状态"],
      ["AI知识库问答", "连接IMA知识库+大模型生成，支持Markdown渲染与分页"],
      ["VIP增强模式", "动态密钥校验，叠加agent.md智能体设定与完整行情快照"],
      ["管理员登录", "服务端会话认证，登录后解锁无限次问答与VIP权限"],
    ]
  ),
  pageBreak()
);

// ===== 第3页：运行环境 =====
children.push(
  h1("2. 软件运行环境"),
  h2("2.1 服务器环境"),
  makeTable(
    ["配置项", "规格"],
    [
      ["服务提供商", "腾讯云轻量应用服务器"],
      ["CPU", "2核"],
      ["内存", "2 GB"],
      ["系统盘", "40 GB SSD 云硬盘"],
      ["操作系统", "Ubuntu 22.04 LTS / Linux"],
      ["Web服务器", "Nginx（反向代理）+ Node.js（业务后端）"],
      ["Node版本", "≥ 18.0（推荐 LTS 20.x / 22.x）"],
      ["服务端口", "Node 监听 127.0.0.1:8787，Nginx 对外 80/443"],
      ["部署域名", "www.aialter.site"],
    ]
  ),
  ...spacer(1),

  h2("2.2 客户端环境"),
  makeTable(
    ["环境", "要求"],
    [
      ["操作系统", "iOS 14+ / Android 9+ / Windows 10+ / macOS 10.15+"],
      ["浏览器", "微信内置浏览器（推荐）/ Chrome 90+ / Safari 14+ / Edge 90+"],
      ["网络", "4G/5G 移动网络或 Wi-Fi，需能访问 qt.gtimg.cn（行情源）"],
      ["分辨率", "375px 以上宽度（移动优先设计）"],
    ]
  ),
  ...spacer(1),

  h2("2.3 编程语言与框架"),
  makeTable(
    ["层次", "语言/框架", "说明"],
    [
      ["前端", "HTML5 / CSS3 / JavaScript (ES2020+)", "单页应用，无框架依赖"],
      ["样式", "Tailwind CSS（本地化构建）", "避免CDN在微信中被拦截"],
      ["后端", "Node.js (ESM)", "原生 http 模块，零第三方框架"],
      ["AI接口", "IMA OpenAPI / OpenAI 兼容协议", "腾讯混元 or DeepSeek 模型"],
      ["行情接口", "腾讯财经 qt.gtimg.cn（公开）", "Access-Control-Allow-Origin: *"],
      ["编码处理", "TextDecoder('gbk')", "接口正文为GBK，避免股票名乱码"],
      ["构建工具", "npm + Tailwind CLI", "仅构建CSS，无打包器"],
    ]
  ),
  ...spacer(1),

  h2("2.4 关键依赖说明"),
  ...code([
    "// package.json 关键字段",
    '{',
    '  "type": "module",',
    '  "scripts": {',
    '    "build:css": "tailwindcss -i tailwind.input.css -o tailwind.min.css --minify",',
    '    "test": "node --test tests/"',
    '  },',
    '  "devDependencies": {',
    '    "tailwindcss": "^3.x"',
    '  }',
    '}',
    '',
    '// 本地运行（任意静态服务，避免 file:// 的 CORS 限制）',
    'python -m http.server 8080',
    '# 浏览器访问 http://localhost:8080/',
    '',
    '// 服务端启动',
    'node server.js',
    '# 健康检查',
    'curl -s -X POST http://127.0.0.1/api/health',
  ]),
  pageBreak()
);

// ===== 第4页：安装与部署 =====
children.push(
  h1("3. 安装与部署"),
  h2("3.1 本地调试"),
  body("在项目根目录执行以下命令即可本地运行："),
  ...code([
    "# 1. 安装构建依赖（仅需一次）",
    "npm install",
    "",
    "# 2. 构建 Tailwind CSS",
    "npm run build:css",
    "",
    "# 3. 启动静态文件服务（任选其一）",
    "python -m http.server 8080   # Python 方式",
    "npx serve .                  # npx 方式",
    "",
    "# 4. 浏览器访问",
    "# http://localhost:8080/",
    "",
    "# 5. 启动知识库问答后端（需配置环境变量）",
    "node server.js",
    "# 服务默认监听 127.0.0.1:8787",
  ]),

  h2("3.2 本地无限次调试"),
  body("将 unlock-secret.example.js 复制为 unlock-secret.js，配置如下："),
  ...code([
    "// unlock-secret.js（仅 localhost 环境生效）",
    "window.__ALPHA_LOCAL = {",
    "  secretOk: true,",
    "  useUsageLimit: false,   // false = 不限次（本地调试用）",
    "  vipUnlimited: true      // 可选：本地 VIP 增强",
    "};",
    "",
    "// 注意：此文件已加入 .gitignore，勿提交仓库！",
    "// 线上真实访客不受此文件影响",
  ]),

  h2("3.3 服务器部署（Ubuntu + Nginx）"),
  body("推荐架构：Nginx 托管静态页面 + /api/ 反代到 Node 后端。"),
  ...code([
    "# 1. 上传文件到服务器",
    "scp index.html core.js server.js tailwind.min.css root@your-server:/var/www/html/",
    "",
    "# 2. Nginx 配置片段（/etc/nginx/sites-available/alpha）",
    "server {",
    "    listen 80;",
    "    server_name www.aialter.site;",
    "    root /var/www/html;",
    "    index index.html;",
    "",
    "    # API 反向代理",
    "    location /api/ {",
    "        proxy_pass http://127.0.0.1:8787;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "        proxy_set_header X-Forwarded-Proto $scheme;",
    "    }",
    "",
    "    # 静态资源",
    "    location / {",
    "        try_files $uri $uri/ /index.html;",
    "    }",
    "}",
    "",
    "# 3. 配置 systemd 服务（/etc/systemd/system/alpha-terminal.service）",
    "[Unit]",
    "Description=Alpha Terminal Node Server",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=/var/www/html",
    "ExecStart=/usr/bin/node /var/www/html/server.js",
    "Environment=IMA_ENV_FILE=/root/.config/ima/.env",
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
    "# 4. 启动服务",
    "sudo systemctl enable alpha-terminal",
    "sudo systemctl start alpha-terminal",
    "sudo systemctl status alpha-terminal",
  ]),
  pageBreak()
);

// ===== 第5页：用户界面说明 =====
children.push(
  h1("4. 用户界面说明"),
  h2("4.1 页面整体布局"),

  imgPara(imgMobile || imgScreen1, 260, 480, "移动端界面"),
  caption("图 4-1  移动端界面布局（访问 www.aialter.site）"),

  h2("4.2 界面区域说明"),
  makeTable(
    ["区域编号", "区域名称", "功能说明"],
    [
      ["① 页头", "市场状态栏", "实时显示当前交易状态（交易中/休市/节假日）及时间"],
      ["② 输入区", "股票代码与基准金额", "输入6位A股代码和基准本金，点击「执行数据刷新」查询"],
      ["③ 行情卡", "实时行情展示", "显示股票名称、最新价、涨跌幅，交易时段内自动跳动"],
      ["④ 指标区", "核心数据指标", "展示波动率、净流向、杠杆比例等辅助分析数据"],
      ["⑤ 盈亏区", "浮动盈亏计算", "基于10倍杠杆实时计算浮动盈亏金额与效率指标"],
      ["⑥ 资讯栏", "财经资讯滚动", "横向滚动展示腾讯财经、新浪财经实时快讯标题"],
      ["⑦ 功能按钮", "知识库问答", "点击打开AI知识库问答弹窗"],
      ["⑧ 联系区", "微信联系入口", "显示联系微信号，双击可打开管理员登录框"],
    ]
  ),

  h2("4.3 合规声明流程"),
  body("软件首次加载时会显示合规声明遮罩，用户需主动点击「我已了解，进入终端」后，系统才会加载 core.js 主逻辑。此设计用于满足金融信息展示的合规要求。"),
  ...code([
    "// index.html 合规入口控制逻辑片段",
    "const disclaimerOverlay = document.getElementById('disclaimerOverlay');",
    "const enterBtn = document.getElementById('enterBtn');",
    "",
    "enterBtn.addEventListener('click', function() {",
    "  // 隐藏合规遮罩",
    "  disclaimerOverlay.classList.add('hidden');",
    "  // 动态加载核心业务逻辑",
    "  const script = document.createElement('script');",
    "  script.src = 'core.js';",
    "  script.defer = true;",
    "  document.body.appendChild(script);",
    "});",
  ]),
  pageBreak()
);

// ===== 第6页：A股行情查询 =====
children.push(
  h1("5. A股行情查询功能"),
  h2("5.1 支持的证券代码规则"),
  makeTable(
    ["前缀规则", "市场", "示例"],
    [
      ["60 / 68 / 69 开头", "上海交易所（含科创板）", "600519（贵州茅台）、688981（中芯国际）"],
      ["00 / 30 开头", "深圳交易所（主板、创业板）", "000001（平安银行）、300750（宁德时代）"],
      ["430 / 830 / 870 / 880 / 920", "北京证券交易所", "430047、830946"],
    ]
  ),
  ...spacer(1),

  h2("5.2 操作步骤"),
  ...[
    "① 在「股票代码」输入框中输入6位纯数字代码（如：600519）",
    "② 在「基准数额」输入框中填写本金金额（如：10000）",
    "③ 点击「执行数据刷新」按钮",
    "④ 系统自动拉取腾讯财经行情，展示实时价格与涨跌幅",
    "⑤ 盈亏区域自动计算10倍杠杆下的浮动盈亏"
  ].map(t => body(t)),
  ...spacer(1),

  h2("5.3 行情刷新机制"),
  body("行情数据每2秒自动轮询刷新，交易时段内会在最新价基础上叠加微小随机波动（幅度 ±0.05%），直观反映撮合状态。非交易时段（节假日、休市、盘前盘后）仅显示行情快照，不做随机跳动。"),

  imgPara(imgScreen2 || imgScreen3, 460, 280, "行情查询结果界面"),
  caption("图 5-1  A股行情查询结果展示（www.aialter.site）"),

  h2("5.4 错误处理"),
  makeTable(
    ["错误类型", "提示内容", "原因"],
    [
      ["格式错误", "请输入6位数字代码", "输入非6位数字或包含字母"],
      ["UNSUPPORTED_CODE", "不属于当前支持的沪深北交所规则", "代码前缀不在支持列表内"],
      ["NOT_FOUND / BAD_DATA", "行情源未返回有效数据，可能已退市", "接口无数据或代码错误"],
      ["NETWORK", "网络异常，请稍后重试", "超时或网络断开"],
    ]
  ),
  ...spacer(1),
  body("注意：代码格式错误或无效代码不会消耗查询次数。"),
  pageBreak()
);

// ===== 第7页：知识库问答 =====
children.push(
  h1("6. 知识库问答功能"),
  h2("6.1 功能概述"),
  body("点击页面底部「知识库问答」按钮，打开问答弹窗。系统通过后端服务连接腾讯 IMA 知识库，检索相关文档片段后，调用 AI 大模型（混元 Hunyuan / DeepSeek）生成专业回答，支持 Markdown 渲染和多页分页显示。"),

  imgPara(imgScreen3 || imgScreen4, 460, 280, "知识库问答界面"),
  caption("图 6-1  知识库问答功能界面（www.aialter.site）"),

  h2("6.2 问答使用流程"),
  ...[
    "① 点击「知识库问答」按钮打开弹窗",
    "② 从下拉列表中选择知识库（默认：理财书籍）",
    "③ 在文本框中输入问题，支持 Ctrl+Enter 快捷提交",
    "④ 点击「提问」按钮，等待检索与生成（通常 5~30 秒）",
    "⑤ 查看 AI 回答（支持分页），参考来源文档列表",
  ].map(t => body(t)),
  ...spacer(1),

  h2("6.3 次数限制说明"),
  makeTable(
    ["用户类型", "问答次数", "获取方式"],
    [
      ["普通访客", "免费2次（第2次回答模糊化）", "直接访问网站"],
      ["VIP增强用户", "次数不限，完整行情快照", "填写有效VIP动态密钥"],
      ["管理员", "次数不限，VIP增强模式", "服务端管理员账号登录"],
      ["本地开发", "次数不限", "配置 unlock-secret.js"],
    ]
  ),

  h2("6.4 VIP密钥获取"),
  body("VIP 密钥由管理员生成，基于北京时间分钟级动态生成，每隔3分钟更新一次（窗口可配置）。密钥填入问答弹窗的「VIP 增强密钥」输入框后，服务端校验通过即可解锁增强功能。"),
  ...code([
    "// 服务端 VIP 密钥生成（server.js 片段）",
    "function vipKeyAtMinuteOffset(minuteOffset) {",
    "  if (!VIP_SECRET) return '';",
    "  const d = new Date(Date.now() - minuteOffset * 60 * 1000);",
    "  const p = beijingParts(d);   // 获取北京时间的年月日+时分",
    "  // md2Hex: MD2 哈希函数（对 VIP_SECRET + 时间做散列）",
    "  return md2Hex(VIP_SECRET + '|' + p.ymd + p.hm);",
    "}",
    "",
    "function isVipKeyValid(key) {",
    "  const k = String(key || '').trim();",
    "  if (!k || !VIP_SECRET) return false;",
    "  // 在时间窗口内逐分钟检查是否匹配",
    "  for (let i = 0; i < VIP_WINDOW_MINUTES; i++) {",
    "    if (k === vipKeyAtMinuteOffset(i)) return true;",
    "  }",
    "  return false;",
    "}",
  ]),
  pageBreak()
);

// ===== 第8页：核心代码——行情模块 =====
children.push(
  h1("7. 核心代码解析——行情数据模块"),
  h2("7.1 行情接口调用（core.js）"),
  body("系统优先直连腾讯财经公开行情接口，失败后自动回退到服务端聚合接口。接口返回 GBK 编码，使用 TextDecoder 解码以保证股票名称正确显示。"),
  ...code([
    "/** 腾讯财经公开行情（CORS: *）",
    " *  接口正文为 GBK，使用 TextDecoder('gbk') 解码 */",
    "const QUOTE_URL = 'https://qt.gtimg.cn/q=';",
    "const QUOTE_TIMEOUT_MS = 4500;",
    "const QUOTE_MAX_ATTEMPTS = 2;",
    "const QUOTE_CACHE_TTL_MS = 60 * 1000; // 60秒缓存",
    "const _quoteCache = new Map();",
    "",
    "function decodeTencentQuoteBody(buffer) {",
    "  const labels = ['gbk', 'gb18030'];",
    "  for (let i = 0; i < labels.length; i++) {",
    "    try {",
    "      return new TextDecoder(labels[i]).decode(buffer);",
    "    } catch (e) {",
    "      // 当前环境不支持该 label 时换下一个",
    "    }",
    "  }",
    "  return new TextDecoder('utf-8').decode(buffer);",
    "}",
    "",
    "function codeToSymbol(code) {",
    "  if (!/^\\d{6}$/.test(code)) return null;",
    "  const p2 = code.slice(0, 2);",
    "  const p3 = code.slice(0, 3);",
    "  if (p2 === '60' || p2 === '68' || p2 === '69') return 'sh' + code;",
    "  if (p2 === '00' || p2 === '30') return 'sz' + code;",
    "  if (p3 === '430' || p3 === '830' || p3 === '870'",
    "    || p3 === '880' || p3 === '920') return 'bj' + code;",
    "  return null;",
    "}",
    "",
    "async function fetchQuoteObject(code) {",
    "  const symbol = codeToSymbol(code);",
    "  if (!symbol) throw quoteError('UNSUPPORTED_CODE', 'UNSUPPORTED_CODE');",
    "",
    "  const cacheKey = symbol;",
    "  const cached = _quoteCache.get(cacheKey);",
    "  if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) return cached;",
    "",
    "  const url = QUOTE_URL + encodeURIComponent(symbol);",
    "  let lastErrCode = 'NETWORK';",
    "  for (let attempt = 1; attempt <= QUOTE_MAX_ATTEMPTS; attempt++) {",
    "    try {",
    "      const res = await fetchWithTimeout(url, { cache: 'no-store' }, QUOTE_TIMEOUT_MS);",
    "      if (!res.ok) throw quoteError('NETWORK', 'NETWORK');",
    "      const buf = await res.arrayBuffer();",
    "      const text = decodeTencentQuoteBody(buf);",
    "      if (!text || !text.trim()) throw quoteError('NOT_FOUND', 'NOT_FOUND');",
    "      if (/v_pv_none_match/i.test(text)) throw quoteError('NOT_FOUND', 'NOT_FOUND');",
    "      const m = text.match(/v_[a-z0-9]+=\"([^\"]*)\"/i);",
    "      if (!m) throw quoteError('PARSE', 'PARSE');",
    "      const parts = m[1].split('~');",
    "      const currentPrice = parseFloat(parts[3]);",
    "      let basePrice = parseFloat(parts[4]);",
    "      if (!Number.isFinite(currentPrice) || currentPrice <= 0)",
    "        throw quoteError('BAD_DATA', 'BAD_DATA');",
    "      if (!Number.isFinite(basePrice) || basePrice <= 0) basePrice = currentPrice;",
    "      const name = (parts[1] || '').trim();",
    "      const out = { code, symbol, name, basePrice, currentPrice, ts: Date.now() };",
    "      _quoteCache.set(cacheKey, out);",
    "      return out;",
    "    } catch (e) {",
    "      lastErrCode = e && e.code ? String(e.code) : 'NETWORK';",
    "      if (attempt >= QUOTE_MAX_ATTEMPTS) break;",
    "      await new Promise(r => setTimeout(r, 120 * attempt));",
    "    }",
    "  }",
    "  // 回退到服务端聚合接口",
    "  try {",
    "    const out = await fetchQuoteObjectViaServer(code);",
    "    _quoteCache.set(cacheKey, out);",
    "    return out;",
    "  } catch {}",
    "  if (cached) return cached; // 返回过期缓存快照",
    "  throw quoteError(lastErrCode, lastErrCode);",
    "}",
  ]),
  pageBreak()
);

// ===== 第9页：交易日历模块 =====
children.push(
  h1("8. 核心代码解析——交易日历模块"),
  h2("8.1 法定节假日定义"),
  body("系统内置2026年度沪深北交所法定节假日全天休市日期，按国务院当年通知维护。交易日历会影响价格跳动行为和页头状态栏的显示内容。"),
  ...code([
    "/** 元旦、春节、清明、劳动节、端午、中秋、国庆",
    " *  等按日休市（沪/深/北交所同步口径，以交易所当年通知为准）*/",
    "const CN_STOCK_FULL_DAY_HOLIDAYS = new Set();",
    "[",
    "  ['2026-01-01', '2026-01-03'],  // 元旦",
    "  ['2026-02-15', '2026-02-23'],  // 春节",
    "  ['2026-04-04', '2026-04-06'],  // 清明",
    "  ['2026-05-01', '2026-05-05'],  // 劳动节",
    "  ['2026-06-19', '2026-06-21'],  // 端午",
    "  ['2026-09-25', '2026-09-27'],  // 中秋",
    "  ['2026-10-01', '2026-10-07'],  // 国庆",
    "].forEach(function(se) {",
    "  addClosedRange(CN_STOCK_FULL_DAY_HOLIDAYS, se[0], se[1]);",
    "});",
    "",
    "/** 周末因调休而仍开市的日期（逐年维护；空则仅按周六日+节假日判断）*/",
    "const CN_STOCK_WEEKEND_WORKDAY = new Set([]);",
    "",
    "// 交易时段定义",
    "function sessionPhase(t) {",
    "  const hm = t.getHours() * 60 + t.getMinutes();",
    "  const am0 = 9 * 60 + 30;   // 09:30 上午开盘",
    "  const am1 = 11 * 60 + 30;  // 11:30 上午收盘",
    "  const pm0 = 13 * 60;        // 13:00 下午开盘",
    "  const pm1 = 15 * 60;        // 15:00 下午收盘",
    "  if (hm >= am0 && hm < am1) return { inSession: true, label: '上午连续竞价' };",
    "  if (hm >= pm0 && hm < pm1) return { inSession: true, label: '下午连续竞价' };",
    "  if (hm < am0)  return { inSession: false, label: '盘前休市' };",
    "  if (hm >= am1 && hm < pm0) return { inSession: false, label: '午间休市' };",
    "  return { inSession: false, label: '盘后休市' };",
    "}",
    "",
    "// 综合判断当前A股市场状态",
    "function getAshareMarketState(now) {",
    "  const t = now || new Date();",
    "  const ymd = formatLocalYMD(t);",
    "  const dow = t.getDay();   // 0=周日, 6=周六",
    "",
    "  if (CN_STOCK_WEEKEND_WORKDAY.has(ymd)) {  // 调休补班",
    "    const ph = sessionPhase(t);",
    "    return ph.inSession",
    "      ? { open: true, line: '当前：A股连续竞价时段（周末调休补班）。' }",
    "      : { open: false, line: '当前：' + ph.label + '（周末调休补班日）…' };",
    "  }",
    "  if (CN_STOCK_FULL_DAY_HOLIDAYS.has(ymd)) {  // 法定节假日",
    "    return { open: false, line: '当前：法定节假日休市，A股不交易…' };",
    "  }",
    "  if (dow === 0 || dow === 6) {  // 普通周末",
    "    return { open: false, line: '当前：周末休市，A股不交易…' };",
    "  }",
    "  const ph = sessionPhase(t);  // 工作日内判断时段",
    "  if (!ph.inSession) {",
    "    return { open: false, line: '当前：' + ph.label + '；非连续竞价时段…' };",
    "  }",
    "  return { open: true, line: '当前：A股连续竞价时段，行情可能随撮合变动。' };",
    "}",
  ]),
  pageBreak()
);

// ===== 第10页：知识库问答前端 =====
children.push(
  h1("9. 核心代码解析——知识库问答前端"),
  h2("9.1 问答请求与次数控制"),
  ...code([
    "// 知识库问答核心函数（core.js）",
    "async function askKbQuestion() {",
    "  if (!kbQuestion || !kbSelect) return;",
    "  await syncAdminAuthStatus();  // 同步管理员登录状态",
    "",
    "  const kbId  = (kbSelect.value || '').trim();",
    "  const q     = (kbQuestion.value || '').trim();",
    "  const vipKey = kbVipKey ? String(kbVipKey.value || '').trim() : '';",
    "  const hasVip = Boolean(vipKey) || effectiveVipUnlimited;",
    "",
    "  // 次数判断",
    "  if (!hasVip && !effectiveUsageBypass && _kbqa_limit >= MAX_KB_QA_TRIES) {",
    "    if (lockModal) lockModal.classList.remove('hidden');",
    "    setKbQaStatus('问答次数已用尽，请联系高级顾问获取 VIP 增强密钥。');",
    "    return;",
    "  }",
    "  if (!kbId) { setKbQaStatus('请先选择知识库。'); return; }",
    "  if (!q)    { setKbQaStatus('请输入问题。');    return; }",
    "",
    "  if (kbAskBtn) { kbAskBtn.disabled = true; kbAskBtn.textContent = '检索中…'; }",
    "  setKbQaAnswer('');",
    "  setKbQaSources([]);",
    "  setKbQaStatus('正在检索并生成回答…');",
    "",
    "  try {",
    "    // 提交问答请求到后端",
    "    const res = await fetchWithTimeout('/api/qa/ask', {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    "      body: JSON.stringify({",
    "        knowledge_base_id: kbId,",
    "        question: q,",
    "        trial_index: effectiveUsageBypass || effectiveVipUnlimited",
    "          ? 0 : _kbqa_limit + 1,",
    "        vip_key: vipKey,",
    "        vip_unlimited: effectiveVipUnlimited",
    "      })",
    "    }, 120000);  // 2分钟超时",
    "",
    "    const data = await res.json().catch(() => ({}));",
    "",
    "    if (!res.ok) {",
    "      if (res.status === 429) {",
    "        if (lockModal) lockModal.classList.remove('hidden');",
    "        setKbQaStatus('问答次数已用尽，请联系高级顾问获取 VIP 增强密钥。');",
    "        return;",
    "      }",
    "      setKbQaStatus(String(data.error || '服务端返回错误'));",
    "      return;",
    "    }",
    "",
    "    // 更新本地次数计数",
    "    if (!hasVip && !effectiveUsageBypass) {",
    "      _kbqa_limit += 1;",
    "      localStorage.setItem(KB_QA_STORAGE_KEY, String(_kbqa_limit));",
    "      updateKbQuotaUI();",
    "    }",
    "",
    "    // 渲染分页回答",
    "    setKbQaAnswer(String(data.answer || '').trim() || '（无回答）');",
    "    const src = Array.isArray(data.sources) ? data.sources : [];",
    "    setKbQaSources(src.map(x => ({",
    "      media_id: x.media_id,",
    "      title: x.title,",
    "      snippet: stripHtmlToText(x.highlight_content || x.snippet || '')",
    "    })));",
    "    setKbQaStatus('完成。');",
    "  } catch (e) {",
    "    // 超时/中断/网络错误处理",
    "    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'",
    "      || /aborted|timeout/i.test(e?.message || '');",
    "    if (timedOut) setKbQaStatus('请求超时，知识库检索可能较慢，请稍后重试。');",
    "    else setKbQaStatus('请求失败：' + (e?.message || '未知错误'));",
    "  } finally {",
    "    if (kbAskBtn) { kbAskBtn.disabled = false; kbAskBtn.textContent = '提问'; }",
    "  }",
    "}",
  ]),
  pageBreak()
);

// ===== 第11页：服务端——IMA接口与认证 =====
children.push(
  h1("10. 服务端核心逻辑——IMA接口与认证"),
  h2("10.1 IMA 知识库检索（server.js）"),
  ...code([
    "// IMA OpenAPI 调用封装",
    "async function imaApi(pathname, bodyObj) {",
    "  const env = await getImaCredentialsOrError();",
    "  if (!env.ok) {",
    "    const err = new Error(env.error);",
    "    err.code = 'MISSING_IMA_CREDENTIALS';",
    "    throw err;",
    "  }",
    "  const url = `https://ima.qq.com/${pathname.replace(/^\\//, '')}`;",
    "  const res = await fetch(url, {",
    "    method: 'POST',",
    "    headers: {",
    "      'Content-Type': 'application/json',",
    "      'ima-openapi-clientid': env.clientId,",
    "      'ima-openapi-apikey': env.apiKey   // 不含敏感密钥值本身",
    "    },",
    "    body: JSON.stringify(bodyObj || {})",
    "  });",
    "  const text = await res.text();",
    "  let data = null;",
    "  try { data = text ? JSON.parse(text) : {}; }",
    "  catch { data = { raw: text }; }",
    "  if (!res.ok) { const err = new Error('IMA_API_ERROR'); err.status = res.status; throw err; }",
    "  // 检查业务码",
    "  const retCode = data?.ret_code ?? data?.retcode ?? data?.err_code ?? null;",
    "  if (retCode !== null && retCode !== 0) {",
    "    const msg = String(data.errmsg ?? data.message ?? 'IMA_API_RET_CODE_NOT_ZERO');",
    "    const err = new Error(msg); err.code = 'IMA_API_RET_CODE_NOT_ZERO';",
    "    err.ret_code = retCode; throw err;",
    "  }",
    "  return data;",
    "}",
    "",
    "// 多策略知识库检索（含关键词分词与列表回退）",
    "async function searchKnowledgeMulti(knowledgeBaseId, question) {",
    "  const queries = buildSearchQueries(question);  // 多维度分词",
    "  const picked = [];",
    "  const seen = new Set();",
    "  for (let i = 0; i < queries.length; i++) {",
    "    const search = await imaApi('openapi/wiki/v1/search_knowledge', {",
    "      query: queries[i], cursor: '', knowledge_base_id: knowledgeBaseId",
    "    });",
    "    const list = firstArrayByPaths(search, ['info_list', 'data.info_list', ...]);",
    "    for (const it of list) {",
    "      const id = String(it?.media_id || '').trim();",
    "      if (!id || seen.has(id)) continue;",
    "      seen.add(id); picked.push(it);",
    "      if (picked.length >= 8) break;",
    "    }",
    "    if (picked.length) break;",
    "  }",
    "  if (picked.length) return { sources: picked, mode: 'search_knowledge', queries };",
    "  // 回退：直接列举知识库文档标题",
    "  const listResp = await imaApi('openapi/wiki/v1/get_knowledge_list', {",
    "    cursor: '', limit: 50, knowledge_base_id: knowledgeBaseId",
    "  });",
    "  const kbList = firstArrayByPaths(listResp, ['knowledge_list', ...]);",
    "  const fallback = kbList.slice(0, 8).map(x => ({",
    "    media_id: x?.media_id, title: x?.title, highlight_content: ''",
    "  }));",
    "  return { sources: fallback, mode: 'get_knowledge_list', queries };",
    "}",
  ]),
  pageBreak()
);

// ===== 第12页：服务端——行情聚合与VIP快照 =====
children.push(
  h1("11. 服务端核心逻辑——行情聚合与VIP快照"),
  h2("11.1 多源行情聚合（server.js）"),
  body("当前端直连腾讯行情失败时，服务端会依次尝试腾讯→东方财富→新浪三个公开数据源："),
  ...code([
    "// 服务端多源行情聚合",
    "async function fetchQuoteSnapshot(code) {",
    "  const cached = _quoteCache.get(code);",
    "  if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) return cached;",
    "",
    "  const symbol = codeToSymbolTencent(code);",
    "  if (!symbol) return null;",
    "",
    "  async function tryTencent() {",
    "    const url = QUOTE_URL + encodeURIComponent(symbol);",
    "    for (let attempt = 1; attempt <= 2; attempt++) {",
    "      try {",
    "        const res = await fetch(url, { cache: 'no-store' });",
    "        if (!res.ok) throw new Error('HTTP_' + res.status);",
    "        const buf = await res.arrayBuffer();",
    "        const text = decodeTencentQuoteBody(buf);",
    "        const parsed = parseTencentQuoteText(text);",
    "        if (!parsed) return null;",
    "        return { code, symbol, name: parsed.name,",
    "          currentPrice: parsed.currentPrice, basePrice: parsed.basePrice,",
    "          ts: Date.now(), provider: 'tencent' };",
    "      } catch {",
    "        if (attempt >= 2) return null;",
    "        await new Promise(r => setTimeout(r, 120 * attempt));",
    "      }",
    "    }",
    "    return null;",
    "  }",
    "",
    "  async function tryEastmoney() {",
    "    const secid = codeToEastmoneySecid(code);",
    "    if (!secid) return null;",
    "    const url = 'https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&'",
    "      + 'secid=' + encodeURIComponent(secid) + '&fields=f12,f14,f58,f43,f60';",
    "    const j = await fetchJsonNoStore(url, 3800);",
    "    const parsed = parseEastmoneyStockGetJson(j);",
    "    if (!parsed) return null;",
    "    return { code, symbol, ...parsed, ts: Date.now(), provider: 'eastmoney' };",
    "  }",
    "",
    "  async function trySina() {",
    "    if (!symbol || symbol.startsWith('bj')) return null;",
    "    const url = 'https://hq.sinajs.cn/list=' + encodeURIComponent(symbol);",
    "    const text = await fetchTextNoStore(url, 3800);",
    "    const parsed = parseSinaHqText(text);",
    "    if (!parsed) return null;",
    "    return { code, symbol, ...parsed, ts: Date.now(), provider: 'sina' };",
    "  }",
    "",
    "  // 依次尝试三个数据源，取第一个成功的",
    "  const q = (await tryTencent()) || (await tryEastmoney()) || (await trySina());",
    "  if (q) _quoteCache.set(code, q);",
    "  return q || null;",
    "}",
    "",
    "// OpenAI 兼容模型调用（混元/DeepSeek）",
    "async function openAiChatComplete(messages) {",
    "  const cfg = getOpenAiCompatConfig();",
    "  if (!cfg.ok) { const err = new Error(cfg.error); throw err; }",
    "  const url = `${cfg.baseUrl.replace(/\\/$/, '')}/chat/completions`;",
    "  const res = await fetch(url, {",
    "    method: 'POST',",
    "    headers: { Authorization: `Bearer ${cfg.apiKey}`,",
    "               'Content-Type': 'application/json' },",
    "    body: JSON.stringify({",
    "      model: cfg.model,",
    "      messages,",
    "      temperature: 0.2,",
    "      stream: false",
    "    })",
    "  });",
    "  const text = await res.text();",
    "  const data = text ? JSON.parse(text) : {};",
    "  if (!res.ok) { throw new Error('LLM_API_ERROR'); }",
    "  return data?.choices?.[0]?.message?.content || '';",
    "}",
  ]),
  pageBreak()
);

// ===== 第13页：管理员与VIP权限 =====
children.push(
  h1("12. 管理员与VIP权限体系"),
  h2("12.1 管理员登录"),
  body('管理员账号密码保存在服务器 .env 文件中，前端不暴露。登录成功后，服务端下发 HttpOnly Cookie 会话，前端仅感知"已登录"状态。'),
  ...code([
    "// 管理员登录接口（server.js）",
    "if (pathname === '/api/admin/login' && req.method === 'POST') {",
    "  const enabled = Boolean(ADMIN_USER && ADMIN_PASS && ADMIN_SESSION_SECRET);",
    "  if (!enabled) {",
    "    json(res, 404, { error: '未启用管理员登录。' });",
    "    return true;",
    "  }",
    "  // 频率限制：5次失败后锁10分钟",
    "  const guard = _adminLoginGuard.get(key) || { attempts: 0, lockUntil: 0 };",
    "  if (guard.lockUntil && Date.now() < guard.lockUntil) {",
    "    json(res, 429, { error: '尝试次数过多，请稍后再试。' });",
    "    return true;",
    "  }",
    "  const body = await readJsonBody(req);",
    "  if (body.user === ADMIN_USER && body.pass === ADMIN_PASS) {",
    "    const token = createAdminSessionToken();  // HMAC-SHA256 签名的会话令牌",
    "    setCookie(res, 'admin_session', token, {",
    "      httpOnly: true, sameSite: 'Lax',",
    "      secure: shouldSecureCookie(req),",
    "      maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000)  // 7天",
    "    });",
    "    json(res, 200, { ok: true });",
    "    return true;",
    "  }",
    "  json(res, 401, { error: '账号或密码错误。' });",
    "  return true;",
    "}",
    "",
    "// 创建安全会话令牌（有效期7天，含 HMAC-SHA256 签名）",
    "function createAdminSessionToken() {",
    "  const exp = Date.now() + ADMIN_SESSION_TTL_MS;",
    "  const nonce = crypto.randomBytes(16).toString('hex');",
    "  const payload = String(exp) + '.' + nonce;",
    "  const sig = crypto",
    "    .createHmac('sha256', ADMIN_SESSION_SECRET)",
    "    .update(payload)",
    "    .digest('hex');",
    "  return payload + '.' + sig;  // exp.nonce.hmac",
    "}",
    "",
    "function verifyAdminSessionToken(token) {",
    "  const parts = String(token || '').split('.');",
    "  if (parts.length !== 3) return false;",
    "  const exp = Number(parts[0]);",
    "  if (!Number.isFinite(exp) || exp <= Date.now()) return false;  // 已过期",
    "  const payload = parts[0] + '.' + parts[1];",
    "  const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET)",
    "    .update(payload).digest('hex');",
    "  // 时序安全比较，防止时序攻击",
    "  return crypto.timingSafeEqual(",
    "    Buffer.from(parts[2], 'hex'), Buffer.from(expected, 'hex')",
    "  );",
    "}",
    "",
    "// 环境变量配置（.env 文件，权限 chmod 600）",
    "ADMIN_USER=你的管理员账号",
    "ADMIN_PASS=你的管理员密码",
    "ADMIN_SESSION_SECRET=openssl rand -hex 32 生成的随机串",
    "VIP_SECRET=另一个随机串（VIP动态密钥种子）",
    "VIP_ADMIN_TOKEN=管理员取密钥入口的访问令牌",
  ]),
  pageBreak()
);

// ===== 第14页：常见问题排查 =====
children.push(
  h1("13. 常见问题排查"),
  h2("13.1 故障排查指南"),
  makeTable(
    ["问题现象", "可能原因", "解决方法"],
    [
      ["页面打开空白或样式异常", "tailwind.min.css 未上传或路径错误", "确认同时上传 tailwind.min.css 与最新 index.html"],
      ["行情数据加载失败（NETWORK）", "手机网络拦截 qt.gtimg.cn", "切换网络或检查代理/企业网络设置"],
      ["行情超时（TIMEOUT）", "弱网环境", "系统自动重试2次并回退到60秒内缓存快照"],
      ["股票简称乱码", "浏览器不支持 GBK TextDecoder", "更新浏览器版本，或通过服务端接口回退"],
      ['知识库问答显示"服务错误"', "IMA凭证未配置或模型API Key缺失", "检查服务器环境变量 IMA_OPENAPI_APIKEY 与模型Key"],
      ["问答次数已用尽", "已使用2次免费问答", "联系管理员获取VIP密钥，或管理员账号登录"],
      ["管理员登录失败", "账号密码错误，或服务端未配置ADMIN_USER", "核对 .env 文件中的 ADMIN_USER 与 ADMIN_PASS"],
      ["VIP密钥无效", "密钥已过期（超过3分钟窗口）", "联系管理员重新获取当前有效密钥"],
      ["问答超时（2分钟）", "知识库检索或模型响应慢", "等待后重试，可增大服务端 timeout 参数"],
    ]
  ),
  ...spacer(1),

  h2("13.2 服务端运维命令"),
  ...code([
    "# 查看服务状态",
    "sudo systemctl status alpha-terminal",
    "",
    "# 查看运行日志（最近100行）",
    "sudo journalctl -u alpha-terminal -n 100 --no-pager",
    "",
    "# 健康检查",
    "curl -s -X POST http://127.0.0.1/api/health | python3 -m json.tool",
    "",
    "# 获取 VIP 密钥（需要 VIP_ADMIN_TOKEN）",
    "curl -s 'http://www.aialter.site/api/vip/key?token=YOUR_ADMIN_TOKEN'",
    "",
    "# 重启服务",
    "sudo systemctl restart alpha-terminal",
    "",
    "# 更新代码后重启",
    "# 1. 上传文件",
    "scp index.html core.js server.js root@your-server:/var/www/html/",
    "# 2. 重启服务",
    "sudo systemctl restart alpha-terminal",
    "# 3. 验证",
    "curl -s -X POST http://127.0.0.1/api/health",
  ]),

  imgPara(imgScreen4, 460, 260, "系统运行状态截图"),
  caption("图 13-1  系统正常运行界面（www.aialter.site）"),
  pageBreak()
);

// ===== 第15页：技术特点与版权 =====
children.push(
  h1("14. 技术特点与版权声明"),
  h2("14.1 技术特点"),
  body("智博优 Alpha_Terminal 智能终端系统在技术实现上有如下核心特点："),

  makeTable(
    ["技术方向", "特点描述"],
    [
      ["AI大模型应用", "基于腾讯混元 Hunyuan 大模型（OpenAI兼容协议）或 DeepSeek 模型，通过 RAG 检索增强生成，回答质量稳定可靠"],
      ["龙虾OpenClaw集成", "系统通过 IMA（腾讯智能知识库）OpenAPI 连接私有知识库，实现领域专属的知识问答，区别于通用大模型直接问答"],
      ["知识库开发", "支持自定义知识库，管理员可上传金融书籍、研报等文档，系统自动建立向量索引，实现精准检索"],
      ["前端零依赖", "纯 HTML5/JS 实现，无 React/Vue 等框架依赖，Tailwind CSS 本地化构建，兼容微信内置浏览器等各种环境"],
      ["GBK编码处理", "使用 TextDecoder('gbk') 原生解码腾讯行情接口，解决移动端行情显示乱码的历史痛点"],
      ["多源行情容灾", "行情获取依次回退：腾讯qt.gtimg.cn → 东方财富 → 新浪，确保弱网下仍能显示数据"],
      ["安全设计", "VIP密钥采用MD2哈希+时间窗口动态生成，管理员会话使用HMAC-SHA256签名+时序安全比较，防止枚举攻击"],
      ["交易日历内置", "内置2026年全年节假日休市日期，智能区分交易时段与非交易时段，价格跳动符合真实市场规律"],
    ]
  ),

  h2("14.2 软件架构示意"),
  ...code([
    "┌─────────────────────────────────────────────────────┐",
    "│              用户浏览器（移动端 H5）                   │",
    "│  index.html → 合规入口 → core.js（前端主逻辑）        │",
    "│  ├─ 行情查询（qt.gtimg.cn 直连 + 服务端回退）         │",
    "│  ├─ 交易日历（内置2026年节假日）                      │",
    "│  ├─ 财经资讯（新浪 JSONP + 腾讯财经链接）             │",
    "│  └─ 知识库问答（POST /api/qa/ask）                    │",
    "└───────────────────┬─────────────────────────────────┘",
    "                     │  Nginx 反代",
    "┌───────────────────▼─────────────────────────────────┐",
    "│          Node.js 服务端 (server.js)                  │",
    "│  ├─ /api/health    健康检查                          │",
    "│  ├─ /api/quote     行情聚合（腾讯/东财/新浪）         │",
    "│  ├─ /api/kb/list   知识库列表（IMA OpenAPI）          │",
    "│  ├─ /api/qa/ask    知识库检索 + 模型生成              │",
    "│  ├─ /api/admin/*   管理员登录/状态/登出               │",
    "│  └─ /api/vip/*     VIP密钥生成与校验                  │",
    "└──────────┬──────────────────────┬───────────────────┘",
    "           │                      │",
    "  ┌────────▼────────┐   ┌─────────▼────────┐",
    "  │  IMA 知识库      │   │  AI 大模型 API   │",
    "  │  ima.qq.com      │   │  混元 Hunyuan    │",
    "  │  (RAG检索)       │   │  或 DeepSeek     │",
    "  └─────────────────┘   └──────────────────┘",
  ]),

  h2("14.3 版权与免责声明"),
  body("本软件及全部源代码版权归原作者所有，权利范围：全部权利。未经书面授权，禁止将本软件用于商业目的或对外分发。"),
  body("免责声明：本软件仅作技术演示与数据展示练习，不构成任何投资建议。行情数据来自第三方公开接口，延迟、准确性、可用性不做保证；请勿将本软件用于实盘投资决策依据。使用本软件须遵守中华人民共和国相关法律法规及所在平台规则（含微信等）。"),
  ...spacer(1),

  new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: "1E3A5F", space: 12 } },
    spacing: { before: 240 },
    children: [new TextRun({ text: "本文档由智博优 Alpha_Terminal 智能终端系统（V1.0）自动生成", size: 18, color: "666666", font: "微软雅黑", italics: true })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "官方网站：http://www.aialter.site  |  版本：V1.0  |  日期：2026-04-01", size: 18, color: "666666", font: "微软雅黑", italics: true })]
  })
);

// ─────────── 组装文档 ───────────
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "微软雅黑", size: 20, color: "374151" }
      }
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "微软雅黑", color: "1E3A5F" },
        paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "微软雅黑", color: "2563EB" },
        paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "微软雅黑", color: "374151" },
        paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2 }
      },
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
      }
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "智博优 Alpha_Terminal 智能终端系统 V1.0  |  用户操作说明书", size: 16, color: "888888", font: "微软雅黑" }),
              new TextRun({ children: ["\t"], size: 16 }),
              new TextRun({ text: "www.aialter.site", size: 16, color: "2563EB", font: "微软雅黑" })
            ],
            tabStops: [{ type: "right", position: 8506 }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC", space: 4 } }
          })
        ]
      })
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "第 ", size: 16, color: "888888", font: "微软雅黑" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
              new TextRun({ text: " 页  |  © 2026 智博优科技  |  保留所有权利", size: 16, color: "888888", font: "微软雅黑" })
            ],
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC", space: 4 } }
          })
        ]
      })
    },
    children
  }]
});

const outPath = path.join(__dirname, "Alpha_Terminal_用户操作说明书_V1.0.docx");
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log("✅ 文档生成成功：", outPath);
  console.log("📄 文件大小：", (buf.length / 1024).toFixed(1), "KB");
}).catch(err => {
  console.error("❌ 生成失败：", err.message);
  process.exit(1);
});
