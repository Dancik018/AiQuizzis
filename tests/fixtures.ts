import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export function fixtureLines() {
  const lines: { text: string; page: number; color?: string }[] = [];
  for (let i = 1; i <= 450; i++) {
    const page = Math.ceil(i / 5);
    if (i % 5 === 1)
      lines.push({ text: 'MINISTERUL EDUCATIEI', page }, { text: 'UNIVERSITATEA TEHNICA', page });
    const start =
      i % 4 === 0
        ? `${i})`
        : i % 4 === 1
          ? `${String(i).padStart(2, '0')}.`
          : i % 4 === 2
            ? `${i} -`
            : '';
    lines.push({
      text: `${start} Care este rezultatul adunarii ${i} cu 1?`.trim(),
      page,
      color: i % 3 === 0 ? '#0000ff' : '#000000',
    });
    if (i % 10 === 0) lines.push({ text: `Raspuns: ${i + 1}`, page });
    else
      lines.push(
        { text: `A. ${i}`, page },
        { text: `B. ${i + 1}`, page },
        { text: `C. ${i + 2}`, page },
        { text: `D. ${i + 3}`, page },
        { text: 'Raspuns: B', page },
      );
    if (i % 15 === 0)
      lines.push(
        { text: `${9000 + i}. What is the result of adding ${i} and 1?`, page, color: '#0000ff' },
        { text: `A. ${i}`, page },
        { text: `B. ${i + 1}`, page },
      );
    if (i % 5 === 0) lines.push({ text: `Pagina ${page}`, page });
  }
  lines.push(
    { text: '999. Care este rezultatul adunarii 1 cu 1?', page: 91 },
    { text: 'A. 1', page: 91 },
    { text: 'B. 2', page: 91 },
    { text: 'C. 3', page: 91 },
    { text: 'D. 4', page: 91 },
    { text: 'Raspuns: B', page: 91 },
  );
  return lines;
}
const escapeXml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function docxFixture(lines = fixtureLines()) {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = lines
    .map((l, i) => {
      const p = `<w:p>${i % 51 === 0 ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:rPr><w:color w:val="${(l.color || '#000000').slice(1)}"/><w:b/><w:sz w:val="24"/></w:rPr><w:t>${escapeXml(l.text)}</w:t></w:r></w:p>`;
      return i % 11 === 0 ? `<w:tbl><w:tr><w:tc>${p}</w:tc></w:tr></w:tbl>` : p;
    })
    .join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${ns}"><w:body>${paragraphs}</w:body></w:document>`,
      ),
    }),
  );
}
export async function pdfFixture(lines = fixtureLines()) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage();
  let y = 800;
  for (const line of lines) {
    if (y < 35) {
      page = pdf.addPage();
      y = 800;
    }
    page.drawText(line.text, {
      x: 40,
      y,
      size: 10,
      font,
      color: line.color === '#0000ff' ? rgb(0, 0, 1) : rgb(0, 0, 0),
    });
    y -= 15;
  }
  return Buffer.from(await pdf.save());
}

export function numberedDocxFixture() {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const p = (text: string, numId: number) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:rPr><w:color w:val="0000FF"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const content =
    p('Care este capitala Republicii Moldova?', 1) +
    p('București', 2) +
    p('Chișinău', 2) +
    '<w:p><w:r><w:t>Răspuns: B</w:t></w:r></w:p>' +
    p('Ce reprezintă Random Access Memory?', 1) +
    p('Memorie cu acces aleatoriu', 3) +
    p('Procesor central', 3) +
    '<w:p><w:r><w:t>Răspuns: A</w:t></w:r></w:p>';
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${ns}"><w:body>${content}</w:body></w:document>`,
      ),
      'word/numbering.xml': strToU8(
        `<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      ),
    }),
  );
}
