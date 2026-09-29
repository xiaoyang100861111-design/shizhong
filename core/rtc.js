'use strict';
/*
 * SZ.rtc — voice/video through Cloudflare Realtime (serverless SFU), via our own /api/rtc proxy.
 * One call / live room / 1:1 session = one "scope" ('call:<id>', 'live:<id>', 'private:<id>'); the owning
 * server module decides who may publish and who may watch. Everyone in a scope pushes their own tracks and
 * pulls the others'. Offline demo (no backend) or no Cloudflare token: SZ.rtc.status() says so and
 * features show their placeholder instead of media.
 *
 *   const status = await SZ.rtc.status();          // { configured, enabled }
 *   const room = await SZ.rtc.join('call:42', {
 *     audio: true, video: true,                    // publish (omit both to only watch)
 *     onTrack(track, pub, stream) {},              // a remote track arrived (pub = { userId, sessionId, trackName, kind })
 *     onTrackEnded(pub) {},                        // a remote publisher stopped
 *   });
 *   room.localStream; room.mute('audio', true); await room.switchCamera(); await room.leave();
 */
(function () {
  const offline = { configured: false, enabled: false };
  if (!SZ.server) {
    SZ.rtc = {
      status: async () => offline,
      async join() {
        throw new SZ.ApiError(0, 'rtc.notConfigured');
      },
    };
    return;
  }

  let statusTask = null;
  function status({ fresh = false } = {}) {
    if (!SZ.session.isLoggedIn) return Promise.resolve(offline);
    if (!statusTask || fresh) statusTask = SZ.api.get('rtc/status').catch(() => offline);
    return statusTask;
  }

  /** getUserMedia with the admin's quality cap; throws ApiError('rtc.noDevice' | 'rtc.denied'). */
  async function capture({ audio, video, facingMode = 'user' }) {
    if (!navigator.mediaDevices?.getUserMedia) throw new SZ.ApiError(0, 'rtc.noDevice');
    const height = Number(SZ.config('rtc.videoHeight', 720)) || 720;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
        video: video ? { facingMode, height: { ideal: height }, width: { ideal: Math.round((height * 16) / 9) } } : false,
      });
    } catch (e) {
      throw new SZ.ApiError(0, e?.name === 'NotAllowedError' ? 'rtc.denied' : 'rtc.noDevice');
    }
  }

  async function join(scope, opts = {}) {
    const { audio = false, video = false, stream: given = null, onTrack, onTrackEnded, facingMode = 'user' } = opts;
    const s = await SZ.api.post('rtc/sessions', { scope });
    const sessionId = s.sessionId;
    const pc = new RTCPeerConnection({ iceServers: s.iceServers || [], bundlePolicy: 'max-bundle' });
    const byMid = new Map(); // mid → publication
    const pulled = new Set(); // sessionId|trackName already subscribed
    let closed = false;
    let queue = Promise.resolve();
    const serial = fn => (queue = queue.then(fn, fn));

    pc.ontrack = e => {
      const pub = byMid.get(e.transceiver?.mid) || null;
      try {
        onTrack?.(e.track, pub, e.streams?.[0] || new MediaStream([e.track]));
      } catch (err) {
        console.error(err);
      }
    };

    // ---- publish
    let localStream = null;
    const senders = new Map(); // kind → RTCRtpSender
    if ((audio || video || given) && s.canPublish) {
      localStream = given || (await capture({ audio, video, facingMode }));
      await serial(async () => {
        const transceivers = localStream.getTracks().map(track => {
          const tr = pc.addTransceiver(track, { direction: 'sendonly', streams: [localStream] });
          senders.set(track.kind, tr.sender);
          return tr;
        });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const res = await SZ.api.post(`rtc/sessions/${encodeURIComponent(sessionId)}/tracks`, {
          sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
          tracks: transceivers.map(tr => ({
            location: 'local',
            mid: tr.mid,
            trackName: tr.sender.track.kind + '-' + Math.random().toString(36).slice(2, 8),
            kind: tr.sender.track.kind,
          })),
        });
        await pc.setRemoteDescription(res.sessionDescription);
        const kbps = Number(SZ.config('rtc.videoKbps', 1500)) || 1500;
        const vs = senders.get('video');
        if (vs) {
          const params = vs.getParameters();
          params.encodings = (params.encodings?.length ? params.encodings : [{}]).map(enc => ({ ...enc, maxBitrate: kbps * 1000 }));
          vs.setParameters(params).catch(() => {});
        }
      });
    }

    // ---- subscribe
    function subscribe(pubs) {
      const fresh = (pubs || []).filter(p => p.sessionId !== sessionId && !pulled.has(p.sessionId + '|' + p.trackName));
      if (!fresh.length || closed) return queue;
      for (const p of fresh) pulled.add(p.sessionId + '|' + p.trackName);
      return serial(async () => {
        if (closed) return;
        const res = await SZ.api.post(`rtc/sessions/${encodeURIComponent(sessionId)}/tracks`, {
          tracks: fresh.map(p => ({ location: 'remote', sessionId: p.sessionId, trackName: p.trackName })),
        });
        for (const tr of res.tracks || []) {
          const pub = fresh.find(p => p.trackName === tr.trackName && p.sessionId === tr.sessionId) || null;
          if (tr.mid) byMid.set(tr.mid, pub);
          if (tr.error) pulled.delete(tr.sessionId + '|' + tr.trackName);
        }
        if (res.requiresImmediateRenegotiation && res.sessionDescription) {
          await pc.setRemoteDescription(res.sessionDescription);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await SZ.api.put(`rtc/sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
            sessionDescription: { type: 'answer', sdp: pc.localDescription.sdp },
          });
        }
      }).catch(e => {
        for (const p of fresh) pulled.delete(p.sessionId + '|' + p.trackName);
        console.warn('rtc subscribe', e);
      });
    }

    const topic = 'rtc:' + scope;
    const offPub = SZ.realtime.on('rtc:pub', p => p?.scope === scope && subscribe([p]));
    const offUnpub = SZ.realtime.on('rtc:unpub', p => {
      if (p?.scope !== scope || p.sessionId === sessionId) return;
      pulled.delete(p.sessionId + '|' + p.trackName);
      try {
        onTrackEnded?.(p);
      } catch (err) {
        console.error(err);
      }
    });
    await SZ.realtime.join(topic);
    const existing = await SZ.api.get(`rtc/scopes/${encodeURIComponent(scope)}/tracks`).catch(() => []);
    subscribe(existing);

    async function leave() {
      if (closed) return;
      closed = true;
      offPub();
      offUnpub();
      localStream?.getTracks().forEach(t => t.stop());
      try {
        pc.close();
      } catch (_) {}
      SZ.realtime.leave(topic);
      await SZ.api.del(`rtc/sessions/${encodeURIComponent(sessionId)}`).catch(() => {});
    }

    return {
      sessionId,
      pc,
      get localStream() {
        return localStream;
      },
      canPublish: !!s.canPublish,
      subscribe,
      leave,
      /** mute('audio' | 'video', true/false) — keeps the connection, sends silence / black. */
      mute(kind, on) {
        localStream?.getTracks().filter(t => t.kind === kind).forEach(t => (t.enabled = !on));
      },
      /** Front ↔ back camera without renegotiating. */
      async switchCamera() {
        const sender = senders.get('video');
        if (!sender) return;
        const current = sender.track?.getSettings?.().facingMode || 'user';
        const next = await capture({ audio: false, video: true, facingMode: current === 'user' ? 'environment' : 'user' });
        const track = next.getVideoTracks()[0];
        const old = sender.track;
        await sender.replaceTrack(track);
        if (old) {
          localStream.removeTrack(old);
          old.stop();
        }
        localStream.addTrack(track);
      },
      get connectionState() {
        return pc.connectionState;
      },
    };
  }

  SZ.rtc = { status, join, capture };
})();
