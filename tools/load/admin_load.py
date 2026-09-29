#!/usr/bin/env python3
"""
Admin console under load: dashboard, member list with filters, orders, finance ledger, CSV exports — measured alone and
while app traffic (the mixed read mix of read_load.py at --app-conc workers) runs at the same time.

    python admin_load.py [--base URL] [--levels 2,5,10] [--seconds 10] [--app-conc 100]
"""
import argparse, asyncio, random

import common as C
import read_load as R

PAGES = {
    "dashboard": lambda: "/api/admin/dashboard",
    "users": lambda: "/api/admin/users?page=%d&size=20" % random.randint(1, 50),
    "users-filter": lambda: "/api/admin/users?city=%s&sort=-balance&size=50" % random.choice(["吉隆坡", "槟城", "新山", "怡保"]),
    "users-search": lambda: "/api/admin/users?q=%s" % random.choice(["Tan", "Lim", "陈", "Siti", "0123", "李"]),
    "orders": lambda: "/api/admin/orders?page=%d&size=20" % random.randint(1, 30),
    "orders-filter": lambda: "/api/admin/orders?status=%d&size=50" % random.randint(0, 5),
    "orders-summary": lambda: "/api/admin/orders/summary",
    "ledger": lambda: "/api/admin/finance/transactions?page=%d&size=50" % random.randint(1, 30),
    "ledger-kind": lambda: "/api/admin/finance/transactions?kind=%s&size=50" % random.choice(["order", "gift", "live-gift", "recharge", "withdraw"]),
    "withdrawals": lambda: "/api/admin/finance/withdrawals",
    "reconciliation": lambda: "/api/admin/finance/reconciliation",
    "gift-tx": lambda: "/api/admin/gift-transactions?size=50",
    "live-sessions": lambda: "/api/admin/live/sessions?status=live",
    "export-users": lambda: "/api/admin/users/export",
    "export-orders": lambda: "/api/admin/orders/export",
    "export-ledger": lambda: "/api/admin/finance/transactions/export",
}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--levels", default="2,10")
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--app-conc", type=int, default=100)
    ap.add_argument("--only", default="")
    ap.add_argument("--pid", default=None)
    args = ap.parse_args()
    C.set_base(args.base)
    levels = [int(x) for x in args.levels.split(",")]
    mon = C.Monitor(C.api_pid(args.pid))
    results = []
    async with C.new_http() as http:
        adm = await C.admin(http)
        users, owned, people = await R.prepare(http, 200)
        t = R.targets(users, [], people)
        if owned:
            t["order-detail"] = lambda i: owned[i % len(owned)][0].get("/api/orders/" + str(owned[i % len(owned)][1]))
        keys = [k for k in R.MIX if k in t]
        weights = [R.MIX[k] for k in keys]
        names = [k for k in PAGES if not args.only or k in args.only.split(",")]
        for with_app in (False, True):
            app_task, app_stats = None, None
            if with_app and args.app_conc:
                total = (len(names) * len(levels)) * (args.seconds + 1) + 5
                app_task = asyncio.ensure_future(C.closed_loop("app-mixed", args.app_conc, total, lambda i: t[random.choices(keys, weights)[0]](i)))
                await asyncio.sleep(3)
            label = f" (+ app load c={args.app_conc})" if with_app else " (alone)"
            print("  admin console" + label)
            for name in names:
                for conc in levels:
                    mon.start()
                    st = await C.closed_loop(name, conc, args.seconds, lambda i, n=name: adm.get(PAGES[n](), raw=n.startswith("export")))
                    s = st.summary()
                    s["server"] = mon.stop()
                    s["withApp"] = with_app
                    results.append(s)
                    print(C.fmt_row(s, s["server"]), flush=True)
                    await asyncio.sleep(1)
            if app_task:
                app_stats = (await app_task).summary()
                app_stats["name"] = "app-mixed (during admin)"
                results.append(app_stats)
                print(C.fmt_row(app_stats))
    C.save("admin", results)


if __name__ == "__main__":
    asyncio.run(main())
