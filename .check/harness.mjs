/* Shared test rig: load a page under jsdom with its local scripts inlined,
   the video element driveable, and (optionally) a fake Supabase in place of
   the CDN library. Nothing here touches the network. */
import fs from 'fs';
import { JSDOM } from 'jsdom';

/* ---------------------------------------------------------------- assert -- */
export function reporter() {
  const r = { ok: 0, bad: 0 };
  r.is = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    pass ? r.ok++ : r.bad++;
    console.log((pass ? 'PASS ' : 'FAIL ') + label + (pass ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  };
  r.okay = (label, cond, extra = '') => {
    cond ? r.ok++ : r.bad++;
    console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : '  ' + extra));
  };
  r.done = () => { console.log(`\n${r.ok} passed, ${r.bad} failed`); process.exit(r.bad ? 1 : 0); };
  return r;
}

/* ------------------------------------------------------- a fake Supabase -- */
/* Enough of the client for the two tools: OTP auth, the four table verbs the
   cloud layer uses, and a signed-URL stub. In memory, synchronous, no network. */
export function fakeSupabase() {
  const db = { matches: [], clips: [] };
  const state = { user: null, sentTo: null, code: '123456', signedFor: [] };
  const uuid = () => 'id-' + (uuid.n = (uuid.n || 0) + 1);
  const cbs = [];
  const fire = () => cbs.forEach(cb => cb(state.user ? 'SIGNED_IN' : 'SIGNED_OUT',
    state.user ? { user: state.user } : null));

  function table(name) {
    const f = [];
    let op = 'select', payload = null, wantSingle = false, sel = '';
    const match = row => f.every(([c, v]) => row[c] === v);
    function run() {
      const all = db[name];
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload])
          .map(r => ({ id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
        all.push(...rows);
        return { data: wantSingle ? rows[0] : rows, error: null };
      }
      if (op === 'update') {
        const hit = all.filter(match);
        hit.forEach(r => Object.assign(r, payload, { updated_at: new Date().toISOString() }));
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        const keep = all.filter(r => !match(r));
        const gone = all.filter(match);
        if (name === 'matches') gone.forEach(m => { db.clips = db.clips.filter(c => c.match_id !== m.id); });
        db[name] = keep;
        return { data: gone, error: null };
      }
      let rows = all.filter(match).map(r => ({ ...r }));
      if (name === 'matches' && /clips\(count\)/.test(sel)) {
        rows = rows.map(m => ({ ...m, clips: [{ count: db.clips.filter(c => c.match_id === m.id).length }] }));
      }
      if (wantSingle) {
        return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
      }
      return { data: rows, error: null };
    }
    const q = {
      select(s) { sel = s || ''; if (op === 'select') op = 'select'; return q; },
      insert(v) { op = 'insert'; payload = v; return q; },
      update(v) { op = 'update'; payload = v; return q; },
      delete() { op = 'delete'; return q; },
      eq(c, v) { f.push([c, v]); return q; },
      order() { return q; },
      single() { wantSingle = true; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    return q;
  }

  const client = {
    auth: {
      async getSession() { return { data: { session: state.user ? { user: state.user } : null } }; },
      onAuthStateChange(cb) { cbs.push(cb); return { data: { subscription: { unsubscribe() { } } } }; },
      async signInWithOtp({ email }) { state.sentTo = email; return { error: null }; },
      async verifyOtp({ email, token }) {
        if (token !== state.code) return { data: {}, error: { message: 'Token has expired or is invalid' } };
        state.user = { id: 'user-1', email };
        fire();
        return { data: { user: state.user }, error: null };
      },
      async signOut() { state.user = null; fire(); return { error: null }; }
    },
    from: table,
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path) {
            if (!state.user) return { data: null, error: { message: 'not signed in' } };
            state.signedFor.push(path);
            return { data: { signedUrl: `https://fake.supabase.co/storage/${bucket}/${path}?token=sig` }, error: null };
          }
        };
      }
    }
  };
  return { lib: { createClient: () => client }, db, state };
}

/* ------------------------------------------------------------ page loader -- */
export function loadPage(file, opts = {}) {
  let html = fs.readFileSync(file, 'utf8');
  /* inline every local script; drop the CDN one (stubbed below when wanted) */
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    /^https?:/.test(src) ? '' : '<script>' + fs.readFileSync(src, 'utf8') + '</' + 'script>');
  /* config.js on disk points at the real project. A test must not change
     meaning because of that, so a blank config is the default here and each
     suite opts in to a live-looking one explicitly. */
  const cfg = opts.config || { url: '', anonKey: '' };
  html = html.replace(/const SUPABASE = \{[\s\S]*?\};/,
    'const SUPABASE = ' + JSON.stringify(cfg) + ';');

  const stubCtx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : () => { }) });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: opts.url || 'http://localhost/' + file,
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => stubCtx;
      win.ResizeObserver = class { observe() { } };
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => { };
      win.confirm = () => true;
      let paused = true, time = 0;
      Object.defineProperty(win.HTMLMediaElement.prototype, 'paused', { get() { return paused; } });
      Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', {
        get() { return time; },
        set(x) { time = x; this.dispatchEvent(new win.Event('seeked')); }
      });
      Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', { get() { return 600; } });
      win.HTMLMediaElement.prototype.play = function () { paused = false; this.dispatchEvent(new win.Event('play')); };
      win.HTMLMediaElement.prototype.pause = function () { paused = true; this.dispatchEvent(new win.Event('pause')); };
      if (opts.supabase) win.supabase = opts.supabase;
    }
  });
  const w = dom.window;
  return { dom, w, d: w.document, $: id => w.document.getElementById(id), E: s => w.eval(s) };
}

/* let queued promises settle */
export const settle = (n = 4) => new Promise(r => {
  let i = 0;
  const tick = () => (++i >= n ? r() : setTimeout(tick, 0));
  tick();
});
