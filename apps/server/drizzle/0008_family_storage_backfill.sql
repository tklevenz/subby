-- The counts for families that synced before the columns existed; every push keeps them from here on.
UPDATE "families" AS f
SET "record_count" = r.n, "data_bytes" = r.bytes
FROM (
  SELECT "family_id", count(*)::integer AS n, coalesce(sum(length("data")), 0)::bigint AS bytes
  FROM "records"
  GROUP BY "family_id"
) AS r
WHERE r."family_id" = f."id";
