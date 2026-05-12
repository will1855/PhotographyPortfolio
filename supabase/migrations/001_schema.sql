-- =============================================================================
-- Photography Portfolio — Supabase Schema
-- Run this in the Supabase SQL Editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sections (DB-driven — rename/reorder/hide without code changes)
-- -----------------------------------------------------------------------------
create table if not exists portfolio_sections (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        unique not null,
  label         text        not null,
  nav_label     text,
  -- hero_image_id added as FK after portfolio_images is created (see below)
  hero_image_id uuid,
  hero_kicker   text,
  hero_link_text text,
  sort_order    int         not null default 0,
  is_visible    boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Images
-- -----------------------------------------------------------------------------
create table if not exists portfolio_images (
  id                 uuid        primary key default gen_random_uuid(),
  section_id         uuid        references portfolio_sections(id) on delete cascade,
  title              text,
  alt_text           text,
  original_filename  text,
  safe_filename      text,
  -- Store storage PATHS only — public URLs generated server-side
  storage_path_full  text        not null,
  storage_path_thumb text        not null,
  width              int,
  height             int,
  sort_order         int         not null default 0,
  is_visible         boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. Add FK from sections → images (hero) after both tables exist
-- -----------------------------------------------------------------------------
alter table portfolio_sections
  add constraint fk_hero_image
  foreign key (hero_image_id)
  references portfolio_images(id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- 4. Site settings (single row, id = 1)
-- -----------------------------------------------------------------------------
create table if not exists site_settings (
  id                      int         primary key default 1,
  site_title              text        not null default 'Will Davies',
  about_title             text        not null default 'About',
  about_text              text,
  about_profile_image_id  uuid        references portfolio_images(id) on delete set null,
  about_profile_storage_path text,
  contact_email           text,
  instagram_url           text,
  updated_at              timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. Seed: default sections
-- -----------------------------------------------------------------------------
insert into portfolio_sections (slug, label, nav_label, sort_order)
values
  ('archive', 'Archive', 'Archive', 0),
  ('studies', 'Studies', 'Studies', 1)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Seed: site settings row
-- -----------------------------------------------------------------------------
insert into site_settings (id, site_title)
values (1, 'Will Davies')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 7. Helpful indexes
-- -----------------------------------------------------------------------------
create index if not exists idx_images_section_order
  on portfolio_images (section_id, sort_order asc);

create index if not exists idx_sections_order
  on portfolio_sections (sort_order asc);

-- -----------------------------------------------------------------------------
-- 8. Contact Inquiries
-- -----------------------------------------------------------------------------
create table if not exists contact_inquiries (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  email       text        not null,
  message     text        not null,
  created_at  timestamptz not null default now()
);
