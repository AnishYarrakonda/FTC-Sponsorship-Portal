-- 0009_portfolio_fields.sql

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS technical_summary text,
ADD COLUMN IF NOT EXISTS outreach_summary text,
ADD COLUMN IF NOT EXISTS media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS youtube_url text,
ADD COLUMN IF NOT EXISTS budget_items jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS financial_ask_cents bigint NOT NULL DEFAULT 0 CHECK (financial_ask_cents >= 0);
