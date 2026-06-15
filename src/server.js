// Astorya OMS — backend API.
//
// Backed by a real SQLite database (src/database.js). Serves three areas:
//   • Projets & Livrables  (tile 1)        — /api/projects
//   • Commandes            (tile 2)        — /api/orders  (validate → project)
//   • Sage Gestion Commerciale module      — /api/sage/*  (devis→commande→BL→facture→avoir)

import express from "express";
import cors from "cors";
import "./database.js"; // opens DB + runs schema/seed on import
import { legacyRouter } from "./routes/legacy.js";
import { sageRouter } from "./routes/sage.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "astorya-oms", db: "sqlite" }));

app.use("/api", legacyRouter);        // /api/projects, /api/orders
app.use("/api/sage", sageRouter);     // /api/sage/...

// Centralised error handler so DB exceptions return JSON, not HTML.
app.use((err, req, res, next) => {
  console.error("[oms] error:", err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`Astorya OMS (sqlite) listening on http://localhost:${PORT}`));
