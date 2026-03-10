-- Enable Realtime postgres_changes delivery for the events table.
-- Without this the supabase_realtime publication does not include events,
-- so INSERT callbacks in EventBrowser and MonitorView never fire.
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
