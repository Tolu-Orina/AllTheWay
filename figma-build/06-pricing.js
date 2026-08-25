// Step 6 — Pricing row (Free / Plus / Team). One use_figma call.
const P = f => ({ family: 'Poppins', style: f });
const F = f => ({ family: 'Fraunces', style: f });
for (const f of [P('Regular'), P('SemiBold'), P('Bold'), F('SemiBold')]) await figma.loadFontAsync(f);

const landing = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(landing);
const sec = await figma.getNodeByIdAsync('2012:27');
const priceComp  = await figma.getNodeByIdAsync('2012:21');
const btnPrimary = await figma.getNodeByIdAsync('2008:5');

const V = async id => await figma.variables.getVariableByIdAsync(id);
const vInk = await V('VariableID:2006:7');
const vInkSoft = await V('VariableID:2006:8');
const vAmberDeep = await V('VariableID:2006:16');
const vPlum = await V('VariableID:2006:18');
const solid = () => ({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } });
const bind = v => figma.variables.setBoundVariableForPaint(solid(), 'color', v);

const stEyebrow = await figma.getStyleByIdAsync('S:b30c162bcd67652fc225ee2a6a3cbcad3c95048f,');
const stH2      = await figma.getStyleByIdAsync('S:f821e9c4470107d9c04cda8ac36ed725943e2dad,');
const stBodyLg  = await figma.getStyleByIdAsync('S:008a702f53e384f59ad83915ec2a6b8cb34d7876,');

sec.set({
  layoutMode: 'VERTICAL', counterAxisAlignItems: 'CENTER',
  paddingLeft: 80, paddingRight: 80, paddingTop: 104, paddingBottom: 104, itemSpacing: 48
});
sec.layoutSizingVertical = 'HUG';

function addText(parent, name, chars, font, style, colorVar, width) {
  const t = figma.createText();
  t.fontName = font; t.characters = chars; t.name = name;
  parent.appendChild(t);
  t.textStyleId = style.id;
  t.fills = [bind(colorVar)];
  t.textAlignHorizontal = 'CENTER';
  t.textAutoResize = 'HEIGHT';
  if (width) { t.layoutSizingHorizontal = 'FIXED'; t.resize(width, t.height); }
  else { t.layoutSizingHorizontal = 'HUG'; }
  return t;
}

const head = figma.createAutoLayout('VERTICAL', { name: 'Section Head', itemSpacing: 14, counterAxisAlignItems: 'CENTER' });
head.fills = [];
sec.appendChild(head);
head.layoutSizingHorizontal = 'FILL';
addText(head, 'Eyebrow', 'Pricing', P('SemiBold'), stEyebrow, vAmberDeep, null);
addText(head, 'Heading', 'Pay for what it actually does', F('SemiBold'), stH2, vInk, 820);
addText(head, 'Description', 'Voice minutes and Watcher runs are metered, because both carry real marginal cost. Everything else is per seat.', P('Regular'), stBodyLg, vInkSoft, 640);

const row = figma.createAutoLayout('HORIZONTAL', { name: 'Pricing Row', itemSpacing: 24, counterAxisAlignItems: 'MIN' });
row.fills = [];
sec.appendChild(row);
row.layoutSizingHorizontal = 'FILL';

const tiers = [
  { Plan: 'Free', Price: '$0', Period: 'forever',
    Tagline: 'Enough to see whether it actually remembers you.',
    f: ['1 active session', 'Weekly profile sync', 'Core connectors, text only'] },
  { Plan: 'Plus', Price: '$18', Period: '/ month',
    Tagline: 'For individuals who want voice, memory and their first Watchers.',
    f: ['Unlimited sessions, daily profile sync', 'Voice conversation with fair-use minutes', '1-3 active Watchers'] },
  { Plan: 'Team', Price: 'Custom', Period: 'per seat',
    Tagline: 'When the companion has to be safe for a company to adopt.',
    f: ['Everything in Plus, per seat', 'Org-level Watcher policy controls', 'SSO and audit visibility across the org'] }
];

const made = [];
tiers.forEach((t, idx) => {
  const i = priceComp.createInstance();
  i.setProperties({
    'Plan#2012:0': t.Plan, 'Price#2012:1': t.Price, 'Period#2012:2': t.Period,
    'Tagline#2012:3': t.Tagline,
    'Feature 1#2012:4': t.f[0], 'Feature 2#2012:5': t.f[1], 'Feature 3#2012:6': t.f[2]
  });
  row.appendChild(i);
  i.layoutSizingHorizontal = 'FILL';
  made.push(i);

  if (idx === 1) {
    i.strokes = [bind(vPlum)];
    i.strokeWeight = 2;
    const cta = i.children.filter(c => c.name === 'CTA')[0];
    if (cta) cta.swapComponent(btnPrimary);
  }
});
for (const i of made) i.layoutSizingVertical = 'FILL';

sec.placeholder = false;
await sec.screenshot();
return { createdNodeIds: [head.id, row.id].concat(made.map(i => i.id)), mutatedNodeIds: [sec.id], height: sec.height };
