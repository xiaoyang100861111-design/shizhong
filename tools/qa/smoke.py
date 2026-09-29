#!/usr/bin/env python3
"""
Shizhong smoke / screenshot runner (Chrome DevTools Protocol, no Selenium/Playwright needed).

    python tools/qa/smoke.py                       # all scenarios, zh-CN, demo account
    python tools/qa/smoke.py --locale en           # English UI + untranslated-text report
    python tools/qa/smoke.py --only live,chat      # scenario name substrings
    python tools/qa/smoke.py --root D:/worktree    # test another checkout
    python tools/qa/smoke.py --session none        # first-run (welcome / login screen)
    python tools/qa/smoke.py --theme dark --width 320 --height 740
    python tools/qa/smoke.py --url http://127.0.0.1:8000/          # offline demo from a static server
    python tools/qa/smoke.py --url http://127.0.0.1:5080/ --server # server mode (sessions via /api/auth)
    python tools/qa/smoke.py --chrome /opt/pw-browsers/chromium-1194/chrome-linux/chrome

Server mode (--server): session "demo" signs in with POST /api/auth/demo, "new" registers a fresh member,
"none" signs out and "guest" signs out and browses as a guest. In server mode, scenarios may set
"serverSkip": true (offline-only behaviour) or "serverSteps" (used instead of "steps"). Any request to /api/
in the offline demo (no --server) and any HTTP 5xx is reported as a failure.

Scenarios live in tools/qa/scenarios/*.json (one file per feature area). Each scenario:
    {"name": "home", "hash": "home", "session": "demo", "steps": [ ...step... ]}
Steps:
    {"click": "css selector"}            click the first match (fails the step if absent)
    {"click": "css", "text": "礼物"}     first match whose trimmed text equals / contains text
    {"type": "css", "value": "hello"}    set an input value and fire input/change
    {"submit": "form css"}               requestSubmit()
    {"key": "Escape"}                    dispatch a keydown on document
    {"back": true}                       history.back() (tests the phone back button)
    {"wait": 1200}                       milliseconds
    {"eval": "js expression"}            run code (awaited)
    {"expect": "js expression", "msg": "..."}  must be truthy, else a failure is recorded
    {"shot": "suffix"}                   extra screenshot mid-scenario
A final screenshot is always taken. Results: <out>/report.json and PNGs.

Exit code 1 when any scenario has an exception, failed step or failed expectation.
"""
import argparse, asyncio, base64, glob, json, os, random, re, shutil, subprocess, sys, time, urllib.request

try:
    import websockets
except ImportError:
    sys.exit("pip install websockets")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
] + sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"), reverse=True)  # Playwright's Chromium (CI / cloud)

PROBE = r"""
(() => {
  const out = { overflowX: document.documentElement.scrollWidth - innerWidth, cjk: [], clipped: [], top: '' };
  const top = [...document.querySelectorAll('#overlay-root > [data-sz-layer]')].pop();
  out.top = top ? (top.querySelector('h2')?.textContent || top.getAttribute('aria-label') || top.dataset.kind || '').trim().slice(0, 40) : '-';
  out.depth = document.querySelectorAll('#overlay-root > [data-sz-layer]').length;
  const scope = top ? [top] : [document.querySelector('#app'), document.querySelector('#bottom-nav')];
  const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
  const seen = new Set();
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  for (const root of scope) {
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const text = n.nodeValue.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || el.closest('[lang^="zh"],[data-i18n-skip],script,style,[aria-hidden="true"]') || !visible(el)) continue;
      if (cjk.test(text) && !seen.has(text)) { seen.add(text); out.cjk.push(text.slice(0, 60)); }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length || !el.textContent.trim() || !visible(el) || el.closest('.sr-only,.sr-text,[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !/-webkit-box/.test(cs.display))
        out.clipped.push(el.textContent.trim().slice(0, 40));
    }
  }
  out.cjk = out.cjk.slice(0, 40);
  out.clipped = [...new Set(out.clipped)].slice(0, 20);
  return out;
})()
"""


class CDP:
    def __init__(self, ws):
        self.ws, self.n, self.events = ws, 0, []

    async def send(self, method, params=None):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)

    async def drain(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=max(0.01, end - time.time())))
                if "method" in msg:
                    self.events.append(msg)
            except asyncio.TimeoutError:
                break

    async def js(self, expr):
        r = await self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__error__": (d.get("exception", {}).get("description") or d.get("text") or "")[:300]}
        return r.get("result", {}).get("value")

    async def wait_for(self, expr, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            v = await self.js(expr)
            if v and not (isinstance(v, dict) and "__error__" in v):
                return True
            await self.drain(0.15)
        return False


def errors_since(cdp, start, offline=False):
    out = []
    for e in cdp.events[start:]:
        m, p = e["method"], e.get("params", {})
        if m == "Network.requestWillBeSent" and offline and "/api/" in p.get("request", {}).get("url", ""):
            out.append("API CALL in the offline demo " + p["request"]["url"][-80:])
        elif m == "Network.responseReceived" and p.get("response", {}).get("status", 0) >= 500:
            out.append(f"HTTP {p['response']['status']} " + p["response"].get("url", "")[-100:])
        elif m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            out.append("EXCEPTION " + (d.get("exception", {}).get("description") or d.get("text") or "")[:400])
        elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
            out.append("console.error " + " ".join(str(a.get("value", a.get("description", "")))[:200] for a in p.get("args", [])))
        elif m == "Log.entryAdded":
            en = p.get("entry", {})
            # optional translated demo content may not exist yet for every chunk
            # server mode: a refused action (400 / 409 / 429) is an expected answer the app shows as a toast
            expected = not offline and re.search(r"status of (400|409|422|429) ", en.get("text", ""))
            if en.get("level") == "error" and not expected and "favicon" not in en.get("text", "") and "/data/i18n/" not in (en.get("url") or ""):
                out.append("LOG " + en.get("text", "")[:200] + " " + (en.get("url") or "")[-80:])
    return out


def load_scenarios(only):
    items = []
    for f in sorted(glob.glob(os.path.join(HERE, "scenarios", "*.json"))):
        with open(f, encoding="utf-8") as fh:
            for sc in json.load(fh):
                sc["_file"] = os.path.basename(f)
                items.append(sc)
    if only:
        keys = [k.strip() for k in only.split(",") if k.strip()]
        items = [s for s in items if any(k in s["name"] or k in s["_file"] for k in keys)]
    return items


def sel_click_js(sel, text=None):
    s = json.dumps(sel)
    if text is None:
        return f"(()=>{{const b=[...document.querySelectorAll({s})].find(e=>!e.closest('[inert]'));if(!b)return false;b.scrollIntoView({{block:'center'}});b.click();return true}})()"
    t = json.dumps(text)
    return (
        f"(()=>{{const els=[...document.querySelectorAll({s})].filter(e=>!e.closest('[inert]'));"
        f"const b=els.find(e=>e.textContent.trim()==={t})||els.find(e=>e.textContent.includes({t})||(e.getAttribute('aria-label')||'').includes({t}));"
        f"if(!b)return false;b.scrollIntoView({{block:'center'}});b.click();return true}})()"
    )


async def run(args):
    chrome = args.chrome or next((c for c in CHROME_CANDIDATES if os.path.exists(c)), None)
    if not chrome:
        sys.exit("Chrome/Edge not found; pass --chrome")
    root = os.path.abspath(args.root)
    url = (args.url.rstrip("/") + "/index.html") if args.url else "file:///" + root.replace("\\", "/").lstrip("/") + "/index.html"
    out = os.path.abspath(args.out or os.path.join(root, ".qa", f"{args.locale}-{args.width}"))
    os.makedirs(out, exist_ok=True)
    profile = os.path.join(out, "_profile")
    shutil.rmtree(profile, ignore_errors=True)
    port = args.port
    proc = subprocess.Popen(
        [chrome, "--headless=new", "--disable-gpu", "--no-sandbox", f"--remote-debugging-port={port}", "--remote-allow-origins=*",
         f"--user-data-dir={profile}", "--hide-scrollbars", "--no-first-run", "--mute-audio", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report, failures = {}, 0
    try:
        ws_url = None
        for _ in range(80):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                ws_url = next(t for t in targets if t["type"] == "page")["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.25)
        if not ws_url:
            sys.exit("Chrome did not start")
        async with websockets.connect(ws_url, max_size=None) as ws:
            cdp = CDP(ws)
            for m in ("Page.enable", "Runtime.enable", "Log.enable", "Network.enable"):
                await cdp.send(m)
            await cdp.send("Emulation.setDeviceMetricsOverride", {"width": args.width, "height": args.height, "deviceScaleFactor": 2, "mobile": True})
            await cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            scenarios = load_scenarios(args.only)
            if args.server:
                scenarios = [x for x in scenarios if not x.get("serverSkip")]
            for sc in scenarios:
                name = sc["name"]
                session = sc.get("session", args.session)
                start = len(cdp.events)
                if args.server:  # sign-in is rate limited per client IP: every scenario looks like a fresh client
                    await cdp.send("Network.setExtraHTTPHeaders", {"headers": {"X-Forwarded-For": "10.%d.%d.%d" % (
                        random.randint(0, 250), random.randint(0, 250), random.randint(1, 250))}})
                # fresh document with the requested locale/session/theme
                await cdp.send("Page.navigate", {"url": url + "#home"})
                await cdp.wait_for("document.readyState==='complete'", 15)
                setup = [f"localStorage.setItem('sz:locale',{json.dumps(args.locale)})",
                         f"localStorage.setItem('sz:theme',{json.dumps(args.theme)})"]
                if args.server:
                    # the server session is a cookie: sign in / out through the API before the real load
                    if session == "demo":
                        setup.append("await fetch('/api/auth/demo',{method:'POST'})")
                    elif session == "new":
                        setup.append("await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify("
                                     "{phone:'+60 1'+String(Math.floor(1e7+Math.random()*8e7)),password:'qa123456a',name:'QA',ageConfirmed:true,terms:true,city:'吉隆坡'})})")
                    else:
                        setup.append("await fetch('/api/auth/logout',{method:'POST'})")
                    setup.append("localStorage.setItem('sz:v3:guest','1')" if session == "guest" else "localStorage.removeItem('sz:v3:guest')")
                if session == "none":
                    setup.append("localStorage.removeItem('sz:v2:session')")
                else:
                    setup.append(f"localStorage.setItem('sz:v2:session',JSON.stringify({{accountId:{json.dumps(session)},at:Date.now()}}))")
                for extra in sc.get("setup", []):
                    setup.append(extra)
                await cdp.js("(async()=>{" + ";".join(setup) + "})()")
                await cdp.send("Page.navigate", {"url": "about:blank"})
                await cdp.wait_for("location.href==='about:blank'", 5)
                await cdp.send("Page.navigate", {"url": url + "#" + sc.get("hash", "home")})
                booted = await cdp.wait_for("window.SZ_BOOTED===true || !!document.querySelector('.boot-error')", 15)
                await cdp.drain(0.6)
                steps_log, step_fail = [], []
                steps = sc.get("serverSteps", sc.get("steps", [])) if args.server else sc.get("steps", [])
                if args.server:  # the server's demo account talks to personas: p1–p3's chats (offline seed) → seeded ones
                    text = json.dumps(steps)
                    for legacy, persona in (("p1", "u0040"), ("p2", "u0058"), ("p3", "u0033")):
                        text = re.sub(r"(=|'|:)%s(\]|')" % legacy, r"\g<1>%s\g<2>" % persona, text)
                    steps = json.loads(text)
                for i, st in enumerate(steps):
                    try:
                        res = True
                        if "click" in st:
                            res = await cdp.js(sel_click_js(st["click"], st.get("text")))
                        elif "type" in st:
                            res = await cdp.js(f"(()=>{{const e=document.querySelector({json.dumps(st['type'])});if(!e)return false;e.focus();e.value={json.dumps(st['value'])};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));return true}})()")
                        elif "submit" in st:
                            res = await cdp.js(f"(()=>{{const f=document.querySelector({json.dumps(st['submit'])});if(!f)return false;f.requestSubmit();return true}})()")
                        elif "key" in st:
                            res = await cdp.js(f"(document.activeElement||document).dispatchEvent(new KeyboardEvent('keydown',{{key:{json.dumps(st['key'])},bubbles:true}}))||true")
                        elif st.get("back"):
                            res = await cdp.js("history.back(),true")
                        elif "wait" in st:
                            await cdp.drain(st["wait"] / 1000)
                        elif "eval" in st:
                            res = await cdp.js(st["eval"])
                        elif "expect" in st:
                            v = await cdp.js(st["expect"])
                            res = bool(v) and not (isinstance(v, dict) and "__error__" in v)
                            if not res:
                                step_fail.append(f"expect failed: {st.get('msg') or st['expect']} -> {v}")
                        elif "shot" in st:
                            shot = await cdp.send("Page.captureScreenshot", {"format": "png"})
                            with open(os.path.join(out, f"{name}--{st['shot']}.png"), "wb") as fh:
                                fh.write(base64.b64decode(shot["data"]))
                        if isinstance(res, dict) and "__error__" in res:
                            step_fail.append(f"step {i} error: {res['__error__']}")
                        elif res is False and "expect" not in st:
                            step_fail.append(f"step {i} target not found: {json.dumps(st, ensure_ascii=False)}")
                        steps_log.append(res if not isinstance(res, dict) else "err")
                        if "wait" not in st:
                            await cdp.drain(st.get("settle", 700) / 1000)
                            await cdp.wait_for("!document.querySelector('#resource-loading')", 8)
                    except Exception as exc:  # page navigated away, target closed, etc.
                        step_fail.append(f"step {i} crashed: {exc}")
                        break
                await cdp.drain(0.4)
                try:
                    shot = await cdp.send("Page.captureScreenshot", {"format": "png"})
                    with open(os.path.join(out, f"{name}.png"), "wb") as fh:
                        fh.write(base64.b64decode(shot["data"]))
                    probe = await cdp.js(PROBE) or {}
                except Exception as exc:
                    probe = {}
                    step_fail.append(f"final capture failed: {exc}")
                errs = errors_since(cdp, start, offline=not args.server)
                bad = (not booted) or bool(errs) or bool(step_fail)
                failures += 1 if bad else 0
                report[name] = {"file": sc["_file"], "booted": booted, "steps": steps_log, "stepFailures": step_fail, "errors": errs, **(probe if isinstance(probe, dict) else {})}
                flag = "FAIL" if bad else "ok  "
                extra = []
                if isinstance(probe, dict):
                    if probe.get("overflowX", 0) > 0:
                        extra.append(f"overflowX={probe['overflowX']}")
                    if args.locale != "zh-CN" and probe.get("cjk"):
                        extra.append(f"untranslated={len(probe['cjk'])}")
                    if probe.get("clipped"):
                        extra.append(f"clipped={len(probe['clipped'])}")
                    extra.append(f"top={probe.get('top')!r} depth={probe.get('depth')}")
                print(f"{flag} {name:32s} {' '.join(extra)}", flush=True)
                for e in errs + step_fail:
                    print("      " + e, flush=True)
            with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as fh:
                json.dump(report, fh, ensure_ascii=False, indent=1)
    finally:
        proc.kill()
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)
    print(f"\n{len(report)} scenarios, {failures} failing. Report: {os.path.join(out, 'report.json')}")
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=REPO)
    ap.add_argument("--locale", default="zh-CN")
    ap.add_argument("--theme", default="light")
    ap.add_argument("--session", default="demo", help="demo | guest | none | <accountId>")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--width", type=int, default=390)
    ap.add_argument("--height", type=int, default=844)
    ap.add_argument("--port", type=int, default=9333)
    ap.add_argument("--chrome", default="")
    ap.add_argument("--url", default="", help="base URL (static server or the API host) instead of file://")
    ap.add_argument("--server", action="store_true", help="server mode: sign in through /api/auth")
    args = ap.parse_args()
    sys.exit(1 if asyncio.run(run(args)) else 0)


if __name__ == "__main__":
    main()
