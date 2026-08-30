export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      circle_memberships: {
        Row: {
          circle_id: string;
          id: string;
          joined_at: string;
          person_id: string;
          revoked_at: string | null;
          revoked_by_membership_id: string | null;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          circle_id: string;
          id?: string;
          joined_at?: string;
          person_id: string;
          revoked_at?: string | null;
          revoked_by_membership_id?: string | null;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          circle_id?: string;
          id?: string;
          joined_at?: string;
          person_id?: string;
          revoked_at?: string | null;
          revoked_by_membership_id?: string | null;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "circle_memberships_circle_id_fkey";
            columns: ["circle_id"];
            isOneToOne: false;
            referencedRelation: "circles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "circle_memberships_person_fkey";
            columns: ["circle_id", "person_id"];
            isOneToOne: true;
            referencedRelation: "people";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "circle_memberships_revoked_by_fkey";
            columns: ["circle_id", "revoked_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      circles: {
        Row: {
          created_at: string;
          created_by_membership_id: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_membership_id: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_membership_id?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "circles_created_by_fkey";
            columns: ["id", "created_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      people: {
        Row: {
          accent_token: string;
          circle_id: string;
          created_at: string;
          created_by_membership_id: string;
          display_name: string;
          id: string;
          profile_kind: string;
          updated_at: string;
        };
        Insert: {
          accent_token?: string;
          circle_id: string;
          created_at?: string;
          created_by_membership_id: string;
          display_name: string;
          id?: string;
          profile_kind: string;
          updated_at?: string;
        };
        Update: {
          accent_token?: string;
          circle_id?: string;
          created_at?: string;
          created_by_membership_id?: string;
          display_name?: string;
          id?: string;
          profile_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "people_circle_id_fkey";
            columns: ["circle_id"];
            isOneToOne: false;
            referencedRelation: "circles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "people_created_by_fkey";
            columns: ["circle_id", "created_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      person_guardians: {
        Row: {
          circle_id: string;
          created_at: string;
          created_by_membership_id: string;
          guardian_membership_id: string;
          id: string;
          managed_person_id: string;
          revoked_at: string | null;
          revoked_by_membership_id: string | null;
        };
        Insert: {
          circle_id: string;
          created_at?: string;
          created_by_membership_id: string;
          guardian_membership_id: string;
          id?: string;
          managed_person_id: string;
          revoked_at?: string | null;
          revoked_by_membership_id?: string | null;
        };
        Update: {
          circle_id?: string;
          created_at?: string;
          created_by_membership_id?: string;
          guardian_membership_id?: string;
          id?: string;
          managed_person_id?: string;
          revoked_at?: string | null;
          revoked_by_membership_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "person_guardians_creator_fkey";
            columns: ["circle_id", "created_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "person_guardians_guardian_fkey";
            columns: ["circle_id", "guardian_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "person_guardians_person_fkey";
            columns: ["circle_id", "managed_person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "person_guardians_revoked_by_fkey";
            columns: ["circle_id", "revoked_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { token: string }; Returns: string };
      create_invitation: {
        Args: {
          circle_id: string;
          display_name: string;
          email: string;
          reinvite_membership_id?: string;
        };
        Returns: {
          expires_at: string;
          invitation_id: string;
          raw_token: string;
        }[];
      };
      create_managed_person: {
        Args: {
          accent_token?: string;
          circle_id: string;
          display_name: string;
        };
        Returns: string;
      };
      list_pending_invitations: {
        Args: { circle_id: string };
        Returns: {
          created_at: string;
          display_name: string;
          expires_at: string;
          invitation_id: string;
        }[];
      };
      preflight_invitation: {
        Args: { email: string; token: string };
        Returns: boolean;
      };
      revoke_invitation: {
        Args: { invitation_id: string };
        Returns: undefined;
      };
      revoke_membership: {
        Args: { membership_id: string };
        Returns: undefined;
      };
      set_membership_role: {
        Args: { membership_id: string; role: string };
        Returns: undefined;
      };
      set_person_guardian: {
        Args: {
          grant_access: boolean;
          guardian_membership_id: string;
          managed_person_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
