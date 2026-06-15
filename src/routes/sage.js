// Sage Gestion Commerciale module — référentiels (clients, articles),
// administration (TVA, numérotation, règlements, société, utilisateurs) and the
// sales document chain Devis → Commande → BL → Facture → Avoir with conversion.

import { Router } from "express";
import { q } from "../database.js";

export const sageRouter = Router();

// ───────────────────────── Helpers ─────────────────────────

const DOC_TYPES = ["devis", "commande", "bl", "facture", "avoir"];
const DEFAULT_STATUS = { devis: "brouillon", commande: "a_preparer", bl: "prepare", facture: "a_regler", avoir: "emis" };
// Allowed conversions and the status the source document moves to once converted.
const CONVERSIONS = {
  devis:    { commande: "accepte", facture: "facture" },
  commande: { bl: "livree", facture: "facturee" },
  bl:       { facture: "facture" },
  facture:  { avoir: "avoir" },
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function computeLine(l) {
  const qty = Number(l.qty) || 0;
  const pu = Number(l.unitPriceHt ?? l.unit_price_ht) || 0;
  const disc = Number(l.discountPct ?? l.discount_pct) || 0;
  const vat = Number(l.vatRate ?? l.vat_rate) || 0;
  const ht = round2(qty * pu * (1 - disc / 100));
  const tva = round2(ht * vat / 100);
  return { ht, tva, ttc: round2(ht + tva), qty, pu, disc, vat };
}

// Pull the next number for a document type and advance the counter.
function assignNumber(type) {
  const seq = q.get(`SELECT * FROM doc_sequences WHERE doc_type = ?`, type);
  if (!seq) throw new Error(`no sequence for ${type}`);
  const year = new Date().getFullYear();
  const num = `${seq.prefix}${year}-${String(seq.next_number).padStart(seq.padding, "0")}`;
  q.run(`UPDATE doc_sequences SET next_number = next_number + 1 WHERE doc_type = ?`, type);
  return num;
}

function insertLines(documentId, lines) {
  let totHt = 0, totVat = 0;
  (lines || []).forEach((l, i) => {
    const c = computeLine(l);
    totHt += c.ht; totVat += c.tva;
    q.run(`INSERT INTO document_lines (document_id,article_id,ref,designation,qty,unit,unit_price_ht,discount_pct,vat_rate,total_ht,total_vat,total_ttc,position)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      documentId, l.articleId ?? l.article_id ?? null, l.ref || null, l.designation || "", c.qty,
      l.unit || "u", c.pu, c.disc, c.vat, c.ht, c.tva, c.ttc, l.position ?? i);
  });
  return { totHt: round2(totHt), totVat: round2(totVat) };
}

function recalcTotals(documentId) {
  const r = q.get(`SELECT COALESCE(SUM(total_ht),0) ht, COALESCE(SUM(total_vat),0) tva, COALESCE(SUM(total_ttc),0) ttc FROM document_lines WHERE document_id = ?`, documentId);
  q.run(`UPDATE documents SET total_ht = ?, total_vat = ?, total_ttc = ? WHERE id = ?`, round2(r.ht), round2(r.tva), round2(r.ttc), documentId);
}

const toLine = (r) => ({
  id: r.id, articleId: r.article_id, ref: r.ref, designation: r.designation, qty: r.qty, unit: r.unit,
  unitPriceHt: r.unit_price_ht, discountPct: r.discount_pct, vatRate: r.vat_rate,
  totalHt: r.total_ht, totalVat: r.total_vat, totalTtc: r.total_ttc, position: r.position,
});
const toDoc = (r, withLines = false) => {
  if (!r) return null;
  const doc = {
    id: r.id, type: r.type, number: r.number, customerId: r.customer_id, customerName: r.customer_name,
    date: r.date, dueDate: r.due_date, status: r.status, parentId: r.parent_id,
    paymentTermId: r.payment_term_id, paymentMethodId: r.payment_method_id, notes: r.notes,
    totalHt: r.total_ht, totalVat: r.total_vat, totalTtc: r.total_ttc, createdAt: r.created_at,
  };
  if (withLines) doc.lines = q.all(`SELECT * FROM document_lines WHERE document_id = ? ORDER BY position, id`, r.id).map(toLine);
  return doc;
};

// ───────────────────────── Référentiels ─────────────────────────

// Customers
sageRouter.get("/customers", (req, res) => res.json(q.all(`SELECT * FROM customers ORDER BY name`)));
sageRouter.get("/customers/:id", (req, res) => {
  const c = q.get(`SELECT * FROM customers WHERE id = ?`, req.params.id);
  return c ? res.json(c) : res.status(404).json({ error: "customer not found" });
});
sageRouter.post("/customers", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "name is required" });
  const code = b.code || `CL-${String(q.get(`SELECT COUNT(*) n FROM customers`).n + 1).padStart(3, "0")}`;
  const r = q.run(`INSERT INTO customers (code,name,contact,email,phone,address,zip,city,vat_number,payment_term_id,payment_method_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    code, b.name, b.contact || "", b.email || "", b.phone || "", b.address || "", b.zip || "", b.city || "",
    b.vatNumber || "", b.paymentTermId || null, b.paymentMethodId || null);
  res.status(201).json(q.get(`SELECT * FROM customers WHERE id = ?`, r.lastInsertRowid));
});
sageRouter.patch("/customers/:id", (req, res) => {
  if (!q.get(`SELECT 1 FROM customers WHERE id = ?`, req.params.id)) return res.status(404).json({ error: "customer not found" });
  const map = { code: "code", name: "name", contact: "contact", email: "email", phone: "phone", address: "address", zip: "zip", city: "city", vatNumber: "vat_number", paymentTermId: "payment_term_id", paymentMethodId: "payment_method_id" };
  for (const [k, col] of Object.entries(map)) if (k in (req.body || {})) q.run(`UPDATE customers SET ${col} = ? WHERE id = ?`, req.body[k], req.params.id);
  res.json(q.get(`SELECT * FROM customers WHERE id = ?`, req.params.id));
});
sageRouter.delete("/customers/:id", (req, res) => { q.run(`DELETE FROM customers WHERE id = ?`, req.params.id); res.status(204).end(); });

// Article families
sageRouter.get("/article-families", (req, res) => res.json(q.all(`SELECT * FROM article_families ORDER BY name`)));
sageRouter.post("/article-families", (req, res) => {
  if (!req.body || !req.body.name) return res.status(400).json({ error: "name is required" });
  const r = q.run(`INSERT INTO article_families (name) VALUES (?)`, req.body.name);
  res.status(201).json(q.get(`SELECT * FROM article_families WHERE id = ?`, r.lastInsertRowid));
});

// Articles (catalogue)
sageRouter.get("/articles", (req, res) => res.json(q.all(`SELECT * FROM articles WHERE active = 1 ORDER BY label`)));
sageRouter.get("/articles/:id", (req, res) => {
  const a = q.get(`SELECT * FROM articles WHERE id = ?`, req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "article not found" });
});
sageRouter.post("/articles", (req, res) => {
  const b = req.body || {};
  if (!b.label) return res.status(400).json({ error: "label is required" });
  const r = q.run(`INSERT INTO articles (ref,label,description,unit,price_ht,vat_rate,family_id,stock) VALUES (?,?,?,?,?,?,?,?)`,
    b.ref || null, b.label, b.description || "", b.unit || "u", Number(b.priceHt) || 0, Number(b.vatRate) || 20, b.familyId || null, Number(b.stock) || 0);
  res.status(201).json(q.get(`SELECT * FROM articles WHERE id = ?`, r.lastInsertRowid));
});
sageRouter.patch("/articles/:id", (req, res) => {
  if (!q.get(`SELECT 1 FROM articles WHERE id = ?`, req.params.id)) return res.status(404).json({ error: "article not found" });
  const map = { ref: "ref", label: "label", description: "description", unit: "unit", priceHt: "price_ht", vatRate: "vat_rate", familyId: "family_id", stock: "stock", active: "active" };
  for (const [k, col] of Object.entries(map)) if (k in (req.body || {})) q.run(`UPDATE articles SET ${col} = ? WHERE id = ?`, req.body[k], req.params.id);
  res.json(q.get(`SELECT * FROM articles WHERE id = ?`, req.params.id));
});
sageRouter.delete("/articles/:id", (req, res) => { q.run(`UPDATE articles SET active = 0 WHERE id = ?`, req.params.id); res.status(204).end(); });

// ───────────────────────── Administration ─────────────────────────

const crud = (path, table, cols) => {
  sageRouter.get(`/${path}`, (req, res) => res.json(q.all(`SELECT * FROM ${table} ORDER BY id`)));
  sageRouter.post(`/${path}`, (req, res) => {
    const vals = cols.map((c) => (req.body || {})[c.k] ?? c.def ?? null);
    const r = q.run(`INSERT INTO ${table} (${cols.map((c) => c.col).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...vals);
    res.status(201).json(q.get(`SELECT * FROM ${table} WHERE id = ?`, r.lastInsertRowid));
  });
  sageRouter.patch(`/${path}/:id`, (req, res) => {
    if (!q.get(`SELECT 1 FROM ${table} WHERE id = ?`, req.params.id)) return res.status(404).json({ error: "not found" });
    for (const c of cols) if (c.k in (req.body || {})) q.run(`UPDATE ${table} SET ${c.col} = ? WHERE id = ?`, req.body[c.k], req.params.id);
    res.json(q.get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id));
  });
  sageRouter.delete(`/${path}/:id`, (req, res) => { q.run(`DELETE FROM ${table} WHERE id = ?`, req.params.id); res.status(204).end(); });
};

crud("vat-rates", "vat_rates", [{ k: "label", col: "label" }, { k: "rate", col: "rate" }, { k: "isDefault", col: "is_default", def: 0 }]);
crud("payment-methods", "payment_methods", [{ k: "label", col: "label" }]);
crud("payment-terms", "payment_terms", [{ k: "label", col: "label" }, { k: "days", col: "days", def: 0 }]);
crud("users", "users", [{ k: "name", col: "name" }, { k: "email", col: "email" }, { k: "role", col: "role", def: "commercial" }, { k: "active", col: "active", def: 1 }]);

// Numbering sequences
sageRouter.get("/sequences", (req, res) => res.json(q.all(`SELECT * FROM doc_sequences`)));
sageRouter.patch("/sequences/:type", (req, res) => {
  if (!q.get(`SELECT 1 FROM doc_sequences WHERE doc_type = ?`, req.params.type)) return res.status(404).json({ error: "sequence not found" });
  for (const [k, col] of Object.entries({ prefix: "prefix", nextNumber: "next_number", padding: "padding" }))
    if (k in (req.body || {})) q.run(`UPDATE doc_sequences SET ${col} = ? WHERE doc_type = ?`, req.body[k], req.params.type);
  res.json(q.get(`SELECT * FROM doc_sequences WHERE doc_type = ?`, req.params.type));
});

// Company (single row)
sageRouter.get("/company", (req, res) => res.json(q.get(`SELECT * FROM company WHERE id = 1`)));
sageRouter.put("/company", (req, res) => {
  const map = { name: "name", address: "address", zip: "zip", city: "city", siret: "siret", vatNumber: "vat_number", phone: "phone", email: "email", iban: "iban" };
  for (const [k, col] of Object.entries(map)) if (k in (req.body || {})) q.run(`UPDATE company SET ${col} = ? WHERE id = 1`, req.body[k]);
  res.json(q.get(`SELECT * FROM company WHERE id = 1`));
});

// ───────────────────────── Documents ─────────────────────────

sageRouter.get("/documents", (req, res) => {
  const { type } = req.query;
  const rows = type
    ? q.all(`SELECT * FROM documents WHERE type = ? ORDER BY id DESC`, type)
    : q.all(`SELECT * FROM documents ORDER BY id DESC`);
  res.json(rows.map((r) => toDoc(r)));
});

sageRouter.get("/documents/:id", (req, res) => {
  const doc = toDoc(q.get(`SELECT * FROM documents WHERE id = ?`, req.params.id), true);
  return doc ? res.json(doc) : res.status(404).json({ error: "document not found" });
});

sageRouter.post("/documents", (req, res) => {
  const b = req.body || {};
  if (!DOC_TYPES.includes(b.type)) return res.status(400).json({ error: `type must be one of ${DOC_TYPES.join(", ")}` });
  if (!b.customerId && !b.customerName) return res.status(400).json({ error: "customerId or customerName is required" });

  const customer = b.customerId ? q.get(`SELECT * FROM customers WHERE id = ?`, b.customerId) : null;
  const result = q.tx(() => {
    const number = assignNumber(b.type);
    const r = q.run(`INSERT INTO documents (type,number,customer_id,customer_name,date,due_date,status,parent_id,payment_term_id,payment_method_id,notes)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      b.type, number, b.customerId || null, (customer && customer.name) || b.customerName || "",
      b.date || new Date().toISOString().slice(0, 10), b.dueDate || null, b.status || DEFAULT_STATUS[b.type],
      b.parentId || null, b.paymentTermId || (customer && customer.payment_term_id) || null,
      b.paymentMethodId || (customer && customer.payment_method_id) || null, b.notes || "");
    insertLines(r.lastInsertRowid, b.lines);
    recalcTotals(r.lastInsertRowid);
    return r.lastInsertRowid;
  });
  res.status(201).json(toDoc(q.get(`SELECT * FROM documents WHERE id = ?`, result), true));
});

sageRouter.patch("/documents/:id", (req, res) => {
  const doc = q.get(`SELECT * FROM documents WHERE id = ?`, req.params.id);
  if (!doc) return res.status(404).json({ error: "document not found" });
  const b = req.body || {};
  const map = { customerId: "customer_id", customerName: "customer_name", date: "date", dueDate: "due_date", status: "status", paymentTermId: "payment_term_id", paymentMethodId: "payment_method_id", notes: "notes" };
  q.tx(() => {
    for (const [k, col] of Object.entries(map)) if (k in b) q.run(`UPDATE documents SET ${col} = ? WHERE id = ?`, b[k], doc.id);
    if (Array.isArray(b.lines)) {
      q.run(`DELETE FROM document_lines WHERE document_id = ?`, doc.id);
      insertLines(doc.id, b.lines);
    }
    recalcTotals(doc.id);
  });
  res.json(toDoc(q.get(`SELECT * FROM documents WHERE id = ?`, doc.id), true));
});

sageRouter.delete("/documents/:id", (req, res) => {
  q.tx(() => {
    q.run(`DELETE FROM document_lines WHERE document_id = ?`, req.params.id);
    q.run(`DELETE FROM documents WHERE id = ?`, req.params.id);
  });
  res.status(204).end();
});

// Convert a document to the next stage of the sales chain.
sageRouter.post("/documents/:id/convert", (req, res) => {
  const src = q.get(`SELECT * FROM documents WHERE id = ?`, req.params.id);
  if (!src) return res.status(404).json({ error: "document not found" });
  const target = (req.body || {}).target;
  const allowed = CONVERSIONS[src.type] || {};
  if (!allowed[target]) return res.status(400).json({ error: `cannot convert ${src.type} → ${target}. Allowed: ${Object.keys(allowed).join(", ") || "none"}` });

  const lines = q.all(`SELECT * FROM document_lines WHERE document_id = ? ORDER BY position, id`, src.id);
  const result = q.tx(() => {
    const number = assignNumber(target);
    const r = q.run(`INSERT INTO documents (type,number,customer_id,customer_name,date,due_date,status,parent_id,payment_term_id,payment_method_id,notes)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      target, number, src.customer_id, src.customer_name, new Date().toISOString().slice(0, 10), null,
      DEFAULT_STATUS[target], src.id, src.payment_term_id, src.payment_method_id, src.notes || "");
    const newId = r.lastInsertRowid;
    insertLines(newId, lines.map(toLine));
    recalcTotals(newId);
    q.run(`UPDATE documents SET status = ? WHERE id = ?`, allowed[target], src.id); // advance source
    return newId;
  });

  res.status(201).json({
    source: toDoc(q.get(`SELECT * FROM documents WHERE id = ?`, src.id)),
    created: toDoc(q.get(`SELECT * FROM documents WHERE id = ?`, result), true),
  });
});
