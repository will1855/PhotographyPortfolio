-- =============================================================================
-- Migration: Add Analytics Logging Table
-- Run this in the Supabase SQL Editor to support the Admin Analytics Panel
-- =============================================================================

create table if not exists portfolio_analytics (
  id           uuid        primary key default gen_random_uuid(),
  event_type   text        not null, -- 'page_view' | 'lightbox_click'
  event_target text        not null, -- e.g. section slug 'archive', 'studies', or image title/filename
  created_at   timestamptz not null default now()
);

-- Index for fast sorting of analytical events
create index if not exists idx_analytics_created
  on portfolio_analytics (created_at desc);

-- Index to quickly query section or image aggregates
create index if not exists idx_analytics_event_target
  on portfolio_analytics (event_type, event_target);
