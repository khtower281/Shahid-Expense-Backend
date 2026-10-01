const PDFDocument = require('pdfkit');

/* Brand palette */
const COLORS = {
  primary: '#1E3A8A',
  accent: '#2563EB',
  text: '#0F172A',
  muted: '#64748B',
  rowAlt: '#F8FAFC',
  border: '#E2E8F0',
  pkr: '#1D4ED8',
  usd: '#059669',
  white: '#FFFFFF'
};

const PAGE_MARGIN = 40;

/* ------------------------------------------------------------------ */
/*                              UTILITIES                             */
/* ------------------------------------------------------------------ */
const formatDate = (d) => {
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
};

const formatMoney = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const truncate = (str, max) => {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
};

/**
 * Shrink font size to fit a string in a given width.
 * Returns the font size (never larger than maxSize, never below minSize).
 */
const fitFontSize = (doc, text, maxWidth, maxSize, minSize = 6, font = 'Helvetica') => {
  let size = maxSize;
  doc.font(font).fontSize(size);
  while (doc.widthOfString(String(text)) > maxWidth && size > minSize) {
    size -= 0.25;
    doc.font(font).fontSize(size);
  }
  return size;
};

/* ------------------------------------------------------------------ */
/*                          MAIN BUILDER                              */
/* ------------------------------------------------------------------ */
const buildTransactionsPDF = ({ transactions, totals, filters, admin, res }) => {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });

  const filename = `shahid-expense-${Date.now()}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  doc.pipe(res);

  /* ------------------------------------------------------------------ */
  /*                              HEADER                                */
  /* ------------------------------------------------------------------ */
  const headerH = 96;
  doc.rect(0, 0, doc.page.width, headerH).fill(COLORS.primary);

  doc
    .fillColor(COLORS.white)
    .fontSize(22)
    .font('Helvetica-Bold')
    .text('Shahid Expense', PAGE_MARGIN, 26);

  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#BFDBFE')
    .text('Transaction Report', PAGE_MARGIN, 56);

  const rightColX = doc.page.width - PAGE_MARGIN;
  doc
    .fontSize(9)
    .fillColor(COLORS.white)
    .text(`Generated: ${new Date().toLocaleString()}`, PAGE_MARGIN, 30, {
      width: rightColX - PAGE_MARGIN,
      align: 'right'
    });

  doc
    .fontSize(9)
    .fillColor('#BFDBFE')
    .text(`Admin: ${admin?.username || 'admin'}`, PAGE_MARGIN, 46, {
      width: rightColX - PAGE_MARGIN,
      align: 'right'
    });

  /* ------------------------------------------------------------------ */
  /*                       FILTER SUMMARY (optional)                    */
  /* ------------------------------------------------------------------ */
  let y = headerH + 20;

  const filterLines = [];
  if (filters.startDate || filters.endDate) {
    filterLines.push(`Date range:  ${filters.startDate || '—'}  →  ${filters.endDate || '—'}`);
  }
  if (filters.status) filterLines.push(`Status:  ${filters.status}`);
  if (filters.paymentMethod) filterLines.push(`Payment method:  ${filters.paymentMethod}`);
  if (filters.currency) filterLines.push(`Currency:  ${filters.currency}`);
  if (filters.search) filterLines.push(`Search:  "${filters.search}"`);
  if (filters.category) filterLines.push(`Category filter applied`);

  if (filterLines.length) {
    doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica-Oblique')
       .text('Filters applied:', PAGE_MARGIN, y);
    y += 14;

    filterLines.forEach((line) => {
      doc.fillColor(COLORS.text).fontSize(9).font('Helvetica')
         .text(`•  ${line}`, PAGE_MARGIN + 6, y);
      y += 12;
    });
    y += 8;
  }

  /* ------------------------------------------------------------------ */
  /*                          SUMMARY CARDS                             */
  /* ------------------------------------------------------------------ */
  const cardGap = 12;
  const cardW = (doc.page.width - PAGE_MARGIN * 2 - cardGap * 2) / 3;
  const cardH = 72;
  const cardY = y;

  const drawCard = (x, label, value, valueColor) => {
    doc
      .roundedRect(x, cardY, cardW, cardH, 8)
      .fillAndStroke(COLORS.white, COLORS.border);

    doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica')
       .text(label, x + 14, cardY + 14, { width: cardW - 28, lineBreak: false });

    const valueStr = String(value);
    const valueSize = fitFontSize(doc, valueStr, cardW - 28, 15, 9, 'Helvetica-Bold');

    doc.fillColor(valueColor).fontSize(valueSize).font('Helvetica-Bold')
       .text(valueStr, x + 14, cardY + 38, {
         width: cardW - 28,
         lineBreak: false,
         ellipsis: true
       });
  };

  drawCard(PAGE_MARGIN, 'Transactions', String(transactions.length), COLORS.text);
  drawCard(PAGE_MARGIN + cardW + cardGap, 'Total PKR', `Rs ${formatMoney(totals.PKR)}`, COLORS.pkr);
  drawCard(PAGE_MARGIN + (cardW + cardGap) * 2, 'Total USD', `$ ${formatMoney(totals.USD)}`, COLORS.usd);

  y = cardY + cardH + 22;

  /* ------------------------------------------------------------------ */
  /*                            TABLE SETUP                             */
  /* ------------------------------------------------------------------ */
  const tableW = doc.page.width - PAGE_MARGIN * 2;

  /*
   * Column layout — 5 columns.
   * A4 content width = 595 - 80 = 515 pt.
   *
   *   Date        :  70
   *   Description : 160
   *   Category    : 100
   *   Amount      : 100   ← widened so Rs 100,000,000.00 fits at 9pt
   *   Payment     :  85   ← widened so Check #numbers fit
   *   ---------------------
   *   Total       : 515
   */
  const cols = [
    { key: 'date',        label: 'Date',        width:  70, align: 'left'  },
    { key: 'description', label: 'Description', width: 160, align: 'left'  },
    { key: 'category',    label: 'Category',    width: 100, align: 'left'  },
    { key: 'amount',      label: 'Amount',      width: 100, align: 'right' },
    { key: 'payment',     label: 'Payment',     width:  85, align: 'left'  }
  ];

  const rowHeight = 26;         // slightly taller for breathing room
  const rowPaddingX = 8;
  const rowPaddingY = 9;        // vertical padding so text is vertically centered
  const headerHeight = 26;

  const drawTableHeader = () => {
    doc.rect(PAGE_MARGIN, y, tableW, headerHeight).fill(COLORS.accent);

    let x = PAGE_MARGIN;
    doc.fillColor(COLORS.white).fontSize(9).font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.label, x + rowPaddingX, y + 8, {
        width: c.width - rowPaddingX * 2,
        align: c.align,
        lineBreak: false,
        ellipsis: true
      });
      x += c.width;
    });

    y += headerHeight;
  };

  drawTableHeader();

  /* ------------------------------------------------------------------ */
  /*                             TABLE ROWS                             */
  /* ------------------------------------------------------------------ */
  let isAlt = false;

  transactions.forEach((t) => {
    /* Page break check */
    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawTableHeader();
      isAlt = false;
    }

    if (isAlt) {
      doc.rect(PAGE_MARGIN, y, tableW, rowHeight).fill(COLORS.rowAlt);
    }
    isAlt = !isAlt;

    const payment =
      t.paymentMethod === 'Check' && t.checkNumber
        ? `Check #${t.checkNumber}`
        : t.paymentMethod || '';

    const row = {
      date: formatDate(t.date),
      description: truncate(t.description, 26),
      category: truncate(t.category?.name || '—', 18),
      amount: `${t.currency === 'PKR' ? 'Rs' : '$'} ${formatMoney(t.amount)}`,
      payment
    };

    let x = PAGE_MARGIN;

    cols.forEach((c) => {
      const cellWidth = c.width - rowPaddingX * 2;
      const text = String(row[c.key]);
      const isAmount = c.key === 'amount';

      /* Pick base font */
      const font = isAmount ? 'Helvetica-Bold' : 'Helvetica';
      const baseSize = 9;

      /* Auto-shrink font if the value doesn't fit */
      const size = fitFontSize(doc, text, cellWidth, baseSize, 6, font);

      /* Color */
      if (isAmount) {
        doc.fillColor(t.currency === 'PKR' ? COLORS.pkr : COLORS.usd);
      } else {
        doc.fillColor(COLORS.text);
      }

      doc
        .font(font)
        .fontSize(size)
        .text(text, x + rowPaddingX, y + rowPaddingY, {
          width: cellWidth,
          align: c.align,
          lineBreak: false,
          ellipsis: true
        });

      x += c.width;
    });

    /* Row divider */
    doc
      .moveTo(PAGE_MARGIN, y + rowHeight)
      .lineTo(PAGE_MARGIN + tableW, y + rowHeight)
      .strokeColor(COLORS.border)
      .lineWidth(0.3)
      .stroke();

    y += rowHeight;
  });

  /* Bottom border of table */
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + tableW, y)
    .strokeColor(COLORS.accent)
    .lineWidth(1)
    .stroke();

  /* ------------------------------------------------------------------ */
  /*                            GRAND TOTAL                             */
  /* ------------------------------------------------------------------ */
  y += 20;

  /* Page-break guard */
  if (y + 60 > doc.page.height - 60) {
    doc.addPage();
    y = PAGE_MARGIN;
  }

  doc.fillColor(COLORS.text).fontSize(11).font('Helvetica-Bold')
     .text('Grand Total', PAGE_MARGIN, y, { lineBreak: false });

  doc.fillColor(COLORS.pkr).fontSize(11).font('Helvetica-Bold')
     .text(`Rs ${formatMoney(totals.PKR)}`, PAGE_MARGIN, y, {
       width: tableW,
       align: 'right',
       lineBreak: false,
       ellipsis: true
     });

  y += 18;

  doc.fillColor(COLORS.usd).fontSize(11).font('Helvetica-Bold')
     .text(`$ ${formatMoney(totals.USD)}`, PAGE_MARGIN, y, {
       width: tableW,
       align: 'right',
       lineBreak: false,
       ellipsis: true
     });

  /* ------------------------------------------------------------------ */
  /*                        FOOTER ON EVERY PAGE                        */
  /* ------------------------------------------------------------------ */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - 40;

    doc
      .moveTo(PAGE_MARGIN, fy - 6)
      .lineTo(doc.page.width - PAGE_MARGIN, fy - 6)
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .stroke();

    doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica')
       .text('Shahid Expense — Personal Finance Manager', PAGE_MARGIN, fy, {
         width: tableW,
         align: 'left',
         lineBreak: false
       })
       .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, fy, {
         width: tableW,
         align: 'right',
         lineBreak: false
       });
  }

  doc.end();
};

module.exports = { buildTransactionsPDF };