// Contrast ratios for every foreground/ground pair the APP uses, in both modes.
// The landing page has its own table in design/contrast-audit.md; this file
// covers the pairs that one never measured -- badge tones, the rail's active
// row, and the tinted pills.
//
// Run: node design/app-contrast.mjs
// Exits non-zero if any pair falls below its threshold, so it can gate CI.
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
];

let failed = 0;
const rows = PAIRS.map(([name, fg, bg, need, ctx]) => {
  const l = ratio(T.Light[fg], T.Light[bg]);
  const d = ratio(T.Dark[fg], T.Dark[bg]);
  if (l < need || d < need) failed++;
  const f = (v) => `${v.toFixed(2)}${v < need ? ' FAIL' : ''}`;
  return `| ${name} | ${ctx} | ${need} | ${f(l)} | ${f(d)} |`;
});
console.log('| Pair | Context | Need | Light | Dark |');
console.log('|---|---|---|---|---|');
console.log(rows.join('\n'));
if (failed) { console.error(`\n${failed} pair(s) below threshold.`); process.exit(1); }
console.log('\nAll pairs pass.');
