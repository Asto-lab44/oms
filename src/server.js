// Astorya OMS — order management API.
//
// Core business rule: when an order is validated (POST /api/orders/:id/validate)
// the service automatically creates a deliverable project that shows up in the
// Hub "Projets & Livrables" board, at the "Devis validé" stage.

import express from "express";
import cors from "cors";
import { db } from "./db.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const nextProjectId = () => {
  const nums = db.get("projects")
    .map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  return `PRJ-${(nums.length ? Math.max(...nums) : 1042) + 1}`;
};

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "astorya-oms" }));

// ───── Projects ─────
app.get("/api/projects", (req, res) => res.json(db.get("projects")));

app.post("/api/projects", (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.client) return res.status(400).json({ error: "title and client are required" });
  const project = {
    id: b.id || nextProjectId(),
    ref: b.ref || `DEV-2026-${Math.floor(100 + Math.random() * 900)}`,
    title: b.title,
    client: b.client,
    contact: b.contact || "",
    amount: Number(b.amount) || 0,
    stage: b.stage || "recu",
    due: b.due || null,
    owner: b.owner || null,
    items: Number(b.items) || 1,
    orderId: b.orderId || null,
  };
  db.insert("projects", project);
  res.status(201).json(project);
});

app.patch("/api/projects/:id", (req, res) => {
  const updated = db.update("projects", req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "project not found" });
  res.json(updated);
});

// ───── Orders ─────
app.get("/api/orders", (req, res) => res.json(db.get("orders")));

app.post("/api/orders", (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.client) return res.status(400).json({ error: "title and client are required" });
  const order = {
    id: b.id || `CMD-${5012 + db.get("orders").length}`,
    refSage: b.refSage || `CO-2026-${Math.floor(100 + Math.random() * 900)}`,
    title: b.title,
    client: b.client,
    contact: b.contact || "",
    amount: Number(b.amount) || 0,
    items: Number(b.items) || 1,
    deliveryDate: b.deliveryDate || null,
    owner: b.owner || null,
    status: "a_valider",
    projectId: null,
  };
  db.insert("orders", order);
  res.status(201).json(order);
});

// The key endpoint: validate an order → spawn the deliverable project.
app.post("/api/orders/:id/validate", (req, res) => {
  const order = db.find("orders", req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });

  // Idempotent: a validated order returns its existing project.
  if (order.status === "valide" && order.projectId) {
    return res.json({ order, project: db.find("projects", order.projectId) });
  }

  const project = {
    id: nextProjectId(),
    ref: order.refSage,
    title: order.title,
    client: order.client,
    contact: order.contact || "",
    amount: order.amount,
    stage: "devis_valide",
    due: order.deliveryDate,
    owner: order.owner,
    items: order.items,
    orderId: order.id,
  };
  db.insert("projects", project);
  const updatedOrder = db.update("orders", order.id, { status: "valide", projectId: project.id });

  res.status(201).json({ order: updatedOrder, project });
});

app.listen(PORT, () => console.log(`Astorya OMS listening on http://localhost:${PORT}`));
