// Step 7 — Closing CTA band + footer. One use_figma call.
const P = f => ({ family: 'Poppins', style: f });
const F = f => ({ family: 'Fraunces', style: f });
for (const f of [P('Regular'), P('SemiBold'), F('SemiBold')]) await figma.loadFontAsync(f);

const landing = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(landing);
const cta    = await figma.getNodeByIdAsync('2012:28');
const footer = await figma.getNodeByIdAsync('2012:29');
const logoComp   = await figma.getNodeByIdAsync('2009:7');
const btnPrimary = await figma.getNodeByIdAsync('2008:5');
const btnGhost   = await figma.getNodeByIdAsync('2008:11');
const navLink    = await figma.getNodeByIdAsync('2009:13');

const V = async id => await figma.variables.getVariableByIdAsync(id);
const vInk = await V('VariableID:2006:7');
const vInkSoft = await V('VariableID:2006:8');
const vInkFaint = await V('VariableID:2006:9');
const vAmberSoft = await V('VariableID:2006:15');
const vLine = await V('VariableID:2006:11');
const solid = () => ({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } });
const bind = v => figma.variables.setBoundVariableForPaint(solid(), 'color', v);

const stH2    = await figma.getStyleByIdAsync('S:f821e9c4470107d9c04cda8ac36ed725943e2dad,');
const stBodyLg= await figma.getStyleByIdAsync('S:008a702f53e384f59ad83915ec2a6b8cb34d7876,');
const stSmall = await figma.getStyleByIdAsync('S:de3f03881910d0dab4ca609d9213bff8252ef07b,');

function addText(parent, name, chars, font, style, colorVar, width, align) {
  const t = figma.createText();
  t.fontName = font; t.characters = chars; t.name = name;
  parent.appendChild(t);
  t.textStyleId = style.id;
  t.fills = [bind(colorVar)];
  t.textAlignHorizontal = align || 'LEFT';
  t.textAutoResize = 'HEIGHT';
  if (width) { t.layoutSizingHorizontal = 'FIXED'; t.resize(width, t.height); }
  else { t.layoutSizingHorizontal = 'HUG'; }
  return t;
}

// ---------- CTA band ----------
cta.set({
  layoutMode: 'VERTICAL', counterAxisAlignItems: 'CENTER',
  paddingLeft: 80, paddingRight: 80, paddingTop: 96, paddingBottom: 96, itemSpacing: 24
});
cta.fills = [bind(vAmberSoft)];
cta.layoutSizingVertical = 'HUG';

addText(cta, 'Heading', 'Start with one conversation', F('SemiBold'), stH2, vInk, 700, 'CENTER');
addText(cta, 'Body', 'No setup wizard, no preferences form. Talk to it once and it starts building the profile that makes the next time better.', P('Regular'), stBodyLg, vInkSoft, 560, 'CENTER');

const ctaRow = figma.createAutoLayout('HORIZONTAL', { name: 'CTA Buttons', itemSpacing: 14, counterAxisAlignItems: 'CENTER' });
ctaRow.fills = [];
cta.appendChild(ctaRow);
const a = btnPrimary.createInstance(); a.setProperties({ 'Label#2008:0': 'Start free' }); ctaRow.appendChild(a);
const b = btnGhost.createInstance();   b.setProperties({ 'Label#2008:0': 'Talk to sales' }); ctaRow.appendChild(b);
cta.placeholder = false;

// ---------- Footer ----------
footer.set({
  layoutMode: 'VERTICAL', counterAxisAlignItems: 'MIN',
  paddingLeft: 80, paddingRight: 80, paddingTop: 56, paddingBottom: 48, itemSpacing: 32
});
footer.layoutSizingVertical = 'HUG';
footer.strokes = [bind(vLine)];
footer.strokeWeight = 1;
footer.strokeTopWeight = 1;
footer.strokeBottomWeight = 0;
footer.strokeLeftWeight = 0;
footer.strokeRightWeight = 0;

const cols = figma.createAutoLayout('HORIZONTAL', { name: 'Footer Columns', itemSpacing: 64, counterAxisAlignItems: 'MIN' });
cols.fills = [];
footer.appendChild(cols);
cols.layoutSizingHorizontal = 'FILL';

const brandCol = figma.createAutoLayout('VERTICAL', { name: 'Brand', itemSpacing: 14 });
brandCol.fills = [];
cols.appendChild(brandCol);
brandCol.layoutSizingHorizontal = 'FILL';
brandCol.appendChild(logoComp.createInstance());
addText(brandCol, 'Tagline', 'Your collaborative companion — voice, autonomous follow-through, and a memory you can inspect.', P('Regular'), stSmall, vInkSoft, 300, 'LEFT');

const groups = [
  ['Product', ['Voice', 'Watchers', 'Cognitive Profile', 'Connectors']],
  ['Company', ['About', 'Blog', 'Careers', 'Contact']],
  ['Trust',   ['Security', 'Transparent Trace', 'Status', 'Privacy']]
];
const colIds = [];
for (const [title, links] of groups) {
  const c = figma.createAutoLayout('VERTICAL', { name: title, itemSpacing: 10 });
  c.fills = [];
  cols.appendChild(c);
  c.layoutSizingHorizontal = 'HUG';
  addText(c, 'Column Title', title, P('SemiBold'), stSmall, vInk, null, 'LEFT');
  for (const l of links) {
    const i = navLink.createInstance();
    i.setProperties({ 'Label#2009:1': l });
    c.appendChild(i);
  }
  colIds.push(c.id);
}

addText(footer, 'Legal', '© 2026 AllTheWay. Built on Gemini Live, ADK and Cloud Run.', P('Regular'), stSmall, vInkFaint, null, 'LEFT');
footer.placeholder = false;

const desktop = await figma.getNodeByIdAsync('2012:22');
await desktop.screenshot();
return { createdNodeIds: [ctaRow.id, cols.id, brandCol.id].concat(colIds), mutatedNodeIds: [cta.id, footer.id], totalHeight: desktop.height };
