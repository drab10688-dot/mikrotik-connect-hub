-- Agregar rol 'secretary' al enum existente
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'secretary';