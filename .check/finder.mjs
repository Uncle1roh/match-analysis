import { reporter, loadPage, settle } from './harness.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const { w, d, $, E } = loadPage('finder.html');

is('index intact after the split', E('S.length'), 617);
okay('the bundled PDF is live from the start', /Training Tasks\.pdf/.test($('pdfname').textContent), $('pdfname').textContent);
is('no picking needed', E('pdfURL'), 'Training%20Tasks.pdf');
E('openPage(7)'); await settle();
okay('a page opens straight into the sheet', !$('modal').hidden && /Training%20Tasks\.pdf#page=7/.test($('mframe').src), $('mframe').src);
E('closePage()');

okay('chips built from the shared vocabulary', d.querySelectorAll('#c-theme .chip').length === 20);
okay('set pieces is now a phase you can pick', !!d.querySelector('#c-phase .chip[data-v="set-pieces"]'));
okay('PER and SMS levels reachable', !!d.querySelector('#c-level .chip[data-v="PER"]') && !!d.querySelector('#c-level .chip[data-v="SMS"]'));

/* the tagger's deep link must land on a filtered finder */
const link = 'http://localhost/finder.html#m=progression&p=defensive&t=pressing%2Ccompactness&l=LGF&d=MD-2';
const two = loadPage('finder.html', { url: link });
const w2 = two.w, E2 = two.E;
is('deep link restores the moment', E2('[...sel.moment]'), ['progression']);
is('deep link restores the themes', E2('[...sel.theme]'), ['pressing', 'compactness']);
is('deep link restores the level', E2('[...sel.level]'), ['LGF']);
is('deep link restores the day', E2('sel.md'), 'MD-2');
okay('and it actually lists sessions', w2.document.querySelectorAll('#out .card').length > 0,
     w2.document.getElementById('count').textContent);
okay('scored identically to the tagger',
     E2('rankSessions({moments:sel.moment,phases:sel.phase,themes:sel.theme,levels:sel.level,md:sel.md})[0].s.page')
     === E2('rankSessions({moments:["progression"],phases:["defensive"],themes:["pressing","compactness"],levels:["LGF"],md:"MD-2"})[0].s.page'));

r.done();
