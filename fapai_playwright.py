#!/usr/bin/env python3
"""深圳法拍房爬虫 - Playwright版（房天下+阿里拍卖）"""
import json, os, sys, time, hashlib, re
from datetime import datetime

OUTPUT = "/var/www/xuequ/data/fapai.json"

def guess_district(text):
    for d in ["福田","南山","罗湖","宝安","龙岗","龙华","光明","坪山","盐田","大鹏"]:
        if d in text:
            return d
    return "深圳"

def make_id(s):
    return hashlib.md5(s.encode()).hexdigest()[:12]

def crawl_fang_com(page):
    """爬房天下法拍"""
    items = []
    base_url = "https://sz.esf.fang.com/fapai/house/"
    
    for pg in range(1, 8):  # 爬7页
        url = f"{base_url}i3{pg}/" if pg > 1 else base_url
        print(f"[fang] 第{pg}页: {url}")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=15000)
            time.sleep(2)
            
            # 尝试多种选择器
            cards = page.query_selector_all("div.houseList li, div.list_wrap li, .fapai_list li, dl.list, .house_item, a[href*='fapai']")
            if not cards:
                # 尝试直接提取链接
                cards = page.query_selector_all("a[href*='/fapai/sz/']")
            
            print(f"  找到 {len(cards)} 个元素")
            
            for card in cards:
                try:
                    # 提取链接
                    link_el = card if card.evaluate("el => el.tagName") == "A" else card.query_selector("a[href*='fapai']")
                    if not link_el:
                        continue
                    href = link_el.get_attribute("href") or ""
                    if "fapai" not in href and "out_" not in href:
                        continue
                    
                    # 提取文本
                    text = card.inner_text()
                    if not text or len(text) < 10:
                        continue
                    
                    # 提取标题
                    title = ""
                    for sel in ["h3", "h2", ".title", "a"]:
                        el = card.query_selector(sel)
                        if el:
                            t = el.inner_text().strip()
                            if len(t) > 5:
                                title = t
                                break
                    if not title:
                        title = text[:60].split("\n")[0].strip()
                    
                    # 提取价格
                    start_price = 0
                    prices = re.findall(r'(\d+\.?\d*)\s*万', text)
                    if prices:
                        start_price = float(prices[0])
                    
                    # 提取面积
                    area = 0
                    areas = re.findall(r'(\d+\.?\d*)\s*[㎡平]', text)
                    if areas:
                        area = float(areas[0])
                    
                    # 提取单价
                    unit_price = 0
                    ups = re.findall(r'(\d+)\s*元/㎡', text)
                    if ups:
                        unit_price = float(ups[0])
                    elif start_price > 0 and area > 0:
                        unit_price = round(start_price * 10000 / area)
                    
                    # 提取折扣
                    discount_pct = 0
                    discs = re.findall(r'(\d+\.?\d*)\s*折', text)
                    if discs:
                        discount_pct = (10 - float(discs[0])) * 10
                    elif "折" in text:
                        nums = re.findall(r'(\d+)', text.split("折")[0][-5:])
                        if nums:
                            discount_pct = round((1 - float(nums[-1])/100) * 100, 1)
                    
                    if start_price > 0 and title:
                        full_url = href if href.startswith("http") else f"https://sz.esf.fang.com{href}"
                        items.append({
                            "id": make_id(title + str(start_price)),
                            "title": title[:80],
                            "district": guess_district(title),
                            "community": title[:30],
                            "area": area,
                            "start_price": start_price,
                            "assess_price": round(start_price / 0.7, 1) if start_price > 0 else 0,
                            "auction_date": "",
                            "court": "",
                            "school_district": "待核实",
                            "status": "法拍",
                            "source": "房天下",
                            "url": full_url,
                            "discount_pct": discount_pct,
                            "unit_price": unit_price
                        })
                except Exception as e:
                    continue
            
            if len(cards) == 0:
                print(f"  第{pg}页无数据，停止翻页")
                break
        except Exception as e:
            print(f"  第{pg}页错误: {e}")
            continue
    
    return items

def crawl_taobao_sf(page):
    """爬阿里拍卖司法频道"""
    items = []
    url = "https://sf.taobao.com/item_list.htm?city=%E6%B7%B1%E5%9C%B3&province=%E5%B9%BF%E4%B8%9C"
    print(f"[taobao] {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        time.sleep(3)
        
        # 阿里拍卖的列表
        cards = page.query_selector_all(".item-card, .sf-item, .J_Item, [class*='item'], dl")
        print(f"  找到 {len(cards)} 个元素")
        
        for card in cards:
            try:
                text = card.inner_text()
                if len(text) < 15:
                    continue
                
                title = text.split("\n")[0].strip()[:80]
                if not title or "法拍" not in title and "拍卖" not in title and "深圳" not in title:
                    # 尝试匹配深圳房产
                    if not any(d in title for d in ["福田","南山","罗湖","宝安","龙岗","龙华"]):
                        continue
                
                prices = re.findall(r'(\d+\.?\d*)\s*万', text)
                start_price = float(prices[0]) if prices else 0
                areas = re.findall(r'(\d+\.?\d*)\s*[㎡平]', text)
                area = float(areas[0]) if areas else 0
                
                if start_price > 0:
                    items.append({
                        "id": make_id(title + str(start_price)),
                        "title": title,
                        "district": guess_district(title),
                        "community": title[:30],
                        "area": area,
                        "start_price": start_price,
                        "assess_price": round(start_price / 0.7, 1) if start_price > 0 else 0,
                        "auction_date": "",
                        "court": "",
                        "school_district": "待核实",
                        "status": "法拍",
                        "source": "阿里拍卖",
                        "url": "https://sf.taobao.com",
                        "discount_pct": 0,
                        "unit_price": round(start_price * 10000 / area) if area > 0 else 0
                    })
            except:
                continue
    except Exception as e:
        print(f"  taobao错误: {e}")
    
    return items

def main():
    from playwright.sync_api import sync_playwright
    
    all_items = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            viewport={"width": 390, "height": 844}
        )
        page = ctx.new_page()
        
        # 先爬房天下
        items = crawl_fang_com(page)
        all_items.extend(items)
        print(f"[fang] 共 {len(items)} 条")
        
        # 再爬阿里拍卖
        items = crawl_taobao_sf(page)
        all_items.extend(items)
        print(f"[taobao] 共 {len(items)} 条")
        
        browser.close()
    
    # 去重
    seen = set()
    unique = []
    for item in all_items:
        key = item["title"][:20]
        if key not in seen:
            seen.add(key)
            unique.append(item)
    
    # 保存
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)
    
    print(f"\n[done] 共 {len(unique)} 条法拍房数据（去重后），已保存到 {OUTPUT}")
    return len(unique)

if __name__ == "__main__":
    count = main()
    sys.exit(0 if count >= 10 else 1)
