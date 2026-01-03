-- Add telegram_chat_id column to isp_clients table
ALTER TABLE public.isp_clients 
ADD COLUMN telegram_chat_id TEXT DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.isp_clients.telegram_chat_id IS 'Telegram Chat ID for automatic notifications';