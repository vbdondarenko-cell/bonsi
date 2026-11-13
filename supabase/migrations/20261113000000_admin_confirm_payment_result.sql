-- Return the exact confirmed payment row from the same transaction as the decision.
-- This lets the application enqueue an email for the right record even when the amount
-- correction path replaces the original pending row.
create or replace function public.admin_confirm_payment_with_result(
  p_payment uuid,
  p_amount numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_confirmed_before uuid[];
  v_confirmed_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock in the same order as admin_confirm_payment, then serialize invoice-level writers
  -- before capturing the set of existing confirmed rows.
  select invoice_id into v_invoice
    from public.payments
   where id = p_payment
   for update;
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  perform 1 from public.invoices where id = v_invoice for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
    into v_confirmed_before
    from public.payments
   where invoice_id = v_invoice and kind = 'payment' and status = 'confirmed';

  perform public.admin_confirm_payment(p_payment, p_amount, p_note);

  select id into v_confirmed_id
    from public.payments
   where invoice_id = v_invoice
     and kind = 'payment'
     and status = 'confirmed'
     and not (id = any(v_confirmed_before))
   order by decided_at desc, id desc
   limit 1;
  if v_confirmed_id is null then
    raise exception 'confirmation_result_missing' using errcode = 'P0001';
  end if;
  return v_confirmed_id;
end;
$$;

revoke all on function public.admin_confirm_payment_with_result(uuid, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_payment_with_result(uuid, numeric, text)
  to authenticated;
