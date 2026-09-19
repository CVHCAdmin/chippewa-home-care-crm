// Renders the CVHC binder forms (CVHC-Operations/Forms/*.md) as printable PDFs into
// CVHC-Operations/Forms/PDF/. Signable on a phone or computer with Acrobat Fill & Sign,
// or printed. Markdown in, PDF out: headings, paragraphs with **bold**, bullet and
// numbered lists, [ ] checkboxes, blockquotes, --- rules, and pipe tables.
// usage: node audits/build_binder_form_pdfs.js [formsDir] [outDir]
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FORMS = process.argv[2] || 'C:/ALL TWOMIAH PRODUCTS/CVHC-Operations/Forms';
const OUT = process.argv[3] || path.join(FORMS, 'PDF');

const AGENCY = {
  name: 'Chippewa Valley Home Care',
  line: '2607 Beverly Hills Dr  ·  Eau Claire, WI 54701  ·  715-491-1254  ·  chippewavalleyhomecare@gmail.com',
};
const INK = '#111827', MUTED = '#6B7280', TEAL = '#0F766E', RULE = '#D1D5DB', SHADE = '#F3F4F6';
const M = { top: 54, bottom: 56, left: 54, right: 54 };
const PAGE_W = 612 - M.left - M.right;

// Helvetica has no box/check glyphs (they print as "&"), so use ASCII equivalents.
const ascii = (s) => String(s)
  .replace(/[☐□]/g, '[  ]')
  .replace(/[☑☒✓✔]/g, '[X]')
  .replace(/[—–]/g, '-')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'");

// Split **bold** runs so a line can mix weights.
const runs = (s) => ascii(s).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part =>
  part.startsWith('**') && part.endsWith('**')
    ? { text: part.slice(2, -2), bold: true }
    : { text: part, bold: false });

function render(doc, md, title) {
  const bottom = () => doc.page.height - M.bottom;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

  const rich = (text, { size = 10.5, gap = 3, indent = 0, color = INK } = {}) => {
    const parts = runs(text);
    doc.fontSize(size).fillColor(color);
    const h = doc.heightOfString(parts.map(p => p.text).join(''), { width: PAGE_W - indent });
    ensure(h + gap);
    const startX = M.left + indent;
    doc.x = startX;
    parts.forEach((p, i) => {
      doc.font(p.bold ? 'Helvetica-Bold' : 'Helvetica')
         .text(p.text, i === 0 ? startX : doc.x, doc.y, { width: PAGE_W - indent, continued: i < parts.length - 1 });
    });
    doc.x = M.left;
    doc.y += gap;
  };

  const table = (rows) => {
    const cols = rows[0].length;
    const w = PAGE_W / cols;
    rows.forEach((row, r) => {
      let cells = row;
      doc.font(r === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(r === 0 ? 8.5 : 9);
      cells = cells.map(c => ascii(c).replace(/\*\*/g, ''));
      const h = Math.max(...cells.map(c => doc.heightOfString(c || ' ', { width: w - 8 }))) + 10;
      ensure(h);
      const y = doc.y;
      if (r === 0) doc.rect(M.left, y, PAGE_W, h).fill(SHADE);
      doc.fillColor(INK);
      cells.forEach((c, i) => {
        doc.font(r === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(r === 0 ? 8.5 : 9)
           .text(c || '', M.left + i * w + 4, y + 5, { width: w - 8 });
        doc.moveTo(M.left + i * w, y).lineTo(M.left + i * w, y + h).lineWidth(0.4).strokeColor(RULE).stroke();
      });
      doc.rect(M.left, y, PAGE_W, h).lineWidth(0.4).strokeColor(RULE).stroke();
      doc.y = y + h;
      doc.x = M.left;
    });
    doc.y += 6;
  };

  // Letterhead
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(AGENCY.name, M.left, M.top);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(AGENCY.line);
  doc.moveDown(0.3);
  doc.moveTo(M.left, doc.y).lineTo(M.left + PAGE_W, doc.y).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.moveDown(0.8);
  doc.fillColor(INK);

  const lines = md.split(/\r?\n/);
  let pendingTable = [];
  const flushTable = () => { if (pendingTable.length) { table(pendingTable); pendingTable = []; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // separator row
      pendingTable.push(cells);
      continue;
    }
    flushTable();

    if (!line.trim()) { doc.y += 4; continue; }
    if (/^---+$/.test(line.trim())) {
      ensure(10);
      doc.moveTo(M.left, doc.y + 2).lineTo(M.left + PAGE_W, doc.y + 2).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y += 10;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 16 : level === 2 ? 11.5 : 10.5;
      ensure(size + 12);
      if (level > 1) doc.y += 4;
      doc.font('Helvetica-Bold').fontSize(size).fillColor(level === 1 ? INK : TEAL)
         .text(h[2].replace(/\*\*/g, ''), M.left, doc.y, { width: PAGE_W });
      if (level === 1) {
        doc.moveTo(M.left, doc.y + 3).lineTo(M.left + PAGE_W, doc.y + 3).lineWidth(0.8).strokeColor(RULE).stroke();
        doc.y += 10;
      } else doc.y += 4;
      doc.fillColor(INK);
      continue;
    }
    if (/^>\s?/.test(line)) { rich(line.replace(/^>\s?/, ''), { size: 9.5, color: MUTED, indent: 10 }); continue; }

    const box = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
    if (box) {
      const indent = 10 + Math.floor(box[1].length / 2) * 12;
      const text = box[3];
      doc.font('Helvetica').fontSize(10.5);
      const th = doc.heightOfString(text.replace(/\*\*/g, ''), { width: PAGE_W - indent - 18 });
      ensure(th + 6);
      const y = doc.y;
      doc.rect(M.left + indent, y + 1.5, 9, 9).lineWidth(0.8).strokeColor('#4B5563').stroke();
      if (box[2].toLowerCase() === 'x') doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('X', M.left + indent + 2, y + 2);
      doc.y = y;
      rich(text, { indent: indent + 16, gap: 4 });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      const indent = 12 + Math.floor(bullet[1].length / 2) * 12;
      const y = doc.y;
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('•', M.left + indent - 8, y);
      doc.y = y;
      rich(bullet[2], { indent, gap: 3 });
      continue;
    }
    const num = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (num) {
      const indent = 18 + Math.floor(num[1].length / 2) * 12;
      const y = doc.y;
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(`${num[2]}.`, M.left + indent - 16, y);
      doc.y = y;
      rich(num[3], { indent, gap: 3 });
      continue;
    }
    rich(line, { gap: 4 });
  }
  flushTable();

  // Footer on every page. Writing inside the bottom margin would spill onto a new page,
  // so drop the bottom margin while stamping.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor('#9CA3AF')
       .text(`${AGENCY.name}  ·  ${ascii(title)}  ·  Page ${i + 1} of ${range.count}`,
             M.left, doc.page.height - 40, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(FORMS).filter(f => f.toLowerCase().endsWith('.md'));
  for (const f of files) {
    const md = fs.readFileSync(path.join(FORMS, f), 'utf8');
    const title = (md.match(/^#\s+(.*)$/m) || [null, path.basename(f, '.md')])[1].replace(/\*\*/g, '');
    const outFile = path.join(OUT, path.basename(f, '.md') + '.pdf');
    const doc = new PDFDocument({ size: 'LETTER', margins: M, bufferPages: true, info: { Title: title, Author: AGENCY.name } });
    const stream = fs.createWriteStream(outFile);
    doc.pipe(stream);
    render(doc, md, title);
    doc.end();
    await new Promise(r => stream.on('finish', r));
    console.log(`${outFile}  (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
  }
  console.log(`\n${files.length} form PDFs written to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
