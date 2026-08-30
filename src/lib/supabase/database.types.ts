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
          time_zone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_membership_id: string;
          id?: string;
          name: string;
          time_zone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_membership_id?: string;
          id?: string;
          name?: string;
          time_zone?: string;
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
      moment_notes: {
        Row: {
          author_membership_id: string;
          body: string;
          circle_id: string;
          created_at: string;
          id: string;
          moment_id: string;
          revision: number;
          trashed_at: string | null;
          updated_at: string;
        };
        Insert: {
          author_membership_id: string;
          body: string;
          circle_id: string;
          created_at?: string;
          id?: string;
          moment_id: string;
          revision?: number;
          trashed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          author_membership_id?: string;
          body?: string;
          circle_id?: string;
          created_at?: string;
          id?: string;
          moment_id?: string;
          revision?: number;
          trashed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_notes_author_fkey";
            columns: ["circle_id", "author_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "moment_notes_moment_fkey";
            columns: ["circle_id", "moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      moment_people: {
        Row: {
          circle_id: string;
          created_at: string;
          moment_id: string;
          person_id: string;
          removed_at: string | null;
          tagged_by_membership_id: string;
        };
        Insert: {
          circle_id: string;
          created_at?: string;
          moment_id: string;
          person_id: string;
          removed_at?: string | null;
          tagged_by_membership_id: string;
        };
        Update: {
          circle_id?: string;
          created_at?: string;
          moment_id?: string;
          person_id?: string;
          removed_at?: string | null;
          tagged_by_membership_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_people_moment_fkey";
            columns: ["circle_id", "moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "moment_people_person_fkey";
            columns: ["circle_id", "person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "moment_people_tagger_fkey";
            columns: ["circle_id", "tagged_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      moment_reactions: {
        Row: {
          author_membership_id: string;
          circle_id: string;
          created_at: string;
          id: string;
          moment_id: string;
          reaction_type: string;
          removed_at: string | null;
          revision: number;
          updated_at: string;
        };
        Insert: {
          author_membership_id: string;
          circle_id: string;
          created_at?: string;
          id?: string;
          moment_id: string;
          reaction_type: string;
          removed_at?: string | null;
          revision?: number;
          updated_at?: string;
        };
        Update: {
          author_membership_id?: string;
          circle_id?: string;
          created_at?: string;
          id?: string;
          moment_id?: string;
          reaction_type?: string;
          removed_at?: string | null;
          revision?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_reactions_author_fkey";
            columns: ["circle_id", "author_membership_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "moment_reactions_moment_fkey";
            columns: ["circle_id", "moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["circle_id", "id"];
          },
        ];
      };
      moments: {
        Row: {
          body: string;
          circle_id: string;
          created_at: string;
          id: string;
          journal_person_id: string;
          kind: string;
          occurred_at: string | null;
          occurred_on: string;
          occurred_timezone: string | null;
          place_name: string | null;
          recorded_by_user_id: string;
          revision: number;
          time_precision: string;
          title: string | null;
          trashed_at: string | null;
          trashed_by_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          body: string;
          circle_id: string;
          created_at?: string;
          id?: string;
          journal_person_id: string;
          kind?: string;
          occurred_at?: string | null;
          occurred_on: string;
          occurred_timezone?: string | null;
          place_name?: string | null;
          recorded_by_user_id: string;
          revision?: number;
          time_precision?: string;
          title?: string | null;
          trashed_at?: string | null;
          trashed_by_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          body?: string;
          circle_id?: string;
          created_at?: string;
          id?: string;
          journal_person_id?: string;
          kind?: string;
          occurred_at?: string | null;
          occurred_on?: string;
          occurred_timezone?: string | null;
          place_name?: string | null;
          recorded_by_user_id?: string;
          revision?: number;
          time_precision?: string;
          title?: string | null;
          trashed_at?: string | null;
          trashed_by_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moments_circle_id_fkey";
            columns: ["circle_id"];
            isOneToOne: false;
            referencedRelation: "circles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moments_journal_person_fkey";
            columns: ["circle_id", "journal_person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["circle_id", "id"];
          },
          {
            foreignKeyName: "moments_recorder_fkey";
            columns: ["circle_id", "recorded_by_user_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "user_id"];
          },
          {
            foreignKeyName: "moments_trashed_by_fkey";
            columns: ["circle_id", "trashed_by_user_id"];
            isOneToOne: false;
            referencedRelation: "circle_memberships";
            referencedColumns: ["circle_id", "user_id"];
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
      create_family_moment: {
        Args: {
          circle_id: string;
          journal_person_id: string;
          moment_body: string;
          moment_kind: string;
          moment_title: string;
          occurred_at?: string;
          occurred_on: string;
          occurred_timezone?: string;
          place_name: string;
          tagged_person_ids: string[];
        };
        Returns: string;
      };
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
      create_moment_note: {
        Args: { body: string; moment_id: string };
        Returns: string;
      };
      create_written_moment: {
        Args: {
          body: string;
          circle_id: string;
          journal_person_id: string;
          occurred_at?: string;
          occurred_on: string;
          occurred_timezone?: string;
        };
        Returns: string;
      };
      get_moment_conversation: {
        Args: { moment_id: string };
        Returns: {
          notes: Json;
          reactions: Json;
        }[];
      };
      list_manageable_trashed_written_moments: {
        Args: { circle_id: string };
        Returns: {
          body: string;
          journal_person_accent: string;
          journal_person_id: string;
          journal_person_name: string;
          moment_id: string;
          moment_kind: string;
          moment_title: string;
          occurred_on: string;
          place_name: string;
          revision: number;
          trashed_at: string;
        }[];
      };
      list_memory_moments: {
        Args: {
          anniversary_day?: number;
          anniversary_month?: number;
          circle_id: string;
          cursor_has_precise_time?: boolean;
          cursor_moment_id?: string;
          cursor_occurred_at?: string;
          cursor_occurred_on?: string;
          memory_year?: number;
          page_size?: number;
          snapshot_at?: string;
        };
        Returns: {
          body: string;
          can_change: boolean;
          created_at: string;
          feed_snapshot_at: string;
          journal_person_accent: string;
          journal_person_kind: string;
          journal_person_name: string;
          moment_circle_id: string;
          moment_id: string;
          moment_journal_person_id: string;
          moment_kind: string;
          moment_title: string;
          occurred_at: string;
          occurred_on: string;
          occurred_timezone: string;
          place_name: string;
          recorder_person_id: string;
          recorder_person_name: string;
          revision: number;
          tagged_people: Json;
          time_precision: string;
          updated_at: string;
        }[];
      };
      list_memory_years: {
        Args: { before_year?: number; circle_id: string; page_size?: number };
        Returns: {
          memory_year: number;
        }[];
      };
      list_milestone_memories: {
        Args: {
          circle_id: string;
          cursor_has_precise_time?: boolean;
          cursor_moment_id?: string;
          cursor_occurred_at?: string;
          cursor_occurred_on?: string;
          page_size?: number;
          snapshot_at?: string;
        };
        Returns: {
          body: string;
          can_change: boolean;
          created_at: string;
          feed_snapshot_at: string;
          journal_person_accent: string;
          journal_person_kind: string;
          journal_person_name: string;
          moment_circle_id: string;
          moment_id: string;
          moment_journal_person_id: string;
          moment_kind: string;
          moment_title: string;
          occurred_at: string;
          occurred_on: string;
          occurred_timezone: string;
          place_name: string;
          recorder_person_id: string;
          recorder_person_name: string;
          revision: number;
          tagged_people: Json;
          time_precision: string;
          updated_at: string;
        }[];
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
      list_timeline_moments: {
        Args: {
          circle_id: string;
          cursor_has_precise_time?: boolean;
          cursor_moment_id?: string;
          cursor_occurred_at?: string;
          cursor_occurred_on?: string;
          journal_person_id?: string;
          page_size?: number;
          snapshot_at?: string;
        };
        Returns: {
          body: string;
          can_change: boolean;
          created_at: string;
          feed_snapshot_at: string;
          journal_person_accent: string;
          journal_person_kind: string;
          journal_person_name: string;
          moment_circle_id: string;
          moment_id: string;
          moment_journal_person_id: string;
          moment_kind: string;
          moment_title: string;
          occurred_at: string;
          occurred_on: string;
          occurred_timezone: string;
          place_name: string;
          recorder_person_id: string;
          recorder_person_name: string;
          revision: number;
          tagged_people: Json;
          time_precision: string;
          updated_at: string;
        }[];
      };
      preflight_invitation: {
        Args: { email: string; token: string };
        Returns: boolean;
      };
      request_family_export: {
        Args: { circle_id: string; request_key: string };
        Returns: string;
      };
      request_invitation_job: {
        Args: {
          circle_id: string;
          display_name: string;
          request_key: string;
          target_auth_user_id: string;
        };
        Returns: string;
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
      set_moment_reaction: {
        Args: { moment_id: string; reaction_type: string };
        Returns: number;
      };
      set_person_guardian: {
        Args: {
          grant_access: boolean;
          guardian_membership_id: string;
          managed_person_id: string;
        };
        Returns: string;
      };
      set_written_moment_trashed: {
        Args: {
          expected_revision: number;
          moment_id: string;
          trashed: boolean;
        };
        Returns: number;
      };
      trash_moment_note: {
        Args: { expected_revision: number; note_id: string };
        Returns: number;
      };
      update_family_moment: {
        Args: {
          expected_revision: number;
          moment_body: string;
          moment_id: string;
          moment_title: string;
          occurred_at?: string;
          occurred_on: string;
          occurred_timezone?: string;
          place_name: string;
          tagged_person_ids: string[];
        };
        Returns: number;
      };
      update_moment_note: {
        Args: { body: string; expected_revision: number; note_id: string };
        Returns: number;
      };
      update_written_moment: {
        Args: {
          body: string;
          expected_revision: number;
          moment_id: string;
          occurred_at?: string;
          occurred_on: string;
          occurred_timezone?: string;
        };
        Returns: number;
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
