export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      billing_config: {
        Row: {
          auto_send_telegram: boolean
          auto_send_whatsapp: boolean
          billing_day: number
          billing_type: string
          created_at: string
          created_by: string
          grace_period_days: number
          id: string
          invoice_maturity_days: number
          mikrotik_id: string
          reminder_days_before: number
          suspension_address_list: string | null
          updated_at: string
        }
        Insert: {
          auto_send_telegram?: boolean
          auto_send_whatsapp?: boolean
          billing_day?: number
          billing_type?: string
          created_at?: string
          created_by: string
          grace_period_days?: number
          id?: string
          invoice_maturity_days?: number
          mikrotik_id: string
          reminder_days_before?: number
          suspension_address_list?: string | null
          updated_at?: string
        }
        Update: {
          auto_send_telegram?: boolean
          auto_send_whatsapp?: boolean
          billing_day?: number
          billing_type?: string
          created_at?: string
          created_by?: string
          grace_period_days?: number
          id?: string
          invoice_maturity_days?: number
          mikrotik_id?: string
          reminder_days_before?: number
          suspension_address_list?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_config_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: true
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      client_billing_settings: {
        Row: {
          billing_day: number
          client_id: string | null
          created_at: string
          grace_period_days: number
          id: string
          is_suspended: boolean
          last_payment_date: string | null
          mikrotik_id: string
          monthly_amount: number
          next_billing_date: string | null
          reminder_days_before: number
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          billing_day?: number
          client_id?: string | null
          created_at?: string
          grace_period_days?: number
          id?: string
          is_suspended?: boolean
          last_payment_date?: string | null
          mikrotik_id: string
          monthly_amount: number
          next_billing_date?: string | null
          reminder_days_before?: number
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_day?: number
          client_id?: string | null
          created_at?: string
          grace_period_days?: number
          id?: string
          is_suspended?: boolean
          last_payment_date?: string | null
          mikrotik_id?: string
          monthly_amount?: number
          next_billing_date?: string | null
          reminder_days_before?: number
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_billing_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "isp_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invoices: {
        Row: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          client_id: string | null
          contract_id: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          mikrotik_id: string
          paid_at: string | null
          paid_via: string | null
          payment_reference: string | null
          service_breakdown: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          due_date: string
          id?: string
          invoice_number: string
          mikrotik_id: string
          paid_at?: string | null
          paid_via?: string | null
          payment_reference?: string | null
          service_breakdown?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_period_end?: string
          billing_period_start?: string
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          due_date?: string
          id?: string
          invoice_number?: string
          mikrotik_id?: string
          paid_at?: string | null
          paid_via?: string | null
          payment_reference?: string | null
          service_breakdown?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "isp_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "isp_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      cloudflare_config: {
        Row: {
          agent_host: string | null
          agent_port: number | null
          agent_secret: string | null
          api_token: string | null
          created_at: string
          created_by: string
          domain: string | null
          id: string
          is_active: boolean
          mikrotik_id: string
          mode: string
          tunnel_id: string | null
          tunnel_name: string | null
          tunnel_url: string | null
          updated_at: string
        }
        Insert: {
          agent_host?: string | null
          agent_port?: number | null
          agent_secret?: string | null
          api_token?: string | null
          created_at?: string
          created_by: string
          domain?: string | null
          id?: string
          is_active?: boolean
          mikrotik_id: string
          mode?: string
          tunnel_id?: string | null
          tunnel_name?: string | null
          tunnel_url?: string | null
          updated_at?: string
        }
        Update: {
          agent_host?: string | null
          agent_port?: number | null
          agent_secret?: string | null
          api_token?: string | null
          created_at?: string
          created_by?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          mikrotik_id?: string
          mode?: string
          tunnel_id?: string | null
          tunnel_name?: string | null
          tunnel_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloudflare_config_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: true
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      isp_clients: {
        Row: {
          address: string | null
          assigned_ip: string | null
          city: string | null
          client_name: string
          comment: string | null
          connection_type: string
          created_at: string
          created_by: string
          email: string | null
          id: string
          identification_number: string | null
          is_potential_client: boolean | null
          latitude: string | null
          longitude: string | null
          mikrotik_id: string
          phone: string | null
          plan_or_speed: string | null
          service_option: string | null
          service_price: number | null
          telegram_chat_id: string | null
          total_monthly_price: number | null
          username: string
        }
        Insert: {
          address?: string | null
          assigned_ip?: string | null
          city?: string | null
          client_name: string
          comment?: string | null
          connection_type: string
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          identification_number?: string | null
          is_potential_client?: boolean | null
          latitude?: string | null
          longitude?: string | null
          mikrotik_id: string
          phone?: string | null
          plan_or_speed?: string | null
          service_option?: string | null
          service_price?: number | null
          telegram_chat_id?: string | null
          total_monthly_price?: number | null
          username: string
        }
        Update: {
          address?: string | null
          assigned_ip?: string | null
          city?: string | null
          client_name?: string
          comment?: string | null
          connection_type?: string
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          identification_number?: string | null
          is_potential_client?: boolean | null
          latitude?: string | null
          longitude?: string | null
          mikrotik_id?: string
          phone?: string | null
          plan_or_speed?: string | null
          service_option?: string | null
          service_price?: number | null
          telegram_chat_id?: string | null
          total_monthly_price?: number | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "isp_clients_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      isp_contracts: {
        Row: {
          address: string | null
          client_id: string | null
          client_name: string
          client_signature_url: string | null
          contract_number: string
          created_at: string
          created_by: string
          email: string | null
          equipment: string[] | null
          id: string
          identification: string
          manager_signature_url: string | null
          mikrotik_id: string
          pdf_url: string | null
          phone: string | null
          plan: string
          price: string | null
          service_option: string | null
          service_price: string | null
          signed_at: string | null
          speed: string | null
          status: string
          total_price: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_id?: string | null
          client_name: string
          client_signature_url?: string | null
          contract_number: string
          created_at?: string
          created_by: string
          email?: string | null
          equipment?: string[] | null
          id?: string
          identification: string
          manager_signature_url?: string | null
          mikrotik_id: string
          pdf_url?: string | null
          phone?: string | null
          plan: string
          price?: string | null
          service_option?: string | null
          service_price?: string | null
          signed_at?: string | null
          speed?: string | null
          status?: string
          total_price?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_id?: string | null
          client_name?: string
          client_signature_url?: string | null
          contract_number?: string
          created_at?: string
          created_by?: string
          email?: string | null
          equipment?: string[] | null
          id?: string
          identification?: string
          manager_signature_url?: string | null
          mikrotik_id?: string
          pdf_url?: string | null
          phone?: string | null
          plan?: string
          price?: string | null
          service_option?: string | null
          service_price?: string | null
          signed_at?: string | null
          speed?: string | null
          status?: string
          total_price?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "isp_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "isp_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mikrotik_devices: {
        Row: {
          created_at: string | null
          created_by: string
          host: string
          hotspot_url: string | null
          id: string
          name: string
          password: string
          port: number
          status: string
          updated_at: string | null
          username: string
          version: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          host: string
          hotspot_url?: string | null
          id?: string
          name: string
          password: string
          port?: number
          status?: string
          updated_at?: string | null
          username: string
          version?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          host?: string
          hotspot_url?: string | null
          id?: string
          name?: string
          password?: string
          port?: number
          status?: string
          updated_at?: string | null
          username?: string
          version?: string
        }
        Relationships: []
      }
      payment_platforms: {
        Row: {
          created_at: string
          created_by: string
          environment: string
          id: string
          is_active: boolean
          mikrotik_id: string
          platform: string
          private_key: string | null
          public_key: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          environment?: string
          id?: string
          is_active?: boolean
          mikrotik_id: string
          platform: string
          private_key?: string | null
          public_key?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          environment?: string
          id?: string
          is_active?: boolean
          mikrotik_id?: string
          platform?: string
          private_key?: string | null
          public_key?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          external_reference: string | null
          id: string
          invoice_id: string | null
          mikrotik_id: string
          payer_email: string | null
          payer_name: string | null
          platform: string
          raw_response: Json | null
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          invoice_id?: string | null
          mikrotik_id: string
          payer_email?: string | null
          payer_name?: string | null
          platform: string
          raw_response?: Json | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          invoice_id?: string | null
          mikrotik_id?: string
          payer_email?: string | null
          payer_name?: string | null
          platform?: string
          raw_response?: Json | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reseller_assignments: {
        Row: {
          assigned_by: string
          commission_percentage: number | null
          created_at: string | null
          id: string
          mikrotik_id: string
          reseller_id: string
        }
        Insert: {
          assigned_by: string
          commission_percentage?: number | null
          created_at?: string | null
          id?: string
          mikrotik_id: string
          reseller_id: string
        }
        Update: {
          assigned_by?: string
          commission_percentage?: number | null
          created_at?: string | null
          id?: string
          mikrotik_id?: string
          reseller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reseller_assignments_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      secretary_assignments: {
        Row: {
          assigned_by: string
          can_create_pppoe: boolean | null
          can_create_queues: boolean | null
          can_delete_pppoe: boolean | null
          can_delete_queues: boolean | null
          can_disconnect_pppoe: boolean | null
          can_edit_pppoe: boolean | null
          can_edit_queues: boolean | null
          can_manage_pppoe: boolean | null
          can_manage_queues: boolean | null
          can_reactivate_queues: boolean | null
          can_suspend_queues: boolean | null
          can_toggle_pppoe: boolean | null
          can_toggle_queues: boolean | null
          created_at: string | null
          id: string
          mikrotik_id: string
          secretary_id: string
        }
        Insert: {
          assigned_by: string
          can_create_pppoe?: boolean | null
          can_create_queues?: boolean | null
          can_delete_pppoe?: boolean | null
          can_delete_queues?: boolean | null
          can_disconnect_pppoe?: boolean | null
          can_edit_pppoe?: boolean | null
          can_edit_queues?: boolean | null
          can_manage_pppoe?: boolean | null
          can_manage_queues?: boolean | null
          can_reactivate_queues?: boolean | null
          can_suspend_queues?: boolean | null
          can_toggle_pppoe?: boolean | null
          can_toggle_queues?: boolean | null
          created_at?: string | null
          id?: string
          mikrotik_id: string
          secretary_id: string
        }
        Update: {
          assigned_by?: string
          can_create_pppoe?: boolean | null
          can_create_queues?: boolean | null
          can_delete_pppoe?: boolean | null
          can_delete_queues?: boolean | null
          can_disconnect_pppoe?: boolean | null
          can_edit_pppoe?: boolean | null
          can_edit_queues?: boolean | null
          can_manage_pppoe?: boolean | null
          can_manage_queues?: boolean | null
          can_reactivate_queues?: boolean | null
          can_suspend_queues?: boolean | null
          can_toggle_pppoe?: boolean | null
          can_toggle_queues?: boolean | null
          created_at?: string | null
          id?: string
          mikrotik_id?: string
          secretary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "secretary_assignments_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      service_options: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_default: boolean
          mikrotik_id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_default?: boolean
          mikrotik_id: string
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_default?: boolean
          mikrotik_id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_options_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_config: {
        Row: {
          bot_token: string
          bot_username: string | null
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          mikrotik_id: string
          updated_at: string
        }
        Insert: {
          bot_token: string
          bot_username?: string | null
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          mikrotik_id: string
          updated_at?: string
        }
        Update: {
          bot_token?: string
          bot_username?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          mikrotik_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_config_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: true
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_messages: {
        Row: {
          chat_id: string
          client_id: string | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          message_content: string
          message_type: string
          mikrotik_id: string
          related_contract_id: string | null
          related_invoice_id: string | null
          sent_at: string | null
          status: string
          telegram_message_id: string | null
        }
        Insert: {
          chat_id: string
          client_id?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          message_content: string
          message_type?: string
          mikrotik_id: string
          related_contract_id?: string | null
          related_invoice_id?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: string | null
        }
        Update: {
          chat_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          message_content?: string
          message_type?: string
          mikrotik_id?: string
          related_contract_id?: string | null
          related_invoice_id?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "isp_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_messages_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_messages_related_contract_id_fkey"
            columns: ["related_contract_id"]
            isOneToOne: false
            referencedRelation: "isp_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_messages_related_invoice_id_fkey"
            columns: ["related_invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mikrotik_access: {
        Row: {
          created_at: string | null
          granted_by: string
          id: string
          mikrotik_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          granted_by: string
          id?: string
          mikrotik_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          granted_by?: string
          id?: string
          mikrotik_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_mikrotik_access_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voucher_presets: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          mikrotik_id: string | null
          name: string
          price: number
          updated_at: string | null
          validity: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          mikrotik_id?: string | null
          name: string
          price?: number
          updated_at?: string | null
          validity: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          mikrotik_id?: string | null
          name?: string
          price?: number
          updated_at?: string | null
          validity?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_presets_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_sales_history: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string
          expired_at: string
          id: string
          mikrotik_id: string
          price: number
          profile: string
          sold_at: string | null
          sold_by: string | null
          total_uptime: string | null
          validity: string
          voucher_code: string
          voucher_password: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by: string
          expired_at?: string
          id?: string
          mikrotik_id: string
          price?: number
          profile: string
          sold_at?: string | null
          sold_by?: string | null
          total_uptime?: string | null
          validity: string
          voucher_code: string
          voucher_password: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string
          expired_at?: string
          id?: string
          mikrotik_id?: string
          price?: number
          profile?: string
          sold_at?: string | null
          sold_by?: string | null
          total_uptime?: string | null
          validity?: string
          voucher_code?: string
          voucher_password?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_sales_history_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          activated_at: string | null
          code: string
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          mikrotik_id: string
          mikrotik_user_id: string | null
          password: string
          price: number | null
          profile: string
          sold_at: string | null
          sold_by: string | null
          status: string
          updated_at: string | null
          validity: string | null
        }
        Insert: {
          activated_at?: string | null
          code: string
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          mikrotik_id: string
          mikrotik_user_id?: string | null
          password: string
          price?: number | null
          profile: string
          sold_at?: string | null
          sold_by?: string | null
          status?: string
          updated_at?: string | null
          validity?: string | null
        }
        Update: {
          activated_at?: string | null
          code?: string
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          mikrotik_id?: string
          mikrotik_user_id?: string | null
          password?: string
          price?: number | null
          profile?: string
          sold_at?: string | null
          sold_by?: string | null
          status?: string
          updated_at?: string | null
          validity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          access_token: string
          business_account_id: string | null
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          mikrotik_id: string
          phone_number_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          business_account_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          mikrotik_id: string
          phone_number_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          business_account_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          mikrotik_id?: string
          phone_number_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: true
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          message_content: string
          message_type: string
          mikrotik_id: string
          phone_number: string
          related_contract_id: string | null
          related_invoice_id: string | null
          sent_at: string | null
          status: string
          whatsapp_message_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          message_content: string
          message_type?: string
          mikrotik_id: string
          phone_number: string
          related_contract_id?: string | null
          related_invoice_id?: string | null
          sent_at?: string | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          message_content?: string
          message_type?: string
          mikrotik_id?: string
          phone_number?: string
          related_contract_id?: string | null
          related_invoice_id?: string | null
          sent_at?: string | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "isp_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_mikrotik_id_fkey"
            columns: ["mikrotik_id"]
            isOneToOne: false
            referencedRelation: "mikrotik_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_related_contract_id_fkey"
            columns: ["related_contract_id"]
            isOneToOne: false
            referencedRelation: "isp_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_related_invoice_id_fkey"
            columns: ["related_invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_active_payment_platforms: {
        Args: { _mikrotik_id: string }
        Returns: {
          environment: string
          is_active: boolean
          platform: string
          public_key: string
        }[]
      }
      get_client_by_contract: {
        Args: { _contract_number: string }
        Returns: {
          billing_day: number
          client_id: string
          client_name: string
          connection_type: string
          is_suspended: boolean
          mikrotik_id: string
          monthly_amount: number
          plan_or_speed: string
          username: string
        }[]
      }
      get_client_invoices: {
        Args: { _client_id: string }
        Returns: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          due_date: string
          id: string
          invoice_number: string
          paid_at: string
          status: string
        }[]
      }
      get_client_payment_info: {
        Args: { _identification: string }
        Returns: {
          billing_day: number
          client_id: string
          client_name: string
          connection_type: string
          is_suspended: boolean
          mikrotik_id: string
          monthly_amount: number
          plan_or_speed: string
          username: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "user" | "reseller" | "secretary"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "user", "reseller", "secretary"],
    },
  },
} as const
