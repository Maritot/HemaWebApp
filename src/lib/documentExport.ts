/**
 * Hema Executive Document & Spreadsheet Exporter
 * Generates ChatGPT-quality standalone formatted HTML documents and Excel-ready CSV spreadsheets.
 */

export interface DocumentMetadata {
  title: string;
  filenameBase: string;
  rowCount: number;
  hasTable: boolean;
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
  const docKeywords = /(sheet|spreadsheet|csv|excel|document|doc|report|table|statement|export|download|list|names|who|givers|takers|breakdown|summary|details|జాబితా|షీట్|పట్టిక|రికార్డు|పేర్లు|ఎవరు|వివరాలు|तालिका|शीट|दस्तावेज|रिपोर्ट|नाम|किसने|विवरण)/i;

  return docKeywords.test(prompt) || prompt.length === 0;
}

/**
 * Extracts metadata and title from the assistant message
 */
export function extractDocumentMetadata(assistantText: string, defaultTitle: string = 'Household Financial Report'): DocumentMetadata {
  let title = defaultTitle;
  let rowCount = 0;

  // Try finding headline in text (e.g. **Gifts & Shagun Registry** or # Gifts)
  const boldHeaderMatch = assistantText.match(/\*\*([^*]+(Registry|Report|Ledger|Sheet|Summary|Gifts|Debts|Expenses|Overview)[^*]*)\*\*/i);
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
 * Converts Markdown table(s) embedded in text into clean, Excel-compatible CSV.
 * Crucially includes UTF-8 BOM (\uFEFF) so Microsoft Excel opens it with correct Rupee and Indian characters.
 */
export function extractMarkdownTablesAsCSV(markdown: string): string | null {
  if (!markdown || !markdown.includes('|')) return null;

  const lines = markdown.split('\n');
  const csvTables: string[] = [];
  let currentTableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const isDelimiter = /^\|[\s\-:|]+\|$/.test(trimmed);
      if (!isDelimiter) {
        currentTableLines.push(trimmed);
      }
      inTable = true;
    } else {
      if (inTable && currentTableLines.length > 0) {
        const rows = currentTableLines.map(row => {
          const cells = row.split('|').slice(1, -1).map(c => {
            let clean = c.trim()
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\*([^*]+)\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1');
            clean = clean.replace(/"/g, '""');
            return `"${clean}"`;
          });
          return cells.join(',');
        });
        csvTables.push(rows.join('\r\n'));
        currentTableLines = [];
      }
      inTable = false;
    }
  }

  if (inTable && currentTableLines.length > 0) {
    const rows = currentTableLines.map(row => {
      const cells = row.split('|').slice(1, -1).map(c => {
        let clean = c.trim()
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        clean = clean.replace(/"/g, '""');
        return `"${clean}"`;
      });
      return cells.join(',');
    });
    csvTables.push(rows.join('\r\n'));
  }

  if (csvTables.length === 0) return null;

  // Prepend UTF-8 BOM so Excel opens with proper UTF-8 decoding
  return '\uFEFF' + csvTables.join('\r\n\r\n');
}

/**
 * Generates an executive, styled HTML document from the assistant's markdown response.
 * Looks like a professionally formatted report that can be opened in any browser, Word, Google Docs,
 * or printed directly to PDF on mobile or desktop.
 */
export function generateExecutiveHtmlDocument(markdownText: string, metadata?: DocumentMetadata): string {
  const meta = metadata || extractDocumentMetadata(markdownText);
  const now = new Date();
  const formattedDate = now.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const formattedTime = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // Convert markdown to clean HTML
  const lines = markdownText.split('\n');
  const htmlParts: string[] = [];
  let inTable = false;
  let tableHeaderParsed = false;
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const isDelimiter = /^\|[\s\-:|]+\|$/.test(trimmed);
      if (isDelimiter) {
        continue; // delimiter handled by thead/tbody structure
      }

      if (!inTable) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        inTable = true;
        tableHeaderParsed = false;
        htmlParts.push('<div class="table-container"><table>');
      }

      const cells = trimmed.split('|').slice(1, -1).map(c => {
        let text = c.trim();
        // bold
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // italic
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return text;
      });

      if (!tableHeaderParsed) {
        htmlParts.push('<thead><tr>');
        cells.forEach(cell => {
          htmlParts.push(`<th>${cell}</th>`);
        });
        htmlParts.push('</tr></thead><tbody>');
        tableHeaderParsed = true;
      } else {
        htmlParts.push('<tr>');
        cells.forEach((cell, idx) => {
          // Check if cell looks like currency or number
          const isNumeric = /^[₹$€£\d,.\s+-]+$/.test(cell.replace(/<[^>]+>/g, '').trim());
          const alignClass = isNumeric && idx > 1 ? ' class="num-cell"' : '';
          htmlParts.push(`<td${alignClass}>${cell}</td>`);
        });
        htmlParts.push('</tr>');
      }
      continue;
    }

    if (inTable) {
      htmlParts.push('</tbody></table></div>');
      inTable = false;
    }

    // Unordered lists
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      if (!inList) {
        htmlParts.push('<ul class="report-list">');
        inList = true;
      }
      let content = trimmed.replace(/^[\*\-•]\s+/, '');
      content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      htmlParts.push(`<li>${content}</li>`);
      continue;
    }

    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }

    // Empty lines
    if (!trimmed) {
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      const text = trimmed.replace(/^#\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1');
      htmlParts.push(`<h1 class="report-h1">${text}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      const text = trimmed.replace(/^##\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1');
      htmlParts.push(`<h2 class="report-h2">${text}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      const text = trimmed.replace(/^###\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1');
      htmlParts.push(`<h3 class="report-h3">${text}</h3>`);
      continue;
    }

    // Regulatory note or disclaimer
    if (trimmed.startsWith('*(') && trimmed.endsWith(')*')) {
      const text = trimmed.slice(2, -2).trim();
      htmlParts.push(`<div class="disclaimer-note">ℹ️ ${text}</div>`);
      continue;
    }

    // Regular paragraphs
    let pContent = trimmed;
    pContent = pContent.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    pContent = pContent.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    htmlParts.push(`<p class="report-p">${pContent}</p>`);
  }

  if (inTable) {
    htmlParts.push('</tbody></table></div>');
  }
  if (inList) {
    htmlParts.push('</ul>');
  }

  const bodyHtml = htmlParts.join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title} - Hema Financial Ledger</title>
  <style>
    :root {
      --primary: #d97706;
      --primary-dark: #b45309;
      --navy: #0f172a;
      --slate-800: #1e293b;
      --slate-600: #475569;
      --slate-100: #f1f5f9;
      --slate-50: #f8fafc;
      --border: #e2e8f0;
      --emerald: #059669;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f3f4f6;
      color: var(--slate-800);
      line-height: 1.6;
      padding: 24px 12px;
      -webkit-font-smoothing: antialiased;
    }

    .document-card {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }

    /* Executive Header */
    .doc-header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      padding: 28px 32px;
      border-bottom: 4px solid var(--primary);
    }

    .doc-header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(217, 119, 6, 0.2);
      border: 1px solid rgba(217, 119, 6, 0.5);
      color: #fbbf24;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 4px 10px;
      border-radius: 6px;
    }

    .doc-date {
      font-size: 12px;
      color: #94a3b8;
      font-weight: 500;
    }

    .doc-title {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }

    .doc-subtitle {
      font-size: 13px;
      color: #cbd5e1;
      font-weight: 400;
    }

    /* Document Body */
    .doc-body {
      padding: 32px;
    }

    .report-p {
      font-size: 14px;
      color: #334155;
      margin-bottom: 16px;
      line-height: 1.65;
    }

    .report-h1 {
      font-size: 18px;
      font-weight: 800;
      color: var(--navy);
      margin: 24px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--border);
    }

    .report-h2 {
      font-size: 16px;
      font-weight: 700;
      color: var(--navy);
      margin: 20px 0 10px 0;
    }

    .report-h3 {
      font-size: 15px;
      font-weight: 700;
      color: var(--primary-dark);
      margin: 16px 0 8px 0;
    }

    .report-list {
      margin: 12px 0 18px 20px;
      font-size: 14px;
      color: #334155;
    }

    .report-list li {
      margin-bottom: 6px;
      padding-left: 4px;
    }

    /* Tables */
    .table-container {
      overflow-x: auto;
      margin: 24px 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13.5px;
    }

    thead {
      background: #0f172a;
      color: #ffffff;
    }

    th {
      padding: 12px 14px;
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #f8fafc;
      border-bottom: 1px solid #334155;
      white-space: nowrap;
    }

    td {
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      color: #1e293b;
      white-space: nowrap;
    }

    tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }

    tbody tr:hover {
      background-color: #f1f5f9;
    }

    .num-cell {
      text-align: right;
      font-weight: 600;
      font-feature-settings: "tnum";
    }

    /* Disclaimer & Footer */
    .disclaimer-note {
      background: #fffbeb;
      border-left: 4px solid var(--primary);
      padding: 10px 14px;
      border-radius: 0 8px 8px 0;
      font-size: 12px;
      color: #92400e;
      margin: 20px 0;
      font-style: italic;
    }

    .doc-footer {
      border-top: 1px solid var(--border);
      padding: 20px 32px;
      background: #f8fafc;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748b;
    }

    .footer-left {
      font-weight: 600;
    }

    .footer-right {
      color: #94a3b8;
    }

    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .document-card {
        border: none;
        box-shadow: none;
        max-width: 100%;
      }
      .doc-header {
        background: #0f172a !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      th {
        background: #0f172a !important;
        color: #ffffff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      .doc-header {
        padding: 20px 18px;
      }
      .doc-body {
        padding: 20px 16px;
      }
      .doc-footer {
        padding: 16px 18px;
        flex-direction: column;
        gap: 6px;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="document-card">
    <div class="doc-header">
      <div class="doc-header-top">
        <div class="brand-badge">🏛️ Hema Financial Ledger</div>
        <div class="doc-date">${formattedDate} • ${formattedTime}</div>
      </div>
      <h1 class="doc-title">${meta.title}</h1>
      <p class="doc-subtitle">Official Household Intelligence Report · Verified Grounded Ledger</p>
    </div>

    <div class="doc-body">
      ${bodyHtml}
    </div>

    <div class="doc-footer">
      <div class="footer-left">Generated by Hema AI • Household Financial Companion</div>
      <div class="footer-right">Confidential Personal Household Ledger • Keep Secure</div>
    </div>
  </div>
</body>
</html>`;
}
