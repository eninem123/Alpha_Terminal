#!/bin/bash
# 法拍房数据采集流水线
# 流程：拍房网公众号最新文章 → 图片 → MiMo识别 → CSV → fapai.json
# 用法：
#   bash fapai_pipeline.sh collect   # 步骤1: 采集文章图片(需云手机)
#   bash fapai_pipeline.sh ocr       # 步骤2: MiMo图片识别转CSV
#   bash fapai_pipeline.sh import    # 步骤3: CSV导入fapai.json
#   bash fapai_pipeline.sh all       # 全流程(除采集需云手机)

set -e
WORK_DIR="/root/Alpha_Terminal/fapai_work"
CSV_DIR="$WORK_DIR/csv"
IMG_DIR="$WORK_DIR/images"
OUTPUT_JSON="/var/www/xuequ/data/fapai.json"
MIMO_API="https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
MIMO_KEY="tp-czmhb86n2j7nlx1b717du0e76khpm558ntajjl2158j2u084"
MIMO_MODEL="xiaomi-coding/mimo-v2.5"

mkdir -p "$WORK_DIR" "$CSV_DIR" "$IMG_DIR"

# 步骤1: 采集提示(需云手机操作)
collect() {
    echo "========================================="
    echo "📱 拍房网公众号采集步骤（需云手机操作）"
    echo "========================================="
    echo "1. 打开微信 → 搜索「拍房网」公众号"
    echo "2. 进入最新法拍房文章（通常标题含「深圳法拍」+ 日期）"
    echo "3. 截取文章中的法拍房表格图片，保存到: $IMG_DIR/"
    echo "4. 图片命名格式: {区名}法拍房_{日期}.jpg"
    echo "   例如: 福田法拍房_0530.jpg"
    echo ""
    echo "图片保存后运行: bash fapai_pipeline.sh ocr"
}

# 步骤2: MiMo图片识别转CSV
ocr() {
    echo "🔍 开始MiMo图片识别..."
    
    img_count=$(ls "$IMG_DIR"/*.jpg "$IMG_DIR"/*.png 2>/dev/null | wc -l)
    if [ "$img_count" -eq 0 ]; then
        echo "❌ $IMG_DIR/ 下没有图片文件"
        echo "请先将公众号文章截图放入该目录"
        exit 1
    fi
    
    echo "找到 $img_count 张图片，开始识别..."
    
    for img in "$IMG_DIR"/*.jpg "$IMG_DIR"/*.png; do
        [ -f "$img" ] || continue
        basename=$(basename "$img")
        
        echo "  识别: $basename"
        
        # 将图片转base64
        b64=$(base64 -w0 "$img")
        
        # 判断图片格式
        if echo "$basename" | grep -qi '\.png'; then
            mime="image/png"
        else
            mime="image/jpeg"
        fi
        
        # 调用MiMo视觉模型识别表格
        response=$(curl -s --max-time 60 "$MIMO_API" \
            -H "Authorization: Bearer $MIMO_KEY" \
            -H "Content-Type: application/json" \
            -d "{
                \"model\": \"$MIMO_MODEL\",
                \"messages\": [{
                    \"role\": \"user\",
                    \"content\": [
                        {
                            \"type\": \"image_url\",
                            \"image_url\": {\"url\": \"data:${mime};base64,${b64}\"}
                        },
                        {
                            \"type\": \"text\",
                            \"text\": \"请将这张法拍房表格图片识别为CSV格式。列名：序号,平台,物业,商圈,面积 (㎡),起拍价 (万),市场价 (万),起拍单价 (万 / 平),市场单价 (万 / 平),开拍日 (月 / 日),学区。注意：1.平台列填A(阿里拍卖)或J(京东拍卖)或T(淘宝拍卖) 2.数字不要带单位 3.开拍日格式MM/DD 4.只输出CSV数据不要其他内容 5.第一行必须是表头 6.所有行都要识别不要遗漏\"
                        }
                    ]
                }],
                \"max_tokens\": 4096,
                \"temperature\": 0.1
            }")
        
        # 提取CSV内容
        csv_content=$(echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    text = d['choices'][0]['message']['content']
    # 清理markdown代码块
    text = text.replace('\`\`\`csv','').replace('\`\`\`','').strip()
    print(text)
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
        
        if echo "$csv_content" | grep -q "^ERROR"; then
            echo "  ❌ 识别失败: $csv_content"
            continue
        fi
        
        # 保存CSV
        csv_name="${basename%.*}.csv"
        echo "$csv_content" > "$CSV_DIR/$csv_name"
        echo "  ✅ 保存: $CSV_DIR/$csv_name"
    done
    
    echo ""
    echo "识别完成！CSV文件保存在 $CSV_DIR/"
    echo "下一步运行: bash fapai_pipeline.sh import"
}

# 步骤3: CSV导入fapai.json
import() {
    echo "📦 开始导入CSV到fapai.json..."
    
    csv_count=$(ls "$CSV_DIR"/*.csv 2>/dev/null | wc -l)
    if [ "$csv_count" -eq 0 ]; then
        echo "❌ $CSV_DIR/ 下没有CSV文件"
        echo "请先运行 ocr 步骤生成CSV"
        exit 1
    fi
    
    python3 << 'PYEOF'
import csv, json, os, glob
from datetime import datetime

CSV_DIR = "/root/Alpha_Terminal/fapai_work/csv"
OUTPUT = "/var/www/xuequ/data/fapai.json"

platform_map = {
    'A': ('阿里拍卖', 'https://sf.taobao.com'),
    'J': ('京东拍卖', 'https://sifa.jd.com'),
    'T': ('淘宝拍卖', 'https://sf.taobao.com'),
}

# 加载已有数据(去重用)
existing = set()
if os.path.exists(OUTPUT):
    try:
        with open(OUTPUT, 'r', encoding='utf-8') as f:
            old_data = json.load(f)
            for item in old_data:
                key = f"{item.get('district','')}_{item.get('title','')}_{item.get('auction_date','')}"
                existing.add(key)
    except:
        old_data = []
else:
    old_data = []

all_records = list(old_data)
counter = len(all_records) + 1
today_str = datetime.now().strftime('%Y-%m-%d')
new_count = 0
dup_count = 0

def guess_district(filename):
    name = os.path.basename(filename)
    for d in ['福田','南山','罗湖','宝安','龙岗','龙华','光明','坪山','盐田','大鹏']:
        if d in name:
            return d
    return ''

for csv_file in sorted(glob.glob(os.path.join(CSV_DIR, "*.csv"))):
    file_district = guess_district(csv_file)
    print(f"  处理: {os.path.basename(csv_file)} (区名: {file_district or '未知'})")
    
    with open(csv_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            prop = row.get('物业', row.get('property', '')).strip()
            if not prop:
                continue
            
            district = file_district or row.get('district', row.get('区', '')).strip()
            if not district:
                biz = row.get('商圈', row.get('business_area', '')).strip()
                for d, areas in {
                    '福田': ['福田','香蜜湖','景田','梅林','皇岗','新洲','石厦','华强','八卦岭','莲花','竹子林','福保','百花','园岭'],
                    '南山': ['南山','后海','前海','蛇口','科技园','粤海','西丽','华侨城','南头','沙河','招商'],
                    '罗湖': ['罗湖','莲塘','翠竹','东门','黄贝','笋岗','地王','银湖','布心','螺岭','百仕达','水库'],
                    '宝安': ['宝安','新安','西乡','福永','沙井','松岗','光明','公明','石岩'],
                    '龙岗': ['龙岗','布吉','横岗','平湖','坪山','大鹏','龙城','宝龙','龙华'],
                }.items():
                    if biz in areas:
                        district = d
                        break
            if not district:
                district = '深圳'
            
            pc = row.get('平台', row.get('platform', '')).strip()
            si = platform_map.get(pc, ('其他', ''))
            
            try: area = float(row.get('面积 (㎡)', row.get('面积', row.get('area', '0'))).strip() or '0')
            except: area = 0
            try: sp = float(row.get('起拍价 (万)', row.get('起拍价', row.get('start_price', '0'))).strip() or '0')
            except: sp = 0
            mp_s = row.get('市场价 (万)', row.get('市场价', row.get('market_price', ''))).strip()
            try: ap = float(mp_s) if mp_s and mp_s not in ('—','/','') else 0
            except: ap = 0
            su_s = row.get('起拍单价 (万 / 平)', row.get('起拍单价', row.get('start_unit_price', ''))).strip()
            try: up = int(float(su_s)*10000) if su_s and su_s not in ('—','/','') else 0
            except: up = 0
            dp = round((1-sp/ap)*100,1) if ap>0 and sp>0 else 0
            
            ad_s = row.get('开拍日 (月 / 日)', row.get('开拍日', row.get('auction_date', ''))).strip()
            ad = ''
            if ad_s:
                if '/' in ad_s:
                    ps = ad_s.split('/')
                    if len(ps) == 2:
                        ad = f"2026-{ps[0].zfill(2)}-{ps[1].zfill(2)}"
                elif '-' in ad_s and len(ad_s) >= 8:
                    ad = ad_s[:10]
            
            if ad:
                if ad < today_str: st = '已开拍'
                elif ad == today_str: st = '今日开拍'
                else: st = '待开拍'
            else: st = '待定'
            
            sd = row.get('学区', row.get('school_district', '')).strip()
            sd = sd.replace('、',' / ') if sd and sd != '/' else '待查询'
            
            biz = row.get('商圈', row.get('business_area', '')).strip()
            title = f"{district}-{prop}"
            
            key = f"{district}_{title}_{ad}"
            if key in existing:
                dup_count += 1
                continue
            
            record = {
                "id": f"fp_{counter:03d}",
                "title": title,
                "district": district,
                "community": prop,
                "business_area": biz,
                "area": area,
                "start_price": sp,
                "assess_price": ap,
                "auction_date": ad,
                "court": f"{district}区人民法院",
                "school_district": sd,
                "status": st,
                "source": si[0],
                "url": si[1],
                "discount_pct": dp,
                "unit_price": up,
            }
            
            all_records.append(record)
            existing.add(key)
            counter += 1
            new_count += 1

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(all_records, f, ensure_ascii=False, indent=2)

from collections import Counter
dc = Counter(r['district'] for r in all_records)
print(f"\n✅ 导入完成！新增{new_count}条，跳过{dup_count}条重复")
print(f"📊 总计{len(all_records)}条:")
for d, c in sorted(dc.items()):
    print(f"   {d}: {c}条")
PYEOF

    echo "如需清理已处理文件: rm -f $IMG_DIR/*.jpg $IMG_DIR/*.png $CSV_DIR/*.csv"
}

# 全流程
all() {
    echo "🚀 法拍房数据全流程"
    collect
    echo ""
    echo "⚠️  采集步骤需手动操作云手机"
    echo "图片准备好后运行: bash fapai_pipeline.sh ocr && bash fapai_pipeline.sh import"
}

case "${1:-help}" in
    collect) collect ;;
    ocr) ocr ;;
    import) import ;;
    all) all ;;
    *) echo "用法: bash fapai_pipeline.sh {collect|ocr|import|all}" ;;
esac
