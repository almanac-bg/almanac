"""Merge the checked chunks of /fix-questions into one batch for `almanac bank add`, and their waivers into the bank's.

  python3 -I merge.py <work> <bank> <chunk>…

Writes <work>/batch/<category>.json (the chunks' questions, changed and new), <work>/batch/retire.json,
<work>/batch/images/, and adds the agreed waivers to <bank>/waivers.json (none twice). The new questions are numbered
again from the bank's next free id, in order, so the chunks' reserved ranges leave no gaps (their waivers follow), and
every date is the day it goes in (a run may pass midnight). What the chunks judged goes
into <work>/judged.json, so the next work list doesn't judge it again. Prints the counts.
"""
import collections
import datetime
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
                # Who checked it is bank add's to say (-checked-by), not what an agent wrote in.
                q.pop("checked", None)
                q.pop("checkedBy", None)
                qs[f[:-5]].append(q)
        elif f == "images":
            os.makedirs(f"{out}/images", exist_ok=True)
            for im in os.listdir(p):
                shutil.copy2(f"{p}/{im}", f"{out}/images/{im}")
    w = f"{work}/checked/{ch}.waivers.json"
    if os.path.exists(w):
        waivers += json.load(open(w))
# The bank's last number in each category (retired ones too): new ids follow it, one after another.
last, have = {}, {}
for f in os.listdir(f"{bank}/questions"):
    for q in json.load(open(f"{bank}/questions/{f}")):
        p_, n = q["id"].rsplit("-", 1)
        last[p_] = max(last.get(p_, 0), int(n))
        have[q["id"]] = q
bankq = dict(have)  # the bank as it is, by id (have is the waivers further down)
# The dates are the day it goes in, which bank add checks, not the day an agent wrote it (a run can pass midnight):
# a change is updated today, and changed today if the agent changed what it asks; a new question is added today.
today = datetime.date.today().isoformat()
for lst in qs.values():
    for q in lst:
        old = have.get(q["id"])
        q["updated"] = today
        if old is None:
            q["added"] = today
        elif q.get("changed") and q.get("changed") != old.get("changed"):
            q["changed"] = today
renum = {}
for c, lst in qs.items():
    news = sorted((q for q in lst if int(q["id"].rsplit("-", 1)[1]) > last[q["id"].rsplit("-", 1)[0]]),
                  key=lambda q: int(q["id"].rsplit("-", 1)[1]))
    for q in news:
        p_ = q["id"].rsplit("-", 1)[0]
        last[p_] += 1
        renum[q["id"]] = f"{p_}-{last[p_]}"
        q["id"] = renum[q["id"]]
for r in retire:
    r["by"] = renum.get(r.get("by"), r.get("by"))
for w in waivers:
    w["id"] = renum.get(w["id"], w["id"])
judged = json.load(open(f"{work}/judged.json")) if os.path.exists(f"{work}/judged.json") else {}
for ch in chunks:
    for it in json.load(open(f"{work}/chunks/{ch}.json"))["items"]:
        judged.setdefault(it["id"], [])
        judged[it["id"]] = sorted(set(judged[it["id"]]) | {j.split(":")[0] for j in it["judge"]})
for new in renum.values():
    judged[new] = ["easy-picture", "false-fact"]
json.dump(judged, open(f"{work}/judged.json", "w"), ensure_ascii=False)
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
# The days ahead are drawn again, all of them after tomorrow, when the live questions that are dated or about Bulgaria
# change (play.Ahead hashes their ids, `on` and `bg`): a pre-check's batch that does so throws away the month it read.
def tag(q):
    return (tuple(q.get("on") or []), bool(q.get("bg"))) if not q.get("retired") else ((), False)
moved = [q["id"] for lst in qs.values() for q in lst if tag(q) != tag(bankq.get(q["id"]) or {})]
moved += [r["id"] for r in retire if tag(bankq.get(r["id"]) or {}) != ((), False)]
if moved:
    print(f"warning: the days' dated or Bulgarian questions change ({', '.join(sorted(set(moved)))}): the server will"
          " draw every day after tomorrow again; a pre-check keeps them as they were")
print(f"questions {sum(len(v) for v in qs.values())} ({len(renum)} new, numbered on), retired {len(retire)}, waivers {len(new)} new")
