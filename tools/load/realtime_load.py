#!/usr/bin/env python3
"""
Realtime (SignalR /hubs/app, JSON protocol over WebSocket) under load.

    python realtime_load.py [--base URL] [--conns 600] [--viewers 400] [--only connect,live,pairs,group]

  connect  --conns members open a hub connection (connect time, failures, server memory)
  live     --viewers members join one live room ('live:<id>'); 20 members post comments and gifts over REST;
           every viewer should receive every 'live:comment' / 'live:gift' → delivery latency p50/p95/p99 and loss
  pairs    200 pairs: A posts a 1:1 message over REST, B's socket must receive 'chat:message' (latency, loss)
  group    one group with 150 connected members, 10 senders × 5 messages → each member receives all 50
Latency = client receive time − client send time of the REST call that caused it (same machine clock).
"""
import argparse, asyncio, json, random, time, uuid

import aiohttp

import common as C

RS = "\x1e"


class Hub:
    """Minimal SignalR JSON-protocol client (negotiate v1 + WebSocket)."""

    def __init__(self, api):
        self.api, self.ws, self.events, self.waiters, self.inv = api, None, [], {}, 0
        self.handlers = []
        self.task = None

    async def connect(self):
        http = self.api.http
        h = self.api.headers()
        async with http.post(C.BASE + "/hubs/app/negotiate?negotiateVersion=1", headers=h) as r:
            neg = await r.json()
        token = neg.get("connectionToken") or neg.get("connectionId")
        url = C.BASE.replace("http", "ws", 1) + f"/hubs/app?id={token}&access_token={self.api.token}"
        self.ws = await http.ws_connect(url, headers={"X-Forwarded-For": self.api.ip}, heartbeat=None, max_msg_size=0)
        await self.ws.send_str(json.dumps({"protocol": "json", "version": 1}) + RS)
        msg = await self.ws.receive(timeout=30)
        if msg.type != aiohttp.WSMsgType.TEXT or not msg.data.startswith("{}"):
            raise RuntimeError(f"handshake failed: {msg.data!r}"[:200])
        self.task = asyncio.ensure_future(self._reader())
        self.pinger = asyncio.ensure_future(self._ping())

    async def _ping(self):
        while True:
            await asyncio.sleep(10)
            try:
                await self.ws.send_str('{"type":6}' + RS)
            except Exception:
                return

    async def _reader(self):
        try:
            async for msg in self.ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                now = time.perf_counter()
                for part in msg.data.split(RS):
                    if not part:
                        continue
                    m = json.loads(part)
                    t = m.get("type")
                    if t == 1 and m.get("target") == "evt":
                        name, payload = m["arguments"][0], m["arguments"][1] if len(m["arguments"]) > 1 else None
                        for h in self.handlers:
                            h(name, payload, now)
                    elif t == 3:
                        f = self.waiters.pop(m.get("invocationId"), None)
                        if f and not f.done():
                            f.set_result(m)
                    elif t == 7:  # close
                        return
        except Exception:
            pass

    async def invoke(self, target, *args):
        self.inv += 1
        iid = str(self.inv)
        f = asyncio.get_event_loop().create_future()
        self.waiters[iid] = f
        await self.ws.send_str(json.dumps({"type": 1, "invocationId": iid, "target": target, "arguments": list(args)}) + RS)
        return await asyncio.wait_for(f, 30)

    async def close(self):
        for t in (self.task, getattr(self, "pinger", None)):
            if t:
                t.cancel()
        if self.ws:
            await self.ws.close()


def pct(v, p):
    if not v:
        return 0
    s = sorted(v)
    return round(s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))])


async def open_hubs(users, conc=50):
    sem = asyncio.Semaphore(conc)
    times, fails = [], []

    async def one(a):
        async with sem:
            h = Hub(a)
            t0 = time.perf_counter()
            try:
                await h.connect()
                times.append((time.perf_counter() - t0) * 1000)
                return h
            except Exception as e:
                fails.append(repr(e)[:120])
                return None
    hubs = await asyncio.gather(*[one(a) for a in users])
    return hubs, times, fails


RESULTS = []


def out(name, detail, **kw):
    RESULTS.append({"name": name, "detail": detail, **kw})
    print(f"  {name:<10} {detail}", flush=True)


async def t_connect(ctx):
    mon = C.Monitor(ctx.pid)
    mon.start()
    t0 = time.perf_counter()
    hubs, times, fails = await open_hubs(ctx.users[:ctx.conns])
    dt = time.perf_counter() - t0
    await asyncio.sleep(3)
    s, h, _ = await C.Api(ctx.http).get("/api/health")
    server = mon.stop()
    out("connect", f"{len([x for x in hubs if x])}/{ctx.conns} connected in {dt:.1f}s, connect p50={pct(times, 50)}ms p95={pct(times, 95)}ms "
        f"p99={pct(times, 99)}ms, failures {len(fails)} {fails[:2]}, server online={h.get('online') if isinstance(h, dict) else h}, api {server.get('api')}",
        connected=len([x for x in hubs if x]), failures=len(fails), p50=pct(times, 50), p95=pct(times, 95), server=server)
    ctx.hubs = hubs


async def t_live(ctx):
    viewers = [h for h in ctx.hubs if h][:ctx.viewers]
    s, d, _ = await ctx.users[0].get("/api/live/rooms")
    room = d["rooms"][ctx.room]["sessionId"] if ctx.room is not None else random.choice(d["rooms"])["sessionId"]
    sent = {}
    # (key, viewer index, receive time), matched with the send times afterwards: a gift's id is known only when its
    # REST answer arrives, which can be after the broadcast
    events = []
    joined_idx = set()

    def handler_for(idx):
        def on(name, payload, now):
            if name in ("live:comment", "live:gift") and isinstance(payload, dict) and payload.get("sessionId") == room:
                events.append((payload.get("text") if name == "live:comment" else payload.get("id"), idx, now))
        return on
    t0 = time.perf_counter()
    join_ms, join_res = [], {}
    sem = asyncio.Semaphore(50)

    async def join(i, h):
        h.handlers.append(handler_for(i))
        async with sem:
            t = time.perf_counter()
            try:
                r = await h.invoke("Join", f"live:{room}")
                res = "joined" if r.get("result") is True else "refused (blocked)" if r.get("result") is False else str(r.get("error"))[:60]
            except Exception as e:
                res = "timeout" if isinstance(e, asyncio.TimeoutError) else repr(e)[:60]
            join_ms.append((time.perf_counter() - t) * 1000)
            join_res[res] = join_res.get(res, 0) + 1
            if res == "joined":
                joined_idx.add(i)
    mon0 = C.Monitor(ctx.pid)
    mon0.start()
    await asyncio.gather(*[join(i, h) for i, h in enumerate(viewers)])
    jt = time.perf_counter() - t0
    join_server = mon0.stop()
    joined = len(joined_idx)
    out("live-join", f"{len(viewers)} viewers join live:{room} (50 at a time): {join_res} in {jt:.1f}s, Join p50={pct(join_ms, 50)}ms "
        f"p95={pct(join_ms, 95)}ms max={pct(join_ms, 100)}ms; api {join_server.get('api')}", results=join_res, seconds=round(jt, 1),
        p50=pct(join_ms, 50), p95=pct(join_ms, 95), server=join_server)
    await asyncio.sleep(2)
    senders = [a for a in ctx.users[ctx.conns:ctx.conns + 20]] or ctx.users[-20:]
    mon = C.Monitor(ctx.pid)
    mon.start()
    errors = 0

    async def comment(a, k):
        nonlocal errors
        text = "rt-%s" % uuid.uuid4().hex[:10]
        sent[text] = time.perf_counter()
        s, d, _ = await a.post(f"/api/live/sessions/{room}/comments", {"text": text})
        if s != 200:
            errors += 1
            sent.pop(text, None)

    async def gift(a):
        nonlocal errors
        t = time.perf_counter()
        s, d, _ = await a.post(f"/api/live/sessions/{room}/gifts", {"giftId": "heart", "quantity": 1})
        if s == 200:
            sent[d["gift"]["id"]] = t
        else:
            errors += 1
    # 20 senders × 5 comments + 3 gifts each, spread over ~5 s
    for wave in range(5):
        await asyncio.gather(*[comment(a, wave) for a in senders], *[gift(a) for a in senders if wave < 3])
        await asyncio.sleep(1)
    await asyncio.sleep(5)
    server = mon.stop()
    got, lat = {}, []
    for key, idx, now in events:
        if key in sent and idx in joined_idx and idx not in got.setdefault(key, set()):
            got[key].add(idx)
            lat.append((now - sent[key]) * 1000)
    expected = len(sent) * joined
    received = sum(len(v) for v in got.values())
    loss = 100 * (1 - received / expected) if expected else 0
    out("live", f"{joined} viewers in live:{room}; {len(sent)} comments+gifts sent (REST errors {errors}); "
        f"deliveries {received}/{expected} (loss {loss:.2f}%), latency p50={pct(lat, 50)}ms p95={pct(lat, 95)}ms p99={pct(lat, 99)}ms max={pct(lat, 100)}ms; "
        f"api {server.get('api')}", joined=joined, sent=len(sent), expected=expected, received=received, lossPct=round(loss, 3),
        p50=pct(lat, 50), p95=pct(lat, 95), p99=pct(lat, 99), server=server)
    for h in viewers:
        h.handlers.clear()
        try:
            await h.invoke("Leave", f"live:{room}")
        except Exception:
            pass


async def t_pairs(ctx):
    hubs = [h for h in ctx.hubs if h]
    n = min(200, len(hubs) // 2)
    pairs = [(hubs[2 * i], hubs[2 * i + 1]) for i in range(n)]
    sent, lat, got = {}, [], set()

    def on(name, payload, now):
        if name == "chat:message" and isinstance(payload, dict):
            txt = (payload.get("message") or {}).get("text", "")
            if txt in sent and txt not in got:
                got.add(txt)
                lat.append((now - sent[txt]) * 1000)
    for a, b in pairs:
        b.handlers.append(on)
    errors = 0
    mon = C.Monitor(ctx.pid)
    mon.start()

    async def send(a, b, k):
        nonlocal errors
        text = "pair-%s" % uuid.uuid4().hex[:12]
        sent[text] = time.perf_counter()
        s, d, _ = await a.api.post(f"/api/chats/{b.api.id}/messages", {"type": "text", "text": text, "clientId": uuid.uuid4().hex})
        if s != 200:
            errors += 1
            sent.pop(text, None)
    t0 = time.perf_counter()
    for k in range(5):
        await asyncio.gather(*[send(a, b, k) for a, b in pairs])
    dt = time.perf_counter() - t0
    await asyncio.sleep(4)
    server = mon.stop()
    loss = 100 * (1 - len(got) / len(sent)) if sent else 0
    out("pairs", f"{n} pairs × 5 messages ({len(sent)} sent in {dt:.1f}s = {len(sent) / dt:.0f}/s, REST errors {errors}): delivered {len(got)} (loss {loss:.2f}%), "
        f"latency p50={pct(lat, 50)}ms p95={pct(lat, 95)}ms p99={pct(lat, 99)}ms max={pct(lat, 100)}ms; api {server.get('api')}",
        sent=len(sent), delivered=len(got), lossPct=round(loss, 3), p50=pct(lat, 50), p95=pct(lat, 95), p99=pct(lat, 99), server=server)
    for a, b in pairs:
        b.handlers.clear()


async def t_group(ctx):
    hubs = [h for h in ctx.hubs if h][:150]
    owner = hubs[0].api
    s, g, _ = await owner.post("/api/groups", {"name": "压测群 %d" % random.randint(1000, 9999), "desc": "load test", "city": "吉隆坡"})
    gid = g["group"]["id"]
    joins = await asyncio.gather(*[h.api.post(f"/api/groups/{gid}/join") for h in hubs[1:]])
    join_codes = {}
    for s_, d_, _ in joins:
        join_codes[s_] = join_codes.get(s_, 0) + 1
    out("group-join", f"{len(hubs) - 1} members join one group at once: {join_codes}", codes=join_codes)
    await asyncio.sleep(2)
    sent, lat, got = {}, [], {}

    def handler_for(idx):
        def on(name, payload, now):
            if name == "chat:message" and isinstance(payload, dict):
                txt = (payload.get("message") or {}).get("text", "")
                if txt in sent:
                    got.setdefault(txt, set()).add(idx)
                    lat.append((now - sent[txt]) * 1000)
        return on
    for i, h in enumerate(hubs):
        h.handlers.append(handler_for(i))
    senders = hubs[:10]
    errors = 0
    mon = C.Monitor(ctx.pid)
    mon.start()

    async def send(h):
        nonlocal errors
        text = "grp-%s" % uuid.uuid4().hex[:12]
        sent[text] = time.perf_counter()
        s, d, _ = await h.api.post(f"/api/chats/{gid}/messages", {"type": "text", "text": text, "clientId": uuid.uuid4().hex})
        if s != 200:
            errors += 1
            sent.pop(text, None)
    t0 = time.perf_counter()
    for k in range(5):
        await asyncio.gather(*[send(h) for h in senders])
    dt = time.perf_counter() - t0
    await asyncio.sleep(5)
    server = mon.stop()
    # every member's socket gets it, the sender's too (its other devices are sent a copy)
    expected = len(sent) * len(hubs)
    received = sum(len(v) for v in got.values())
    loss = 100 * (1 - received / expected) if expected else 0
    out("group", f"{len(hubs)} members, {len(sent)} messages in {dt:.1f}s (REST errors {errors}): deliveries {received}/{expected} (loss {loss:.2f}%), "
        f"latency p50={pct(lat, 50)}ms p95={pct(lat, 95)}ms p99={pct(lat, 99)}ms max={pct(lat, 100)}ms; api {server.get('api')}",
        sent=len(sent), expected=expected, received=received, lossPct=round(loss, 3), p50=pct(lat, 50), p95=pct(lat, 95), p99=pct(lat, 99), server=server)
    for h in hubs:
        h.handlers.clear()


class Ctx:
    pass


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=C.BASE)
    ap.add_argument("--conns", type=int, default=600)
    ap.add_argument("--viewers", type=int, default=400)
    ap.add_argument("--room", type=int, default=None, help="index in the live room list (default: random, so viewers are new to it)")
    ap.add_argument("--only", default="")
    ap.add_argument("--pid", default=None)
    args = ap.parse_args()
    C.set_base(args.base)
    async with C.new_http() as http:
        ctx = Ctx()
        ctx.http, ctx.conns, ctx.viewers, ctx.pid, ctx.room = http, args.conns, args.viewers, C.api_pid(args.pid), args.room
        ctx.users = await C.sessions(http, args.conns + 20)
        adm = await C.admin(http)
        await C.db_ids(adm, ctx.users)
        # beans for the gift senders
        for a in ctx.users[args.conns:args.conns + 20]:
            await adm.post(f"/api/admin/users/{a.info['dbId']}/adjust", {"currency": "BEAN", "amount": 1000, "reason": "压测准备", "notify": False})
        print(f"  {len(ctx.users)} members")
        await t_connect(ctx)
        for name, fn in [("live", t_live), ("pairs", t_pairs), ("group", t_group)]:
            if args.only and name not in args.only.split(","):
                continue
            try:
                await fn(ctx)
            except Exception as e:
                import traceback
                traceback.print_exc()
                out(name, "crashed: " + repr(e)[:200])
        await asyncio.gather(*[h.close() for h in ctx.hubs if h])
    C.save("realtime", RESULTS)


if __name__ == "__main__":
    asyncio.run(main())
