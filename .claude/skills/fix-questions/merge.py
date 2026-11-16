"""Merge the checked chunks of /fix-questions into one batch for `almanac bank add`, and their waivers into the bank's.

  python3 -I merge.py <work> <bank> <chunk>…

Writes <work>/batch/<category>.json (the chunks' questions, changed and new), <work>/batch/retire.json,
<work>/batch/images/, and adds the agreed waivers to <bank>/waivers.json (none twice). Prints the counts.
"""
import collections
import json
import os
import shutil
import sys

work, bank, chunks = sys.argv[1], sys.argv[2], sys.argv[3:]
out = f"{work}/batch"
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)
qs, retire, waivers, seen = collections.defaultdict(list), [], [], set()
for ch in chunks:
    d = f"{work}/checked/{ch}"
    if not os.path.isdir(d):
        print(f"{ch}: not checked, left out")
        continue
    for f in sorted(os.listdir(d)):
        p = f"{d}/{f}"
        if f == "retire.json":
            retire += json.load(open(p))
        elif f.endswith(".json"):
            for q in json.load(open(p)):
                if q["id"] in seen:
                    sys.exit(f"{q['id']} twice: {ch}")
                seen.add(q["id"])
                qs[f[:-5]].append(q)
        elif f == "images":
            os.makedirs(f"{out}/images", exist_ok=True)
            for im in os.listdir(p):
                shutil.copy2(f"{p}/{im}", f"{out}/images/{im}")
    w = f"{work}/checked/{ch}.waivers.json"
    if os.path.exists(w):
        waivers += json.load(open(w))
for c, lst in qs.items():
    json.dump(lst, open(f"{out}/{c}.json", "w"), ensure_ascii=False, indent=2)
if retire:
    json.dump(retire, open(f"{out}/retire.json", "w"), ensure_ascii=False, indent=2)
path = f"{bank}/waivers.json"
have = json.load(open(path)) if os.path.exists(path) else []
keys = {(x["id"], x["rule"]) for x in have}
new = [w for w in waivers if (w["id"], w["rule"]) not in keys]
if new:
    with open(path, "w") as f:
        json.dump(have + new, f, ensure_ascii=False, indent=2)
        f.write("\n")
print(f"questions {sum(len(v) for v in qs.values())}, retired {len(retire)}, waivers {len(new)} new")
