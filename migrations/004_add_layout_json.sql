-- Migration: Add layout_json column to portfolio_sections
-- Run this in the Supabase SQL editor (or via psql) once.
-- The server.js endpoints gracefully handle the missing column until this runs.

ALTER TABLE portfolio_sections
  ADD COLUMN IF NOT EXISTS layout_json TEXT;

-- Verify:
-- SELECT id, slug, layout_json FROM portfolio_sections;
