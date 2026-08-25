// Step 5 — Trust band. use_figma(fileKey='0iGGq63HtoqO2QgTut7Wt0', code=<this file>)
const P = f => ({ family: 'Poppins', style: f });
const F = f => ({ family: 'Fraunces', style: f });
for (const f of [P('Regular'), P('SemiBold'), F('SemiBold')]) await figma.loadFontAsync(f);

const landing = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(landing);
const sec = await figma.getNodeByIdAsync('2012:26');

const V = async id => await figma.variables.getVariableByIdAsync(id);
const vPlumDeep   = await V('VariableID:2006:20');
const vWhite      = await V('VariableID:2006:5');
const vPlumSoft   = await V('VariableID:2006:19');
const vAmberLight = await V('VariableID:2006:17');
const solid = () => ({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } });
const bind = v => figma.variables.setBoundVariableForPaint(solid(), 'color', v);

const stEyebrow = await figma.getStyleByIdAsync('S:b30c162bcd67652fc225ee2a6a3cbcad3c95048f,');
const stH2      = await figma.getStyleByIdAsync('S:f821e9c4470107d9c04cda8ac36ed725943e2dad,');
const stBody    = await figma.getStyleByIdAsync('S:9ee6cfc8c22db4363350caf36c7cf7db91a08a76,');

sec.set({
  layoutMode: 'HORIZONTAL', counterAxisAlignItems: 'MIN',
  paddingLeft: 80, paddingRight: 80, paddingTop: 96, paddingBottom: 96, itemSpacing: 80
});
sec.fills = [bind(vPlumDeep)];
sec.layoutSizingVertical = 'HUG';

function addText(parent, name, chars, font, style, colorVar) {
  const t = figma.createText();
  t.fontName = font; t.characters = chars; t.name = name;
  parent.appendChild(t);
  t.textStyleId = style.id;
  t.fills = [bind(colorVar)];
  t.textAutoResize = 'HEIGHT';
  t.layoutSizingHorizontal = 'FILL';
  return t;
}

const left = figma.createAutoLayout('VERTICAL', { name: 'Trust Copy', itemSpacing: 16 });
left.fills = [];
sec.appendChild(left);
left.layoutSizingHorizontal = 'FILL';
addText(left, 'Eyebrow', 'Governed by design', P('SemiBold'), stEyebrow, vAmberLight);
addText(left, 'Heading', 'Autonomy you can actually hand over', F('SemiBold'), stH2, vWhite);
addText(left, 'Body', 'Adding "does things without you watching" to a product built on visibility only works if the guardrails are load-bearing. Every Watcher run lands in the same Plan Panel and Feedback Ledger as a session you drove yourself.', P('Regular'), stBody, vPlumSoft);

const right = figma.createAutoLayout('VERTICAL', { name: 'Guarantees', itemSpacing: 18 });
right.fills = [];
sec.appendChild(right);
right.layoutSizingHorizontal = 'FILL';

const items = [
  'Irreversible actions always confirm first — a floor the user cannot lower alone',
  'Per-category autonomy ceilings: draft only, send after review, or send automatically',
  'Prompt-injection screening on every piece of untrusted external content a Watcher ingests',
  'Least-privilege agent identity between every internal service, from first deployment'
];
const rowIds = [];
for (const copy of items) {
  const row = figma.createAutoLayout('HORIZONTAL', { name: 'Guarantee', itemSpacing: 14, counterAxisAlignItems: 'MIN' });
  row.fills = [];
  right.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';
  const d = figma.createEllipse();
  d.resize(7, 7);
  d.fills = [bind(vAmberLight)];
  row.appendChild(d);
  d.layoutSizingHorizontal = 'FIXED';
  d.layoutSizingVertical = 'FIXED';
  addText(row, 'Copy', copy, P('Regular'), stBody, vPlumSoft);
  rowIds.push(row.id);
}

sec.placeholder = false;
await sec.screenshot();
return { createdNodeIds: [left.id, right.id].concat(rowIds), mutatedNodeIds: [sec.id], height: sec.height };
