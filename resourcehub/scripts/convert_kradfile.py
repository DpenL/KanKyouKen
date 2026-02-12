#!/usr/bin/env python3
"""
Convert krad.json + krad_components.json to KRADFILE schema format.

This script transforms the bhffmnn/krad-unicode format into our
KRADFILE radical decomposition schema.
"""

import json
from datetime import date
from pathlib import Path
from collections import defaultdict

# Paths
SCRIPT_DIR = Path(__file__).parent
DOWNLOADS_DIR = SCRIPT_DIR.parent / "downloads"
BUNDLED_DIR = SCRIPT_DIR.parent / "bundled"
INPUT_KRAD = DOWNLOADS_DIR / "krad.json"
INPUT_COMPONENTS = DOWNLOADS_DIR / "krad_components.json"
OUTPUT_FILE = BUNDLED_DIR / "kradfile_u_v2025.1.0.json"


# Radical meanings (partial list - sourced from common knowledge)
# For radicals without meanings, we'll omit the meaning field
RADICAL_MEANINGS = {
    "一": "one",
    "｜": "line",
    "丶": "dot",
    "ノ": "slash",
    "乙": "second",
    "亅": "hook",
    "二": "two",
    "亠": "lid",
    "人": "person",
    "儿": "legs",
    "入": "enter",
    "八": "eight",
    "冂": "down box",
    "冖": "cover",
    "冫": "ice",
    "几": "table",
    "凵": "container",
    "刀": "knife",
    "力": "power",
    "勹": "wrap",
    "匕": "spoon",
    "匚": "box",
    "十": "ten",
    "卜": "divination",
    "卩": "seal",
    "厂": "cliff",
    "厶": "private",
    "又": "again",
    "口": "mouth",
    "囗": "enclosure",
    "土": "earth",
    "士": "samurai",
    "夂": "go",
    "夕": "evening",
    "大": "big",
    "女": "woman",
    "子": "child",
    "宀": "roof",
    "寸": "inch",
    "小": "small",
    "尢": "lame",
    "尸": "corpse",
    "屮": "sprout",
    "山": "mountain",
    "川": "river",
    "工": "craft",
    "己": "self",
    "巾": "cloth",
    "干": "dry",
    "幺": "short thread",
    "广": "dotted cliff",
    "廴": "long stride",
    "廾": "hands joined",
    "弋": "shoot",
    "弓": "bow",
    "彡": "hair",
    "彳": "step",
    "心": "heart",
    "戈": "halberd",
    "戸": "door",
    "手": "hand",
    "支": "branch",
    "攴": "strike",
    "文": "literature",
    "斗": "dipper",
    "斤": "axe",
    "方": "direction",
    "无": "have not",
    "日": "sun",
    "曰": "say",
    "月": "moon",
    "木": "tree",
    "欠": "lack",
    "止": "stop",
    "歹": "death",
    "殳": "weapon",
    "毋": "do not",
    "比": "compare",
    "毛": "fur",
    "氏": "clan",
    "气": "steam",
    "水": "water",
    "火": "fire",
    "爪": "claw",
    "父": "father",
    "爻": "trigrams",
    "爿": "split wood",
    "片": "slice",
    "牙": "fang",
    "牛": "cow",
    "犬": "dog",
    "玄": "dark",
    "玉": "jewel",
    "瓜": "melon",
    "瓦": "tile",
    "甘": "sweet",
    "生": "life",
    "用": "use",
    "田": "rice field",
    "疋": "bolt of cloth",
    "疒": "sickness",
    "癶": "footsteps",
    "白": "white",
    "皮": "skin",
    "皿": "dish",
    "目": "eye",
    "矛": "spear",
    "矢": "arrow",
    "石": "stone",
    "示": "show",
    "禸": "track",
    "禾": "grain",
    "穴": "cave",
    "立": "stand",
    "竹": "bamboo",
    "米": "rice",
    "糸": "thread",
    "缶": "jar",
    "网": "net",
    "羊": "sheep",
    "羽": "feather",
    "老": "old",
    "而": "and yet",
    "耒": "plow",
    "耳": "ear",
    "聿": "brush",
    "肉": "meat",
    "臣": "minister",
    "自": "self",
    "至": "arrive",
    "臼": "mortar",
    "舌": "tongue",
    "舛": "opposite",
    "舟": "boat",
    "艮": "stopping",
    "色": "color",
    "艸": "grass",
    "虍": "tiger",
    "虫": "insect",
    "血": "blood",
    "行": "go",
    "衣": "clothes",
    "襾": "cover",
    "見": "see",
    "角": "horn",
    "言": "speak",
    "谷": "valley",
    "豆": "bean",
    "豕": "pig",
    "豸": "badger",
    "貝": "shell",
    "赤": "red",
    "走": "run",
    "足": "foot",
    "身": "body",
    "車": "cart",
    "辛": "spicy",
    "辰": "dragon",
    "辵": "walk",
    "邑": "town",
    "酉": "sake",
    "釆": "divide",
    "里": "village",
    "金": "gold",
    "長": "long",
    "門": "gate",
    "阜": "mound",
    "隶": "slave",
    "隹": "old bird",
    "雨": "rain",
    "青": "blue",
    "非": "wrong",
    "面": "face",
    "革": "leather",
    "韋": "tanned leather",
    "韭": "leek",
    "音": "sound",
    "頁": "page",
    "風": "wind",
    "飛": "fly",
    "食": "eat",
    "首": "neck",
    "香": "fragrant",
    "馬": "horse",
    "骨": "bone",
    "高": "tall",
    "髟": "hair",
    "鬥": "fight",
    "鬯": "herbs",
    "鬲": "tripod",
    "鬼": "ghost",
    "魚": "fish",
    "鳥": "bird",
    "鹵": "salt",
    "鹿": "deer",
    "麦": "wheat",
    "麻": "hemp",
    "黄": "yellow",
    "黍": "millet",
    "黒": "black",
    "黹": "embroidery",
    "黽": "frog",
    "鼎": "tripod",
    "鼓": "drum",
    "鼠": "rat",
    "鼻": "nose",
    "齊": "equal",
    "歯": "tooth",
    "竜": "dragon",
    "亀": "turtle",
}


def convert_to_kradfile_schema(krad_data: list, components_data: list) -> dict:
    """Convert krad data to KRADFILE schema."""

    # Build radicals dict (kanji -> list of radicals)
    radicals = {}
    for entry in krad_data:
        literal = entry["literal"]
        components = entry["components"]
        radicals[literal] = components

    # Build radical catalog (radical -> {stroke_count, meaning?})
    radical_catalog = {}
    for entry in components_data:
        component = entry["component"]
        stroke_count = entry["strokeCount"]
        catalog_entry = {"stroke_count": stroke_count}

        # Add meaning if we have it
        if component in RADICAL_MEANINGS:
            catalog_entry["meaning"] = RADICAL_MEANINGS[component]

        radical_catalog[component] = catalog_entry

    # Build reverse index (radical -> list of kanji containing it)
    kanji_by_radical = defaultdict(list)
    for kanji, rads in radicals.items():
        for rad in rads:
            kanji_by_radical[rad].append(kanji)

    # Convert defaultdict to regular dict and sort kanji lists
    kanji_by_radical = {
        rad: sorted(kanjis)
        for rad, kanjis in sorted(kanji_by_radical.items())
    }

    # Build output
    output = {
        "metadata": {
            "version": "2025.1.0",
            "date": date.today().isoformat(),
            "source": "bhffmnn/krad-unicode (derived from EDRDG KRADFILE/RADKFILE)",
            "source_url": "https://github.com/bhffmnn/krad-unicode",
            "character_count": len(radicals),
            "radical_count": len(radical_catalog),
            "description": "Kanji radical decomposition database mapping characters to their component radicals"
        },
        "radicals": radicals,
        "radical_catalog": radical_catalog,
        "kanji_by_radical": kanji_by_radical
    }

    return output


def main():
    """Run the conversion."""
    print("🔄 Converting krad data to KRADFILE schema")
    print("=" * 60)

    # Load inputs
    print(f"📄 Loading krad data from {INPUT_KRAD}")
    with open(INPUT_KRAD, 'r', encoding='utf-8') as f:
        krad_data = json.load(f)
    print(f"   Found {len(krad_data)} kanji entries")

    print(f"📄 Loading component data from {INPUT_COMPONENTS}")
    with open(INPUT_COMPONENTS, 'r', encoding='utf-8') as f:
        components_data = json.load(f)
    print(f"   Found {len(components_data)} radical/component entries")

    # Convert
    print("\n✓ Converting to KRADFILE schema...")
    output_data = convert_to_kradfile_schema(krad_data, components_data)

    # Ensure output directory exists
    BUNDLED_DIR.mkdir(parents=True, exist_ok=True)

    # Save output
    print(f"\n💾 Saving to {OUTPUT_FILE}")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Add trailing newline

    # Report
    file_size = OUTPUT_FILE.stat().st_size
    print("\n" + "=" * 60)
    print("✅ Conversion complete!")
    print(f"   Output file: {OUTPUT_FILE.name}")
    print(f"   Kanji: {output_data['metadata']['character_count']:,}")
    print(f"   Radicals: {output_data['metadata']['radical_count']:,}")
    print(f"   File size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")

    return 0


if __name__ == '__main__':
    exit(main())
