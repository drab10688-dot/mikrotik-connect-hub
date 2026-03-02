ALTER TABLE public.cloudflare_config
ADD COLUMN agent_host text DEFAULT NULL,
ADD COLUMN agent_port integer DEFAULT 3847,
ADD COLUMN agent_secret text DEFAULT NULL;