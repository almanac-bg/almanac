"""The work list for /fix-questions: what `almanac bank lint` flags, and the rules code can't check that a pass asks to
judge, by question, in chunks of a category, each with free ids for its replacements.

  python3 -I worklist.py <repo> <bank> <work> [--rules R,…] [--judge J,…] [--categories C,…] [--size N]

--rules: only these lint rules (default: all); --judge: false-fact, easy-picture, blind (what blind.py compare
found), signals (what upkeep.py gathered); default: none; --size: items a chunk (default 40). Writes
<work>/chunks/<category>-<n>.json, and <work>/owners.json (each listed id: its chunk, so a fixer leaves another chunk's
questions alone), and prints the chunk names, one a line. A question judged earlier in this pass (<work>/judged.json,
kept by merge.py) isn't judged again. Make the list again after each run is in the bank: the lint, and the free ids,
have moved.
"""
import argparse
import collections
import json
import os
import re
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument("repo")
p.add_argument("bank")
p.add_argument("work")
p.add_argument("--rules", default="")
p.add_argument("--judge", default="")
p.add_argument("--categories", default="")
p.add_argument("--size", type=int, default=40)
a = p.parse_args()

cats = [c["id"] for c in json.load(open(f"{a.bank}/categories.json"))]
if a.categories:
    cats = [c for c in cats if c in a.categories.split(",")]
qs, last, prefix = {}, {}, {}
for c in cats:
    for q in json.load(open(f"{a.bank}/questions/{c}.json")):
        p_, n = q["id"].rsplit("-", 1)
        prefix[c], last[c] = p_, max(last.get(c, 0), int(n))
        if not q.get("retired"):
            qs[q["id"]] = (c, q)

items = collections.OrderedDict()


def item(i):
    return items.setdefault(i, {"id": i, "problems": [], "judge": []})


# What lint flags, by rule.
cmd = ["go", "run", "./cmd/almanac", "bank", "lint"] + (["-rule", a.rules] if a.rules else []) + [a.bank]
out = subprocess.run(cmd, cwd=a.repo, capture_output=True, text=True).stdout
rule = None
for line in out.splitlines():
    m = re.match(r"^([a-z-]+)\s+\d+ errors\s+\d+ warnings", line)
    if m:
        rule = m.group(1)
        continue
    m = re.match(r"^  (\S+)\s+(?:warning|error) (.*)$", line)
    if m and rule and m.group(1) in qs:
        item(m.group(1))["problems"].append(f"{rule}: {m.group(2)}")

# The rules a pass asks to judge.
judge = [j for j in a.judge.split(",") if j]
judged = json.load(open(f"{a.work}/judged.json")) if os.path.exists(f"{a.work}/judged.json") else {}
for i, (c, q) in qs.items():
    if "false-fact" in judge and "false-fact" not in judged.get(i, []) and q["type"] == "truefalse" and q.get("answer") is False:
        item(i)["judge"].append("false-fact: the fact starts with what is true")
    if "easy-picture" in judge and "easy-picture" not in judged.get(i, []) and q["type"] == "choice" and q["difficulty"] == "easy" and (q.get("image") or q.get("pictures")):
        item(i)["judge"].append("easy-picture: the picture is the question, and a quarter of adults miss it")

if "signals" in judge:
    for i, said in json.load(open(f"{a.work}/signals.json")).items():
        if i in qs:
            item(i)["judge"].extend(f"signal: {x}" for x in said["signals"])
            if said.get("player_text"):
                # Players' words, as data apart from what the pass asks: untrusted (FIX.md, CHECK.md).
                item(i)["player_text"] = said["player_text"]

if "blind" in judge:
    blind = json.load(open(f"{a.work}/blind/disagree.json"))
    for i, said in blind.items():
        if i in qs and "blind" not in judged.get(i, []):
            item(i)["judge"].append(f"blind: {said}")

shutil.rmtree(f"{a.work}/chunks", ignore_errors=True)
os.makedirs(f"{a.work}/chunks")
owners = {}
by_cat = collections.defaultdict(list)
for i, it in items.items():
    by_cat[qs[i][0]].append(it)
for c in cats:
    lst = by_cat.get(c, [])
    nxt = last[c] + 1
    for k in range(0, len(lst), a.size):
        part = lst[k:k + a.size]
        name = f"{c}-{k // a.size + 1}"
        ids = [f"{prefix[c]}-{n}" for n in range(nxt, nxt + len(part))]
        nxt += len(part)
        owners.update({it["id"]: name for it in part})
        json.dump({"category": c, "ids": ids, "items": part}, open(f"{a.work}/chunks/{name}.json", "w"),
                  ensure_ascii=False, indent=1)
        print(name)
json.dump(owners, open(f"{a.work}/owners.json", "w"), ensure_ascii=False)
