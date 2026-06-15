# Astorya OMS

Order management backend for the Astorya Hub. Validating an order automatically
creates a deliverable project that appears in the Hub **Projets & Livrables**
board at the *Devis validé* stage.

## Run

```bash
npm install
npm start        # http://localhost:3001  (PORT env to override)
```

Data is persisted to `data/db.json` (created on first run from the seed).

## API

| Method | Path                          | Description                                        |
|--------|-------------------------------|----------------------------------------------------|
| GET    | `/api/health`                 | Service health check                               |
| GET    | `/api/projects`               | List deliverable projects                          |
| POST   | `/api/projects`               | Create a project (`title`, `client` required)      |
| PATCH  | `/api/projects/:id`           | Update a project (e.g. `{ "stage": "livre" }`)     |
| GET    | `/api/orders`                 | List orders                                        |
| POST   | `/api/orders`                 | Create an order                                    |
| POST   | `/api/orders/:id/validate`    | **Validate an order → auto-creates the project**   |

### Order → project on validation

`POST /api/orders/:id/validate` sets the order to `valide`, links it to a new
project, and returns `{ order, project }`. The operation is idempotent: a
re-validated order returns its existing project instead of creating a duplicate.
