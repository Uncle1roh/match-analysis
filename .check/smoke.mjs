import { reporter, loadPage, settle } from './harness.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const { w, d, $, E } = loadPage('tagger.html');

is('617 sessions in scope', E('S.length'), 617);
is('themes shared with the finder', E('THEMES.length'), 20);
is('theme chips rendered from the shared list', d.querySelectorAll('.chip.th').length, 20);
is('chips wear the finder labels', d.querySelector('.chip.th[data-t=pressing]').textContent, 'Pressing / recovering');
is('level select filled from LEVELS', $('level').options.length, E('LEVELS.length') + 1);
is('microcycle select filled', $('tmd').options.length, 6);

E('v.src="blob:fake";$("drop").style.display="none";$("rail").hidden=false;');

/* --- draw on a paused frame --- */
E('v.currentTime=120');
E('setTool("ring")');
E('markShapeTime();shapes.push({k:"ring",c:"#fff",x:.5,y:.6,r:1});draw();');
is('drawing anchored to the paused second', E('shapeTime'), 120);
is('drawing held while paused', E('shapes.length'), 1);

/* --- tag it --- */
E('setCtx("moment","progression");setCtx("phase","defensive");setCtx("team","them");setCtx("verdict","bad");');
E('document.querySelectorAll(".chip.th").forEach(b=>{if(b.dataset.t==="pressing"||b.dataset.t==="compactness")b.setAttribute("aria-pressed","true")});');
$('level').value = 'LGF'; $('level').dispatchEvent(new w.Event('change'));
E('tag()');
is('one clip recorded', E('clips.length'), 1);
is('clip carries the level', E('clips[0].level'), 'LGF');
is('clip carries both themes', E('clips[0].themes'), ['pressing', 'compactness']);
is('the drawing was saved onto the clip', E('clips[0].shapes.length'), 1);
okay('the tag answers with a session on the spot', !$('answer').hidden && /trains/.test($('answer').textContent) && /Open p[.][0-9]+/.test($('answer').textContent), $('answer').textContent);
is('tagging leaves the panel where it was', E('tab'), 'clips');
E('setTab("sessions")');
okay('sessions listed for the tag', d.querySelectorAll('.ses').length > 0, d.querySelectorAll('.ses').length + ' cards');
okay('a page button per session', /Open p\.\d+/.test($('panel').innerHTML));
okay('count shown in the context bar', /found/.test($('sescount').textContent), $('sescount').textContent);
okay('deep link back to the finder', /finder\.html#.*t=pressing%2Ccompactness/.test($('panel').innerHTML),
     ($('panel').innerHTML.match(/finder\.html#[^"]*/) || [''])[0]);
okay('status confirms the tag', /^tagged /.test($('status').textContent), $('status').textContent);

/* --- resuming must wipe the overlay --- */
E('v.play()');
is('play clears the drawing', E('shapes.length'), 0);
is('and forgets its frame', E('shapeTime'), null);
is('nothing renders while playing', E(`(()=>{let n=0;const old=render;render=()=>n++;shapes=[{k:"ring",c:"#fff",x:.5,y:.5,r:1}];draw();render=old;shapes=[];return n;})()`), 0);
okay('the coach is told why it vanished', /only on the frame/.test($('tip').textContent), $('tip').textContent);

/* --- recall puts it back on its own frame --- */
E('v.pause();recall(0)');
is('recall restores the drawing', E('shapes.length'), 1);
is('recall re-anchors the frame', E('shapeTime'), E('clips[0].tagged'));
is('recall restores the level', $('level').value, 'LGF');

E('v.currentTime=200');
is('seeking off the frame clears it', E('shapes.length'), 0);

/* --- training context filters the shortlist --- */
E('recall(0)');
const wide = d.querySelectorAll('.ses').length;
$('tsq').value = '8'; $('tsq').dispatchEvent(new w.Event('input'));
$('tmd').value = 'MD-2'; $('tmd').dispatchEvent(new w.Event('change'));
okay('the shortlist survives the squad/day filter', d.querySelectorAll('.ses').length > 0);
okay('squad cap applied', E('rankSessions(clipQuery(clips[0])).every(r=>!r.s.players||r.s.players<=8)'));
okay('day now ranks first', E('rankSessions(clipQuery(clips[0]))[0].s.md.includes("MD-2")'),
     E('JSON.stringify(rankSessions(clipQuery(clips[0]))[0].s.md)'));

/* --- the PDF page opens in place --- */
E('openPage(42)'); await settle();
okay('page sheet opens on the bundled PDF', !$('modal').hidden && /Training%20Tasks\.pdf#page=42/.test($('mframe').src), $('mframe').src);
E('closePage()');
is('sheet closes', $('modal').hidden, true);

/* --- export carries the correlation --- */
E('dl=(n,t)=>{window.__md=t;}');
E('$("tsq").value="";train.players="";clips.push({...clips[0],t:clips[0].t+30},{...clips[0],t:clips[0].t+60});renderPanel();exportMd();');
const md = w.__md;
okay('export names real sessions for the pattern', /\(p\.\d+\)/.test(md));
okay('export has a Level column', /\| Clip \| Who \| Phase \| Moment \| Level \|/.test(md));
okay('clip rows carry the level', /\| LGF \|/.test(md));
console.log('\n--- exported findings block ---');
console.log(md.split('## Findings')[1].split('Take each row')[0].trim());


/* --- save / load round trip --- */
E('window.__saved=null;dl=(n,t)=>{window.__saved=t;};saveWork();');
const saved = JSON.parse(w.__saved);
is('save keeps the level', saved.clips[0].level, 'LGF');
is('save keeps the training context', saved.train, { md: 'MD-2', players: '' });
E('clips=[];train.md="";train.players="";active=-1;$("tmd").value="";renderPanel();');
w.__load = saved;
E('(()=>{const d=window.__load;clips=d.clips;Object.assign(train,d.train);$("tmd").value=train.md||"";active=-1;renderPanel();})()');
is('load restores the level', E('clips[0].level'), 'LGF');
is('load restores the day', E('train.md'), 'MD-2');
is('and the reloaded clip still finds sessions', E('rankSessions(clipQuery(clips[0])).length > 0'), true);

/* --- deleting every clip clears the answer strip --- */
E('while(clips.length)del(0);');
is('no clips left', E('clips.length'), 0);
is('answer strip hidden again', $('answer').hidden, true);

r.done();
