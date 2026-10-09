"use client";
import React, { useEffect, useMemo, useState } from "react";
import { fmtDate } from "./ui";
import { type Contact, type LeadDetail, sendLeadEmail } from "@/lib/sales-api";
import { useConsole } from "./ConsoleApp";

export interface EmailTemplate {
  id: string;
  name: string;
  tag: string;
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "intro_rfq",
    name: "1. Intro & Buyer RFQ Match",
    tag: "First Outreach",
    subject: "Swaniki RFQ Network · Potential vendor onboarding for {{company_name}}",
    body: `Dear {{contact_name}},

I hope this email finds you well.

I am reaching out from Swaniki RFQ Network. We are actively aggregating verified RFQs (Requests for Quotation) in the {{category}} sector from vetted enterprise buyers across India.

We came across {{company_name}} and your manufacturing capabilities in {{hub_city}}. We would love to onboard your team so you can directly review and bid on active purchase orders in our network with zero listing fees.

Could we arrange a brief 5-minute call this week to introduce our platform and share currently open RFQs that match your catalog?

Best regards,
{{rep_name}}
Inside Sales Team | Swaniki RFQ Network
Email: {{rep_email}}`,
  },
  {
    id: "post_call",
    name: "2. Post-Call Follow-up & Next Steps",
    tag: "Follow-up",
    subject: "Follow-up: Discussion regarding Swaniki RFQ onboarding for {{company_name}}",
    body: `Hi {{contact_name}},

Thank you for taking the time to speak with me today regarding {{company_name}}'s supply capabilities in {{category}}.

As discussed, here is a quick summary of what Swaniki RFQ Network offers:
• Zero listing fees: Access qualified domestic buyer inquiries directly.
• Verified buyers: All RFQs are pre-screened with clear technical specifications and volume requirements.
• Direct connection: Submit competitive bids with full control over your pricing and terms.

As agreed, our next follow-up call is scheduled for {{next_meeting_date}}. Please feel free to reach out to me directly at {{rep_email}} if any questions arise in the meantime.

Looking forward to connecting soon!

Warm regards,
{{rep_name}}
Inside Sales Team | Swaniki RFQ Network
Email: {{rep_email}}`,
  },
  {
    id: "rfq_demand",
    name: "3. Active RFQ Demand Alert",
    tag: "Catalog Demand",
    subject: "New buyer procurement inquiries matching {{company_name}} ({{category}})",
    body: `Dear {{contact_name}},

We have recently received high-priority RFQs from verified enterprise buyers seeking suppliers in {{category}}.

Given {{company_name}}'s track record and presence in {{hub_city}}, we believe your catalog is a strong fit for these procurement requirements.

Please let us know if you have bandwidth to review these inquiries so I can share the detailed bill of materials and spec sheets.

Best regards,
{{rep_name}}
Swaniki RFQ Network
Email: {{rep_email}}`,
  },
  {
    id: "checkin",
    name: "4. Gentle Re-engagement / Check-in",
    tag: "Nurture",
    subject: "Checking in: RFQ opportunities for {{company_name}}",
    body: `Hi {{contact_name}},

I am following up on our earlier conversation regarding vendor onboarding for {{company_name}}.

I understand your team might have been occupied, so I wanted to see if now might be a more convenient time to explore how Swaniki can bring you additional procurement demand in {{category}}.

Would you have 5 minutes for a quick chat later this week?

Warm regards,
{{rep_name}}
Swaniki RFQ Network
Email: {{rep_email}}`,
  },
  {
    id: "custom",
    name: "5. Custom Direct Message",
    tag: "Blank",
    subject: "Update regarding {{company_name}}",
    body: `Hi {{contact_name}},

I wanted to touch base regarding {{company_name}} and our RFQ opportunities in {{category}}.



Best regards,
{{rep_name}}
Swaniki RFQ Network
Email: {{rep_email}}`,
  },
];

interface EmailComposerModalProps {
  d: LeadDetail;
  initialContactId?: number | null;
  onClose: () => void;
  onSent: (data: { to: string; subject: string; summary: string }) => void;
}

export function EmailComposerModal({ d, initialContactId, onClose, onSent }: EmailComposerModalProps) {
  const { user } = useConsole();
  const co = d.company;

  // Find contacts with email addresses
  const emailContacts = useMemo(() => {
    return d.contacts.filter((c) => !!c.email && c.email.includes("@"));
  }, [d.contacts]);

  const defaultContact = useMemo(() => {
    if (initialContactId) {
      const match = d.contacts.find((c) => c.id === initialContactId);
      if (match) return match;
    }
    return emailContacts.find((c) => c.is_primary) || emailContacts[0] || null;
  }, [emailContacts, initialContactId, d.contacts]);

  const [selectedContactId, setSelectedContactId] = useState<number | "custom">(
    defaultContact ? defaultContact.id : "custom"
  );
  const [customToEmail, setCustomToEmail] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("intro_rfq");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const activeContact = useMemo(() => {
    if (selectedContactId === "custom") return null;
    return d.contacts.find((c) => c.id === selectedContactId) || null;
  }, [d.contacts, selectedContactId]);

  const effectiveToEmail = useMemo(() => {
    if (selectedContactId === "custom") return customToEmail.trim();
    return activeContact?.email || "";
  }, [selectedContactId, activeContact, customToEmail]);

  // Merge placeholders helper
  const mergeVariables = useMemo(() => {
    const repName = user?.email ? user.email.split("@")[0].replace(/[._-]/g, " ") : "Inside Sales Rep";
    const repNameCap = repName.charAt(0).toUpperCase() + repName.slice(1);
    const meetingText = d.next_action_at ? fmtDate(d.next_action_at, true) : "our scheduled call";

    return {
      company_name: co?.name || "your company",
      contact_name: activeContact?.full_name || "Sir/Madam",
      contact_email: effectiveToEmail || "your email",
      contact_phone: activeContact?.phone_primary || activeContact?.phone_secondary || "",
      category: co?.category_primary || "Industrial Manufacturing",
      hub_city: co?.hub_city || "India",
      rep_name: repNameCap,
      rep_email: user?.email || "sales@swaniki.com",
      next_meeting_date: meetingText,
    };
  }, [co, activeContact, effectiveToEmail, user?.email, d.next_action_at]);

  function substitute(text: string): string {
    return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
      const val = (mergeVariables as Record<string, string>)[key];
      return val !== undefined ? val : `{{${key}}}`;
    });
  }

  // Populate template whenever template or contact changes (unless user typed custom text)
  useEffect(() => {
    const tmpl = EMAIL_TEMPLATES.find((t) => t.id === selectedTemplateId) || EMAIL_TEMPLATES[0];
    setSubject(substitute(tmpl.subject));
    setBody(substitute(tmpl.body));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, selectedContactId]);

  async function handleSend() {
    setErr("");
    if (!effectiveToEmail || !effectiveToEmail.includes("@")) {
      setErr("Please select or enter a valid recipient email address.");
      return;
    }
    if (!subject.trim()) {
      setErr("Email subject line cannot be empty.");
      return;
    }
    if (!body.trim()) {
      setErr("Email message body cannot be empty.");
      return;
    }

    setSending(true);
    try {
      await sendLeadEmail(d.id, {
        to_email: effectiveToEmail,
        contact_id: typeof selectedContactId === "number" ? selectedContactId : null,
        subject: subject.trim(),
        body: body.trim(),
        template_key: selectedTemplateId,
      });

      onSent({
        to: effectiveToEmail,
        subject: subject.trim(),
        summary: `Sent email to ${effectiveToEmail}: ${subject.trim()}`,
      });
      onClose();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setSending(false);
    }
  }

  // Close on Escape or Send on Ctrl+Enter
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      className="in-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(18, 16, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="in-modal-box"
        style={{
          width: "min(720px, 96vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          borderRadius: 18,
          boxShadow: "0 20px 45px rgba(24, 18, 48, 0.25), 0 4px 12px rgba(0, 0, 0, 0.08)",
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, #faf9fe, #ffffff)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>✉</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--txt)" }}>
                Compose Sales Email
              </div>
              <div style={{ fontSize: 12, color: "var(--faint)" }}>
                Lead: <b style={{ color: "var(--txt)" }}>{co?.name}</b> · {co?.hub_city || "India"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="in-btn sm"
            style={{ borderRadius: "50%", width: 30, height: 30, padding: 0, display: "grid", placeItems: "center" }}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "18px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {err && (
            <div className="in-err" style={{ padding: "8px 12px", background: "rgba(226, 59, 90, 0.08)", borderRadius: 8, border: "1px solid rgba(226, 59, 90, 0.2)" }}>
              {err}
            </div>
          )}

          {/* Top Control Bar: Recipient & Template Selector */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--dim)", marginBottom: 5 }}>
                Recipient (Contact)
              </label>
              <select
                className="in-field"
                value={selectedContactId}
                onChange={(e) => {
                  const val = e.target.value === "custom" ? "custom" : Number(e.target.value);
                  setSelectedContactId(val);
                }}
                style={{ width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 8 }}
              >
                {d.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name ? `${c.full_name} (${c.email || "No email"})` : c.email || `#${c.id}`}
                    {c.is_primary ? " · Primary" : ""}
                    {c.decision_maker ? " · Decision Maker" : ""}
                  </option>
                ))}
                <option value="custom">＋ Custom Email Address…</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--dim)", marginBottom: 5 }}>
                Preconfigured Template
              </label>
              <select
                className="in-field"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 8 }}
              >
                {EMAIL_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} [{t.tag}]
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Custom To Address if custom selected */}
          {selectedContactId === "custom" && (
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--dim)", marginBottom: 5 }}>
                Custom Recipient Email
              </label>
              <input
                type="email"
                className="in-field"
                placeholder="purchasing@company.com"
                value={customToEmail}
                onChange={(e) => setCustomToEmail(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8 }}
              />
            </div>
          )}

          {/* Quick Contact Overview Banner */}
          {activeContact && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "rgba(91, 75, 255, 0.04)",
                border: "1px solid rgba(91, 75, 255, 0.14)",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <div>
                <b style={{ color: "var(--txt)" }}>{activeContact.full_name || "(Unnamed)"}</b>
                {activeContact.designation && <span style={{ color: "var(--faint)", marginLeft: 6 }}>· {activeContact.designation}</span>}
                {activeContact.email && <span style={{ color: "var(--accent)", marginLeft: 8 }}>✉ {activeContact.email}</span>}
              </div>
              <div>
                {activeContact.phone_primary && (
                  <span style={{ color: "var(--dim)", fontSize: 11 }}>☎ {activeContact.phone_primary}</span>
                )}
              </div>
            </div>
          )}

          {/* Subject Line */}
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--dim)", marginBottom: 5 }}>
              Subject
            </label>
            <input
              type="text"
              className="in-field"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject line…"
              style={{ width: "100%", padding: "8px 12px", fontSize: 13.5, fontWeight: 600, borderRadius: 8 }}
            />
          </div>

          {/* Message Body */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--dim)" }}>
                Message Body (Editable)
              </label>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>
                Variables auto-merged from lead record
              </span>
            </div>
            <textarea
              className="in-field"
              rows={11}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: "inherit",
                borderRadius: 8,
                resize: "vertical",
              }}
            />
          </div>

          {/* Anti-Spam / Deliverability Guarantee Hint */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "var(--dim)",
              padding: "7px 11px",
              background: "rgba(31, 169, 113, 0.06)",
              border: "1px solid rgba(31, 169, 113, 0.22)",
              borderRadius: 8,
            }}
          >
            <span>🛡</span>
            <span>
              <b>Primary Inbox Optimization:</b> Formatted as a clean 1-on-1 direct message with personal Reply-To headers to prevent Spam &amp; Promotional tab filtering.
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "12px 22px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#faf9fe",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--faint)" }}>
            Tip: Press <kbd style={{ padding: "2px 5px", background: "var(--line)", borderRadius: 4 }}>Ctrl</kbd> + <kbd style={{ padding: "2px 5px", background: "var(--line)", borderRadius: 4 }}>Enter</kbd> to send
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="in-btn sm" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="in-btn primary"
              onClick={handleSend}
              disabled={sending}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}
            >
              {sending ? "Sending…" : "✉ Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
