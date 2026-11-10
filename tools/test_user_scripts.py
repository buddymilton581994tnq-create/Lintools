import os
import json
import csv
import re
import sys

# 用户给的诊断脚本原文
def diagnose_dictionary_and_csv():
    print("====== 开始扫描本地词库与索引状态 ======")
    files = [f for f in os.listdir('.') if f.endswith('.json') and not f.startswith('_')]
    print(f"[发现文件]: {files}\n")

    for file in files:
        if file.endswith('.json'):
            try:
                with open(file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    total = len(data)
                    single_chars = [k for k in data.keys() if len(str(k).strip()) == 1]
                    empty_or_bad_vals = [k for k, v in data.items() if not str(v).strip() or str(v).strip().isdigit()]
                    sample = list(data.items())[:3]
                    print(f"JSON文件 [{file}]:")
                    print(f"  - 总词条数: {total}")
                    print(f"  - 单字词条数 (易截胡): {len(single_chars)} 个 (示例: {single_chars[:5]})")
                    print(f"  - 空值/异常数字词条 (会导致吞字!): {len(empty_or_bad_vals)} 个")
                    print(f"  - 前3条结构抽样: {[(str(a)[:20], str(b)[:40]) for a, b in sample]}\n")
            except Exception as e:
                print(f"  - 读取 {file} 失败: {e}\n")


# 用户给的 TagTranslatorEngine 原文（去掉 __main__ 部分）
class TagTranslatorEngine:
    def __init__(self, master_dict_path="master_index.json"):
        self.master_dict_path = master_dict_path
        self.core_safeguard_dict = {
            "乳头": "nipples", "凸点": "covered nipples", "乳晕": "areolae",
            "乳房": "breasts", "胸部": "breasts", "巨乳": "large breasts",
            "贫乳": "flat chest", "乳沟": "cleavage", "事业线": "cleavage",
            "肛门": "anus", "菊花": "anus", "臀部": "ass", "屁股": "ass",
            "阴部": "pussy", "私处": "genitals", "大腿": "thighs", "腿环": "thigh strap",
            "小腿": "calves", "脚趾": "toes", "脚底": "soles", "足底": "soles",
            "腋下": "armpits", "肚脐": "navel", "锁骨": "collarbone", "后背": "back",
            "舌头": "tongue", "口水": "saliva", "汗水": "sweat", "泪水": "tears",
            "白丝": "white pantyhose", "黑丝": "black pantyhose", "肉丝": "nude pantyhose",
            "过膝袜": "thighhighs", "白色过膝袜": "white thighhighs", "黑色过膝袜": "black thighhighs",
            "吊带袜": "garter straps", "死库水": "school swimsuit", "水手服": "serafuku",
            "绝对领域": "zettai ryouiki", "死鱼眼": "jitome", "翻白眼": "rolling eyes",
            "双马尾": "twintails", "单马尾": "ponytail", "姬发式": "hime cut", "呆毛": "ahoge",
            "精灵耳": "pointed ears", "兽耳": "animal ears", "猫耳": "cat ears",
            "机能风": "techwear, cyberpunk jacket, tactical straps",
            "卓尔精灵": "dark elf, drow, greyish purple skin, white hair, pointed ears",
            "提夫林": "tiefling, demon horns, demon tail, colored skin, pointed ears"
        }
        self.clean_dict = {}
        self.pattern = None
        self.reload_dictionary()

    def reload_dictionary(self):
        raw_dict = {}
        if os.path.exists(self.master_dict_path):
            try:
                with open(self.master_dict_path, "r", encoding="utf-8") as f:
                    raw_dict = json.load(f)
            except Exception as e:
                print(f"[警告] 读取外部词库失败: {e}")
        merged_dict = {**raw_dict, **self.core_safeguard_dict}
        self.clean_dict = {
            k.strip(): v.strip()
            for k, v in merged_dict.items()
            if len(k.strip()) >= 2 and len(v.strip()) > 0
        }
        sorted_cn_keys = sorted(self.clean_dict.keys(), key=len, reverse=True)
        if sorted_cn_keys:
            escaped_keys = [re.escape(k) for k in sorted_cn_keys]
            self.pattern = re.compile("|".join(escaped_keys))

    def lock_known_tags(self, user_cn_prompt):
        if not self.pattern or not user_cn_prompt:
            return user_cn_prompt
        def _replacer(match):
            cn_word = match.group(0)
            en_tag = self.clean_dict[cn_word]
            return f" {{{{{en_tag}}}}} "
        return self.pattern.sub(_replacer, user_cn_prompt)

    def finalize_tags(self, llm_raw_output):
        cleaned = re.sub(r"\{\{|\}\}", "", llm_raw_output)
        tags = [t.strip() for t in cleaned.split(",") if t.strip()]
        seen = set()
        deduped_tags = []
        for t in tags:
            if t.lower() not in seen:
                seen.add(t.lower())
                deduped_tags.append(t)
        return ", ".join(deduped_tags)


if __name__ == "__main__":
    os.chdir(r"D:\Lintools-repo\electron")
    diagnose_dictionary_and_csv()

    print("=" * 60)
    print("用户版 TagTranslatorEngine 测试")
    print("=" * 60)
    eng = TagTranslatorEngine()
    print("词条数:", len(eng.clean_dict))
    tests = [
        "一个穿着白色过膝袜的卓尔精灵女孩，死鱼眼，露出乳头和肛门，站在大门前摸自己的头",
        "一束菊花插在花瓶里",
        "女孩趴着露出菊花",
    ]
    for t in tests:
        print("\n输入:", t)
        print("锁词后:", eng.lock_known_tags(t)[:220])
