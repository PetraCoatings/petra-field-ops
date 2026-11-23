-- Row count of every table in the app's schemas, one "schema.table|count" per line.
select string_agg(format('select %L || ''|'' || count(*) from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' union all ') as sql
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'app', 'audit') \gset
:sql;
