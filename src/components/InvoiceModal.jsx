import { useState, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { formatDuration, formatDecimal, formatMoney, toDisplayTime, weekStart, formatMonthLabel, weekRangeLabel, unpaidBreakMins, todayStr, downloadFile } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function InvoiceModal() {
  const { showInvoice, setShowInvoice, entries, projects, settings, hourlyRate } = useApp();

  // Filter controls
  const [projectFilter, setProjectFilter] = useState("__all__");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => todayStr());
  const [invoiceNumber, setInvoiceNumber] = useState(() => `INV-${new Date().getFullYear()}-001`);
  const [notes, setNotes] = useState("");

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (e.date < dateFrom || e.date > dateTo) return false;
      if (projectFilter !== "__all__" && !(e.project_ids || []).includes(projectFilter)) return false;
      return true;
    });
  }, [entries, dateFrom, dateTo, projectFilter]);

  const billable = filtered.filter((e) => e.billable !== false);
  const totalMins = filtered.reduce((a, e) => a + e.minutes, 0);
  const billableMins = billable.reduce((a, e) => a + e.minutes, 0);
  const totalEarnings = (billableMins / 60) * hourlyRate;

  const project = projects.find((p) => String(p.id) === projectFilter);

  async function downloadPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF();
    const teal = [13, 148, 136];
    const dark = [15, 23, 42];
    const gray = [100, 116, 139];
    const light = [241, 245, 249];

    // Header
    doc.setFontSize(22);
    doc.setTextColor(...teal);
    doc.setFont("helvetica", "bold");
    doc.text("INVOICE", 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(...gray);
    doc.setFont("helvetica", "normal");
    doc.text(`Invoice #: ${invoiceNumber}`, 14, 30);
    doc.text(`Date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, 14, 36);
    doc.text(`Period: ${dateFrom} – ${dateTo}`, 14, 42);

    if (settings.name) {
      doc.setFontSize(11);
      doc.setTextColor(...dark);
      doc.setFont("helvetica", "bold");
      doc.text("From:", 140, 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(settings.name, 140, 28);
    }

    if (project && project.client_name) {
      doc.setFontSize(11);
      doc.setTextColor(...dark);
      doc.setFont("helvetica", "bold");
      doc.text("Bill To:", 14, 58);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(project.client_name, 14, 64);
      if (project.name) doc.text(`Project: ${project.name}`, 14, 70);
    }

    // Build rows grouped by date
    const byDate = {};
    for (const e of filtered) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    }
    const rows = [];
    for (const date of Object.keys(byDate).sort()) {
      for (const e of byDate[date]) {
        const hrs = formatDecimal(e.minutes);
        const earned = hourlyRate > 0 && e.billable !== false ? formatMoney((e.minutes / 60) * hourlyRate) : "—";
        rows.push([
          date,
          `${toDisplayTime(e.start)} – ${toDisplayTime(e.end)}`,
          e.description || "",
          e.billable !== false ? "Yes" : "No",
          hrs,
          earned,
        ]);
      }
    }

    const startY = project?.client_name ? 78 : 54;

    autoTable(doc, {
      startY,
      head: [["Date", "Time", "Description", "Billable", "Hours", "Amount"]],
      body: rows,
      headStyles: { fillColor: teal, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 32 },
        2: { cellWidth: 70 },
        3: { cellWidth: 16 },
        4: { cellWidth: 16 },
        5: { cellWidth: 24 },
      },
      alternateRowStyles: { fillColor: light },
      margin: { left: 14, right: 14 },
    });

    const finalY = doc.lastAutoTable.finalY + 8;

    // Totals
    const col1 = 140, col2 = 182;
    doc.setFontSize(10);
    doc.setTextColor(...gray);
    doc.text("Total hours:", col1, finalY, { align: "right" });
    doc.setTextColor(...dark);
    doc.text(`${formatDecimal(totalMins)} hrs`, col2, finalY, { align: "right" });

    doc.setTextColor(...gray);
    doc.text("Billable hours:", col1, finalY + 6, { align: "right" });
    doc.setTextColor(...dark);
    doc.text(`${formatDecimal(billableMins)} hrs`, col2, finalY + 6, { align: "right" });

    if (hourlyRate > 0) {
      doc.setTextColor(...gray);
      doc.text(`Rate:`, col1, finalY + 12, { align: "right" });
      doc.setTextColor(...dark);
      doc.text(formatMoney(hourlyRate) + "/hr", col2, finalY + 12, { align: "right" });

      doc.setDrawColor(...teal);
      doc.setLineWidth(0.5);
      doc.line(120, finalY + 16, col2, finalY + 16);

      doc.setFontSize(12);
      doc.setTextColor(...teal);
      doc.setFont("helvetica", "bold");
      doc.text("Total Due:", col1, finalY + 22, { align: "right" });
      doc.text(formatMoney(totalEarnings), col2, finalY + 22, { align: "right" });
    }

    if (notes.trim()) {
      const notesY = finalY + (hourlyRate > 0 ? 34 : 18);
      doc.setFontSize(9);
      doc.setTextColor(...gray);
      doc.setFont("helvetica", "normal");
      doc.text("Notes:", 14, notesY);
      doc.setTextColor(...dark);
      const noteLines = doc.splitTextToSize(notes, 182);
      doc.text(noteLines, 14, notesY + 5);
    }

    const filename = `${settings.name ? settings.name.toLowerCase().replace(/\s+/g, "_") + "_" : ""}invoice_${invoiceNumber}.pdf`;
    await downloadFile(doc.output("blob"), filename);
  }

  if (!showInvoice) return null;

  const inputCls = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:ring-[var(--color-accent)]/40 focus-visible:ring-2 text-sm shadow-sm h-9";

  return (
    <div onClick={() => setShowInvoice(false)} style={{ position: "fixed", inset: 0, background: "var(--color-modal-overlay)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} data-modal style={{ background: "var(--color-modal)", borderRadius: 16, width: "100%", maxWidth: 560, boxShadow: "var(--color-modal-shadow)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 48px)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: "1px solid var(--color-border-light)", flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)", fontFamily: "'Parkinsans', sans-serif", margin: 0 }}>Generate Invoice</p>
            <p style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 2 }}>Configure and download a PDF invoice.</p>
          </div>
          <button onClick={() => setShowInvoice(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", fontSize: 20, lineHeight: 1, padding: "4px 6px" }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", padding: "16px 24px", flex: 1 }}>
          {/* Invoice # */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-secondary)", marginBottom: 6 }}>Invoice number</p>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={`${inputCls} max-w-xs`} />
          </div>

          {/* Date range */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-secondary)", marginBottom: 6 }}>Date range</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "var(--color-text)", background: "var(--color-input-bg)", height: 36 }} />
              <span style={{ color: "var(--color-muted)", fontSize: 13 }}>–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "var(--color-text)", background: "var(--color-input-bg)", height: 36 }} />
            </div>
          </div>

          {/* Project filter */}
          {projects.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-secondary)", marginBottom: 6 }}>Project</p>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className={`${inputCls} w-56`}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]">
                  <SelectItem value="__all__" className="focus:bg-[var(--color-accent-light)]">All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} className="focus:bg-[var(--color-accent-light)]">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || "#14b8a6", display: "inline-block" }} />
                        {p.name}{p.client_name ? ` · ${p.client_name}` : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-secondary)", marginBottom: 6 }}>Notes (optional)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment terms, bank details, etc."
              rows={3}
              style={{ width: "100%", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--color-text)", background: "var(--color-input-bg)", resize: "vertical", outline: "none", fontFamily: "inherit" }}
            />
          </div>

          {/* Summary */}
          <div style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Preview</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-secondary)" }}>Entries</span>
                <span style={{ color: "var(--color-text)" }}>{filtered.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-secondary)" }}>Total hours</span>
                <span style={{ color: "var(--color-text)" }}>{formatDecimal(totalMins)} hrs</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-secondary)" }}>Billable hours</span>
                <span style={{ color: "var(--color-text)" }}>{formatDecimal(billableMins)} hrs</span>
              </div>
              {hourlyRate > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--color-border)", paddingTop: 8, marginTop: 4 }}>
                  <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>Total due</span>
                  <span style={{ color: "var(--color-accent)", fontWeight: 700, fontSize: 16 }}>{formatMoney(totalEarnings)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "14px 24px 18px", borderTop: "1px solid var(--color-border-light)", flexShrink: 0, gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setShowInvoice(false)} className="h-9 px-4 text-sm" style={{ color: "var(--color-secondary)" }}>Cancel</Button>
          <Button size="sm" onClick={downloadPDF} disabled={filtered.length === 0} className="h-9 px-5 text-sm font-semibold disabled:opacity-40" style={{ background: "var(--color-accent)", color: "#fff" }}>
            Download PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
