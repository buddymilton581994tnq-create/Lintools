import os
import json

def diagnose(path):
    print("=" * 60)
    print("文件:", path)
    if not os.path.exists(path):
        print("  不存在")
        return
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("  类型:", type(data).__name__, " 条目:", len(data))

    if isinstance(data, dict):
        keys = [str(k) for k in data.keys()]
        single = [k for k in keys if len(k.strip()) <= 1]
        bad = [k for k, v in data.items() if not str(v).strip() or str(v).strip().isdigit()]
        print("  单字/空键 (易截胡):", len(single), " 示例:", single[:10])
        print("  空值/数字值 (会吞字):", len(bad), " 示例:", bad[:10])
        # 危险单字
        danger = ["门", "头", "口", "手", "脚", "眼", "乳", "肛", "臀", "腿", "背", "胸"]
        hit = [k for k in danger if k in data]
        print("  危险单字命中:", [(k, data[k]) for k in hit])
        # 关键敏感词是否在库
        probe = ["肛门", "乳头", "乳晕", "乳房", "臀部", "阴部", "大腿", "锁骨", "肚脐", "腋下"]
        print("  敏感词覆盖:")
        for p in probe:
            print("    %-4s -> %s" % (p, data.get(p, "【缺失】")))
        # 抽样
        print("  前 3 条:", list(data.items())[:3])
    else:
        print("  首条:", json.dumps(data[0], ensure_ascii=False)[:200])


if __name__ == "__main__":
    base = r"D:\Lintools-repo\electron"
    for name in ["master_index.json", "corpus-library.json"]:
        diagnose(os.path.join(base, name))
