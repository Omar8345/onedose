# OneDose

OneDose is a shared care handoff that prevents two caregivers from recording
the same scheduled action twice.

The product focuses on one claim: when two authorized caregivers act on the
same due item concurrently, exactly one completion is accepted and every
attempt remains explainable.

Built for the 2026 Appwrite Databases Hackathon with Appwrite TablesDB.

## Current prototype

The uncommitted first prototype includes:

- a responsive Today view for shared scheduled actions
- a handoff timeline that preserves corrections
- a guided outcome-recording flow
- an interactive conflict demo showing which concurrent attempt won
- Appwrite browser and server client boundaries

The interface currently uses synthetic data. Live TablesDB mutations will be
enabled after the schema and atomic completion path are implemented.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public Appwrite
endpoint, project ID, and database ID are included in `.env.example`. Add your
own server API key to `.env.local`; never commit it.

## Product contract

The safety invariants and edge cases are documented in
[`docs/product.md`](docs/product.md). Technical choices are recorded in
[`docs/decisions.md`](docs/decisions.md). The TablesDB tables, indexes,
permissions, and completion transaction are described in
[`docs/data-model.md`](docs/data-model.md).
