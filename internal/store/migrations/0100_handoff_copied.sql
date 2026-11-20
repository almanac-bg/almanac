-- A handoff's link copied with „Копирай връзката“ (account.CopiedHandoff) asks every browser for its number, the same
-- phone's too: a copied link goes anywhere a paste can.
ALTER TABLE handoffs ADD COLUMN copied INTEGER NOT NULL DEFAULT 0;
