# Migrations moved — this directory is documentation only

As of Phase 4.0A (local Supabase canonicalization), the **canonical, sole
editable migration source is `supabase/migrations/`**, applied through the
standard Supabase CLI local-development workflow:

```bash
npx supabase start          # boots local Postgres + Auth + REST, applies migrations
npx supabase db reset        # re-applies the full chain from scratch against a clean DB
npx supabase migration new <name>   # create the next migration in sequence
```

This directory (`infra/migrations/`) previously held the same 16 SQL files
(`001_identity.sql` through `016_ranked_rls.sql`) as plain, hand-run scripts
(`psql -f ...`). They were ported verbatim into `supabase/migrations/` with
Supabase-compatible timestamped filenames — no table, index, constraint,
trigger, function, grant, or policy was dropped in the move. See
`supabase/migrations/MIGRATION_INVENTORY.md` for the full object-by-object
inventory and the mapping from old filename to new filename.

**Do not add new `.sql` files here.** There is only one migration chain now;
maintaining two independently editable sources was the exact problem this
pass fixed. If you're looking for historical migration content, `git log`
against this directory's pre-Phase-4.0A history has it.
