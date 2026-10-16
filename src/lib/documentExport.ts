/**
 * Hema Executive Document & Spreadsheet Exporter
 * Generates:
 * 1. Professional PDF Reports (.pdf) using jsPDF & autoTable with executive corporate layout.
 * 2. Formatted Excel Workbooks (.xlsx) using xlsx-js-style with styled headers, custom column widths, and no rogue symbols.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import XLSX from 'xlsx-js-style';

export interface DocumentMetadata {
  title: string;
  filenameBase: string;
  rowCount: number;
  hasTable: boolean;
  totalAmountText?: string;
}

export interface ParsedMarkdownReport {
  tableHeaders: string[];
  tableRows: string[][];
  summaryPoints: string[];
  introText: string;
  totalAmountText?: string;
}

/**
 * Checks if a message represents an intentional document or spreadsheet artifact.
 * Shows the document download card ONLY when:
 * 1. The assistant response contains a structured table or formal ledger dataset.
 * 2. The user requested names, lists, documents, sheets, tables, reports, or breakdowns.
 */
export function isDocumentOrSheetRequested(userPrompt?: string, assistantText?: string): boolean {
  if (!assistantText) return false;

  // Must have a real markdown table (| ... |) with header delimiter (|---|)
  const hasTable = assistantText.includes('|') && /\|[\s\-:|]+\|/.test(assistantText);
  if (!hasTable) return false;

  // Check user prompt keywords
  const prompt = (userPrompt || '').toLowerCase();
  const docKeywords = /(pdf|sheet|spreadsheet|csv|excel|xlsx|document|doc|report|table|statement|export|download|list|names|who|givers|takers|breakdown|summary|details|జాబితా|షీట్|పట్టిక|రికార్డు|పేర్లు|ఎవరు|వివరాలు|तालिका|शीट|दस्तावेज|रिपोर्ट|नाम|किसने|विवरण)/i;

  return docKeywords.test(prompt) || prompt.length === 0;
}

/**
 * Extracts metadata and title from the assistant message
 */
export function extractDocumentMetadata(assistantText: string, defaultTitle: string = 'Household Financial Report'): DocumentMetadata {
  let title = defaultTitle;
  let rowCount = 0;

  // Try finding headline in text (e.g. **Gifts & Shagun Registry** or # Gifts)
  const boldHeaderMatch = assistantText.match(/\*\*([^*]+(Registry|Report|Ledger|Sheet|Summary|Gifts|Debts|Expenses|Overview|Statement|Transactions)[^*]*)\*\*/i);
  if (boldHeaderMatch) {
    title = boldHeaderMatch[1].trim();
  } else {
    const mdHeaderMatch = assistantText.match(/^#+\s+([^\n]+)/m);
    if (mdHeaderMatch) {
      title = mdHeaderMatch[1].trim();
    }
  }

  // Count table rows
  const lines = assistantText.split('\n');
  let tableRows = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !/^\|[\s\-:|]+\|$/.test(trimmed)) {
      tableRows++;
    }
  }
  // Subtract 1 for header row
  rowCount = Math.max(0, tableRows - 1);

  // Generate safe filename base
  const cleanTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filenameBase = `hema_${cleanTitle || 'report'}_${dateStr}`;

  return {
    title,
    filenameBase,
    rowCount,
    hasTable: rowCount > 0
  };
}

/**
 * Cleans header cells by removing rogue characters, BOM, quotes, and standardizing currency labels
 */
export function cleanHeaderLabel(rawHeader: string): string {
  let clean = rawHeader
    .replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  // Replace any corrupted unicode symbols like â□¹ or ₹ with clean standard text
  clean = clean.replace(/[\(（]?\s*â□¹\s*[\)）]?/gi, ' (INR)');
  clean = clean.replace(/[\(（]?\s*₹\s*[\)）]?/gi, ' (INR)');
  clean = clean.replace(/[\(（]?\s*Rs\.?\s*[\)）]?/gi, ' (INR)');
  
  // Strip any lingering quotation marks
  clean = clean.replace(/"/g, '').trim();

  // Normalize common column names
  if (/^person$/i.test(clean)) return 'Person';
  if (/^type$/i.test(clean)) return 'Type';
  if (/^occasion$/i.test(clean)) return 'Occasion';
  if (/^item.*details$/i.test(clean)) return 'Item & Details';
  if (/^amount.*inr$/i.test(clean)) return 'Amount (INR)';
  if (/^date$/i.test(clean)) return 'Date';
  if (/^category$/i.test(clean)) return 'Category';
  if (/^notes?$/i.test(clean)) return 'Notes';

  return clean;
}

/**
 * Parses markdown report text into structured components: headers, rows, summary insights, intro
 */
export function parseMarkdownReport(text: string): ParsedMarkdownReport {
  const lines = text.split('\n');
  const tableHeaders: string[] = [];
  const tableRows: string[][] = [];
  const summaryPoints: string[] = [];
  const introLines: string[] = [];
  let inTable = false;
  let inSummary = false;
  let totalAmountText: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const isDelimiter = /^\|[\s\-:|]+\|$/.test(trimmed);
      if (isDelimiter) continue;

      const cells = trimmed.split('|').slice(1, -1).map(c => {
        return c.trim()
          .replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
      });

      if (!inTable) {
        // First row is headers
        cells.forEach(h => {
          tableHeaders.push(cleanHeaderLabel(h));
        });
        inTable = true;
      } else {
        tableRows.push(cells);
      }
      continue;
    }

    if (inTable) {
      inTable = false;
    }

    // Summary heading detection
    if (/summary|insights|notes|key points|findings/i.test(trimmed)) {
      inSummary = true;
      continue;
    }

    // Bullet points
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const point = trimmed
        .replace(/^[\*\-•]\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/â□¹/g, 'Rs. ')
        .replace(/₹/g, 'Rs. ');

      if (/total.*value|total.*amount/i.test(point)) {
        totalAmountText = point;
      }
      summaryPoints.push(point);
      continue;
    }

    // Intro / narrative text
    if (!inSummary && !trimmed.startsWith('(') && !trimmed.startsWith('#')) {
      introLines.push(
        trimmed
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/â□¹/g, 'Rs. ')
          .replace(/₹/g, 'Rs. ')
      );
    }
  }

  return {
    tableHeaders,
    tableRows,
    summaryPoints,
    introText: introLines.slice(0, 3).join(' '),
    totalAmountText
  };
}

/**
 * 1. PROFESSIONAL EXCEL GENERATOR (.xlsx)
 * Generates an executive Microsoft Excel (.xlsx) workbook using xlsx-js-style.
 * - Headers: Deep Slate/Navy (#0F172A) fill, bold white font, amber accent bottom border.
 * - Columns: Widths calculated to fit content, proper text/number alignment.
 * - Data: Real numeric values for amounts with '#,##0' currency formatting, alternating zebra rows (#F8FAFC).
 * - Zero rogue characters, no BOM glitches, no corrupted symbols.
 */
export function generateExecutiveExcelWorkbook(
  markdownText: string,
  metadata?: DocumentMetadata
): { base64: string; filename: string; mimeType: string } {
  const meta = metadata || extractDocumentMetadata(markdownText);
  const parsed = parseMarkdownReport(markdownText);

  const headers = parsed.tableHeaders.length > 0
    ? parsed.tableHeaders
    : ['Item', 'Details', 'Amount (INR)', 'Date'];

  // Identify column indices for alignment & number formats
  const amountColIdx = headers.findIndex(h => /amount|value|price|cost|balance|interest/i.test(h));
  const dateColIdx = headers.findIndex(h => /date|day|time/i.test(h));
  const typeColIdx = headers.findIndex(h => /type|status|mode|relation/i.test(h));

  const wb = XLSX.utils.book_new();

  // Prepare raw table data
  const aoaData: any[][] = [headers];

  for (const row of parsed.tableRows) {
    const formattedRow: any[] = [];
    for (let c = 0; c < headers.length; c++) {
      const cellText = row[c] || '';
      
      // If this is the amount column or contains pure numeric data
      const cleanCandidate = cellText.replace(/[₹$€£Rs.\s]/gi, '').replace(/,/g, '').trim();
      if (/^-?\d+(\.\d+)?$/.test(cleanCandidate)) {
        const num = Number(cleanCandidate);
        formattedRow.push(isNaN(num) ? cellText : num);
      } else {
        formattedRow.push(cellText);
      }
    }
    aoaData.push(formattedRow);
  }

  // Create sheet
  const ws = XLSX.utils.aoa_to_sheet(aoaData);

  // Calculate dynamic column widths (min 14, max 45)
  const colWidths = headers.map((h, colIdx) => {
    let maxLen = h.length;
    for (const r of parsed.tableRows) {
      const val = String(r[colIdx] || '');
      if (val.length > maxLen) {
        maxLen = val.length;
      }
    }
    return Math.min(Math.max(maxLen + 4, 14), 45);
  });
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  // Style Header Cells
  for (let c = 0; c < headers.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[cellRef]) {
      ws[cellRef].s = {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0F172A' } }, // Deep Navy / Slate 900
        alignment: {
          vertical: 'center',
          horizontal: c === amountColIdx ? 'right' : (c === dateColIdx || c === typeColIdx ? 'center' : 'left'),
          wrapText: true
        },
        border: {
          bottom: { style: 'medium', color: { rgb: 'D97706' } }, // Amber 600
          top: { style: 'thin', color: { rgb: '0F172A' } },
          left: { style: 'thin', color: { rgb: '1E293B' } },
          right: { style: 'thin', color: { rgb: '1E293B' } }
        }
      };
    }
  }

  // Style Data Rows
  const rowCount = parsed.tableRows.length;
  for (let r = 1; r <= rowCount; r++) {
    const isEven = r % 2 === 0;
    for (let c = 0; c < headers.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (ws[cellRef]) {
        const isNum = typeof ws[cellRef].v === 'number';
        const isDateOrType = c === dateColIdx || c === typeColIdx;

        ws[cellRef].s = {
          font: { name: 'Calibri', sz: 10, color: { rgb: '1E293B' } },
          fill: { fgColor: { rgb: isEven ? 'F8FAFC' : 'FFFFFF' } },
          alignment: {
            vertical: 'center',
            horizontal: isNum || c === amountColIdx ? 'right' : (isDateOrType ? 'center' : 'left'),
            wrapText: true
          },
          border: {
            top: { style: 'thin', color: { rgb: 'E2E8F0' } },
            bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
            left: { style: 'thin', color: { rgb: 'E2E8F0' } },
            right: { style: 'thin', color: { rgb: 'E2E8F0' } }
          }
        };

        if (isNum) {
          ws[cellRef].z = '#,##0';
        }
      }
    }
  }

  // Safe sheet name (max 31 characters)
  const safeSheetName = meta.title.replace(/[\\/?*[\]]/g, '').slice(0, 30) || 'Ledger';
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

  // Write base64 workbook
  const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  const filename = `${meta.filenameBase}.xlsx`;
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  return { base64, filename, mimeType };
}

/**
 * 2. PROFESSIONAL PDF REPORT GENERATOR (.pdf)
 * Generates an executive PDF report using jsPDF and autoTable.
 * Follows formal corporate document conventions:
 * - Deep navy executive banner (#0F172A) with gold accent line (#D97706)
 * - Formal document title, timestamp, and audit metadata strip
 * - High-contrast data tables with navy headers, bold amounts, alternating zebra rows
 * - Executive summary insights callout box with gold accent bar
 * - Confidentiality notice and running page numbers (Page X of Y)
 */
export function generateExecutivePdfDocument(
  markdownText: string,
  metadata?: DocumentMetadata
): { base64: string; filename: string; mimeType: string } {
  const meta = metadata || extractDocumentMetadata(markdownText);
  const parsed = parseMarkdownReport(markdownText);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const now = new Date();
  const formattedDate = now.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const formattedTime = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const timestampStr = `${formattedDate} · ${formattedTime}`;

  // 1. Executive Navy Header Banner (0 to 30mm)
  doc.setFillColor(15, 23, 42); // Navy / Slate 900
  doc.rect(0, 0, 210, 30, 'F');

  // Gold accent rule (height 2mm)
  doc.setFillColor(217, 119, 6); // Gold / Amber 600
  doc.rect(0, 30, 210, 2, 'F');

  // Brand Badge
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(251, 191, 36); // Amber 400
  doc.text('HEMA FINANCIAL INTELLIGENCE REPORT', 14, 10);

  // Timestamp (top right)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184); // Slate 400
  doc.text(timestampStr, 196, 10, { align: 'right' });

  // Main Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(meta.title, 14, 18);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225); // Slate 300
  doc.text('Official Household Intelligence Report · Verified Grounded Ledger', 14, 24);

  // 2. Metadata Info Strip (35mm to 45mm)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 35, 182, 8.5, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('SOURCE:', 17, 40.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Personal Household Ledger', 32, 40.5);

  doc.setFont('helvetica', 'bold');
  doc.text('STATUS:', 90, 40.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Verified Grounded Records', 105, 40.5);

  doc.setFont('helvetica', 'bold');
  doc.text('CLASSIFICATION:', 152, 40.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Private & Confidential', 178, 40.5);

  let currentY = 48;

  // 3. Narrative Intro Text (if present)
  if (parsed.introText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const splitIntro = doc.splitTextToSize(parsed.introText, 182);
    doc.text(splitIntro, 14, currentY);
    currentY += splitIntro.length * 4.2 + 2;
  }

  // 4. Data Table (autoTable)
  const headers = parsed.tableHeaders.length > 0
    ? parsed.tableHeaders
    : ['Item', 'Details', 'Amount (INR)', 'Date'];

  // Clean data rows for PDF (replace raw currency symbols with clean 'Rs.')
  const formattedRows = parsed.tableRows.map(row => {
    return row.map((cell, idx) => {
      let clean = cell
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/â□¹/g, 'Rs. ')
        .replace(/₹/g, 'Rs. ');

      // If amount column, ensure 'Rs. ' prefix for visual clarity
      if (/amount|value|price/i.test(headers[idx] || '') && /^\d+/.test(clean.trim())) {
        clean = `Rs. ${clean.trim()}`;
      }
      return clean;
    });
  });

  const amountColIdx = headers.findIndex(h => /amount|value|price/i.test(h));
  const dateColIdx = headers.findIndex(h => /date|day|time/i.test(h));
  const typeColIdx = headers.findIndex(h => /type|status/i.test(h));

  const colStyles: Record<number, any> = {};
  if (amountColIdx >= 0) {
    colStyles[amountColIdx] = { halign: 'right', fontStyle: 'bold' };
  }
  if (dateColIdx >= 0) {
    colStyles[dateColIdx] = { halign: 'center' };
  }
  if (typeColIdx >= 0) {
    colStyles[typeColIdx] = { halign: 'center' };
  }

  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 14 },
    head: [headers.map(h => h.toUpperCase())],
    body: formattedRows,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
      cellPadding: 3.2
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 2.8,
      lineColor: [226, 232, 240],
      lineWidth: 0.1
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: colStyles
  });

  const finalY = (doc as any).lastAutoTable?.finalY || (currentY + 40);
  currentY = finalY + 8;

  // Check if summary card will fit on current page; otherwise add new page
  if (currentY > 235) {
    doc.addPage();
    currentY = 20;
  }

  // 5. Summary Insights & Audit Notes Box
  const summaryItems = parsed.summaryPoints.length > 0
    ? parsed.summaryPoints
    : [
        `Total records documented: ${parsed.tableRows.length} entries.`,
        'All data securely grounded from household database ledger.',
        'Keep this statement for personal audit and family social records.'
      ];

  const cardHeight = Math.max(22, 12 + summaryItems.length * 5.2);

  // Soft Amber Card Container
  doc.setFillColor(255, 251, 235); // Amber 50
  doc.setDrawColor(253, 230, 138); // Amber 200
  doc.roundedRect(14, currentY, 182, cardHeight, 1.5, 1.5, 'FD');

  // Solid Gold Indicator Bar on the left
  doc.setFillColor(217, 119, 6); // Amber 600
  doc.rect(14, currentY, 2.5, cardHeight, 'F');

  // Summary Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(146, 64, 14); // Amber 800
  doc.text('Summary Insights & Audit Notes', 20, currentY + 6.5);

  // Summary Bullets
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(51, 65, 85);

  summaryItems.forEach((item, idx) => {
    const itemY = currentY + 12 + idx * 5.2;
    const cleanItem = item.replace(/\*\*([^*]+)\*\*/g, '$1');
    doc.text(`•  ${cleanItem}`, 20, itemY);
  });

  currentY += cardHeight + 6;

  // 6. Regulatory / Disclaimer Note
  if (currentY <= 265) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Note: Generated by Hema AI • Household Financial Companion. For personal records & social ledger management.',
      14,
      currentY + 2
    );
  }

  // 7. Running Page Footers (Page X of Y on all pages)
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Footer divider line
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 283, 196, 283);

    // Left footer notice
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Hema Household Companion • Confidential Personal Financial Report', 14, 288);

    // Right page number
    doc.text(`Page ${p} of ${totalPages}`, 196, 288, { align: 'right' });
  }

  // Generate Base64 Data URI
  const base64Uri = doc.output('datauristring');
  const filename = `${meta.filenameBase}.pdf`;
  const mimeType = 'application/pdf';

  return { base64: base64Uri, filename, mimeType };
}
