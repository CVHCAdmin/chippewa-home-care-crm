// services/signedPdf.js — produce the signed PDFs for e-signature requests.
//
// fillBid()            fills the OFFICIAL DHS F-82064 Background Information Disclosure
//                      (fillable PDF in src/assets/forms) from the signer's answers, stamps
//                      the drawn signature into the state's signature box, and adds an
//                      electronic-signature record line. The form is flattened so the
//                      answers can't be edited afterwards.
// appendSignaturePage() takes an uploaded document (a policy PDF) and appends a page
//                      with the acknowledgement statement, the signature and the record.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const BID_TEMPLATE = path.join(__dirname, '..', 'assets', 'forms', 'F-82064-BID.pdf');

// The 12 disclosure questions: our key → [radio field, Yes option, No option, describe field, label]
const BID_QUESTIONS = [
  ['pending',     'Pending criminal charges', 'Yes_2', 'No_2', 'Describe the charge', '1. Pending criminal charges'],
  ['convictions', 'Convictions for crimes', 'Yes_3', 'No_3', 'Describe the convictions for crimes', '2. Convictions for crimes'],
  ['abuseChild',  'Abuse or neglect of a child', 'Yes_4', 'No_4', 'Describe the abuse or neglect of a child', '3. Abuse or neglect of a child'],
  ['abuseAdult',  'Abuse or neglect of an adult', 'Yes_5', 'No_5', 'Describe the abuse or neglect of an adult', '4. Abuse or neglect of an adult'],
  ['stealing',    'Stealing or other misappropriation', 'Yes_6', 'No_6', 'Describe the stealing or other misappropriation', '5. Stealing or other misappropriation'],
  ['credential',  'Restriction on credentials', 'Yes_7', 'No_7', 'Describe the restriction on credentials', '6. Restriction on credential'],
  ['license',     'Denial revocation or limitation on license certification or registration', 'Yes_8', 'No_8', 'The license, certification, or registration', '7. Denial, revocation, or limitation on license, certification, or registration'],
  ['premises',    'Denial, revocation, or limitation on ability to reside on certain premises', 'Yes_9', 'No_9', 'Describe the denial, revocation, or limitation on ability to reside on certain premises', '8. Denial, revocation, or limitation on ability to reside on certain premises'],
  ['rehab',       'Rehabilitation review', 'Yes_10', 'No_10', 'Describe the rehabilitation review', '9. Rehabilitation review'],
  ['armed',       'Armed forces discharge', 'Yes_11', 'No_11', 'Month and year of discharge', '10. Armed forces (month and year of discharge)'],
  ['outOfState',  'Out-of-state residence', 'Yes_12', 'No_12', 'If yes list each state and the dates you resided there', '11. Out-of-state residence (last 3 years)'],
  ['govEmployee', 'Government employee', 'Yes_14', 'No_14', null, '12. Government employee'],
  ['outsideWi7',  'Resided outside of Wisconsin in the last seven years', 'Yes_13', 'No_13', 'If yes list each state and the dates you resided there_2', '12. Resided outside Wisconsin in the last 7 years'],
];
// Describe fields that are one line on the form; longer answers go to the additional page.
const SINGLE_LINE_MAX = 70;
const MULTI_LINE_MAX = 170;
const MULTI_LINE_FIELDS = new Set(BID_QUESTIONS.slice(0, 7).map(q => q[4]));

const dataUriToBytes = (dataUri) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUri || ''));
  if (!m) throw Object.assign(new Error('Signature must be a PNG image.'), { status: 400 });
  return Buffer.from(m[1], 'base64');
};

const recordLine = ({ typedName, signedAt, ip }) =>
  `Signed electronically by ${typedName} on ${signedAt} (America/Chicago) from IP ${ip || 'unknown'} via the CVHC e-signature system.`;

async function fillBid(answers, { signaturePng, typedName, signedDate, signedAt, ip, employer }) {
  const doc = await PDFDocument.load(fs.readFileSync(BID_TEMPLATE));
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const setText = (name, value, size = 9) => {
    if (value == null || value === '') return;
    const f = form.getTextField(name);
    f.setFontSize(size);
    f.setText(String(value));
  };

  form.getCheckBox('Applicantemployee').check();
  setText('Describe the position for which you are applying or renewing', answers.position);
  setText('Name First', answers.firstName);
  setText('Name Middle', answers.middleName);
  setText('Name Last', answers.lastName);
  form.getRadioGroup('Have you had or used any other names including prior to marriage').select(answers.otherNames ? 'Yes' : 'No');
  if (answers.otherNames) setText('If yes list each name fully', answers.otherNamesList);
  setText('Social Security number', answers.ssn);
  setText('Date of birth MMDDYYYY', answers.dob);
  if (answers.sex === 'Male' || answers.sex === 'Female') form.getRadioGroup('Sex').select(answers.sex);
  setText('Phone number', answers.phone);
  setText('Address  Street', answers.street);
  setText('City', answers.city);
  setText('State', answers.state);
  setText('ZIP code', answers.zip);

  setText('Name of employer or organization that asked you to complete this form', employer.name);
  setText('Address  Street_2', employer.street);
  setText('City_2', employer.city);
  setText('State_2', employer.state);
  setText('ZIP code_2', employer.zip);

  const overflow = [];
  for (const [key, radio, yes, no, describe, label] of BID_QUESTIONS) {
    const a = (answers.questions || {})[key] || {};
    form.getRadioGroup(radio).select(a.yes ? yes : no);
    if (a.yes && describe && a.describe) {
      const max = MULTI_LINE_FIELDS.has(describe) ? MULTI_LINE_MAX : SINGLE_LINE_MAX;
      if (a.describe.length > max) {
        setText(describe, 'See additional page (page 5).', 8);
        overflow.push(`${label}:\n${a.describe}`);
      } else {
        setText(describe, a.describe, MULTI_LINE_FIELDS.has(describe) ? 8 : 9);
      }
    }
  }
  if (overflow.length) setText('Additional BID information', overflow.join('\n\n'), 10);

  setText('Date signed', signedDate);
  form.updateFieldAppearances(font);

  // Signature: drawn into the state's signature box on page 4 (the /Sig field can't hold an image).
  const sigField = form.getField('Signature  Person completing this form');
  const widget = sigField.acroField.getWidgets()[0];
  const rect = widget.getRectangle();
  const pages = doc.getPages();
  const page = pages.find(p => p.ref === widget.P()) || pages[3];
  const png = await doc.embedPng(dataUriToBytes(signaturePng));
  const h = 30; const w = Math.min(rect.width, (png.width / png.height) * h);
  page.drawImage(png, { x: rect.x + 4, y: rect.y - 4, width: w, height: h });
  page.drawText(recordLine({ typedName, signedAt, ip }), { x: 54, y: rect.y - 40, size: 7, font, color: rgb(0.25, 0.25, 0.25), maxWidth: 504 });

  form.flatten();
  removeDanglingAnnots(doc);
  return Buffer.from(await doc.save());
}

// pdf-lib's flatten() deletes the field widgets but can leave their references in each
// page's /Annots and in the AcroForm, which some viewers report as a damaged file.
function removeDanglingAnnots(doc) {
  const { PDFName, PDFArray } = require('pdf-lib');
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    const keep = annots.asArray().filter(ref => doc.context.lookup(ref) !== undefined);
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  doc.catalog.delete(PDFName.of('AcroForm'));
}

async function appendSignaturePage(pdfBase64, { title, version, signerName, typedName, signedAt, ip, userAgent, signaturePng }) {
  const doc = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  let y = 720;
  const line = (text, { size = 11, f = font, gap = 18 } = {}) => {
    page.drawText(text, { x: 72, y, size, font: f, maxWidth: 468, lineHeight: size + 3 });
    y -= gap;
  };
  line('Acknowledgement and Signature', { size: 16, f: bold, gap: 30 });
  line(`Document: ${title}${version ? ` (version ${version})` : ''}`, { gap: 18 });
  line(`Employee: ${signerName}`, { gap: 30 });
  line('I acknowledge that I have received and read this document, that I understand it,', { gap: 15 });
  line('and that I agree to follow it as a condition of my employment with', { gap: 15 });
  line('Chippewa Valley Home Care LLC.', { gap: 40 });
  const png = await doc.embedPng(dataUriToBytes(signaturePng));
  const h = 50; const w = Math.min(300, (png.width / png.height) * h);
  page.drawImage(png, { x: 72, y: y - h + 10, width: w, height: h });
  y -= h + 4;
  page.drawLine({ start: { x: 72, y }, end: { x: 372, y }, thickness: 0.75, color: rgb(0, 0, 0) });
  y -= 16;
  line(`Signature: ${typedName}`, { gap: 16 });
  line(`Date signed: ${signedAt} (America/Chicago)`, { gap: 30 });
  line(recordLine({ typedName, signedAt, ip }), { size: 8, gap: 12 });
  if (userAgent) line(`Device: ${String(userAgent).slice(0, 160)}`, { size: 7, gap: 12 });
  return Buffer.from(await doc.save());
}

// One PDF of every signed document, for handing to an MCO / auditor.
async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const b of buffers) {
    const src = await PDFDocument.load(b, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return Buffer.from(await out.save());
}

module.exports = { fillBid, appendSignaturePage, mergePdfs, BID_QUESTIONS };
