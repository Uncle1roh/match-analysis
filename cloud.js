/* cloud.js — optional Supabase backing for the tagger and the finder.

   Local first, always. Nothing in here is required for either tool to work:
   with config.js blank, offline, or signed out, CLOUD.on is false and every
   call is a no-op the caller falls back from. That matters because the tagger
   gets used pitchside, where the connection is whatever it is.

   What it adds when it is switched on:
     · an email login (six-digit code, or the link in the same mail)
     · matches and clips saved to Postgres, scoped to the coach by RLS
     · the 617 training pages, one PDF each, out of a private bucket
*/
const CLOUD = (function () {
  const cfg = (typeof SUPABASE !== "undefined" && SUPABASE) || {};
  const configured = !!(cfg.url && cfg.anonKey);
  const lib = typeof globalThis.supabase !== "undefined" ? globalThis.supabase : null;

  let sb = null, user = null, resolveReady;
  const listeners = [];
  const ready = new Promise(r => { resolveReady = r; });
  const pageCache = new Map();          // page number -> {url, expires}
  const PAGE_TTL = 3000;                // seconds a signed page URL stays good

  if (configured && lib) {
    sb = lib.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.getSession().then(({ data }) => {
      user = data.session ? data.session.user : null;
      resolveReady(user);
      announce();
    }, () => resolveReady(null));
    sb.auth.onAuthStateChange((_e, session) => {
      user = session ? session.user : null;
      pageCache.clear();                // signed URLs die with the session
      announce();
    });
  } else {
    resolveReady(null);
  }

  function announce() {
    listeners.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
  }
  const need = () => { if (!sb) throw new Error("Cloud is not configured — fill in config.js"); };
  const pad = n => String(n).padStart(4, "0");
  /* postgrest-js and gotrue-js disagree about the field name; read both */
  const boom = e => { throw new Error((e && (e.message || e.error_description)) || String(e)); };

  return {
    get configured() { return configured; },
    get on() { return !!sb; },
    get user() { return user; },
    get email() { return user ? user.email : ""; },
    ready,                                   // resolves once a stored session is restored
    onChange(fn) { listeners.push(fn); return fn; },

    /* ------------------------------------------------------------ auth -- */
    async signIn(email) {
      need();
      const { error } = await sb.auth.signInWithOtp({
        email: String(email || "").trim(),
        options: { shouldCreateUser: true, emailRedirectTo: location.href.split("#")[0] }
      });
      if (error) boom(error);
    },
    /* The six-digit code out of the same email, for anyone who would rather
       not bounce through a link — and for browsers that eat the redirect. */
    async verify(email, token) {
      need();
      const { data, error } = await sb.auth.verifyOtp({
        email: String(email || "").trim(),
        token: String(token || "").trim(),
        type: "email"
      });
      if (error) boom(error);
      user = data.user; announce();
      return user;
    },
    async signOut() {
      need();
      await sb.auth.signOut();
      user = null; pageCache.clear(); announce();
    },

    /* --------------------------------------------------------- matches -- */
    async listMatches() {
      need();
      const { data, error } = await sb.from("matches")
        .select("id,us,them,played_on,video_name,updated_at,clips(count)")
        .order("updated_at", { ascending: false });
      if (error) boom(error);
      return (data || []).map(m => ({
        ...m, clips: (m.clips && m.clips[0] && m.clips[0].count) || 0
      }));
    },

    /* Writes the whole match in one go: the header row, then the clips as they
       stand. Clips carry no identity of their own in the tagger — they are a
       list the coach sorts and deletes freely — so the set is replaced rather
       than diffed. At a few hundred rows that is the cheap, honest sync. */
    async saveMatch(m) {
      need();
      if (!user) throw new Error("Sign in first");
      const head = {
        user_id: user.id,
        us: m.us || "", them: m.them || "", played_on: m.date || "",
        cam: m.cam || {}, train: m.train || {}, video_name: m.videoName || ""
      };
      let id = m.id;
      if (id) {
        const { error } = await sb.from("matches").update(head).eq("id", id);
        if (error) boom(error);
      } else {
        const { data, error } = await sb.from("matches").insert(head).select("id").single();
        if (error) boom(error);
        id = data.id;
      }
      const { error: wipe } = await sb.from("clips").delete().eq("match_id", id);
      if (wipe) boom(wipe);
      const rows = (m.clips || []).map(c => ({
        match_id: id, user_id: user.id,
        t: c.t, tagged: c.tagged, team: c.team, phase: c.phase, moment: c.moment,
        verdict: c.verdict, level: c.level || "", themes: c.themes || [],
        player: c.player || "", note: c.note || "", img: c.img || "",
        shapes: c.shapes || null, cam: c.cam || null
      }));
      for (let i = 0; i < rows.length; i += 250) {       // stay inside the request limit
        const { error } = await sb.from("clips").insert(rows.slice(i, i + 250));
        if (error) boom(error);
      }
      return id;
    },

    async loadMatch(id) {
      need();
      const { data: m, error } = await sb.from("matches").select("*").eq("id", id).single();
      if (error) boom(error);
      const { data: clips, error: ce } = await sb.from("clips")
        .select("*").eq("match_id", id).order("t");
      if (ce) boom(ce);
      return {
        id: m.id, us: m.us, them: m.them, date: m.played_on,
        cam: m.cam || {}, train: m.train || {}, videoName: m.video_name || "",
        clips: (clips || []).map(c => ({
          t: c.t, tagged: c.tagged, team: c.team, phase: c.phase, moment: c.moment,
          verdict: c.verdict, level: c.level || "", themes: c.themes || [],
          player: c.player || "", note: c.note || "", img: c.img || "",
          shapes: c.shapes || null, cam: c.cam || undefined
        }))
      };
    },

    async deleteMatch(id) {
      need();
      const { error } = await sb.from("matches").delete().eq("id", id);   // clips cascade
      if (error) boom(error);
    },

    /* --------------------------------------------------- training pages -- */
    /* One signed URL per session page, cached until shortly before it lapses.
       Returns null whenever the cloud cannot serve it, so the caller falls back
       to a local PDF without having to know why. */
    async pageUrl(n) {
      if (!sb || !user) return null;
      const hit = pageCache.get(n);
      if (hit && hit.expires > Date.now()) return hit.url;
      const { data, error } = await sb.storage.from("training-pages")
        .createSignedUrl(pad(n) + ".pdf", PAGE_TTL);
      if (error || !data) return null;
      pageCache.set(n, { url: data.signedUrl, expires: Date.now() + (PAGE_TTL - 120) * 1000 });
      return data.signedUrl;
    }
  };
})();
