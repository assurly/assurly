-- EXECUTE on a function does not imply access to its containing schema.
-- Keep the schema private while allowing the trusted server role to resolve
-- the narrowly granted billing implementation.
grant usage on schema private to service_role;
