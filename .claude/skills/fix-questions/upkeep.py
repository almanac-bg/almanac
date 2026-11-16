"""The bank's upkeep: what says a live question may have gone wrong, gathered into one file for worklist.py.

  python3 -I upkeep.py <bank> <work> [--reports file] [--suspects file]

Three signals, each a judge item (`signal: …`) for the fixer and the checker:

- report: players' open reports (`almanac bank reports` on the server, saved to a file);
- suspect: the questions whose players' answers speak against the key (`almanac bank suspects`, saved to a file);
- review: a question whose reviewBy has come (what it says may have stopped being true).

Writes <work>/signals.json ({id: ["report: …", …]}) and prints the counts.
"""
import argparse
import datetime
import json
import os

p = argparse.ArgumentParser()
p.add_argument("bank")
p.add_argument("work")
p.add_argument("--reports", default="")
p.add_argument("--suspects", default="")
a = p.parse_args()

live = {}
for c in json.load(open(f"{a.bank}/categories.json")):
    for q in json.load(open(f"{a.bank}/questions/{c['id']}.json")):
        if not q.get("retired"):
            live[q["id"]] = q

signals, counts = {}, {"report": 0, "suspect": 0, "review": 0}


def add(i, kind, what):
    if i in live:
        signals.setdefault(i, []).append(f"{kind}: {what}")
        counts[kind] += 1


def lines(path):
    if not path:
        return []
    return [ln.rstrip("\n").split("\t") for ln in open(path, encoding="utf-8") if ln.strip() and not ln.startswith("#")]


for row in lines(a.reports):
    if len(row) >= 3:
        add(row[0], "report", f"{row[1]} player report(s): {row[2]}")
for row in lines(a.suspects):
    if len(row) >= 3:
        add(row[0], "suspect", f"of {row[1]} players' answers, {row[2]}")
today = datetime.date.today().isoformat()
for i, q in live.items():
    if q.get("reviewBy") and q["reviewBy"] <= today:
        add(i, "review", f"due for review since {q['reviewBy']}")

os.makedirs(a.work, exist_ok=True)
json.dump(signals, open(f"{a.work}/signals.json", "w"), ensure_ascii=False, indent=1)
print(f"{len(signals)} questions: " + ", ".join(f"{k} {n}" for k, n in counts.items()))
