#!/usr/bin/env python3
"""法拍房爬虫 — 房天下深圳法拍
优先级: 房天下 > 安居客 > 京东 > 阿里拍卖
运行方式: python3 fapai_crawler.py [--source fang|anjuke|jd|taobao] [--output /var/www/xuequ/data/fapai.json]
增量低频: 建议每周一次 crontab
"""
import json, re, os, sys, time, hashlib
from datetime import datetime
from urllib.parse import urljoin

# 尝试导入requests
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# 尝试导入BeautifulSoup
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

OUTPUT_DIR = "/var/www/xuequ/data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "fapai.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://sz.esf.fang.com/",
}

# 深圳学区映射（简化版，可扩展）
SCHOOL_DISTRICT_MAP = {
    "益田花园": "福强小学 / 皇岗中学",
    "前海花园": "南海小学 / 育才二中",
    "翠竹苑": "翠竹小学 / 翠园中学",
    "宏发领域": "宝安中学（集团）小学 / 宝安中学",
    "香蜜湖壹号": "荔园外国语小学 / 高级中学初中部",
    "大运城邦": "华中师大附属龙园学校",
    "桃源村": "桃源小学 / 育才三中",
    "景田东花园": "景莲小学 / 北环中学",
    "梅林一村": "梅园小学 / 梅林中学",
    "百花片区": "百花小学 / 实验学校初中部",
    "侨香村": "侨香外国语学校",
    "中海锦城": "南山外国语学校(集团)滨海学校",
    "深业中城": "福田外国语学校",
    "金地海景": "南华实验学校",
    "海岸花园": "后海小学 / 育才四中",
}

def guess_district(title):
    """从标题猜区域"""
    for d in ["福田","南山","罗湖","宝安","龙岗","龙华","光明","坪山","盐田","大鹏"]:
        if d in title:
            return d
    return "深圳"

def guess_school(community):
    """从小区名猜学区"""
    for key, school in SCHOOL_DISTRICT_MAP.items():
        if key in community:
            return school
    return "待核实"

def make_id(title, court):
    """生成唯一ID"""
    s = f"fapai_{title}_{court}"
    return hashlib.md5(s.encode()).hexdigest()[:12]


def crawl_fang():
    """爬取房天下深圳法拍"""
    if not HAS_REQUESTS or not HAS_BS4:
        print("[warn] 缺少requests/beautifulsoup4，无法爬取")
        return []
    
    items = []
    base_url = "https://sz.esf.fang.com/fapai/"
    
    try:
        # 房天下法拍房列表页
        for page in range(1, 4):
            url = f"{base_url}house/i3{page}/"
            print(f"[fang] 正在抓取第{page}页: {url}")
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.encoding = "utf-8"
            
            if resp.status_code != 200:
                print(f"[fang] 第{page}页请求失败: {resp.status_code}")
                continue
            
            soup = BeautifulSoup(resp.text, "html.parser")
            
            # 房天下法拍房列表结构
            listings = soup.select(".houseList .plotListWrap, .shoplistShop, .fapai-item, .list-item, .houseItem")
            if not listings:
                # 尝试更通用的选择器
                listings = soup.select("[class*='house'], [class*='list'], [class*='item']")
            
            for item in listings[:20]:
                try:
                    text = item.get_text()
                    if not text or len(text) < 10:
                        continue
                    
                    # 尝试提取标题
                    title_el = item.select_one("a[title], .title, h3, .house-title, [class*='title']")
                    title = title_el.get("title") or title_el.get_text(strip=True) if title_el else ""
                    
                    # 尝试提取价格
                    price_el = item.select_one("[class*='price'], .price")
                    price_text = price_el.get_text(strip=True) if price_el else ""
                    
                    # 尝试提取面积
                    area_el = item.select_one("[class*='area'], [class*='size']")
                    area_text = area_el.get_text(strip=True) if area_el else ""
                    
                    # 尝试提取链接
                    link_el = item.select_one("a[href]")
                    link = link_el.get("href", "") if link_el else ""
                    if link and not link.startswith("http"):
                        link = urljoin(base_url, link)
                    
                    if not title and not price_text:
                        continue
                    
                    # 解析数字
                    area_match = re.search(r'(\d+\.?\d*)\s*[㎡平]', text)
                    price_match = re.search(r'(\d+\.?\d*)\s*万', price_text or text)
                    
                    area_val = float(area_match.group(1)) if area_match else 0
                    price_val = float(price_match.group(1)) if price_match else 0
                    
                    district = guess_district(title)
                    community = title.split("-")[-1].strip() if "-" in title else title[:10]
                    school = guess_school(community)
                    
                    items.append({
                        "id": make_id(title, "fang"),
                        "title": title[:80],
                        "district": district,
                        "community": community,
                        "area": area_val,
                        "start_price": price_val,
                        "assess_price": round(price_val * 1.3, 1) if price_val else 0,
                        "auction_date": "",
                        "court": "",
                        "school_district": school,
                        "status": "法拍",
                        "source": "房天下",
                        "url": link,
                        "discount_pct": round((1 - price_val / (price_val * 1.3)) * 100, 1) if price_val else 0,
                        "unit_price": round(price_val / area_val * 10000, 0) if area_val and price_val else 0,
                    })
                except Exception as e:
                    print(f"[fang] 解析条目失败: {e}")
                    continue
            
            time.sleep(2)  # 礼貌爬取
        
    except Exception as e:
        print(f"[fang] 爬取失败: {e}")
    
    return items


def crawl_anjuke():
    """爬取安居客法拍"""
    if not HAS_REQUESTS or not HAS_BS4:
        return []
    
    items = []
    try:
        url = "https://shenzhen.augohome.com/fapai/"
        print(f"[anjuke] 正在抓取: {url}")
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.encoding = "utf-8"
        
        if resp.status_code != 200:
            print(f"[anjuke] 请求失败: {resp.status_code}")
            return []
        
        soup = BeautifulSoup(resp.text, "html.parser")
        listings = soup.select("[class*='item'], [class*='list']")
        
        for item in listings[:20]:
            try:
                text = item.get_text()
                if not text or len(text) < 10:
                    continue
                title_el = item.select_one("a[title], .title, h3")
                title = title_el.get("title") or title_el.get_text(strip=True) if title_el else ""
                price_match = re.search(r'(\d+\.?\d*)\s*万', text)
                area_match = re.search(r'(\d+\.?\d*)\s*[㎡平]', text)
                
                if not title:
                    continue
                    
                price_val = float(price_match.group(1)) if price_match else 0
                area_val = float(area_match.group(1)) if area_match else 0
                district = guess_district(title)
                community = title.split("-")[-1].strip() if "-" in title else title[:10]
                
                items.append({
                    "id": make_id(title, "anjuke"),
                    "title": title[:80],
                    "district": district,
                    "community": community,
                    "area": area_val,
                    "start_price": price_val,
                    "assess_price": round(price_val * 1.3, 1) if price_val else 0,
                    "auction_date": "",
                    "court": "",
                    "school_district": guess_school(community),
                    "status": "法拍",
                    "source": "安居客",
                    "url": "",
                    "discount_pct": round((1 - price_val / (price_val * 1.3)) * 100, 1) if price_val else 0,
                    "unit_price": round(price_val / area_val * 10000, 0) if area_val and price_val else 0,
                })
            except Exception as e:
                continue
        
        time.sleep(2)
    except Exception as e:
        print(f"[anjuke] 爬取失败: {e}")
    
    return items


def merge_data(new_items, existing_file):
    """合并新旧数据，去重"""
    existing = []
    if os.path.exists(existing_file):
        try:
            with open(existing_file, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except:
            existing = []
    
    existing_ids = {item.get("id") for item in existing}
    for item in new_items:
        if item.get("id") not in existing_ids:
            existing.append(item)
            existing_ids.add(item.get("id"))
    
    return existing


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else "fang"
    output = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_FILE
    
    os.makedirs(os.path.dirname(output), exist_ok=True)
    
    all_items = []
    
    if source in ("fang", "all"):
        items = crawl_fang()
        print(f"[fang] 抓取到 {len(items)} 条")
        all_items.extend(items)
    
    if source in ("anjuke", "all"):
        items = crawl_anjuke()
        print(f"[anjuke] 抓取到 {len(items)} 条")
        all_items.extend(items)
    
    if not all_items:
        print("[warn] 未抓取到任何数据，保留现有数据")
        return
    
    # 合并
    merged = merge_data(all_items, output)
    
    with open(output, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    
    print(f"[done] 共 {len(merged)} 条法拍房数据，已保存到 {output}")


if __name__ == "__main__":
    main()
