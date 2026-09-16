// services/midasAssessmentPdf.js
// Reads a MIDAS "SHC/PC Assessment Summary" PDF (the printable summary My Choice
// Wisconsin's RN produces) into the care-task import shape used by
// POST /api/clients/:clientId/care-tasks/import. Runs locally — no PHI leaves the server.
//
// Only the Summary layout is supported. A full "SHC Assessment (View)" page printed
// from the browser has an unreadable text layer, so it is rejected with a clear error
// instead of being guessed at. Every row and section total is checked against the
// sheet's own numbers; any mismatch or unrecognised line fails the whole parse.

class AssessmentPdfError extends Error {}

const SECTION_CATEGORIES = [
  { match: /homemaking/i, category: 'iadl' },
  { match: /attendant care/i, category: 'adl' },
];

const LEFT_MARGIN_MAX_X = 30;   // section/group headers sit at the left margin
const INDENT_MIN_X = 35;        // task names are indented
const NAME_COL_MAX_X = 190;     // task names end before the first number column
const SAME_LINE_Y = 3;          // items within this many points share a line
const NUM_RE = /^\d+$/;

async function extractLines(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer), verbosity: 0, disableFontFace: true, isEvalSupported: false,
    }).promise;
  } catch (e) {
    throw new AssessmentPdfError('Could not open the file as a PDF.');
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.y - it.y) <= SAME_LINE_Y) line.parts.push(it);
      else lines.push({ y: it.y, parts: [it] });
    }
    lines.forEach(l => l.parts.sort((a, b) => a.x - b.x));
    pages.push(lines);
  }
  await doc.destroy();
  return pages;
}

const lineText = (l) => l.parts.map(p => p.s).join(' ');
const after = (lines, label) => {
  for (const l of lines) {
    const i = l.parts.findIndex(p => p.s === label);
    if (i >= 0 && l.parts[i + 1]) return l.parts[i + 1].s;
  }
  return null;
};

async function parseMidasAssessmentPdf(buffer) {
  const pages = await extractLines(buffer);
  const all = pages.flat();
  if (!all.some(l => /SHC\/PC Assessment Summary/i.test(lineText(l)))) {
    throw new AssessmentPdfError(
      'This PDF is not a MIDAS "SHC/PC Assessment Summary". Upload the Summary PDF, or add tasks manually. ' +
      '(A full assessment page printed from the browser cannot be read.)'
    );
  }

  const member = {
    lastName: after(all, 'Last Name:'),
    firstName: after(all, 'First Name:'),
    memberId: after(all, 'Member ID:'),
    assessDate: after(all, 'Assess Date:'),
    assessor: after(all, 'RN:'),
  };

  const sections = [];
  let section = null;
  let group = null;
  let expectSectionName = false;

  for (const lines of pages) {
    for (const line of lines) {
      const text = lineText(line);
      const first = line.parts[0];
      if (/^SHC\/PC Assessment Summary$/i.test(text) || /^Page \d+ of \d+/.test(text) || /Page \d+ of \d+$/.test(text)) continue;

      if (/^Supportive Home Care -$/i.test(text)) { expectSectionName = true; continue; }
      if (expectSectionName) {
        const name = line.parts.find(p => p.x <= LEFT_MARGIN_MAX_X);
        if (!name) continue; // "SHCES Guidelines" header sits between the two title lines
        const def = SECTION_CATEGORIES.find(s => s.match.test(name.s));
        if (!def) throw new AssessmentPdfError(`Unrecognised assessment section "Supportive Home Care - ${name.s}". Add these tasks manually.`);
        section = { name: `Supportive Home Care - ${name.s}`, category: def.category, rows: [], totalMinsPerWeek: null };
        sections.push(section);
        group = null;
        expectSectionName = false;
        continue;
      }
      if (!section) continue; // member/provider header block

      if (/^times per Week/.test(text)) continue; // column header row
      const totalMatch = text.match(/Total Assessed Mins\. \/ Week:/);
      if (totalMatch) {
        const n = line.parts.find(p => NUM_RE.test(p.s));
        if (!n) throw new AssessmentPdfError(`Could not read the total for ${section.name}.`);
        section.totalMinsPerWeek = parseInt(n.s, 10);
        continue;
      }
      if (/Total Assessed Hours \/ Week:/.test(text)) continue;
      // Hours figure printed slightly below its label ("2.00"); it isn't used.
      if (line.parts.every(p => /^\d+\.\d+$/.test(p.s) && p.x >= NAME_COL_MAX_X)) continue;

      const nums = line.parts.filter(p => NUM_RE.test(p.s));
      const words = line.parts.filter(p => !NUM_RE.test(p.s));

      if (nums.length === 0 && line.parts.every(p => p.x <= LEFT_MARGIN_MAX_X)) { group = text; continue; }
      if (nums.length === 0 && first.x >= INDENT_MIN_X && line.parts.every(p => p.x < NAME_COL_MAX_X)) {
        const prev = section.rows[section.rows.length - 1];
        if (!prev || prev.group !== group) throw new AssessmentPdfError(`Could not place the line "${text}" in ${section.name}.`);
        prev.name = `${prev.name} ${text}`; // task name wrapped onto the next line
        continue;
      }
      if (nums.length === 5 && words.length && first.x >= INDENT_MIN_X) {
        const [guideX, guideMin, x, min, minsPerWeek] = nums.map(p => parseInt(p.s, 10)); // columns in x order
        const name = words.map(p => p.s).join(' ');
        if (x * min !== minsPerWeek) {
          throw new AssessmentPdfError(`"${name}" reads as ${x}x/week × ${min} min but ${minsPerWeek} min/week on the sheet. Check the PDF.`);
        }
        section.rows.push({ group, name, guideX, guideMin, x, min, minsPerWeek });
        continue;
      }
      throw new AssessmentPdfError(`Unrecognised line in ${section.name}: "${text}". Add these tasks manually.`);
    }
  }

  if (!sections.length) throw new AssessmentPdfError('No service sections found in the assessment.');
  for (const s of sections) {
    const sum = s.rows.reduce((a, r) => a + r.minsPerWeek, 0);
    if (s.totalMinsPerWeek == null) throw new AssessmentPdfError(`${s.name} has no total on the sheet.`);
    if (sum !== s.totalMinsPerWeek) {
      throw new AssessmentPdfError(`${s.name}: rows add up to ${sum} min/week but the sheet total is ${s.totalMinsPerWeek}.`);
    }
  }

  // Same task name in two places (e.g. Mop Floor in Bathroom and Kitchen) gets its group.
  const rows = sections.flatMap(s => s.rows.filter(r => r.minsPerWeek > 0).map(r => ({ ...r, category: s.category })));
  const counts = rows.reduce((m, r) => (m[r.name] = (m[r.name] || 0) + 1, m), {});
  const tasks = rows.map(r => ({
    taskName: counts[r.name] > 1 && r.group ? `${r.name} (${r.group})` : r.name,
    category: r.category,
    weeklyFrequency: r.x,
    allottedMinutes: r.min,
    daysOfWeek: '',
    timeOfDay: 'any',
    description: r.group || '',
  }));

  return {
    source: 'midas_shc_pc_summary',
    member,
    sections: sections.map(s => ({ name: s.name, category: s.category, minsPerWeek: s.totalMinsPerWeek, tasks: s.rows.length })),
    assessmentTotals: { minsPerWeek: sections.reduce((a, s) => a + s.totalMinsPerWeek, 0) },
    tasks,
  };
}

module.exports = { parseMidasAssessmentPdf, AssessmentPdfError };
