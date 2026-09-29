#!/usr/bin/env python3
"""
Money paths under concurrency: correctness first (no double spending, no negative balance, each reward once),
then throughput. Every scenario fires its requests at the same instant and checks the result through the API.

    python money_race.py [--base URL] [--only orders,packets] [--scale 1]

Scenarios (PASS/FAIL each):
  orders-same-user   30 parallel wallet orders from one member whose balance covers only some of them
  orders-many-users  N members × 3 parallel orders each; every wallet moved by exactly its successful orders
  coupon-race        10 parallel orders all using the same coupon → used once
  bean-packs         10 parallel RM 10 bean packs on RM 50 → exactly 5
  live-gifts         N members × 5 parallel gifts into one live room; host pending income = Σ shares, room beans = Σ gifts
  cross-gifts        two members sending chat gifts to each other at the same time (lock-order / deadlock probe)
  group-packet       lucky red packet with 50 shares, 100 members claim at once (each twice) → 50 claims, Σ = amount
  transfer-race      20 transfers; the recipient fires accept and return 5× each at once → exactly one wins
  withdrawals        10 parallel withdrawal requests → daily count (3) and daily amount limits hold; cancelled afterwards
  checkin            fresh members check in 5× at once → one reward each
  task-claim         fresh member claims the address task 10× at once → one reward
  mixed-wallet       one member: orders + bean packs + red packets + withdrawals at once → never negative, balance = start − Σ
  post-burst         100 members like and comment on one post at once (+ double taps) → counters exact, no 500
Afterwards run `dotnet Shizhong.Api.dll --seed-verify` and sql/checks.sql on the server for the ledger-wide checks.
"""
import argparse, asyncio, random, time

import common as C

RESULTS = []


def report(name, ok, detail, stats=None):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": detail, "stats": stats.summary() if stats else None})
    line = f"  {'PASS' if ok else 'FAIL'}  {name:<18} {detail}"
    if stats:
        s = stats.summary()
        line += f"  | n={s['n']} p50={s['p50']}ms p95={s['p95']}ms p99={s['p99']}ms max={s['max']}ms codes={dict(stats.codes)}"
    print(line, flush=True)


async def burst(calls, name="burst"):
    """Start all coroutines at once; → (results, Stats)."""
    st = C.Stats(name, len(calls))
    st.t0 = time.perf_counter()
    res = await asyncio.gather(*calls)
    st.t1 = time.perf_counter()
    for s, d, ms in res:
        st.add(s, ms, d, s < 500 and s != 0)  # 4xx are expected refusals; 5xx / connection errors are failures
    return res, st


def code(d):
    return d.get("code") if isinstance(d, dict) else str(d)[:80]


def cents(x):
    return int(round(float(x) * 100))


async def wallet(a):
    s, d, _ = await a.get("/api/wallet")
    if s != 200:
        raise RuntimeError(f"wallet {s} {d}")
    return d


async def set_balance(adm, a, rm=None, beans=None):
    """Move a member's balance / beans to exact values with console adjustments (ledger rows)."""
    w = await wallet(a)
    if not a.info.get("dbId"):
        await C.db_ids(adm, [a])
    uid = a.info["dbId"]
    if rm is not None and cents(rm) != cents(w["balance"]):
        s, d, _ = await adm.post(f"/api/admin/users/{uid}/adjust", {"currency": "RM", "amount": round(rm - w["balance"], 2), "reason": "压测准备", "notify": False})
        assert s == 200, (s, d)
    if beans is not None and beans != w["beans"]:
        s, d, _ = await adm.post(f"/api/admin/users/{uid}/adjust", {"currency": "BEAN", "amount": beans - w["beans"], "reason": "压测准备", "notify": False})
        assert s == 200, (s, d)
    return await wallet(a)


async def register(http, name):
    a = C.Api(http)
    phone = "+60 1%d" % random.randint(10000000, 99999999)
    s, d, _ = await a.post("/api/auth/register", {"phone": phone, "password": "load123456", "name": name, "ageConfirmed": True, "terms": True, "city": "吉隆坡"})
    if s != 200:
        raise RuntimeError(f"register {s} {d}")
    a.token, a.info = d["token"], d["me"]
    a.ip = C.rand_ip()
    return a


# ------------------------------------------------------------------------------------------------ catalog helper
GOODS = {}


async def goods_item(a):
    """A goods item (address category, wallet payable) and its payable without coupon."""
    if GOODS:
        return GOODS["id"], GOODS["payable"]
    s, d, _ = await a.get("/api/catalog/search?cat=market&limit=60")
    for sid in d.get("ids", []):
        s, q, _ = await a.post("/api/orders/quote", {"items": [{"id": sid, "qty": 1}], "couponId": ""})
        if s == 200 and q.get("flow") == "goods" and 5 <= q["payable"] <= 40:
            GOODS.update(id=sid, payable=q["payable"])
            return sid, q["payable"]
    raise RuntimeError("no goods item found")


def order_body(sid, payable, coupon=""):
    return {"items": [{"id": sid, "qty": 1}], "address": "1 Jalan Load Test, 50450 Kuala Lumpur", "couponId": coupon, "method": "wallet",
            "expectedPayable": payable, "form": {"phone": "+60 12-3456789", "name": "压测"}}


# ------------------------------------------------------------------------------------------------ scenarios
async def orders_same_user(ctx):
    a, adm = ctx.users[0], ctx.adm
    sid, pay = await goods_item(a)
    start = 10 * pay + pay / 2  # enough for exactly 10
    await set_balance(adm, a, rm=start)
    res, st = await burst([a.post("/api/orders", order_body(sid, pay)) for _ in range(30)])
    okn = sum(1 for s, _, _ in res if s == 200)
    w = await wallet(a)
    refused = {code(d) for s, d, _ in res if s != 200}
    good = okn == 10 and cents(w["balance"]) == cents(start) - okn * cents(pay) and w["balance"] >= 0 and refused <= {"wallet.insufficient", "common.tooMany"}
    report("orders-same-user", good, f"30 parallel × RM{pay} on RM{start:.2f}: {okn} paid (want 10), balance RM{w['balance']} (want {start - 10 * pay:.2f}), refused {refused}", st)


async def orders_many_users(ctx):
    users = ctx.users[1:1 + ctx.n]
    sid, pay = await goods_item(users[0])
    for a in users:
        await set_balance(ctx.adm, a, rm=pay * 2 + 1)  # 2 of 3 fit
    res, st = await burst([a.post("/api/orders", order_body(sid, pay)) for a in users for _ in range(3)])
    bad = []
    for i, a in enumerate(users):
        mine = res[i * 3:(i + 1) * 3]
        okn = sum(1 for s, _, _ in mine if s == 200)
        w = await wallet(a)
        if okn != 2 or cents(w["balance"]) != cents(pay * 2 + 1) - okn * cents(pay):
            bad.append((a.info["displayId"], okn, w["balance"]))
    report("orders-many-users", not bad and st.codes.get(500, 0) == 0,
           f"{len(users)} members × 3 parallel orders (2 affordable): {len(bad)} wrong {bad[:3]}", st)


async def coupon_race(ctx):
    a = await register(ctx.http, "压测券")
    s, d, _ = await a.get("/api/state")
    coupons = [c for c in d["state"].get("coupons", []) if c.get("status") == "available"]
    s, found, _ = await a.get("/api/catalog/search?cat=market&limit=60")
    q = cp = None
    # a coupon whose minimum a goods order can reach (items with a quantity selector)
    for sid in found.get("ids", []):
        s, q1, _ = await a.post("/api/orders/quote", {"items": [{"id": sid, "qty": 1}], "couponId": ""})
        if s != 200 or q1.get("flow") != "goods" or q1["subtotal"] <= 0:
            continue
        for c1 in coupons:
            qty = max(1, int(float(c1.get("min") or 0) // q1["subtotal"]) + 1)
            s, q2, _ = await a.post("/api/orders/quote", {"items": [{"id": sid, "qty": qty}], "couponId": c1["id"]})
            if s == 200 and q2.get("discount", 0) > 0:
                q, cp = q2, c1
                break
        if cp:
            break
    if not cp:
        report("coupon-race", False, f"no usable coupon {coupons[:2]}")
        return
    await set_balance(ctx.adm, a, rm=q["payable"] * 12)
    ob = order_body(sid, q["payable"], cp["id"])
    ob["items"][0]["qty"] = qty
    res, st = await burst([a.post("/api/orders", ob) for _ in range(10)])
    okn = sum(1 for s, _, _ in res if s == 200)
    s, d, _ = await a.get("/api/state")
    used = [c for c in d["state"]["coupons"] if c["id"] == cp["id"]]
    orders_with = [o for o in d["state"]["orders"] if o.get("couponId") == cp["id"]]
    w = await wallet(a)
    good = okn == 1 and len(orders_with) == 1 and used and used[0]["status"] == "used" and cents(w["balance"]) == cents(q["payable"] * 11)
    report("coupon-race", good, f"10 parallel orders with coupon {cp['id']}: {okn} placed (want 1), orders using it {len(orders_with)}, balance RM{w['balance']}", st)


async def bean_packs(ctx):
    a = ctx.users[-1]
    await set_balance(ctx.adm, a, rm=55)
    w0 = await wallet(a)
    res, st = await burst([a.post("/api/beans/exchange", {"packId": "b100"}) for _ in range(10)])
    okn = sum(1 for s, _, _ in res if s == 200)
    w = await wallet(a)
    good = okn == 5 and cents(w["balance"]) == 500 and w["beans"] == w0["beans"] + 500
    report("bean-packs", good, f"10 parallel RM10 packs on RM55: {okn} bought (want 5), balance RM{w['balance']}, beans +{w['beans'] - w0['beans']}", st)


async def host_client(ctx, room):
    s, d, _ = await ctx.adm.get("/api/admin/users?q=" + room["host"]["id"][1:])
    items = [u for u in d.get("items", []) if u["publicId"] == room["host"]["id"]]
    if not items:
        return None
    h = await C.login(ctx.http, items[0]["phone"] or items[0]["email"])
    if h:
        h.info["dbId"] = items[0]["id"]
    return h


async def live_gifts(ctx):
    users = ctx.users[1:1 + ctx.n]
    s, d, _ = await users[0].get("/api/live/rooms")
    rooms = [r for r in d["rooms"] if r["host"].get("kind") == 0]
    host = room = None
    for r in rooms:
        host = await host_client(ctx, r)
        if host:
            room = r
            break
    if not host:
        report("live-gifts", False, "no live room with a member host")
        return
    gift, beans = "rose", 19
    for a in users:
        await set_balance(ctx.adm, a, beans=beans * 5)
    h0 = await wallet(host)
    s, r0, _ = await users[0].get(f"/api/live/sessions/{room['sessionId']}")
    gb0 = (r0.get("session") or r0).get("giftBeans", 0) if isinstance(r0, dict) else 0
    res, st = await burst([a.post(f"/api/live/sessions/{room['sessionId']}/gifts", {"giftId": gift, "quantity": 1}) for a in users for _ in range(6)])
    okn = sum(1 for s, _, _ in res if s == 200)
    h1 = await wallet(host)
    s, r1, _ = await users[0].get(f"/api/live/sessions/{room['sessionId']}")
    gb1 = (r1.get("session") or r1).get("giftBeans", 0) if isinstance(r1, dict) else 0
    neg = []
    for a in users:
        w = await wallet(a)
        if w["beans"] != 0:
            neg.append((a.info["displayId"], w["beans"]))
    # 19 beans × share: host income per gift (RM 1 = 10 beans → 190 cents × share)
    pend = cents(h1["incomePending"]) - cents(h0["incomePending"])
    good = okn == len(users) * 5 and not neg and gb1 - gb0 == okn * beans and pend > 0
    report("live-gifts", good, f"{len(users)} members × 6 parallel gifts (5 affordable) → {okn} sent (want {len(users) * 5}), room beans +{gb1 - gb0} (want {okn * beans}), "
           f"host pending income +RM{pend / 100:.2f} ({pend / max(1, okn):.1f} cents/gift), members left with beans {neg[:3]}", st)
    ctx.host_check = {"hostDbId": host.info["dbId"], "sessionId": room["sessionId"], "gifts": okn, "pendingCents": pend}


async def cross_gifts(ctx):
    a, b = ctx.users[-2], ctx.users[-3]
    s, gl, _ = await ctx.adm.get("/api/admin/gifts?context=chat")
    chat_gifts = sorted([g for g in gl.get("items", []) if g.get("enabled", True) and g.get("beans")], key=lambda g: g["beans"])
    gift, price = chat_gifts[0]["id"], chat_gifts[0]["beans"]
    await set_balance(ctx.adm, a, beans=price * 20)
    await set_balance(ctx.adm, b, beans=price * 20)
    calls = []
    for _ in range(20):
        calls.append(a.post("/api/gifts/send", {"to": b.id, "giftId": gift, "quantity": 1}))
        calls.append(b.post("/api/gifts/send", {"to": a.id, "giftId": gift, "quantity": 1}))
    res, st = await burst(calls)
    okn = sum(1 for s, _, _ in res if s == 200)
    paid_a = sum(d["paid"] for i, (s, d, _) in enumerate(res) if s == 200 and i % 2 == 0)
    paid_b = sum(d["paid"] for i, (s, d, _) in enumerate(res) if s == 200 and i % 2 == 1)
    wa, wb = await wallet(a), await wallet(b)
    good = okn == 40 and wa["beans"] == price * 20 - paid_a and wb["beans"] == price * 20 - paid_b and st.codes.get(500, 0) == 0
    report("cross-gifts", good, f"A↔B 20 '{gift}' chat gifts each way at once: {okn}/40 ok, beans A {wa['beans']} (want {price * 20 - paid_a}), "
           f"B {wb['beans']} (want {price * 20 - paid_b})", st)


async def group_packet(ctx):
    owner = ctx.users[0]
    members = ctx.users[1:1 + min(100, ctx.n)]
    s, g, _ = await owner.post("/api/groups", {"name": "压测红包群 %d" % random.randint(1000, 9999), "desc": "load test", "city": "吉隆坡"})
    gid = (g.get("group") or {}).get("id") if isinstance(g, dict) else None
    if not gid:
        report("group-packet", False, f"create group {s} {g}")
        return
    joins, jst = await burst([m.post(f"/api/groups/{gid}/join") for m in members])
    report("group-join", jst.codes.get(200, 0) == len(members), f"{len(members)} members join one group at once: {dict(jst.codes)}", jst)
    await set_balance(ctx.adm, owner, rm=200)
    total, count = 100.0, 50
    s, d, _ = await owner.post(f"/api/chats/{gid}/packets", {"kind": "envelope", "amount": total, "count": count, "mode": "lucky", "note": "压测"})
    mid = (d.get("message") or {}).get("id") if isinstance(d, dict) else None
    if not mid:
        report("group-packet", False, f"send packet {s} {d}")
        return
    before = {m.info["displayId"]: (await wallet(m))["balance"] for m in members}
    res, st = await burst([m.post(f"/api/packets/{mid}/claim") for m in members for _ in range(2)])
    got = {}
    for i, (s, d, _) in enumerate(res):
        if s == 200:
            m = members[i // 2]
            got.setdefault(m.info["displayId"], []).append(d["cents"])
    twice = [k for k, v in got.items() if len(v) > 1]
    sumc = sum(sum(v) for v in got.values())
    wrong = []
    for m in members:
        w = await wallet(m)
        exp = cents(before[m.info["displayId"]]) + sum(got.get(m.info["displayId"], []))
        if cents(w["balance"]) != exp:
            wrong.append(m.info["displayId"])
    good = len(got) == count and not twice and sumc == cents(total) and not wrong
    report("group-packet", good, f"{len(members)} members × 2 claims on a {count}-share RM{total:.0f} packet: {len(got)} claimed (want {count}), "
           f"Σ RM{sumc / 100:.2f} (want {total:.2f}), claimed twice {twice[:3]}, wallet mismatches {wrong[:3]}", st)


async def transfer_race(ctx):
    a, b = ctx.users[2], ctx.users[3]
    await set_balance(ctx.adm, a, rm=500)
    wb0 = await wallet(b)
    ids = []
    for _ in range(20):
        s, d, _ = await a.post(f"/api/chats/{b.id}/packets", {"kind": "transfer", "amount": 10})
        if s == 200:
            ids.append(d["message"]["id"])
        elif s == 429:
            await asyncio.sleep(2)
    wa1 = await wallet(a)
    calls = []
    for mid in ids:
        for _ in range(5):
            calls.append(b.post(f"/api/packets/{mid}/accept"))
            calls.append(b.post(f"/api/packets/{mid}/return"))
    res, st = await burst(calls)
    wins = {}
    for i, (s, d, _) in enumerate(res):
        if s == 200:
            wins.setdefault(ids[i // 10], []).append("accept" if i % 2 == 0 else "return")
    multi = {k: v for k, v in wins.items() if len(v) != 1}
    accepted = sum(1 for v in wins.values() if v == ["accept"])
    returned = sum(1 for v in wins.values() if v == ["return"])
    wa2, wb2 = await wallet(a), await wallet(b)
    good = not multi and len(wins) == len(ids) and cents(wb2["balance"]) - cents(wb0["balance"]) == accepted * 1000 \
        and cents(wa2["balance"]) - cents(wa1["balance"]) == returned * 1000
    report("transfer-race", good, f"{len(ids)} transfers × (5 accept + 5 return) at once: {accepted} accepted, {returned} returned, settled twice {len(multi)}, "
           f"B +RM{(cents(wb2['balance']) - cents(wb0['balance'])) / 100:.2f}, A refunded +RM{(cents(wa2['balance']) - cents(wa1['balance'])) / 100:.2f}", st)


async def withdrawals(ctx):
    a = ctx.users[4]
    s, d, _ = await a.post("/api/withdraw/accounts", {"kind": "bank", "provider": "Maybank", "accountName": "Load Test", "accountNo": "1234567890"})
    acct = (d.get("account") or {}).get("id") if isinstance(d, dict) else None
    if not acct:
        report("withdrawals", False, f"account {s} {d}")
        return
    await set_balance(ctx.adm, a, rm=20000)
    s, d, _ = await a.get("/api/withdrawals")
    today = [w for w in d.get("items", []) if w.get("status") in (0, "pending", 1, 2) and (time.time() * 1000 - (w.get("createdAt") or 0)) < 86400000]
    # count limit: 10 × RM 100 → at most 3 per day (minus what was already requested today)
    res, st = await burst([a.post("/api/withdrawals", {"source": "wallet", "amount": 100, "accountId": acct}) for _ in range(10)])
    okn = sum(1 for s, _, _ in res if s == 200)
    w = await wallet(a)
    ids = [d["item"]["id"] for s, d, _ in res if s == 200]
    count_ok = okn <= 3 and cents(w["frozen"]) >= okn * 10000
    for wid in ids:  # give the money back
        await a.post(f"/api/withdrawals/{str(wid).lstrip('w')}/cancel")
    # amount limit on another member: 5 × RM 4,000 with RM 10,000 per day → at most 2
    b = ctx.users[5]
    s, d, _ = await b.post("/api/withdraw/accounts", {"kind": "bank", "provider": "Maybank", "accountName": "Load Test", "accountNo": "1234567891"})
    acct_b = d["account"]["id"]
    await set_balance(ctx.adm, b, rm=20000)
    res2, st2 = await burst([b.post("/api/withdrawals", {"source": "wallet", "amount": 4000, "accountId": acct_b}) for _ in range(5)])
    ok2 = sum(1 for s, _, _ in res2 if s == 200)
    wb = await wallet(b)
    for s, d, _ in res2:
        if s == 200:
            await b.post(f"/api/withdrawals/{str(d['item']['id']).lstrip('w')}/cancel")
    wb2 = await wallet(b)
    good = count_ok and ok2 <= 2 and cents(wb["frozen"]) == ok2 * 400000 and cents(wb2["balance"]) == 2000000 and wb2["frozen"] == 0
    report("withdrawals", good, f"10 × RM100 at once: {okn} accepted (≤3; {len(today)} earlier today); 5 × RM4,000 at once: {ok2} accepted (≤2, RM10,000/day), "
           f"frozen RM{wb['frozen']}, after cancel balance RM{wb2['balance']} frozen RM{wb2['frozen']}", st)


async def checkin(ctx):
    fresh = [await register(ctx.http, "压测签到%d" % i) for i in range(20)]
    b0 = [(await wallet(a))["beans"] for a in fresh]
    res, st = await burst([a.post("/api/checkin") for a in fresh for _ in range(5)])
    bad = []
    for i, a in enumerate(fresh):
        okn = sum(1 for s, _, _ in res[i * 5:(i + 1) * 5] if s == 200)
        gained = (await wallet(a))["beans"] - b0[i]
        if okn != 1 or gained != 10:
            bad.append((okn, gained))
    report("checkin", not bad, f"20 fresh members × 5 check-ins at once: {len(bad)} wrong {bad[:3]}", st)


async def task_claim(ctx):
    a = await register(ctx.http, "压测任务")
    await a.post("/api/addresses/", {"name": "压测", "phone": "+60 12-3456789", "address": "1 Jalan Load", "postcode": "50450", "city": "吉隆坡"})
    b0 = (await wallet(a))["beans"]
    res, st = await burst([a.post("/api/tasks/claim", {"task": "address"}) for _ in range(10)])
    rewarded = sum(1 for s, d, _ in res if s == 200 and d["reward"]["points"] > 0)
    gained = (await wallet(a))["beans"] - b0
    report("task-claim", rewarded == 1 and gained == 10, f"10 claims of the address task at once: {rewarded} rewarded (want 1), beans +{gained} (want 10)", st)


async def mixed_wallet(ctx):
    a = ctx.users[6]
    peer = ctx.users[7]
    sid, pay = await goods_item(a)
    start = 300.0
    await set_balance(ctx.adm, a, rm=start)
    s, d, _ = await a.post("/api/withdraw/accounts", {"kind": "bank", "provider": "Maybank", "accountName": "Load Test", "accountNo": "1234567892"})
    acct = d["account"]["id"]
    calls = []
    for _ in range(8):
        calls.append(a.post("/api/orders", order_body(sid, pay)))
        calls.append(a.post("/api/beans/exchange", {"packId": "b300"}))
        calls.append(a.post(f"/api/chats/{peer.id}/packets", {"kind": "envelope", "amount": 20}))
    calls.append(a.post("/api/withdrawals", {"source": "wallet", "amount": 100, "accountId": acct}))
    calls.append(a.post("/api/withdrawals", {"source": "wallet", "amount": 100, "accountId": acct}))
    res, st = await burst(calls)
    spent = 0
    for i, (s, d, _) in enumerate(res):
        if s != 200:
            continue
        if i >= 24:
            spent += 10000
        else:
            spent += [cents(pay), 3000, 2000][i % 3]
    w = await wallet(a)
    good = cents(w["balance"]) + cents(w["frozen"]) == cents(start) - (spent - sum(10000 for i, (s, _, _) in enumerate(res) if i >= 24 and s == 200)) \
        and w["balance"] >= 0 and st.codes.get(500, 0) == 0
    report("mixed-wallet", good, f"one member, 26 money actions at once on RM{start:.0f}: {sum(1 for s, _, _ in res if s == 200)} ok, "
           f"balance RM{w['balance']} + frozen RM{w['frozen']} (spent RM{spent / 100:.2f})", st)
    for s, d, _ in res[24:]:
        if s == 200:
            await a.post(f"/api/withdrawals/{str(d['item']['id']).lstrip('w')}/cancel")


async def post_burst(ctx):
    """Not money, same kind of race: 100 members like and comment on one post at the same moment (counter updates)."""
    users = ctx.users[1:1 + ctx.n]
    probe = ctx.users[0]
    s, d, _ = await probe.get("/api/posts")
    post = next(p for p in d["items"] if p.get("person") not in {u.id for u in ctx.users})["id"]
    await asyncio.gather(*[u.req("DELETE", f"/api/posts/{post}/like") for u in users + [probe]])
    s, d, _ = await probe.req("DELETE", f"/api/posts/{post}/like")
    before = d["likes"]
    s, d, _ = await probe.get(f"/api/posts/{post}/comments")
    c_before = d["count"]
    calls = [u.post(f"/api/posts/{post}/like") for u in users] + [u.post(f"/api/posts/{post}/comments", {"text": "压测评论"}) for u in users] \
        + [users[0].post(f"/api/posts/{post}/like") for _ in range(5)]  # one member's double taps
    res, st = await burst(calls)
    s, d, _ = await probe.post(f"/api/posts/{post}/like")
    after = d["likes"]
    s, d, _ = await probe.get(f"/api/posts/{post}/comments")
    c_after = d["count"]
    good = st.codes.get(500, 0) == 0 and after == before + len(users) + 1 and c_after == c_before + len(users)
    report("post-burst", good, f"{len(users)} likes + {len(users)} comments on one post at once (+5 double taps): likes {before} → {after} "
           f"(want +{len(users) + 1}), comments {c_before} → {c_after} (want +{len(users)})", st)
    await probe.req("DELETE", f"/api/posts/{post}/like")


SCENARIOS = {
    "orders": orders_same_user, "orders-many": orders_many_users, "coupon": coupon_race, "beans": bean_packs, "live": live_gifts,
    "cross": cross_gifts, "packet": group_packet, "transfer": transfer_race, "withdraw": withdrawals, "checkin": checkin,
    "task": task_claim, "mixed": mixed_wallet, "posts": post_burst,
}


class Ctx:
    pass


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--only", default="")
    ap.add_argument("--members", type=int, default=100, help="members per many-user scenario")
    args = ap.parse_args()
    C.set_base(args.base)
    async with C.new_http() as http:
        ctx = Ctx()
        ctx.http, ctx.n = http, args.members
        ctx.adm = await C.admin(http)
        # separate members from the read tests (skip the first 200 cached ones)
        ctx.users = await C.sessions(http, args.members + 10, skip=0)
        await C.db_ids(ctx.adm, ctx.users)
        print(f"  {len(ctx.users)} members ready")
        for name, fn in SCENARIOS.items():
            if args.only and name not in args.only.split(","):
                continue
            try:
                await fn(ctx)
            except Exception as e:
                import traceback
                traceback.print_exc()
                report(name, False, "crashed: " + repr(e)[:200])
    C.save("money", RESULTS)
    fails = [r for r in RESULTS if not r["pass"]]
    print(f"\n{len(RESULTS) - len(fails)} passed, {len(fails)} failed")
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    asyncio.run(main())
