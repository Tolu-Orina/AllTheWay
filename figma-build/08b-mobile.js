// Step 8b — Mobile 390. Clones the finished desktop frame and adapts it.
// Run only AFTER 05, 06 and 07.
const P = f => ({ family: 'Poppins', style: f });
const F = f => ({ family: 'Fraunces', style: f });
for (const f of [P('Regular'), P('SemiBold'), P('Bold'), F('SemiBold')]) await figma.loadFontAsync(f);

const landing = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(landing);
const desktop = await figma.getNodeByIdAsync('2012:22');

const W = 390, PAD = 20;
const m = desktop.clone();
m.name = 'Mobile · 390';
m.x = 2500; m.y = 0;
m.resize(W, m.height);
m.layoutGrids = [{ pattern: 'COLUMNS', alignment: 'STRETCH', count: 4, gutterSize: 16, offset: PAD, visible: false, color: { r: 0.75, g: 0.45, b: 0.2, a: 0.1 } }];

const kid = (parent, name) => parent.children.filter(c => c.name === name)[0];
const inner = W - PAD * 2;
for (const s of m.children) s.set({ paddingLeft: PAD, paddingRight: PAD });

// Nav — logo + single primary action
const nav = kid(m, 'Nav');
nav.set({ paddingTop: 16, paddingBottom: 16 });
const navLinks = kid(nav, 'Nav Links');
if (navLinks) navLinks.visible = false;
const actions = kid(nav, 'Nav Actions');
if (actions && actions.children.length > 1) actions.children[0].visible = false;

// Hero
const hero = kid(m, 'Hero');
hero.set({ paddingTop: 40, itemSpacing: 18 });
const h1 = kid(hero, 'Headline');
h1.fontSize = 34;
h1.resize(inner, h1.height);
const sub = kid(hero, 'Subhead');
sub.fontSize = 16;
sub.resize(inner, sub.height);
const heroCta = kid(hero, 'Hero CTA');
heroCta.set({ layoutMode: 'VERTICAL', itemSpacing: 10 });
heroCta.layoutSizingHorizontal = 'FILL';
for (const c of heroCta.children) c.layoutSizingHorizontal = 'FILL';
const walk = kid(hero, 'Walkways');
walk.resize(inner, 240);
const preview = kid(walk, 'App Preview');
if (preview) { preview.resize(inner - 8, 150); preview.x = 4; preview.y = 90; }

// Pillars — single column
const pillars = kid(m, 'Pillars');
pillars.set({ paddingTop: 56, paddingBottom: 56, itemSpacing: 28 });
const head = kid(pillars, 'Section Head');
kid(head, 'Heading').set({ fontSize: 27, width: inner });
kid(head, 'Description').set({ width: inner });
const grid = kid(pillars, 'Pillar Grid');
grid.set({ layoutMode: 'VERTICAL', itemSpacing: 16 });
for (const c of grid.children) { c.layoutSizingHorizontal = 'FILL'; c.layoutSizingVertical = 'HUG'; }

// Trust
const trust = kid(m, 'Trust');
trust.set({ layoutMode: 'VERTICAL', itemSpacing: 32, paddingTop: 56, paddingBottom: 56 });
kid(kid(trust, 'Trust Copy'), 'Heading').fontSize = 27;

// Pricing
const pricing = kid(m, 'Pricing');
pricing.set({ paddingTop: 56, paddingBottom: 56, itemSpacing: 28 });
const phead = kid(pricing, 'Section Head');
kid(phead, 'Heading').set({ fontSize: 27, width: inner });
kid(phead, 'Description').set({ width: inner });
const prow = kid(pricing, 'Pricing Row');
prow.set({ layoutMode: 'VERTICAL', itemSpacing: 16 });
for (const c of prow.children) c.layoutSizingVertical = 'HUG';

// CTA
const cta = kid(m, 'CTA');
cta.set({ paddingTop: 56, paddingBottom: 56 });
kid(cta, 'Heading').set({ fontSize: 27, width: inner });
kid(cta, 'Body').set({ width: inner });
const ctaBtns = kid(cta, 'CTA Buttons');
ctaBtns.set({ layoutMode: 'VERTICAL', itemSpacing: 10 });
ctaBtns.layoutSizingHorizontal = 'FILL';
for (const c of ctaBtns.children) c.layoutSizingHorizontal = 'FILL';

// Footer — single column
const footer = kid(m, 'Footer');
footer.set({ paddingTop: 40, paddingBottom: 36, itemSpacing: 24 });
const fcols = kid(footer, 'Footer Columns');
fcols.set({ layoutMode: 'VERTICAL', itemSpacing: 28 });
const brand = kid(fcols, 'Brand');
if (brand) kid(brand, 'Tagline').set({ width: inner });

await m.screenshot();
return { createdNodeIds: [m.id], mobileId: m.id, height: m.height };
