"""
Shared helpers for the load / stress scripts (tools/load/README.md).

- Api: one member / admin client on a shared aiohttp session (Bearer token, X-Forwarded-For).
- sessions(): signs in N test members (seed password Test@2026) once and caches their tokens in a JSON file,
  so throughput tests never hit the sign-in rate limiter (30 per 5 min per IP).
- closed_loop(): N concurrent workers calling one function for a fixed time → Stats (RPS, p50/p95/p99, errors).
- Monitor: samples CPU / memory of the API process and of sqlservr (psutil, when the scripts run on the server).
"""
import asyncio, json, os, random, statistics, sys, time
from collections import Counter

import aiohttp

try:
    import psutil
except ImportError:  # monitoring is optional
    psutil = None

BASE = os.environ.get("SZ_BASE", "http://127.0.0.1:5089")
ADMIN_USER = os.environ.get("SZ_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("SZ_ADMIN_PASS", "123123")
SEED_PASSWORD = os.environ.get("SZ_SEED_PASSWORD", "Test@2026")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("SZ_LOAD_OUT", os.path.join(HERE, "out"))


def set_base(b):
    global BASE
    BASE = b.rstrip("/")


def rand_ip():
    return "10.%d.%d.%d" % (random.randint(0, 255), random.randint(0, 255), random.randint(1, 254))


def new_http(limit=0):
    # limit=0: no client-side connection cap (the test controls concurrency with its worker count)
    return aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=limit, ttl_dns_cache=300),
                                 timeout=aiohttp.ClientTimeout(total=120))


class Api:
    def __init__(self, http, token=None, admin=None, ip=None, info=None):
        self.http, self.token, self.admin, self.ip = http, token, admin, ip or rand_ip()
        self.info = info or {}

    @property
    def id(self):  # public id ("m12345678") used as chat / person id
        return self.info.get("publicId") or self.info.get("id")

    def headers(self):
        h = {"X-Forwarded-For": self.ip, "Accept-Encoding": "gzip"}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        if self.admin:
            h["X-Admin-Token"] = self.admin
        return h

    async def req(self, method, path, body=None, raw=False):
        """→ (status, data, ms). data is parsed JSON (or text / bytes length when raw)."""
        t0 = time.perf_counter()
        try:
            async with self.http.request(method, BASE + path, json=body, headers=self.headers()) as r:
                if raw:
                    b = await r.read()
                    data = len(b)
                else:
                    txt = await r.text()
                    try:
                        data = json.loads(txt) if txt else None
                    except ValueError:
                        data = txt
                return r.status, data, (time.perf_counter() - t0) * 1000
        except Exception as e:  # connection refused / reset / timeout
            return 0, repr(e), (time.perf_counter() - t0) * 1000

    async def get(self, p, **kw):
        return await self.req("GET", p, **kw)

    async def post(self, p, b=None, **kw):
        return await self.req("POST", p, {} if b is None else b, **kw)


# ------------------------------------------------------------------------------------------------ sign-in
async def admin(http, username=None, password=None):
    a = Api(http)
    s, d, _ = await a.post("/api/admin/auth/login", {"username": username or ADMIN_USER, "password": password or SEED_PASSWORD if username else ADMIN_PASS})
    if s != 200:
        raise SystemExit(f"admin login failed: {s} {d}")
    a.admin = d["token"]
    return a


async def list_members(adm, n, extra=""):
    """Members from the console user list (phone, public id, db id, balance)."""
    out, page = [], 1
    while len(out) < n:
        s, d, _ = await adm.get(f"/api/admin/users?kind=member&status=0&size=200&page={page}&sort=-lastSeenAt{extra}")
        if s != 200 or not d.get("items"):
            break
        for u in d["items"]:
            if u["kind"] == 0 and (u.get("phone") or u.get("email")):
                out.append(u)
        page += 1
    return out[:n]


async def login(http, account):
    a = Api(http)
    s, d, _ = await a.post("/api/auth/login", {"account": account, "password": SEED_PASSWORD})
    if s != 200:
        return None
    a.token = d["token"]
    a.info = d["me"]
    return a


async def sessions(http, n, cache=None, skip=0):
    """N signed-in test members (cached tokens are re-validated with GET /api/me)."""
    os.makedirs(OUT, exist_ok=True)
    cache = cache or os.path.join(OUT, "sessions-%s.json" % BASE.split("//")[-1].replace(":", "_").replace("/", "_"))
    saved = []
    if os.path.exists(cache):
        try:
            saved = json.load(open(cache))
        except ValueError:
            saved = []
    result = []
    sem = asyncio.Semaphore(16)

    async def check(s):
        async with sem:
            a = Api(http, token=s["token"], info=s["me"])
            st, d, _ = await a.get("/api/me")
            if st == 200:
                a.info.update(dbId=s.get("dbId"))
                return a
    checked = [a for a in await asyncio.gather(*[check(s) for s in saved[skip:skip + n]]) if a]
    result.extend(checked)
    if len(result) < n:
        adm = await admin(http)
        have = {a.info.get("id") for a in result} | {s["me"].get("id") for s in saved}
        members = [m for m in await list_members(adm, n + skip + len(saved) + 50) if m["publicId"] not in have]

        async def one(m):
            async with sem:
                a = await login(http, m.get("phone") or m.get("email"))
                if a:
                    a.info["dbId"] = m["id"]
                return a
        need = n - len(result)
        fresh = [a for a in await asyncio.gather(*[one(m) for m in members[:need + 20]]) if a][:need]
        result.extend(fresh)
        saved.extend({"token": a.token, "me": a.info, "dbId": a.info.get("dbId")} for a in fresh)
        json.dump(saved, open(cache, "w"))
    for a in result:
        a.ip = rand_ip()
    return result[:n]


async def db_ids(adm, apis):
    """Fill info['dbId'] (console user id) for clients that miss it."""
    for a in apis:
        if not a.info.get("dbId"):
            s, d, _ = await adm.get("/api/admin/users?q=" + a.info["displayId"])
            if s == 200 and d.get("items"):
                a.info["dbId"] = d["items"][0]["id"]


# ------------------------------------------------------------------------------------------------ stats
class Stats:
    def __init__(self, name, conc=0):
        self.name, self.conc = name, conc
        self.lat, self.codes, self.errors = [], Counter(), Counter()
        self.t0 = self.t1 = time.perf_counter()
        self.bytes = 0

    def add(self, status, ms, data=None, ok=None):
        self.lat.append(ms)
        self.codes[status] += 1
        good = (200 <= status < 300) if ok is None else ok
        if not good:
            code = data.get("code") if isinstance(data, dict) else (str(data)[:60] if status == 0 else "")
            self.errors[f"{status} {code}".strip()] += 1

    def pct(self, p):
        if not self.lat:
            return 0
        s = sorted(self.lat)
        return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]

    def summary(self):
        n = len(self.lat)
        dur = max(1e-6, self.t1 - self.t0)
        err = sum(self.errors.values())
        return {
            "name": self.name, "conc": self.conc, "n": n, "rps": round(n / dur, 1),
            "p50": round(self.pct(50)), "p95": round(self.pct(95)), "p99": round(self.pct(99)), "max": round(max(self.lat) if self.lat else 0),
            "errPct": round(100 * err / n, 2) if n else 0, "errors": dict(self.errors.most_common(5)),
        }


async def closed_loop(name, conc, seconds, fn, ok=None):
    """conc workers, each calling `await fn(worker_index)` → (status, data, ms) until time is up."""
    st = Stats(name, conc)
    end = time.perf_counter() + seconds

    async def worker(i):
        while time.perf_counter() < end:
            s, d, ms = await fn(i)
            st.add(s, ms, d, ok(s, d) if ok else None)
    st.t0 = time.perf_counter()
    await asyncio.gather(*[worker(i) for i in range(conc)])
    st.t1 = time.perf_counter()
    return st


# ------------------------------------------------------------------------------------------------ server monitor
class Monitor:
    """CPU (% of one core) and RSS of the API process and sqlservr, sampled every second while running."""

    def __init__(self, api_pid=None):
        self.procs = {}
        if psutil:
            if api_pid:
                try:
                    self.procs["api"] = psutil.Process(int(api_pid))
                except Exception:
                    pass
            for p in psutil.process_iter(["name"]):
                if (p.info["name"] or "").lower().startswith("sqlservr"):
                    self.procs.setdefault("sql", p)
                    try:  # the child sqlservr process does the work
                        if p.children():
                            self.procs["sql"] = p.children()[0]
                    except Exception:
                        pass
        self.samples = {k: [] for k in self.procs}
        self.task = None

    async def _run(self):
        for p in self.procs.values():
            try:
                p.cpu_percent(None)
            except Exception:
                pass
        while True:
            await asyncio.sleep(1)
            for k, p in self.procs.items():
                try:
                    self.samples[k].append((p.cpu_percent(None), p.memory_info().rss / 1048576, p.num_threads()))
                except Exception:
                    pass

    def start(self):
        self.samples = {k: [] for k in self.procs}
        self.task = asyncio.ensure_future(self._run())

    def stop(self):
        if self.task:
            self.task.cancel()
        out = {}
        for k, s in self.samples.items():
            if s:
                out[k] = {"cpuAvg": round(statistics.mean(x[0] for x in s)), "cpuMax": round(max(x[0] for x in s)),
                          "rssMaxMb": round(max(x[1] for x in s)), "threadsMax": max(x[2] for x in s)}
        return out


def fmt_row(s, mon=None):
    m = ""
    if mon:
        a, q = mon.get("api", {}), mon.get("sql", {})
        m = f" | api cpu {a.get('cpuAvg', '-')}%/{a.get('rssMaxMb', '-')}MB thr {a.get('threadsMax', '-')} | sql cpu {q.get('cpuAvg', '-')}%"
    e = f" err {s['errPct']}% {s['errors']}" if s["errPct"] else ""
    return f"  {s['name']:<28} c={s['conc']:<4} n={s['n']:<6} rps={s['rps']:<8} p50={s['p50']:<5} p95={s['p95']:<5} p99={s['p99']:<6} max={s['max']:<6}{m}{e}"


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.json")
    json.dump(data, open(path, "w"), ensure_ascii=False, indent=1)
    print("  saved", path)
    return path


def api_pid(args_pid):
    if args_pid:
        return args_pid
    f = os.environ.get("SZ_API_PID_FILE")
    if f and os.path.exists(f):
        return open(f).read().strip()
    return None
