#!/usr/bin/env python3
"""
Read-heavy load: every important GET, one at a time, at rising concurrency (closed loop), plus a mixed "app traffic" run.

    python read_load.py [--base URL] [--levels 10,50,100,200] [--seconds 10] [--users 200] [--only boot,people] [--mixed-only]

Each member worker uses its own signed-in test member (tokens cached in out/sessions-*.json).
Prints RPS, p50/p95/p99/max latency (ms), error rate, and API / SQL Server CPU when run on the server (--pid or SZ_API_PID_FILE).
"""
import argparse, asyncio, random

import common as C

CATS = ["food", "market", "beauty", "car", "clean", "delivery", "flower", "guide", "jobs", "phone", "repair", "travel", "visa"]
WORDS = ["咖啡", "奶茶", "按摩", "洗车", "搬家", "花", "手机", "vegan", "nasi", "美甲", ""]


def targets(users, orders, people):
    def u(i):
        return users[i % len(users)]

    return {
        "health": lambda i: C.Api(u(i).http).get("/api/health"),
        "boot": lambda i: u(i).get("/core/server.js", raw=True),
        "state": lambda i: u(i).get("/api/state", raw=True),
        "people": lambda i: u(i).get("/data/people.js", raw=True),
        "profiles": lambda i: u(i).get("/data/profiles-%d.js" % random.randint(0, 11), raw=True),
        "posts-chunk": lambda i: u(i).get("/data/posts.js", raw=True),
        "services": lambda i: u(i).get("/data/services-%s.js" % random.choice(CATS), raw=True),
        "catalog-index": lambda i: u(i).get("/data/catalog-index.js", raw=True),
        "gift-catalog": lambda i: u(i).get("/data/gift-catalog.js", raw=True),
        "search": lambda i: u(i).get("/api/catalog/search?cat=%s&q=%s&limit=40" % (random.choice(CATS), random.choice(WORDS))),
        "wallet": lambda i: u(i).get("/api/wallet"),
        "wallet-tx": lambda i: u(i).get("/api/wallet/transactions"),
        "order-detail": lambda i: u(i).get("/api/orders/" + random.choice(orders)) if orders else u(i).get("/api/wallet"),
        "feed": lambda i: u(i).get("/api/posts", raw=True),
        "person": lambda i: u(i).get("/api/people/" + random.choice(people)),
        "live-rooms": lambda i: u(i).get("/api/live/rooms"),
        "bean-packs": lambda i: u(i).get("/api/beans/packs"),
        "config": lambda i: u(i).get("/api/config"),
    }


# weights of a typical app session (boot once, then browsing)
MIX = {"boot": 2, "people": 1, "services": 6, "search": 8, "wallet": 5, "order-detail": 5, "feed": 6, "person": 6, "live-rooms": 6,
       "gift-catalog": 2, "bean-packs": 2, "profiles": 3, "wallet-tx": 3, "state": 1, "health": 1}


async def prepare(http, n):
    users = await C.sessions(http, n)
    print(f"  {len(users)} signed-in members")
    # order numbers and people ids from a few members' state
    orders, people = [], []
    for a in users[:40]:
        s, d, _ = await a.get("/api/state")
        if s == 200:
            orders += [o.get("id") or o.get("orderNo") for o in d["state"].get("orders", []) if isinstance(o, dict)][:5]
            people += list((d["state"].get("follows") or {}).keys())[:5] if isinstance(d["state"].get("follows"), dict) else \
                [f for f in (d["state"].get("follows") or []) if isinstance(f, str)][:5]
    # only order numbers that belong to the member asking would pass ownership: map order → owner
    owned = []
    for a in users[:40]:
        s, d, _ = await a.get("/api/state")
        if s == 200:
            for o in d["state"].get("orders", [])[:5]:
                owned.append((a, o.get("id")))
    people = [p for p in people if p] or ["u0070", "u0071", "u0072"]
    return users, owned, people


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--levels", default="10,50,100,200")
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--only", default="")
    ap.add_argument("--mixed-only", action="store_true")
    ap.add_argument("--no-mixed", action="store_true")
    ap.add_argument("--pid", default=None)
    args = ap.parse_args()
    C.set_base(args.base)
    levels = [int(x) for x in args.levels.split(",")]
    mon = C.Monitor(C.api_pid(args.pid))
    results = []
    async with C.new_http() as http:
        users, owned, people = await prepare(http, args.users)
        t = targets(users, [], people)
        # order detail: each worker asks for one of its own orders
        if owned:
            t["order-detail"] = lambda i: owned[i % len(owned)][0].get("/api/orders/" + str(owned[i % len(owned)][1]))
        names = [k for k in t if not args.only or k in args.only.split(",")]
        if not args.mixed_only:
            for name in names:
                for conc in levels:
                    mon.start()
                    st = await C.closed_loop(name, conc, args.seconds, t[name])
                    s = st.summary()
                    s["server"] = mon.stop()
                    results.append(s)
                    print(C.fmt_row(s, s["server"]), flush=True)
                    await asyncio.sleep(1)
        if not args.no_mixed:
            keys = [k for k in MIX if k in t]
            weights = [MIX[k] for k in keys]
            print("  mixed app traffic:", ", ".join(f"{k}×{MIX[k]}" for k in keys))
            for conc in levels:
                mon.start()
                st = await C.closed_loop("mixed", conc, args.seconds * 2, lambda i: t[random.choices(keys, weights)[0]](i))
                s = st.summary()
                s["server"] = mon.stop()
                results.append(s)
                print(C.fmt_row(s, s["server"]), flush=True)
                await asyncio.sleep(1)
    C.save("read", results)


if __name__ == "__main__":
    asyncio.run(main())
