#!/usr/bin/env python3
"""
Server-mode API regression: the cross-area flows of the backend, end to end, against a running API.

    python tools/qa/server_smoke.py [--base http://127.0.0.1:5080] [--only orders,gifts] [--slow]
                                    [--routes routes.txt]

Needs `pip install requests`. Uses the demo account, the console's admin/123123 and freshly registered members
(each run registers new ones; the auth rate limit is per IP, so requests carry a random X-Forwarded-For).
--slow waits for the order worker's auto-confirm (orders.autoConfirm*Seconds) instead of confirming in the console.
--routes <file>: a route list written by the API when started with QA_DUMP_ROUTES=<file>; every /api/admin route
is then called anonymously, as a member and as an admin whose role has no permissions (expects 401/403).
Exit code 1 when a check fails.
"""
import argparse, json, random, re, sys, time
import requests

BASE = "http://127.0.0.1:5080"
FAIL = []
PASS = [0]


def ok(cond, what, extra=""):
    if cond:
        PASS[0] += 1
    else:
        FAIL.append(what + (": " + str(extra)[:300] if extra != "" else ""))
        print("  FAIL", what, str(extra)[:300])
    return cond


class Client:
    def __init__(self, token=None, admin=None):
        self.s = requests.Session()
        self.token, self.admin = token, admin
        self.ip = "10.%d.%d.%d" % (random.randint(0, 255), random.randint(0, 255), random.randint(1, 254))

    def headers(self):
        h = {"X-Forwarded-For": self.ip}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        if self.admin:
            h["X-Admin-Token"] = self.admin
        return h

    def call(self, method, path, body=None, expect=200, **kw):
        r = self.s.request(method, BASE + path, json=body, headers=self.headers(), timeout=60, **kw)
        try:
            data = r.json()
        except ValueError:
            data = r.text
        self.status = r.status_code
        self.resp = r
        if expect is not None:
            exp = expect if isinstance(expect, (list, tuple)) else [expect]
            ok(r.status_code in exp, f"{method} {path} → {r.status_code} (want {expect})", data if r.status_code not in exp else "")
        return data

    def get(self, p, **kw):
        return self.call("GET", p, **kw)

    def post(self, p, b=None, **kw):
        return self.call("POST", p, {} if b is None else b, **kw)

    def put(self, p, b=None, **kw):
        return self.call("PUT", p, {} if b is None else b, **kw)

    def patch(self, p, b=None, **kw):
        return self.call("PATCH", p, {} if b is None else b, **kw)

    def delete(self, p, **kw):
        return self.call("DELETE", p, **kw)

    def state(self):
        return self.get("/api/state")["state"]


def register(name="QA", invite=None, **extra):
    c = Client()
    phone = "+60 1%d" % random.randint(10000000, 99999999)
    body = {"phone": phone, "password": "qa123456a", "name": name, "ageConfirmed": True, "terms": True, "city": "吉隆坡"}
    if invite:
        body["inviteCode"] = invite
    body.update(extra)
    r = c.post("/api/auth/register", body)
    c.token, c.me, c.phone = r["token"], r["me"], phone
    return c


def demo():
    c = Client()
    r = c.post("/api/auth/demo")
    c.token, c.me = r["token"], r["me"]
    return c


def admin(username="admin", password="123123"):
    c = Client()
    r = c.post("/api/admin/auth/login", {"username": username, "password": password})
    c.admin = r["token"]
    return c


def bills(state, **match):
    return [b for b in state.get("bills", []) if all(b.get(k) == v for k, v in match.items())]


def find_messages(state, chat_id):
    return (state.get("messages") or {}).get(chat_id) or []


def wait(fn, timeout=40, step=1.0):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


# ---------------------------------------------------------------------------------------------------- sections
def t_boot():
    print("· boot payload, config, state for a new member and the demo account")
    anon = Client()
    js = anon.s.get(BASE + "/core/server.js", timeout=30)
    ok(js.status_code == 200 and "SZ" in js.text, "anonymous /core/server.js", js.status_code)
    cfg = anon.get("/api/config")
    ok(isinstance(cfg, dict), "GET /api/config")
    d = demo()
    t0 = time.time()
    r = d.s.get(BASE + "/core/server.js", headers=d.headers(), timeout=60)
    dt = time.time() - t0
    size = len(r.content)
    print(f"  demo /core/server.js: {size / 1024:.0f} KB in {dt * 1000:.0f} ms")
    ok(r.status_code == 200, "demo /core/server.js")
    ok(dt < 3.0, "demo boot payload under 3 s", f"{dt:.2f}s")
    ok(size < 3 * 1024 * 1024, "demo boot payload under 3 MB", size)
    st = d.state()
    for key in ["wallet", "points", "bills", "orders", "coupons", "messages", "follows", "checkin", "gifts", "vip", "finance", "notices"]:
        ok(key in st, f"demo state has '{key}'")
    ok(len(st.get("orders", [])) > 0, "demo account has sample orders")


def t_signup():
    print("· sign-up: welcome money, beans, coupon, notice; invite codes; agent attribution")
    u = register("新人")
    st = u.state()
    ok(st["wallet"] == 100, "welcome RM 100", st["wallet"])
    ok(st["points"] == 1000, "welcome 1,000 beans", st["points"])
    ok(any(c.get("preset") == "welcome" for c in st["coupons"]), "welcome coupon granted", st["coupons"])
    ok(any(n.get("titleKey") == "flows.seed.welcomeTitle" for n in st["notices"]), "welcome notice")
    ok(any((b.get("i18n") or {}).get("key") == "server.bill.welcome" for b in st["bills"]), "welcome bill with i18n key")
    # member invite code (SZ + display id) → invited-by
    friend = register("被邀请", invite="SZ" + u.me["displayId"])
    inv = u.get("/api/invites")
    ok(inv.get("count") == 1, "inviter sees 1 invited member", inv)
    bad = Client()
    bad.post("/api/auth/register", {"phone": "+60 1%d" % random.randint(10000000, 99999999), "password": "qa123456a", "name": "x",
                                    "ageConfirmed": True, "terms": True, "inviteCode": "NOPE999"}, expect=400)
    # agent code → the member belongs to the agent (and to its console scope)
    a = admin()
    code = "QA%d" % random.randint(100000, 999999)
    ag = a.post("/api/admin/agents", {"name": "QA 代理 " + code, "code": code})
    m = register("代理客户", invite=code)
    users = a.get("/api/admin/users?q=" + m.me["displayId"])
    items = users.get("items", []) if isinstance(users, dict) else []
    ok(items and (items[0].get("agentId") == ag.get("id") or items[0].get("agent", {}).get("id") == ag.get("id")),
       "agent code at sign-up sets the member's agent", items[:1])
    return u


def t_tasks_address_member_checkout():
    print("· tasks (address/post/profile), membership coupon → checkout, order confirm → merchant chat, cancel → refund")
    u = register("买家")
    u.post("/api/addresses", {"name": "测试", "phone": "+60 12-3456789", "address": "1 Jalan QA", "postcode": "50450", "city": "吉隆坡"})
    st = u.state()
    ok(len(st["address"]) == 1, "address saved", st["address"])
    beans0 = st["points"]
    r = u.post("/api/tasks/claim", {"task": "address"})
    ok(r.get("reward", {}).get("points") == 10, "address task grants 10 beans", r)
    r = u.post("/api/tasks/claim", {"task": "address"})
    ok(r.get("reward", {}).get("points") == 0, "address task only once", r)
    ok(u.state()["points"] == beans0 + 10, "beans +10 once")
    u.post("/api/tasks/claim", {"task": "post"}, expect=400)
    post = u.post("/api/posts", {"text": "QA 第一条动态", "visibility": "public"})
    r = u.post("/api/tasks/claim", {"task": "post"})
    ok(r.get("reward", {}).get("points") == 10, "post task grants beans after posting", r)
    # membership → member coupon
    r = u.post("/api/member/claim")
    ok(r.get("coupon"), "membership grants a coupon", r)
    u.post("/api/member/claim", expect=409)
    st = u.state()
    ok(st.get("member") is True, "state.member true")
    member_coupon = next((c for c in st["coupons"] if c.get("preset") == "member"), None)
    ok(member_coupon is not None, "member coupon in state", st["coupons"])
    # goods order that reaches the member coupon's minimum (RM 50)
    ids = u.get("/api/catalog/search?cat=market&limit=40")["ids"]
    item, qty = None, 1
    for sid in ids:
        q = u.post("/api/orders/quote", {"items": [{"id": sid, "qty": 1}]}, expect=None)
        if u.status == 200 and q.get("flow") == "goods":
            item = sid
            qty = max(1, int(60 // max(1, q["subtotal"])) + 1)
            break
    ok(item is not None, "found a goods item")
    q = u.post("/api/orders/quote", {"items": [{"id": item, "qty": qty}], "couponId": member_coupon["id"] if member_coupon else ""})
    ok(q.get("discount", 0) > 0, "member coupon applies at checkout", q)
    wallet0 = u.state()["wallet"]
    addr = u.state()["address"][0]["id"]
    res = u.post("/api/orders", {"items": [{"id": item, "qty": qty}], "addressId": addr, "couponId": q.get("couponId"), "method": "wallet",
                                 "expectedPayable": q["payable"], "form": {"phone": "+60 12-3456789", "name": "测试"}})
    order = res.get("order", {})
    no = order.get("id") or order.get("orderNo")
    ok(no, "order placed", res)
    st = u.state()
    ok(abs(st["wallet"] - (wallet0 - q["payable"])) < 0.001, "wallet charged the payable", (wallet0, q["payable"], st["wallet"]))
    pay = [b for b in st["bills"] if b.get("orderId") == no]
    ok(pay and pay[0]["kind"] == "order" and (pay[0].get("i18n") or {}).get("key"), "payment bill linked to the order", pay)
    used = [c for c in st["coupons"] if c["id"] == member_coupon["id"]]
    ok(used and used[0]["status"] == "used", "coupon marked used", used)
    # console confirms → merchant chat message for the member
    a = admin()
    oid = None
    lst = a.get("/api/admin/orders?q=" + no)
    for o in lst.get("items", []):
        if o.get("orderNo") == no or o.get("no") == no:
            oid = o.get("id")
    ok(oid, "console finds the order", lst)
    if oid:
        a.post(f"/api/admin/orders/{oid}/confirm")
    chat_id = "merchant:" + item

    def merchant_msg():
        s = u.state()
        return [m for m in find_messages(s, chat_id) if m.get("orderId") == no or "catalog.merchant.confirmed" in json.dumps(m)]
    msgs = wait(merchant_msg, 15)
    ok(msgs, "merchant chat message in the member's messages after confirmation", list((u.state().get("messages") or {}).keys())[:10])
    if msgs:
        ok((msgs[0].get("i18n") or {}).get("key", "").startswith("catalog.merchant.confirmed."), "merchant message carries its i18n key", msgs[0])
    notes = u.state()["notices"]
    ok(any(n.get("titleKey", "").startswith("catalog.notice.confirmed.") for n in notes), "confirmation notice")
    # cancel → refund bill + coupon back
    reason = (u.get("/api/config")["config"].get("orders.cancelReasons") or ["plans"])[0]
    u.post(f"/api/orders/{no}/cancel", {"reason": reason})
    st = u.state()
    ref = [b for b in st["bills"] if b.get("orderId") == no and b["kind"] == "refund"]
    ok(ref and ref[0]["amount"] > 0, "refund bill", [b for b in st["bills"] if b.get("orderId") == no])
    back = [c for c in st["coupons"] if c["id"] == member_coupon["id"]]
    ok(back and back[0]["status"] == "available", "coupon released on cancel", back)
    # ownership: another member cannot read or cancel it
    other = register("路人")
    other.get(f"/api/orders/{no}", expect=404)
    other.post(f"/api/orders/{no}/cancel", {"reason": "x"}, expect=[400, 404])
    other.put(f"/api/addresses/{addr}", {"name": "x", "phone": "+60 12-3456789", "address": "hijack", "postcode": "50450"}, expect=404)
    other.delete(f"/api/addresses/{addr}", expect=404)
    ok(u.state()["address"][0]["address"] == "1 Jalan QA", "address untouched by another member")
    return u


def t_social_money():
    print("· friends, gifts in chat, red packets, transfers, blocks, reports")
    a, b = register("甲"), register("乙")
    r = a.post("/api/friends/requests", {"account": b.me["displayId"], "message": "hi"})
    inc = b.state()["friendRequests"]["incoming"]
    ok(inc, "friend request arrives", inc)
    if inc:
        b.post(f"/api/friends/requests/{inc[0]['id']}/accept")
    # red packet a → b
    wa = a.state()["wallet"]
    res = a.post(f"/api/chats/{b.me['id']}/packets", {"kind": "envelope", "amount": 5, "note": "QA"})
    mid = res.get("message", {}).get("id")
    ok(mid, "red packet sent", res)
    st = a.state()
    ok(abs(st["wallet"] - (wa - 5)) < 0.001, "sender charged RM 5")
    ok(bills(st, kind="envelope", chatId=b.me["id"]), "sender bill for the red packet links to the chat")
    c3 = register("丙")
    c3.post(f"/api/packets/{mid}/claim", expect=404)  # not a member of the chat
    c3.get(f"/api/packets/{mid}", expect=404)
    r = b.post(f"/api/packets/{mid}/claim")
    ok(r.get("cents") == 500, "recipient claims 500 cents", r)
    b.post(f"/api/packets/{mid}/claim", expect=409)
    ok(bills(b.state(), kind="envelope", chatId=a.me["id"]), "recipient bill for the red packet links to the chat")
    # transfer a → b, returned
    res = a.post(f"/api/chats/{b.me['id']}/packets", {"kind": "transfer", "amount": 3})
    tid = res.get("message", {}).get("id")
    b.post(f"/api/packets/{tid}/return")
    ok(bills(a.state(), kind="transfer", chatId=b.me["id"]), "sender sees transfer + return bills")
    # a gift from inventory/beans a → b appears in both chats and can be accepted
    cat = a.get("/data/gift-catalog.js", expect=None)
    gift_id = None
    gl = admin().get("/api/admin/gifts?context=chat")
    for g in gl.get("items", []):
        if g.get("enabled", True) and (g.get("beans") or 0) <= 100:
            gift_id = g["id"]
            break
    ok(gift_id, "a cheap chat gift exists", gl.get("items", [])[:2])
    if gift_id:
        res = a.post("/api/gifts/send", {"to": b.me["id"], "giftId": gift_id, "quantity": 1})
        ok(res.get("chatDelivered") and res.get("messageId"), "gift written to the chat", res)
        am = [m for m in find_messages(a.state(), b.me["id"]) if m.get("type") == "gift"]
        bm = [m for m in find_messages(b.state(), a.me["id"]) if m.get("type") == "gift"]
        ok(am and am[-1].get("self") is True, "sender sees the gift bubble", am[-1:] if am else a.state().get("messages", {}).get(b.me["id"]))
        ok(bm and bm[-1].get("self") is False and bm[-1].get("giftTx"), "recipient sees the gift bubble with its tx", bm[-1:])
        if bm:
            b.post(f"/api/gifts/received/gt{bm[-1]['giftTx']}/accept")
            c3.post(f"/api/gifts/received/gt{bm[-1]['giftTx']}/accept", expect=404)
            inv = b.state().get("gifts", {})
            ok(json.dumps(inv).find(gift_id) >= 0, "accepted gift in the recipient's collection")
        ok(any(n.get("titleKey") == "srvlive.notice.giftTitle" for n in b.state()["notices"]), "gift notice for the recipient")
    # block hides and stops messages
    b.post(f"/api/blocks/{a.me['id']}")
    a.post(f"/api/chats/{b.me['id']}/messages", {"type": "text", "text": "hello?"}, expect=403)
    a.post(f"/api/follows/{b.me['id']}", expect=403)
    b.delete(f"/api/blocks/{a.me['id']}")
    r = a.post("/api/reports", {"targetType": "person", "targetId": b.me["id"], "reason": "spam", "details": "qa"}, expect=[200, 400])
    if a.status == 400:
        cfg = a.get("/api/config")
        print("   (report reasons)", str(cfg)[:200])
    # message ownership
    msg = a.post(f"/api/chats/{b.me['id']}/messages", {"type": "text", "text": "secret"})
    m_id = msg.get("message", {}).get("id", "m0")
    c3.post(f"/api/messages/{m_id}/recall", expect=404)
    c3.delete(f"/api/messages/{m_id}", expect=404)
    c3.get(f"/api/chats/{b.me['id']}/messages")  # c3's own (empty) chat with b, never a↔b
    ok(all(m.get("text") != "secret" for m in c3.get(f"/api/chats/{a.me['id']}/messages").get("items", [])), "third member cannot read a↔b")


def t_finance():
    print("· check-in, bean packs, top-up request, withdrawals (+ ownership)")
    u = register("财务")
    p0 = u.state()["points"]
    r = u.post("/api/checkin")
    ok(r.get("reward") == 10, "check-in +10", r)
    u.post("/api/checkin", expect=409)
    ok(u.state()["points"] == p0 + 10, "beans after check-in")
    packs = u.get("/api/beans/packs")
    if packs.get("packs"):
        p = min(packs["packs"], key=lambda x: x["price"])
        if p["price"] <= 100:
            w0 = u.state()["wallet"]
            u.post("/api/beans/exchange", {"packId": p["id"]})
            st = u.state()
            ok(abs(st["wallet"] - (w0 - p["price"])) < 0.001, "bean pack charged the wallet")
            ok(bills(st, kind="exchange"), "bean pack bill")
    t = u.post("/api/topups", {"amount": 50, "reference": "QA-REF-1"})
    tid = (t.get("item") or {}).get("id")
    acc = u.post("/api/withdraw/accounts", {"kind": "bank", "provider": "Maybank", "accountName": "QA", "accountNo": "1234567890"}, expect=[200, 400])
    acct = (acc.get("account") or {}).get("id") if isinstance(acc, dict) else None
    if acct:
        w = u.post("/api/withdrawals", {"source": "wallet", "amount": 60, "accountId": acct}, expect=[200, 400])
        wid = (w.get("item") or {}).get("id") if isinstance(w, dict) else None
        other = register("他人")
        if wid:
            other.post(f"/api/withdrawals/{str(wid).lstrip('w')}/cancel", expect=[404, 400])
            other.post("/api/withdrawals", {"source": "wallet", "amount": 60, "accountId": acct}, expect=400)
            u.post(f"/api/withdrawals/{str(wid).lstrip('w')}/cancel")
    if tid:
        other = register("他人2")
        other.post(f"/api/topups/{str(tid).lstrip('t')}/cancel", expect=409)


def t_admin_scope():
    print("· console: roles, scopes, CSV exports, sort whitelists")
    a = admin()
    for p in ["/api/admin/users", "/api/admin/orders", "/api/admin/finance/transactions", "/api/admin/finance/withdrawals",
              "/api/admin/finance/deposits", "/api/admin/merchants", "/api/admin/content/posts", "/api/admin/reports",
              "/api/admin/support/conversations", "/api/admin/gifts", "/api/admin/live/sessions", "/api/admin/dashboard", "/api/admin/config",
              "/api/admin/logs", "/api/admin/roles", "/api/admin/admins", "/api/admin/agents", "/api/admin/marketing/coupons",
              "/api/admin/catalog/services", "/api/admin/aftersales", "/api/admin/growth/stats", "/api/admin/vip/overview"]:
        a.get(p)
    # injection attempts in sort / filter parameters must not 500
    for p in ["/api/admin/users?sort=Id;DROP TABLE x--", "/api/admin/orders?sort=1)--&order=desc;--", "/api/admin/catalog/services?sort=name%27",
              "/api/admin/users?q=%27%20OR%201=1--", "/api/admin/finance/transactions?kind=%27&sort=x"]:
        a.get(p, expect=[200, 400])
    # CSV exports neutralise formulas
    evil = register("=cmd|' /C calc'!A0")
    r = a.s.get(BASE + "/api/admin/users/export?q=" + evil.me["displayId"], headers=a.headers(), timeout=60)
    ok(r.status_code == 200, "users export")
    ok("\n=cmd" not in r.text and ",=cmd" not in r.text and '"=cmd' not in r.text, "CSV export neutralises =formulas", r.text[:300])
    r = a.s.get(BASE + "/api/admin/finance/transactions/export", headers=a.headers(), timeout=60)
    ok(r.status_code == 200, "transactions export")
    ok(",'-" not in r.text, "CSV export keeps negative amounts numeric", [l for l in r.text.splitlines() if ",'-" in l][:2])


def t_admin_perms(routes_file):
    print("· every /api/admin route: anonymous 401, member 401, admin without permissions 403")
    routes = [l.split(" ", 1) for l in open(routes_file).read().splitlines() if " " in l]
    a = admin()
    roles = a.get("/api/admin/roles")
    roles = roles if isinstance(roles, list) else roles.get("items", [])
    rid = next((r["id"] for r in roles if r["code"] == "qanone"), None)
    if not rid:
        rid = a.post("/api/admin/roles", {"code": "qanone", "name": "QA 无权限", "permissions": ["dashboard.view"], "dataScope": "all"})["id"]
    admins = a.get("/api/admin/admins")
    admins = admins if isinstance(admins, list) else admins.get("items", [])
    if not any(x["username"] == "qanone" for x in admins):
        a.post("/api/admin/admins", {"username": "qanone", "password": "qa123456", "roleId": rid})
    none = admin("qanone", "qa123456")
    anon, member = Client(), register("perm")
    # endpoints any signed-in admin may call (own account, menu, reference data) or that authorise per item
    open_ok = {"/api/admin/auth/login", "/api/admin/auth/logout", "/api/admin/me", "/api/admin/me/password", "/api/admin/dashboard",
               "/api/admin/permissions", "/api/admin/media", "/api/admin/commerce/meta"}
    for methods, pat in routes:
        if not pat.startswith("/api/admin") or pat in open_ok:
            continue
        path = re.sub(r"\{[^}]*regex[^}]*\}", "confirm", pat)
        path = re.sub(r"\{(\w+)(:long)?\}", lambda m: "999999" if m.group(2) else "zzqa", path)
        for m in methods.split(","):
            body = {} if m in ("POST", "PUT", "PATCH") else None
            for who, c, want in [("anonymous", anon, (401, 403)), ("member", member, (401, 403)), ("no-permission admin", none, (403,))]:
                r = c.s.request(m, BASE + path, json=body, headers=c.headers(), timeout=30)
                # scoped settings endpoints answer an empty form / accept an empty change set
                if who == "no-permission admin" and r.status_code in (200, 400) and ("config" in pat or pat.endswith("/bulk")):
                    continue
                ok(r.status_code in want, f"{m} {pat} as {who} → {r.status_code}", r.text[:120])


SECTIONS = {
    "boot": t_boot, "signup": t_signup, "orders": t_tasks_address_member_checkout, "social": t_social_money,
    "finance": t_finance, "admin": t_admin_scope,
}


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--only", default="")
    ap.add_argument("--routes", default="")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")
    only = [s for s in args.only.split(",") if s]
    for name, fn in SECTIONS.items():
        if only and name not in only:
            continue
        try:
            fn()
        except Exception as e:  # keep going: report the crash as a failure
            import traceback
            traceback.print_exc()
            ok(False, f"section {name} crashed", repr(e))
    if args.routes and (not only or "perms" in only):
        t_admin_perms(args.routes)
    print(f"\n{PASS[0]} checks passed, {len(FAIL)} failed")
    for f in FAIL:
        print("  -", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
