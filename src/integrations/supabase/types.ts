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
      vouchers: {
        Row: {
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
        }
        Insert: {
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
        }
        Update: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
