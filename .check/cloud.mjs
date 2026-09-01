/* The cloud paths, against an in-memory fake Supabase.

   Two things matter here and they pull against each other: that signing in
   really does move storage and page-serving to the cloud, and that none of it
   is load-bearing — with a blank config both tools must behave exactly as the
   local-only versions did. */
import { reporter, loadPage, fakeSupabase, settle } from './harness.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const CFG = { url: 'https://fake.supabase.co', anonKey: 'anon-key' };

/* ============================ 1. cloud configured but nobody signed in ==== */
{
  const fake = fakeSupabase();
  const { w, d, $, E } = loadPage('tagger.html', { config: CFG, supabase: fake.lib });
  await settle();

  is('the client is built when configured', E('CLOUD.on'), true);
  is('but nobody is signed in yet', E('CLOUD.user'), null);
  is('the header button says so', $('cloudbtn').textContent, 'Cloud');

  /* a page must still come from the local PDF while signed out */
  E('v.src="blob:fake";openPage(42)'); await settle();
  okay('signed out, pages still come off the local PDF',
    /Training%20Tasks\.pdf#page=42/.test($('mframe').src), $('mframe').src);
  is('nothing was signed for', fake.state.signedFor.length, 0);

  /* tagging works with no account at all */
  E('$("drop").style.display="none";v.currentTime=90;setCtx("moment","finishing");tag();');
  is('tagging needs no account', E('clips.length'), 1);
  is('and nothing was written to the cloud', fake.db.matches.length, 0);
}

/* ============================ 2. signing in, saving, reopening ============ */
{
  const fake = fakeSupabase();
  const { w, d, $, E } = loadPage('tagger.html', { config: CFG, supabase: fake.lib });
  await settle();

  /* the sign-in form is what the sheet offers first */
  E('openCloud()'); await settle();
  okay('the sheet asks for an email', !!$('cmail'), $('cbody').textContent.slice(0, 60));

  $('cmail').value = 'coach@club.com';
  E('sendCode()'); await settle();
  is('a code was sent to that address', fake.state.sentTo, 'coach@club.com');

  $('ccode').value = '000000';
  E('useCode()'); await settle();
  is('a wrong code does not sign you in', E('CLOUD.user'), null);
  okay('and it says why', /did not work/.test($('csaid').textContent), $('csaid').textContent);

  $('ccode').value = '123456';
  E('useCode()'); await settle();
  is('the right code signs you in', E('CLOUD.email'), 'coach@club.com');
  is('the header button reflects it', $('cloudbtn').textContent, 'Cloud ✓');

  /* tag a couple of moments, drawing on one of them */
  E('v.src="blob:fake";$("drop").style.display="none";videoName="derby-h1.mp4";');
  E('$("m-us").value="Rovers";$("m-them").value="City";$("m-date").value="2026-08-30";');
  E('v.currentTime=120;markShapeTime();shapes.push({k:"ring",c:"#fff",x:.5,y:.6,r:1});');
  E('setCtx("moment","progression");setCtx("phase","defensive");setCtx("verdict","bad");');
  E('document.querySelectorAll(".chip.th").forEach(b=>{if(b.dataset.t==="pressing")b.setAttribute("aria-pressed","true")});');
  E('$("level").value="LGF";ctx.level="LGF";tag();');
  E('v.pause();v.currentTime=300;setCtx("moment","finishing");tag();');
  is('two clips locally', E('clips.length'), 2);

  E('saveToCloud()'); await settle();
  is('one match row written', fake.db.matches.length, 1);
  is('both clips written', fake.db.clips.length, 2);
  const m = fake.db.matches[0];
  is('the match carries the teams', [m.us, m.them, m.played_on], ['Rovers', 'City', '2026-08-30']);
  is('and the video it was cut against', m.video_name, 'derby-h1.mp4');
  is('every row is stamped with the owner', fake.db.clips.every(c => c.user_id === 'user-1'), true);
  const drawn = fake.db.clips.find(c => c.shapes);
  okay('the drawing travelled with its clip', !!drawn && drawn.shapes.length === 1);
  is('so did the level', drawn.level, 'LGF');
  is('and the themes, as an array', drawn.themes, ['pressing']);

  /* saving again must not duplicate the match or leave orphan clips */
  E('saveToCloud()'); await settle();
  is('saving twice keeps one match', fake.db.matches.length, 1);
  is('and does not duplicate clips', fake.db.clips.length, 2);

  /* autosave: another tag should push without being asked */
  E('v.currentTime=400;tag();');
  await new Promise(res => setTimeout(res, 2700));
  await settle();
  is('a later tag syncs on its own', fake.db.clips.length, 3);
  okay('and the header says when', /saved/.test($('sync').textContent), $('sync').textContent);

  /* reopening from the cloud restores everything */
  const id = fake.db.matches[0].id;
  E('clips=[];active=-1;$("m-us").value="";cloudId=null;renderPanel();');
  E(`openFromCloud('${id}')`); await settle();
  is('three clips came back', E('clips.length'), 3);
  is('with the team names', E('$("m-us").value'), 'Rovers');
  is('the level survived the round trip', E('clips.find(c=>c.level).level'), 'LGF');
  is('the drawing survived too', E('clips.filter(c=>c.shapes).length'), 1);
  okay('and the status names the video to load', /derby-h1\.mp4/.test($('status').textContent), $('status').textContent);
  is('a reopened clip still finds sessions', E('rankSessions(clipQuery(clips[0])).length > 0'), true);

  /* pages now come from the bank, one at a time */
  E('openPage(42)'); await settle();
  is('the page was signed for', fake.state.signedFor, ['0042.pdf']);
  okay('and the sheet points at it', /storage\/training-pages\/0042\.pdf/.test($('mframe').src), $('mframe').src);
  okay('the footer says only that page came down', /on its own/.test($('mfoot').textContent), $('mfoot').textContent);

  /* the match list */
  E('openCloud()'); await settle();
  okay('the saved match is listed', /Rovers vs City/.test($('mlist').innerHTML));
  okay('with its clip count', /3 clips/.test($('mlist').innerHTML), $('mlist').textContent.slice(0, 90));

  /* deleting takes the clips with it */
  E(`dropFromCloud('${id}','Rovers vs City')`); await settle();
  is('match gone', fake.db.matches.length, 0);
  is('clips cascaded', fake.db.clips.length, 0);

  /* signing out puts everything back to local */
  E('leaveCloud()'); await settle();
  is('signed out', E('CLOUD.user'), null);
  E('openPage(7)'); await settle();
  okay('and pages fall back to the local PDF again',
    /Training%20Tasks\.pdf#page=7/.test($('mframe').src), $('mframe').src);
}

/* ============================ 3. the finder, signed in =================== */
{
  const fake = fakeSupabase();
  const { w, d, $, E } = loadPage('finder.html', { config: CFG, supabase: fake.lib });
  await settle();

  okay('the finder offers a sign-in when configured', !$('signbtn').hidden, 'button hidden');
  is('and labels it plainly', $('signbtn').textContent, 'Sign in for the session bank');

  E('cloudSign()'); await settle();
  $('smail').value = 'coach@club.com';
  E('sendCode()'); await settle();
  $('scode').value = '123456';
  E('useCode()'); await settle();
  is('signed in', E('CLOUD.email'), 'coach@club.com');
  is('the sheet closed itself', $('signmodal').hidden, true);
  okay('the bar now says where pages come from', /pages come from the bank/.test($('pdfname').textContent), $('pdfname').textContent);

  E('openPage(311)'); await settle();
  is('the finder signs for its page too', fake.state.signedFor, ['0311.pdf']);
}

/* ============================ 4. an auth redirect is not a filter ======== */
{
  const back = 'http://localhost/finder.html#access_token=abc&refresh_token=def&type=magiclink';
  const { E } = loadPage('finder.html', { config: CFG, supabase: fakeSupabase().lib, url: back });
  await settle();
  is('tokens in the hash are not read as a search', E('[...sel.moment].length + [...sel.theme].length'), 0);
}

/* ============================ 5. blank config changes nothing ============ */
{
  const { $, E } = loadPage('tagger.html');          // harness default: a blank config
  await settle();
  is('no config, no client', E('CLOUD.on'), false);
  is('the tools do not pretend otherwise', E('CLOUD.configured'), false);
  E('openCloud()'); await settle();
  okay('the sheet explains rather than breaking', /Not set up|nothing is configured/i.test($('cbody').textContent),
    $('cbody').textContent.slice(0, 80));
  E('v.src="blob:fake";$("drop").style.display="none";v.currentTime=10;tag();');
  is('and tagging is untouched', E('clips.length'), 1);
}

r.done();
