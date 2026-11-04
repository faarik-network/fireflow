
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "companies": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"company_invites": {
                  Row: {
                    "accepted_at": string | null,"company_id": string,"created_at": string,"created_by": string,"email": string,"id": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"company_id": string,"created_at"?: string,"created_by": string,"email": string,"id"?: string,"role"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"company_id"?: string,"created_at"?: string,"created_by"?: string,"email"?: string,"id"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_invites_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_invites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "company_id": string | null,"company_role": string,"created_at": string | null,"email": string,"full_name": string | null,"id": string,"role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string | null,"company_role"?: string,"created_at"?: string | null,"email": string,"full_name"?: string | null,"id": string,"role"?: string | null
                  }
                  Update: {
                    "company_id"?: string | null,"company_role"?: string,"created_at"?: string | null,"email"?: string,"full_name"?: string | null,"id"?: string,"role"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    }
                  ]
                },"project_locks": {
                  Row: {
                    "acquired_at": string,"expires_at": string,"project_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acquired_at"?: string,"expires_at": string,"project_id": string,"user_id": string
                  }
                  Update: {
                    "acquired_at"?: string,"expires_at"?: string,"project_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_locks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_locks_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"project_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"grid_data": NonNullable<Json>,"id": string,"label": string | null,"project_id": string,"reason": string,"started_at": string,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"grid_data": NonNullable<Json>,"id"?: string,"label"?: string | null,"project_id": string,"reason": string,"started_at"?: string,"title"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"grid_data"?: NonNullable<Json>,"id"?: string,"label"?: string | null,"project_id"?: string,"reason"?: string,"started_at"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_versions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "company_id": string | null,"created_at": string | null,"description": string | null,"grid_data": NonNullable<Json>,"id": string,"title": string,"updated_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_id"?: string | null,"created_at"?: string | null,"description"?: string | null,"grid_data"?: NonNullable<Json>,"id"?: string,"title": string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "company_id"?: string | null,"created_at"?: string | null,"description"?: string | null,"grid_data"?: NonNullable<Json>,"id"?: string,"title"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_company_id_fkey"
      columns: ["company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"acquire_project_lock":
{ Args: { "p_force"?: boolean,"p_project": string }; Returns: Json
                           },
"can_edit_project":
{ Args: { "pid": string }; Returns: boolean
                           },
"can_write_project":
{ Args: { "pid": string }; Returns: boolean
                           },
"create_company":
{ Args: { "p_name": string }; Returns: string
                           },
"current_company_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"holds_project_lock":
{ Args: { "pid": string }; Returns: boolean
                           },
"is_company_admin":
{ Args: { "cid": string }; Returns: boolean
                           },
"leave_company":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"my_company_role":
{ Args: { "cid": string }; Returns: string
                           },
"plan_project_id":
{ Args: { "p_name": string }; Returns: string
                           },
"release_project_lock":
{ Args: { "p_project": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "p_member": string }; Returns: undefined
                           },
"rename_project":
{ Args: { "p_project": string,"p_title": string }; Returns: undefined
                           },
"restore_project_version":
{ Args: { "p_version": string }; Returns: undefined
                           },
"save_project_version":
{ Args: { "p_label": string,"p_project": string }; Returns: string
                           },
"set_member_role":
{ Args: { "p_member": string,"p_role": string }; Returns: undefined
                           },
"transfer_ownership":
{ Args: { "p_member": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
