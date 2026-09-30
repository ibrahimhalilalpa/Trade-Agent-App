begin;

update public.notification_event_templates
set title = 'Aramıza hoş geldin',
    message = 'Hesabın hazır. Piyasaları takip etmeye ve ilk izleme listeni oluşturmaya başlayabilirsin.'
where event_key = 'user_registered'
  and title = 'Trade Agent''a hoş geldin';

notify pgrst, 'reload schema';
commit;
