// Contrast ratios for every foreground/ground pair the APP uses, in both modes.
// The landing page has its own table in design/contrast-audit.md; this file
// covers the pairs that one never measured -- badge tones, the rail's active
// row, and the tinted pills.
//
// Run: node design/app-contrast.mjs
// Exits non-zero if any UNEXPECTED pair falls below its threshold, so it can
// gate CI. Pairs listed in KNOWN_FAILURES below are reported as KNOWN, not
// FAIL, and do not affect the exit code -- see that constant's comment.
//
// Two things this script could NOT express until 2026-08-10, and the reason it
// reported "All pairs pass" on the day ruling 1 shipped two real defects:
//
//   1. Every pair was a foreground against a ground, so a token used as a
//      FILL had no way of being measured as one. `--input` moved to a
//      control-boundary value while `switch.jsx` was using it as a track fill,
//      and nothing here could see it. Pairs now carry a ROLE, so a fill is
//      reported as a fill and the reader can tell which layer is measured.
//   2. Grounds came from an app-only table, so a token shared with the
//      marketing page was only ever checked on one of its two surfaces. The
//      landing grounds -- `ground-inverse` above all, which does not invert
//      between modes -- are now present.
//
// The lesson generalises: when a token changes, the question is not "does its
// intended pair still pass" but "what else reads this token, and as what".
const T = {
  Light: {
    paper: [250,250,249], card: [255,255,255], muted: [245,245,244], ink: [28,25,23],
    'muted-fg': [113,106,102], border: [231,229,228],
    indigo: [61,93,219], 'indigo-tint': [235,240,255], link: [61,93,219], 'on-primary': [255,255,255],
    clay: [228,123,78], 'clay-tint': [251,235,228],
    verdigris: [57,117,127], 'verdigris-tint': [233,241,242],
    success: [26,153,72], warning: [200,144,4], destructive: [202,43,43],
    'indigo-ink': [61,93,219], 'success-ink': [4,120,87],
    'destructive-ink': [185,28,28], 'warning-ink': [146,64,14],
    'success-tint': [236,253,245], 'destructive-tint': [254,242,242], 'warning-tint': [255,251,235],
    // --input (globals.css). No longer the same value as --border: ruled
    // 2026-08-10, because a form field's edge is not a decorative divider.
    // It is the boundary token for EVERY control edge -- fields, the outline
    // button, the suggestion chips and the switch track all read it, so a
    // pass here is a pass for all of them on the same ground.
    'input-border': [152,143,139],
    // Switch track, off. `muted-foreground/25` composited over its ground --
    // computed by hand because this script has no alpha model and does not
    // need one for a single pair. NOT --input: see switch.jsx for why the
    // track stopped reading a boundary token.
    'switch-off': [220,218,217],
    'switch-off-on-muted': [212,210,209],
    // The marketing page's dark break section. It does NOT invert between
    // modes, which is exactly why it belongs in both tables rather than being
    // assumed to follow the mode.
    'ground-inverse': [28,25,23],
    'on-inverse': [245,245,244],
  },
  Dark: {
    paper: [18,18,17], card: [26,26,25], muted: [36,36,35], ink: [245,245,244],
    'muted-fg': [168,162,159], border: [42,42,40],
    indigo: [67,103,249], 'indigo-tint': [28,26,45], link: [97,127,250], 'on-primary': [255,255,255],
    clay: [222,133,94], 'clay-tint': [60,40,32],
    verdigris: [77,165,178], 'verdigris-tint': [28,46,48],
    success: [51,204,107], warning: [244,185,37], destructive: [225,51,51],
    'indigo-ink': [165,180,252], 'success-ink': [110,231,183],
    'destructive-ink': [252,165,165], 'warning-ink': [252,211,77],
    'success-tint': [16,33,29], 'destructive-tint': [43,20,19], 'warning-tint': [43,26,16],
    'input-border': [104,104,100],
    'switch-off': [62,60,59],
    'switch-off-on-muted': [69,68,66],
    'ground-inverse': [39,35,33],
    'on-inverse': [245,245,244],
  },
};

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// [label, foreground token, ground token, threshold, role, context]
//
// ROLE says which layer is being measured -- 'text', 'boundary', 'fill' or
// 'state' -- so a token used two ways is reported twice and read correctly
// both times. It is the field whose absence hid the switch defect.
//
// THRESHOLD may be `null`, meaning "report, do not enforce". That is for
// numbers worth watching which no success criterion actually governs: a track
// fill's contrast against the card behind it is a design judgement, not a
// requirement, and inventing a threshold for it would either fail the build
// for no reason or teach the reader that the column is decorative.
const PAIRS = [
  ['ink / paper',            'ink', 'paper', 4.5, 'text', 'body and headings'],
  ['ink / card',             'ink', 'card', 4.5, 'text', 'text in cards'],
  ['muted-fg / paper',       'muted-fg', 'paper', 4.5, 'text', 'sub copy'],
  ['muted-fg / card',        'muted-fg', 'card', 4.5, 'text', 'helper text, counts'],
  ['muted-fg / muted',       'muted-fg', 'muted', 4.5, 'text', 'segmented control, inactive'],
  ['link / paper',           'link', 'paper', 4.5, 'text', 'Ghost buttons, text links'],
  ['link / card',            'link', 'card', 4.5, 'text', 'Tabs active, RailSubItem current'],
  ['link / indigo-tint',     'link', 'indigo-tint', 4.5, 'text', 'RailItem active row'],
  ['on-primary / indigo',    'on-primary', 'indigo', 4.5, 'text', 'Primary button label'],
  ['ink / muted',            'ink', 'muted', 4.5, 'text', 'Badge Neutral'],
  ['indigo-ink / indigo-tint','indigo-ink', 'indigo-tint', 4.5, 'text', 'Badge Primary'],
  ['success-ink / success-tint','success-ink','success-tint', 4.5, 'text', 'Badge Positive'],
  ['destructive-ink / destructive-tint','destructive-ink','destructive-tint', 4.5, 'text', 'Badge Critical'],
  ['warning-ink / warning-tint','warning-ink','warning-tint', 4.5, 'text', 'Badge Warning'],
  ['verdigris / verdigris-tint','verdigris','verdigris-tint', 4.5, 'text', 'Badge Live'],
  ['muted-fg / clay-tint',   'muted-fg', 'clay-tint', 4.5, 'text', 'delegate offer sub copy'],
  ['ink / clay-tint',        'ink', 'clay-tint', 4.5, 'text', 'delegate offer heading'],

  // Control boundaries. One token, so one pass here covers every control that
  // reads it on that ground -- fields, Button variant="outline", the
  // suggestion chips and the switch track. Both grounds are measured because
  // the app puts controls on cards AND on the page itself.
  ['input border / card',    'input-border', 'card', 3.0, 'boundary', 'field, outline button, chip, switch track'],
  ['input border / paper',   'input-border', 'paper', 3.0, 'boundary', 'the same edges, on the page ground'],

  // The Switch, which is why this script grew a role column. Its state is
  // carried by THUMB POSITION, not by colour; the two rows below are the
  // colour that reinforces it.
  ['switch off / switch on', 'switch-off', 'indigo', 3.0, 'state', 'Switch off vs on track'],
  ['switch off / card',      'switch-off', 'card', null, 'fill', 'off track on a card -- watched, not required'],
  ['switch off / muted',     'switch-off-on-muted', 'muted', null, 'fill', 'off track on a muted card'],
  ['switch thumb / off track','on-primary', 'switch-off', null, 'fill', 'white thumb; reads by shadow and ring'],

  // The marketing surface, present so that a token shared between the two
  // pages can never again be checked on only one of them.
  ['on-inverse / ground-inverse','on-inverse','ground-inverse', 4.5, 'text', 'landing dark break section'],
];

// KNOWN_FAILURES is NOT a way to silence a real problem -- it is a small,
// named, reasoned exemption list for pairs that fail today, on purpose,
// pending an owner decision that is out of this script's scope. A pair only
// belongs here if: (1) it genuinely fails the threshold, (2) fixing the token
// would have a blast radius wider than this file (e.g. every input border in
// both the shipping app and the prototype), and (3) someone has written down
// why it isn't being fixed right now. Anyone adding an entry without a real
// reason string, or reaching for this to make an unrelated failure go away,
// is misusing it -- the whole point of this calculator is that failures are
// visible, not that they can be made to disappear.
const KNOWN_FAILURES = new Map([
  // It held `input border / card` until 2026-08-10, when the owner ruled the
  // token should move rather than the exemption stand: --input went to the
  // minimum lightness that clears 3:1 (20 6% 57% Light, 60 2% 40% Dark).
  // --border did NOT move with it -- a decorative divider is exempt, a control
  // boundary is not, and the two tokens now differ in value because they differ
  // in job.
  ['switch off / switch on',
    'Dark measures 2.38 between the off and on tracks. Accepted, and not ' +
    'fixed by darkening either: a switch conveys its state by THUMB POSITION, ' +
    'which is not a colour signal, reinforced by the 3.16/3.11 boundary ring ' +
    'the same change added. Light clears at 3.98. Making the two tracks 3:1 ' +
    'apart in Dark would mean either a heavier off state -- the exact defect ' +
    'this round fixed -- or moving `indigo`, which every Primary button reads. ' +
    'Ruled 2026-08-10; see the Switch table in ' +
    'docs/superpowers/specs/2026-08-10-app-redesign-phase-2-design.md.'],
]);

let failed = 0;
const known = [];
const missing = [];
const rows = PAIRS.map(([name, fg, bg, need, role, ctx]) => {
  // A typo in a token name used to read as `undefined` and throw inside
  // ratio(); saying so plainly beats a stack trace.
  for (const [mode, tok] of [['Light', fg], ['Light', bg], ['Dark', fg], ['Dark', bg]]) {
    if (!T[mode][tok]) missing.push(`${name}: no '${tok}' in ${mode}`);
  }
  if (!T.Light[fg] || !T.Light[bg] || !T.Dark[fg] || !T.Dark[bg]) {
    return `| ${name} | ${ctx} | ${role} | ? | ? | ? |`;
  }
  const l = ratio(T.Light[fg], T.Light[bg]);
  const d = ratio(T.Dark[fg], T.Dark[bg]);
  // need === null means "report, do not enforce" -- nothing can fail it.
  const belowThreshold = need !== null && (l < need || d < need);
  const isKnown = belowThreshold && KNOWN_FAILURES.has(name);
  if (belowThreshold && !isKnown) failed++;
  if (isKnown) known.push(name);
  const f = (v) =>
    `${v.toFixed(2)}${need !== null && v < need ? (isKnown ? ' KNOWN' : ' FAIL') : ''}`;
  return `| ${name} | ${ctx} | ${role} | ${need === null ? '--' : need} | ${f(l)} | ${f(d)} |`;
});
console.log('| Pair | Context | Role | Need | Light | Dark |');
console.log('|---|---|---|---|---|---|');
console.log(rows.join('\n'));
if (known.length) {
  console.log('\nKnown, accepted-and-tracked failures (not passing -- see reasons below):');
  for (const name of known) console.log(`- ${name}: ${KNOWN_FAILURES.get(name)}`);
}
if (missing.length) {
  console.error('\nUnknown token(s) referenced by a pair:');
  for (const m of missing) console.error(`- ${m}`);
  process.exit(1);
}
if (failed) { console.error(`\n${failed} unexpected pair(s) below threshold.`); process.exit(1); }
console.log('\nRows with need `--` are reported, not enforced: no success');
console.log('criterion governs them, and inventing one would be dishonest.');
// Only hedge when there is something to hedge about: an empty exemption list
// means every pair genuinely passes, and saying otherwise trains the reader to
// skim the last line.
console.log(known.length
  ? '\nAll pairs pass (or are known, accepted, and tracked -- see above).'
  : '\nAll pairs pass.');
