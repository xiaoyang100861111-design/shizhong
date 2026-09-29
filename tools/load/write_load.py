#!/usr/bin/env python3
"""
Write-path throughput (closed loop, rising concurrency): wallet orders, bean packs, live gifts into ONE room (every sender
shares the host's row), live gifts spread over all live rooms, 1:1 chat messages, live comments.

    python write_load.py [--base URL] [--levels 10,50,100,200] [--seconds 10] [--users 300] [--only gift-one-room,chat]

Test members get money / beans with console adjustments first (ledger rows "压测准备"). Per-member write limit is
30 per 10 s (burst 60), so every worker uses its own member; 429 answers are counted separately.
Run only against a test / staging database.
"""
import argparse, asyncio, random, uuid

import common as C


async def fund(adm, users, rm=5000, beans=100000):
    sem = asyncio.Semaphore(16)

    async def one(a):
        async with sem:
            s, w, _ = await a.get("/api/wallet")
            if s != 200:
                return
            if w["balance"] < rm / 2:
                await adm.post(f"/api/admin/users/{a.info['dbId']}/adjust", {"currency": "RM", "amount": rm, "reason": "压测准备", "notify": False})
            if w["beans"] < beans / 2:
                await adm.post(f"/api/admin/users/{a.info['dbId']}/adjust", {"currency": "BEAN", "amount": beans, "reason": "压测准备", "notify": False})
    await asyncio.gather(*[one(a) for a in users])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--levels", default="10,50,100,200")
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--users", type=int, default=300)
    ap.add_argument("--only", default="")
    ap.add_argument("--pid", default=None)
    args = ap.parse_args()
    C.set_base(args.base)
    levels = [int(x) for x in args.levels.split(",")]
    mon = C.Monitor(C.api_pid(args.pid))
    results = []
    async with C.new_http() as http:
        adm = await C.admin(http)
        users = await C.sessions(http, args.users)
        await C.db_ids(adm, users)
        await fund(adm, users)
        print(f"  {len(users)} funded members")
        s, d, _ = await users[0].get("/api/live/rooms")
        rooms = [r["sessionId"] for r in d["rooms"]]
        hosts = {r["host"]["id"] for r in d["rooms"]}
        senders = [u for u in users if u.id not in hosts]
        one_room = rooms[0]
        s, q, _ = await users[0].get("/api/catalog/search?cat=market&limit=60")
        item = None
        for sid in q.get("ids", []):
            s, qq, _ = await users[0].post("/api/orders/quote", {"items": [{"id": sid, "qty": 1}], "couponId": ""})
            if s == 200 and qq.get("flow") == "goods" and qq["payable"] <= 30:
                item = (sid, qq["payable"])
                break

        turn = [0]

        def u(i):
            # rotate over all members so the per-member write limit (30 / 10 s) is not what is measured
            turn[0] += 1
            return senders[(turn[0] * 7919 + i) % len(senders)]

        def order(i):
            return u(i).post("/api/orders", {"items": [{"id": item[0], "qty": 1}], "address": "1 Jalan Load Test", "couponId": "", "method": "wallet",
                                             "expectedPayable": item[1], "form": {"phone": "+60 12-3456789", "name": "压测"}})

        def chat(i):
            a = u(i)
            b = senders[(senders.index(a) + 1) % len(senders)]
            return a.post(f"/api/chats/{b.id}/messages", {"type": "text", "text": "压测消息 " + uuid.uuid4().hex[:8], "clientId": uuid.uuid4().hex})

        tests = {
            "order": order,
            "bean-pack": lambda i: u(i).post("/api/beans/exchange", {"packId": "b100"}),
            "gift-one-room": lambda i: u(i).post(f"/api/live/sessions/{one_room}/gifts", {"giftId": "heart", "quantity": 1}),
            "gift-many-rooms": lambda i: u(i).post(f"/api/live/sessions/{rooms[i % len(rooms)]}/gifts", {"giftId": "heart", "quantity": 1}),
            "live-comment": lambda i: u(i).post(f"/api/live/sessions/{rooms[i % len(rooms)]}/comments", {"text": "压测评论 %d" % random.randint(1, 9999)}),
            "chat-message": chat,
        }
        for name, fn in tests.items():
            if args.only and name not in args.only.split(","):
                continue
            for conc in levels:
                if conc > len(senders):
                    continue
                mon.start()
                st = await C.closed_loop(name, conc, args.seconds, fn, ok=lambda s, d: s == 200)
                s = st.summary()
                s["server"] = mon.stop()
                s["rateLimited"] = st.codes.get(429, 0)
                results.append(s)
                print(C.fmt_row(s, s["server"]), flush=True)
                await asyncio.sleep(2)
    C.save("write", results)


if __name__ == "__main__":
    asyncio.run(main())
