-- Future requests need an email for the login link and client workspace.
-- Existing records are left untouched, including legacy rows without an email.

create or replace function public.require_order_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'email_required' using errcode = '23502';
  end if;
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists orders_require_email_on_insert on public.orders;
create trigger orders_require_email_on_insert
  before insert on public.orders
  for each row execute function public.require_order_email();

drop trigger if exists orders_require_email_on_email_update on public.orders;
create trigger orders_require_email_on_email_update
  before update of email on public.orders
  for each row execute function public.require_order_email();
