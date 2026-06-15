# Astorya OMS

Backend API for the Astorya Hub, backed by a **real SQLite database**
(`data/oms.db`, via Node's built-in `node:sqlite`). It serves three areas:

1. **Projets & Livrables** (tile 1) — `/api/projects`
2. **Commandes** (tile 2) — `/api/orders`; validating an order auto-creates a
   deliverable project at the *Devis validé* stage.
3. **Sage Gestion Commerciale** module — `/api/sage/*`: référentiels
   (clients, articles), administration (TVA, numérotation, règlements, société,
   utilisateurs) and the sales document chain
   **Devis → Commande → BL → Facture → Avoir** with conversion & chaining.

## Run

```bash
npm install      # express + cors only (SQLite is built into Node 22)
npm start        # http://localhost:3001  (PORT / DB_PATH env to override)
```

The schema is created and seeded automatically on first run. Delete
`data/oms.db*` to reset.

## API

### Tiles

| Method | Path                       | Description                                      |
|--------|----------------------------|--------------------------------------------------|
| GET    | `/api/health`              | Service health check                             |
| GET/POST/PATCH | `/api/projects[/:id]` | Deliverable projects                          |
| GET/POST | `/api/orders`            | Orders                                           |
| POST   | `/api/orders/:id/validate` | Validate order → auto-create project (idempotent)|

### Sage module — `/api/sage`

| Area          | Endpoints                                                              |
|---------------|-----------------------------------------------------------------------|
| Clients       | `GET/POST/PATCH/DELETE /customers[/:id]`                              |
| Articles      | `GET/POST/PATCH/DELETE /articles[/:id]`, `GET/POST /article-families` |
| Documents     | `GET/POST/PATCH/DELETE /documents[/:id]` (`?type=devis…`)             |
| Conversion    | `POST /documents/:id/convert { "target": "commande" }`               |
| Admin — TVA   | `GET/POST/PATCH/DELETE /vat-rates`                                    |
| Admin — règlements | `GET/POST/PATCH/DELETE /payment-methods`, `/payment-terms`       |
| Admin — numérotation | `GET /sequences`, `PATCH /sequences/:type`                     |
| Admin — société | `GET /company`, `PUT /company`                                     |
| Admin — utilisateurs | `GET/POST/PATCH/DELETE /users`                                |

**Document conversions** (sales chain): `devis → commande|facture`,
`commande → bl|facture`, `bl → facture`, `facture → avoir`. Conversion copies
the lines, links the new document to its parent, and advances the source's
status. Totals (HT / TVA / TTC) are always computed server-side from the lines.
