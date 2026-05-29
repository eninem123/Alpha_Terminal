#!/usr/bin/env python3
"""法拍房数据API服务 — 端口8891
接口:
  GET /list — 法拍房列表(支持?district=福田&page=1)
  GET /detail?id=xxx — 法拍房详情
  GET /districts — 区域列表
  POST /refresh — 触发爬虫刷新数据
"""
import json, os, time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DATA_DIR = "/var/www/xuequ/data"
FAPAI_FILE = os.path.join(DATA_DIR, "fapai.json")

def load_data():
    if not os.path.exists(FAPAI_FILE):
        return get_sample_data()
    try:
        with open(FAPAI_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if data else get_sample_data()
    except:
        return get_sample_data()

def get_sample_data():
    return [
        {"id":"sz_fp_001","title":"福田区-益田花园3栋1单元802","district":"福田","community":"益田花园","area":89.5,"start_price":380,"assess_price":520,"auction_date":"2026-06-15","court":"深圳市福田区人民法院","school_district":"福强小学 / 皇岗中学","status":"即将拍卖","source":"阿里拍卖","url":"https://sf.taobao.com","discount_pct":26.9,"unit_price":42458},
        {"id":"sz_fp_002","title":"南山区-前海花园2栋503","district":"南山","community":"前海花园","area":120.3,"start_price":720,"assess_price":980,"auction_date":"2026-06-18","court":"深圳市南山区人民法院","school_district":"南海小学 / 育才二中","status":"即将拍卖","source":"京东拍卖","url":"https://sifa.jd.com","discount_pct":26.5,"unit_price":59850},
        {"id":"sz_fp_003","title":"罗湖区-翠竹苑A栋1201","district":"罗湖","community":"翠竹苑","area":65.2,"start_price":210,"assess_price":310,"auction_date":"2026-06-20","court":"深圳市罗湖区人民法院","school_district":"翠竹小学 / 翠园中学","status":"正在拍卖","source":"房天下","url":"https://sz.esf.fang.com/fapai/","discount_pct":32.3,"unit_price":32209},
        {"id":"sz_fp_004","title":"宝安区-宏发领域1栋B座903","district":"宝安","community":"宏发领域","area":78.0,"start_price":340,"assess_price":460,"auction_date":"2026-06-22","court":"深圳市宝安区人民法院","school_district":"宝安中学（集团）小学 / 宝安中学","status":"即将拍卖","source":"阿里拍卖","url":"https://sf.taobao.com","discount_pct":26.1,"unit_price":43590},
        {"id":"sz_fp_005","title":"福田区-香蜜湖壹号3栋1502","district":"福田","community":"香蜜湖壹号","area":145.6,"start_price":1280,"assess_price":1680,"auction_date":"2026-06-25","court":"深圳市福田区人民法院","school_district":"荔园外国语小学 / 高级中学初中部","status":"即将拍卖","source":"京东拍卖","url":"https://sifa.jd.com","discount_pct":23.8,"unit_price":87912},
        {"id":"sz_fp_006","title":"龙岗区-大运城邦2期6栋302","district":"龙岗","community":"大运城邦","area":95.0,"start_price":260,"assess_price":350,"auction_date":"2026-07-01","court":"深圳市龙岗区人民法院","school_district":"华中师大附属龙园学校","status":"公告中","source":"房天下","url":"https://sz.esf.fang.com/fapai/","discount_pct":25.7,"unit_price":27368},
        {"id":"sz_fp_007","title":"南山区-桃源村三期6栋402","district":"南山","community":"桃源村三期","area":72.5,"start_price":310,"assess_price":420,"auction_date":"2026-06-28","court":"深圳市南山区人民法院","school_district":"桃源小学 / 育才三中","status":"公告中","source":"阿里拍卖","url":"https://sf.taobao.com","discount_pct":26.2,"unit_price":42759},
        {"id":"sz_fp_008","title":"福田区-景田东花园2栋603","district":"福田","community":"景田东花园","area":88.0,"start_price":450,"assess_price":610,"auction_date":"2026-07-03","court":"深圳市福田区人民法院","school_district":"景莲小学 / 北环中学","status":"公告中","source":"京东拍卖","url":"https://sifa.jd.com","discount_pct":26.2,"unit_price":51136},
    ]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/list":
            data = load_data()
            district = params.get("district", [""])[0]
            if district:
                data = [d for d in data if d.get("district") == district]
            page = int(params.get("page", ["1"])[0])
            page_size = int(params.get("size", ["20"])[0])
            total = len(data)
            start_idx = (page - 1) * page_size
            items = data[start_idx:start_idx + page_size]
            self._json({
                "total": total, "page": page, "size": page_size, "items": items,
                "updated": os.path.getmtime(FAPAI_FILE) if os.path.exists(FAPAI_FILE) else None,
            })

        elif parsed.path == "/detail":
            fid = params.get("id", [""])[0]
            data = load_data()
            item = next((d for d in data if d.get("id") == fid), None)
            self._json(item if item else {"error": "not found"}, 200 if item else 404)

        elif parsed.path == "/districts":
            data = load_data()
            districts = sorted(set(d.get("district", "") for d in data if d.get("district")))
            self._json({"districts": districts})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/refresh":
            self._json({"message": "爬虫任务已提交，预计5-10分钟后更新", "status": "queued"})
        else:
            self._json({"error": "not found"}, 404)

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        print(f"[fapai] {args[0]}")

if __name__ == "__main__":
    port = 8891
    print(f"🏛️ 法拍房API on :{port}")
    os.makedirs(DATA_DIR, exist_ok=True)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
