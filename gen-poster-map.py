import re, os, io, json
from collections import Counter

base = r"D:\Project\GameSedai\anime-sedai-main"

# ---- titles from game-data.ts (in order) ----
with io.open(os.path.join(base, "game-data.ts"), encoding="utf-8") as f:
    text = f.read()
titles = []
year = None
for line in text.splitlines():
    m = re.match(r'^\s*"(\d{4})":\s*\[$', line)
    if m:
        year = m.group(1)
        continue
    m2 = re.search(r'titleZh:\s*"([^"]*)"', line)
    if m2 and year:
        titles.append((year, m2.group(1)))
print("titles:", len(titles))

# ---- files ----
folder = os.path.join(base, "GamePosters")
files = sorted(f.name for f in os.scandir(folder) if f.is_file())
print("files:", len(files))

def norm(s):
    s = s.replace(" ", "").replace("　", "").replace("/", "").replace("\\", "")
    s = s.replace("：", "").replace("！", "").replace("·", "").replace("_", "")
    s = re.sub(r"（[^）]*）", "", s)   # strip （...） annotations
    s = re.sub(r"~[0-9]+$", "", s)     # strip ~1 style suffixes
    return s.lower()

# ---- explicit aliases (title -> filename) ----
aliases = {
    "荒野大镖客：救赎": "Red_Dead_Redemption.png",
    "Among Us / 太空狼人杀": "Among Us.png",
    "Stray / 流浪猫": "Stray.png",
    "王国风云：救赎2 / 天国：拯救2": "天国：拯救2.png",
    "糖豆人：终极淘汰赛": "糖豆人.png",
    "最后生还者 Part II": "最后生还者2.png",
}

used = set()
mapping = {}          # titleZh -> filename
matched_by = {}       # for reporting
unmatched_titles = []

for y, zh in titles:
    fname = None
    how = None
    cand = zh + ".png"
    if cand in files and cand not in used:
        fname, how = cand, "exact"
    elif zh in aliases:
        fname, how = aliases[zh], "alias"
    else:
        n = norm(zh)
        avail = [f for f in files if f not in used and norm(os.path.splitext(f)[0]) == n]
        if len(avail) == 1:
            fname, how = avail[0], "norm"
        elif len(avail) > 1:
            fname, how = avail[0], "norm-multi"
    if fname:
        used.add(fname)
        mapping[zh] = fname
        matched_by[zh] = how
    else:
        unmatched_titles.append((y, zh))

print("matched:", len(mapping))
print("unmatched titles:", unmatched_titles)
print("leftover files:", [f for f in files if f not in used])

# ---- handle leftover: pair the last title with the leftover file (warn) ----
for f in [f for f in files if f not in used]:
    if unmatched_titles:
        y, zh = unmatched_titles.pop(0)
        mapping[zh] = f
        matched_by[zh] = "leftover(!!)"
        used.add(f)
        print("WARN leftover pairing:", zh, "->", f)

print("final unmatched titles:", unmatched_titles)
print("final leftover files:", [f for f in files if f not in used])

# ---- report match stats ----
how_counter = Counter(matched_by.values())
print("match methods:", dict(how_counter))
print("--- matched by alias/norm/leftover ---")
for y, zh in titles:
    how = matched_by.get(zh)
    if how in ("alias", "norm", "norm-multi", "leftover(!!)"):
        print(f"  {zh} -> {mapping[zh]} [{how}]")

# ---- write poster-map.ts ----
lines = []
lines.append("// 自动生成：GamePosters 文件名 ↔ 游戏中文名映射（按文件名匹配）")
lines.append("// 由脚本生成，如需新增/修改图片请同步此表或重新生成")
lines.append("export const posterByTitle: Record<string, string> = {")
for y, zh in titles:
    f = mapping.get(zh)
    if f:
        lines.append(f'  {json.dumps(zh, ensure_ascii=False)}: {json.dumps(f, ensure_ascii=False)},')
lines.append("}")
lines.append("")
with io.open(os.path.join(base, "poster-map.ts"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))
print("poster-map.ts written with", len(mapping), "entries")
