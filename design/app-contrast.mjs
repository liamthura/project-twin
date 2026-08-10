// Contrast ratios for every foreground/ground pair the APP uses, in both modes.
// The landing page has its own table in design/contrast-audit.md; this file
// covers the pairs that one never measured -- badge tones, the rail's active
// row, and the tinted pills.
//
// Run: node design/app-contrast.mjs
// Exits non-zero if any UNEXPECTED pair falls below its threshold, so it can
// gate CI. Pairs listed in KNOWN_FAILURES below are reported as KNOWN, not
// FAIL, and do not affect the exit code -- see that constant's comment.
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
    // --input (globals.css) is the same value as --border. Named separately
    // here, not because the colour differs, but because the USE differs: a
    // form field's edge is not a decorative divider (see the input-border pair
    // in KNOWN_FAILURES below).
    'input-border': [152,143,139],
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
  },
};

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// [label, foreground token, ground token, threshold, context]
const PAIRS = [
  ['ink / paper',            'ink', 'paper', 4.5, 'body and headings'],
  ['ink / card',             'ink', 'card', 4.5, 'text in cards'],
  ['muted-fg / paper',       'muted-fg', 'paper', 4.5, 'sub copy'],
  ['muted-fg / card',        'muted-fg', 'card', 4.5, 'helper text, counts'],
  ['muted-fg / muted',       'muted-fg', 'muted', 4.5, 'segmented control, inactive'],
  ['link / paper',           'link', 'paper', 4.5, 'Ghost buttons, text links'],
  ['link / card',            'link', 'card', 4.5, 'Tabs active, RailSubItem current'],
  ['link / indigo-tint',     'link', 'indigo-tint', 4.5, 'RailItem active row'],
  ['on-primary / indigo',    'on-primary', 'indigo', 4.5, 'Primary button label'],
  ['ink / muted',            'ink', 'muted', 4.5, 'Badge Neutral'],
  ['indigo-ink / indigo-tint','indigo-ink', 'indigo-tint', 4.5, 'Badge Primary'],
  ['success-ink / success-tint','success-ink','success-tint', 4.5, 'Badge Positive'],
  ['destructive-ink / destructive-tint','destructive-ink','destructive-tint', 4.5, 'Badge Critical'],
  ['warning-ink / warning-tint','warning-ink','warning-tint', 4.5, 'Badge Warning'],
  ['verdigris / verdigris-tint','verdigris','verdigris-tint', 4.5, 'Badge Live'],
  ['muted-fg / clay-tint',   'muted-fg', 'clay-tint', 4.5, 'delegate offer sub copy'],
  ['ink / clay-tint',        'ink', 'clay-tint', 4.5, 'delegate offer heading'],
  ['input border / card',   'input-border', 'card', 3.0, "text field boundary (WCAG 1.4.11)"],
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
  // Empty, and worth keeping that way.
  //
  // It held `input border / card` until 2026-08-10, when the owner ruled the
  // token should move rather than the exemption stand: --input went to the
  // minimum lightness that clears 3:1 (20 6% 57% Light, 60 2% 40% Dark).
  // --border did NOT move with it -- a decorative divider is exempt, a control
  // boundary is not, and the two tokens now differ in value because they differ
  // in job.
]);

let failed = 0;
const known = [];
const rows = PAIRS.map(([name, fg, bg, need, ctx]) => {
  const l = ratio(T.Light[fg], T.Light[bg]);
  const d = ratio(T.Dark[fg], T.Dark[bg]);
  const belowThreshold = l < need || d < need;
  const isKnown = belowThreshold && KNOWN_FAILURES.has(name);
  if (belowThreshold && !isKnown) failed++;
  if (isKnown) known.push(name);
  const f = (v) => `${v.toFixed(2)}${v < need ? (isKnown ? ' KNOWN' : ' FAIL') : ''}`;
  return `| ${name} | ${ctx} | ${need} | ${f(l)} | ${f(d)} |`;
});
console.log('| Pair | Context | Need | Light | Dark |');
console.log('|---|---|---|---|---|');
console.log(rows.join('\n'));
if (known.length) {
  console.log('\nKnown, accepted-and-tracked failures (not passing -- see reasons below):');
  for (const name of known) console.log(`- ${name}: ${KNOWN_FAILURES.get(name)}`);
}
if (failed) { console.error(`\n${failed} unexpected pair(s) below threshold.`); process.exit(1); }
// Only hedge when there is something to hedge about: an empty exemption list
// means every pair genuinely passes, and saying otherwise trains the reader to
// skim the last line.
console.log(known.length
  ? '\nAll pairs pass (or are known, accepted, and tracked -- see above).'
  : '\nAll pairs pass.');
