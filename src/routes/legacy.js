// Routes for the two original tiles — Projets & Livrables and Commandes —
// now backed by SQLite. The JSON API contract is unchanged (camelCase fields)
// so the existing front-end keeps working without modification.

import { Router } from "express";
import { q } from "../database.js";

export const legacyRouter = Router();

const toProject = (r) => r && ({
  id: r.id, ref: r.ref, title: r.title, client: r.client, contact: r.contact,
  amount: r.amount, stage: r.stage, due: r.due, owner: r.owner, items: r.items, orderId: r.order_id,
});
const toOrder = (r) => r && ({
  id: r.id, refSage: r.ref_sage, title: r.title, client: r.client, contact: r.contact,
  amount: r.amount, items: r.items, deliveryDate: r.delivery_date, owner: r.owner,
  status: r.status, projectId: r.project_id,
});

const nextProjectId = () => {
  const row = q.get(`SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS m FROM projects WHERE id LIKE 'PRJ-%'`);
  return `PRJ-${(row && row.m ? row.m : 1042) + 1}`;
};

// ───── Projects ─────
legacyRouter.get("/projects", (req, res) => {
  res.json(q.all(`SELECT * FROM projects ORDER BY created_at DESC, id DESC`).map(toProject));
});

legacyRouter.post("/projects", (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.client) return res.status(400).json({ error: "title and client are required" });
  const id = b.id || nextProjectId();
  q.run(`INSERT INTO projects (id,ref,title,client,contact,amount,stage,due,owner,items,order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, b.ref || `DEV-2026-${Math.floor(100 + Math.random() * 900)}`, b.title, b.client, b.contact || "",
    Number(b.amount) || 0, b.stage || "recu", b.due || null, b.owner || null, Number(b.items) || 1, b.orderId || null);
  res.status(201).json(toProject(q.get(`SELECT * FROM projects WHERE id = ?`, id)));
});

legacyRouter.patch("/projects/:id", (req, res) => {
  const existing = q.get(`SELECT * FROM projects WHERE id = ?`, req.params.id);
  if (!existing) return res.status(404).json({ error: "project not found" });
  const allowed = ["ref", "title", "client", "contact", "amount", "stage", "due", "owner", "items"];
  for (const k of allowed) {
    if (k in (req.body || {})) q.run(`UPDATE projects SET ${k} = ? WHERE id = ?`, req.body[k], req.params.id);
  }
  res.json(toProject(q.get(`SELECT * FROM projects WHERE id = ?`, req.params.id)));
});

// ───── Orders ─────
legacyRouter.get("/orders", (req, res) => {
  res.json(q.all(`SELECT * FROM orders ORDER BY created_at DESC, id DESC`).map(toOrder));
});

legacyRouter.post("/orders", (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.client) return res.status(400).json({ error: "title and client are required" });
  const row = q.get(`SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS m FROM orders WHERE id LIKE 'CMD-%'`);
  const id = b.id || `CMD-${(row && row.m ? row.m : 5012) + 1}`;
  q.run(`INSERT INTO orders (id,ref_sage,title,client,contact,amount,items,delivery_date,owner,status,project_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, b.refSage || `CO-2026-${Math.floor(100 + Math.random() * 900)}`, b.title, b.client, b.contact || "",
    Number(b.amount) || 0, Number(b.items) || 1, b.deliveryDate || null, b.owner || null, "a_valider", null);
  res.status(201).json(toOrder(q.get(`SELECT * FROM orders WHERE id = ?`, id)));
});

// Validate an order → auto-create the deliverable project (idempotent).
legacyRouter.post("/orders/:id/validate", (req, res) => {
  const order = q.get(`SELECT * FROM orders WHERE id = ?`, req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });

  if (order.status === "valide" && order.project_id) {
    return res.json({ order: toOrder(order), project: toProject(q.get(`SELECT * FROM projects WHERE id = ?`, order.project_id)) });
  }

  const result = q.tx(() => {
    const pid = nextProjectId();
    q.run(`INSERT INTO projects (id,ref,title,client,contact,amount,stage,due,owner,items,order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      pid, order.ref_sage, order.title, order.client, order.contact || "", order.amount, "devis_valide",
      order.delivery_date, order.owner, order.items, order.id);
    q.run(`UPDATE orders SET status = 'valide', project_id = ? WHERE id = ?`, pid, order.id);
    return pid;
  });

  res.status(201).json({
    order: toOrder(q.get(`SELECT * FROM orders WHERE id = ?`, order.id)),
    project: toProject(q.get(`SELECT * FROM projects WHERE id = ?`, result)),
  });
});
