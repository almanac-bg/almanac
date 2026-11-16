"""The blind pass of /fix-questions: answer sheets of the bank without its key, and what a model answering them got
otherwise.

  python3 -I blind.py sheets <bank> <work> [--size 300]   # <work>/blind/sheets/<n>.json, key.json, images/
  python3 -I blind.py compare <bank> <work>               # <work>/blind/disagree.json, and the counts
  python3 -I blind.py sheets <bank> <work> --from <dir>   # a batch's questions instead (<dir>/*/<cat>.json, as
                                                          # /new-questions' verify/), pictures from beside them

A sheet holds live questions as a player sees them: the text, the options in a fixed shuffled order with letters, the
clues, the items, a picture as a file in <work>/blind/images (never a path into the bank). The answerers write
<work>/blind/answers/<n>.json: {id: {"a": <answer>, "sure": true|false}}. `compare` lists each question whose answer
differs where the answerer was sure (a number: off by more than three tolerances); `worklist.py --judge blind` makes
them judge items.
"""
import argparse
import glob
import hashlib
import json
import os
import shutil

p = argparse.ArgumentParser()
p.add_argument("do", choices=["sheets", "compare"])
p.add_argument("bank")
p.add_argument("work")
p.add_argument("--size", type=int, default=300)
p.add_argument("--from", dest="src", default="")
a = p.parse_args()
out = f"{a.work}/blind"
LETTERS = "ABCDEFGH"


IMAGES = {}  # a question's id: the folder its pictures are in


def live():
    if a.src:
        for f in sorted(glob.glob(f"{a.src}/*/*.json")):
            if os.path.basename(f) == "retire.json":
                continue
            for q in json.load(open(f)):
                IMAGES[q["id"]] = f"{os.path.dirname(f)}/images"
                yield q
        return
    for c in json.load(open(f"{a.bank}/categories.json")):
        for q in json.load(open(f"{a.bank}/questions/{c['id']}.json")):
            if not q.get("retired"):
                yield q


def shuffled(qid, xs):
    """xs in an order fixed by the id, so a sheet made again is the same."""
    return sorted(xs, key=lambda x: hashlib.sha256(f"{qid}|{json.dumps(x, ensure_ascii=False)}".encode()).hexdigest())


def picture(im, qid):
    shutil.copy2(f"{IMAGES.get(qid, a.bank + '/images')}/{im['file']}", f"{out}/images/{im['file']}")
    return f"{out}/images/{im['file']}"


def sheet_item(q):
    """The question as asked, and its key in the sheet's own terms."""
    s = {"id": q["id"], "kind": q["type"], "text": q["text"]}
    if q.get("image"):
        s["picture"] = picture(q["image"], q["id"])
    t = q["type"]
    if t in ("choice", "clues"):
        opts = [q["answer"]] + q["wrong"]
        pics = q.get("pictures")
        idx = shuffled(q["id"], list(range(len(opts))))
        if pics:
            s["options"] = {LETTERS[k]: {"picture": picture(pics[i], q["id"])} for k, i in enumerate(idx)}
        else:
            s["options"] = {LETTERS[k]: opts[i] for k, i in enumerate(idx)}
        if t == "clues":
            s["clues"] = q["clues"]
        return s, LETTERS[idx.index(0)]
    if t == "truefalse":
        return s, bool(q["answer"])
    if t == "number":
        s["unit"] = q.get("unit", "")
        return s, q["answer"]
    if t == "order":
        idx = shuffled(q["id"], list(range(len(q["items"]))))
        s["items"] = {LETTERS[k]: q["items"][i]["text"] for k, i in enumerate(idx)}
        s["unit"] = q.get("unit", "")
        vals = {LETTERS[k]: q["items"][i]["value"] for k, i in enumerate(idx)}
        key = sorted(vals, key=lambda L: vals[L], reverse=q.get("direction") == "desc")
        return s, "".join(key)
    if t == "match":
        rights = [p_["right"] for p_ in q["pairs"]] + ([q["decoy"]] if q.get("decoy") else [])
        ridx = shuffled(q["id"], list(range(len(rights))))
        s["left"] = [p_["left"] for p_ in q["pairs"]]
        s["right"] = {LETTERS[k]: rights[i] for k, i in enumerate(ridx)}
        return s, {p_["left"]: LETTERS[ridx.index(n)] for n, p_ in enumerate(q["pairs"])}
    if t == "split":
        s["groups"] = q["groups"]
        s["items"] = [it["text"] for it in shuffled(q["id"], q["items"])]
        return s, {it["text"]: q["groups"][it["group"]] for it in q["items"]}
    raise SystemExit(f"{q['id']}: a kind the blind pass doesn't know: {t}")


if a.do == "sheets":
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(f"{out}/sheets")
    os.makedirs(f"{out}/images")
    os.makedirs(f"{out}/answers")
    items, key = [], {}
    for q in live():
        s, k = sheet_item(q)
        items.append(s)
        key[q["id"]] = {"key": k, "kind": q["type"], "tolerance": q.get("tolerance"), "sheet": s}
    # Mixed by id hash, so a sheet isn't one topic and one kind.
    items = shuffled("sheets", items)
    n = 0
    for n, k in enumerate(range(0, len(items), a.size), 1):
        json.dump(items[k:k + a.size], open(f"{out}/sheets/{n}.json", "w"), ensure_ascii=False, indent=1)
    json.dump(key, open(f"{out}/key.json", "w"), ensure_ascii=False)
    print(f"{len(items)} questions on {n} sheets")
    raise SystemExit

def readable(s, said):
    """What an answer says, in the question's words rather than the sheet's letters."""
    try:
        if s["kind"] in ("choice", "clues"):
            o = s["options"][str(said).strip().upper()[:1]]
            return o["picture"].rsplit("/", 1)[-1] if isinstance(o, dict) else o
        if s["kind"] == "order":
            return " → ".join(s["items"][L] for L in str(said).replace(" ", "").replace(",", "").upper())
        if s["kind"] == "match":
            return "; ".join(f"{l} — {s['right'].get(str(r).strip(), r)}" for l, r in said.items())
        if s["kind"] == "truefalse":
            return "вярно" if said in (True, "true") else "невярно"
    except (KeyError, AttributeError, TypeError):
        pass
    return json.dumps(said, ensure_ascii=False)


def norm(s):
    """A text as typed: the bank's no-break spaces („1856 г.“) are plain ones to an answerer."""
    return " ".join(str(s).replace("\u00a0", " ").split())


key = json.load(open(f"{out}/key.json"))
answers = {}
for f in glob.glob(f"{out}/answers/*.json"):
    answers.update(json.load(open(f)))
disagree, unsure, missing = {}, 0, [i for i in key if i not in answers]
for i, k in key.items():
    got = answers.get(i)
    if got is None:
        continue
    said, sure = got.get("a"), got.get("sure")
    want = k["key"]
    if k["kind"] == "number":
        try:
            off = abs(float(said) - float(want)) > 3 * float(k["tolerance"] or 0)
        except (TypeError, ValueError):
            off = True
    elif k["kind"] == "order":
        off = str(said).replace(" ", "").replace(",", "").upper() != want
    elif k["kind"] in ("match", "split"):
        got = {norm(x): norm(v) for x, v in said.items()} if isinstance(said, dict) else {}
        off = any(got.get(norm(x)) != norm(v) for x, v in want.items())
    elif k["kind"] == "truefalse":
        off = said not in (want, str(want).lower())
    else:
        off = str(said).strip().upper()[:1] != want
    if off and sure:
        disagree[i] = f"a model answering without the key, sure: {readable(k['sheet'], said)}"
    elif off:
        unsure += 1
json.dump(disagree, open(f"{out}/disagree.json", "w"), ensure_ascii=False, indent=1)
print(f"answered {len(answers)} of {len(key)} (missing {len(missing)}); sure and otherwise: {len(disagree)}; "
      f"unsure and otherwise: {unsure}")
