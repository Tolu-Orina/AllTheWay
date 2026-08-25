// Step 8a — Tablet 768. Clones the finished desktop frame and adapts it.
// Run only AFTER 05, 06 and 07, so the clone contains every section.
const P = f => ({ family: 'Poppins', style: f });
const F = f => ({ family: 'Fraunces', style: f });
for (const f of [P('Regular'), P('SemiBold'), P('Bold'), F('SemiBold')]) await figma.loadFontAsync(f);

const landing = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(landing);
const desktop = await figma.getNodeByIdAsync('2012:22');

const W = 768, PAD = 48;
const t = desktop.clone();
t.name = 'Tablet · 768';
t.x = 1600; t.y = 0;
t.resize(W, t.height);
t.layoutGrids = [{ pattern: 'COLUMNS', alignment: 'STRETCH', count: 8, gutterSize: 24, offset: PAD, visible: false, color: { r: 0.75, g: 0.45, b: 0.2, a: 0.1 } }];

const kid = (parent, name) => parent.children.filter(c => c.name === name)[0];
const pad = n => n.set({ paddingLeft: PAD, paddingRight: PAD });
for (const s of t.children) pad(s);

// Nav — drop the link row, keep logo + actions
const nav = kid(t, 'Nav');
nav.set({ paddingTop: 20, paddingBottom: 20 });
const navLinks = kid(nav, 'Nav Links');
if (navLinks) navLinks.visible = false;

// Hero — smaller type, shorter walkways
const hero = kid(t, 'Hero');
hero.set({ paddingTop: 56, itemSpacing: 22 });
const h1 = kid(hero, 'Headline');
h1.fontSize = 48;
h1.resize(W - PAD * 2, h1.height);
const sub = kid(hero, 'Subhead');
sub.fontSize = 18;
sub.resize(520, sub.height);
const walk = kid(hero, 'Walkways');
walk.resize(W - PAD * 2, 300);

// Pillars — 2 x 2 wrap
const pillars = kid(t, 'Pillars');
pillars.set({ paddingTop: 80, paddingBottom: 80, itemSpacing: 36 });
const head = kid(pillars, 'Section Head');
kid(head, 'Heading').set({ fontSize: 34, width: W - PAD * 2 });
kid(head, 'Description').set({ width: W - PAD * 2 });
const grid = kid(pillars, 'Pillar Grid');
grid.layoutWrap = 'WRAP';
grid.counterAxisSpacing = 24;
const colW = (W - PAD * 2 - 24) / 2;
for (const c of grid.children) { c.layoutSizingHorizontal = 'FIXED'; c.resize(colW, c.height); }

// Trust — stack the two columns
const trust = kid(t, 'Trust');
trust.set({ layoutMode: 'VERTICAL', itemSpacing: 40, paddingTop: 72, paddingBottom: 72 });
kid(kid(trust, 'Trust Copy'), 'Heading').fontSize = 34;

// Pricing — stack the tiers
const pricing = kid(t, 'Pricing');
pricing.set({ paddingTop: 80, paddingBottom: 80, itemSpacing: 36 });
const phead = kid(pricing, 'Section Head');
kid(phead, 'Heading').set({ fontSize: 34, width: W - PAD * 2 });
kid(phead, 'Description').set({ width: W - PAD * 2 });
const prow = kid(pricing, 'Pricing Row');
prow.set({ layoutMode: 'VERTICAL', itemSpacing: 20 });
for (const c of prow.children) c.layoutSizingVertical = 'HUG';

// CTA + footer
const cta = kid(t, 'CTA');
cta.set({ paddingTop: 72, paddingBottom: 72 });
kid(cta, 'Heading').set({ fontSize: 34, width: W - PAD * 2 });
kid(cta, 'Body').set({ width: 520 });

const footer = kid(t, 'Footer');
const fcols = kid(footer, 'Footer Columns');
fcols.layoutWrap = 'WRAP';
fcols.counterAxisSpacing = 32;
fcols.itemSpacing = 40;

await t.screenshot();
return { createdNodeIds: [t.id], tabletId: t.id, height: t.height };
