/* A pass/fail tally. Kept apart from harness.mjs so the browser suite does not
   have to pull jsdom in just to print a line. */
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
