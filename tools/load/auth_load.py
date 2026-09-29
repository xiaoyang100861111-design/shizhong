#!/usr/bin/env python3
"""
Sign-in: (1) the per-IP limiter (30 sign-in / sign-up requests per 5 minutes per IP) under a burst from one IP,
(2) sign-in throughput from many IPs (BCrypt password check is deliberately slow: CPU per login).

    python auth_load.py [--base URL] [--n 200] [--conc 10,20,50]

Uses test members from the console list (password Test@2026). Each run from one IP uses up that IP's quota for 5 minutes.
"""
import argparse, asyncio, random

import common as C


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--conc", default="10,20,50")
    ap.add_argument("--pid", default=None)
    args = ap.parse_args()
    C.set_base(args.base)
    results = []
    mon = C.Monitor(C.api_pid(args.pid))
    async with C.new_http() as http:
        adm = await C.admin(http)
        members = await C.list_members(adm, args.n + 50)
        accounts = [m.get("phone") or m.get("email") for m in members]
        # 1) one IP, 40 sign-ins at once → 30 pass, the rest 429
        ip = C.rand_ip()

        async def one(acct, ip_):
            a = C.Api(http, ip=ip_)
            return await a.post("/api/auth/login", {"account": acct, "password": C.SEED_PASSWORD})
        res = await asyncio.gather(*[one(accounts[i % len(accounts)], ip) for i in range(40)])
        codes = {}
        for s, d, _ in res:
            codes[s] = codes.get(s, 0) + 1
        ok = codes.get(200, 0) <= 30 and codes.get(429, 0) >= 10
        print(f"  {'PASS' if ok else 'FAIL'}  limiter: 40 sign-ins from one IP at once → {codes} (want ≤30 × 200, the rest 429)")
        results.append({"name": "limiter", "pass": ok, "codes": codes})
        # 2) throughput: every request from its own IP
        for conc in [int(x) for x in args.conc.split(",")]:
            queue = list(accounts[:args.n])
            random.shuffle(queue)
            it = iter(queue)

            def fn(i):
                acct = next(it, None) or random.choice(accounts)
                return one(acct, C.rand_ip())
            mon.start()
            st = await C.closed_loop("login", conc, 6, fn)
            s = st.summary()
            s["server"] = mon.stop()
            results.append(s)
            print(C.fmt_row(s, s["server"]), flush=True)
    C.save("auth", results)


if __name__ == "__main__":
    asyncio.run(main())
