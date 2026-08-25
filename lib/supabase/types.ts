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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appeals: {
        Row: {
          appellant_profile_id: string
          assigned_at: string | null
          assigned_reviewer_id: string | null
          created_at: string
          decision_at: string
          id: string
          original_decider_id: string | null
          override_reason: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          statement: string
          status: string
          subject_id: string
          subject_type: string
          updated_at: string
        }
        Insert: {
          appellant_profile_id: string
          assigned_at?: string | null
          assigned_reviewer_id?: string | null
          created_at?: string
          decision_at: string
          id?: string
          original_decider_id?: string | null
          override_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          statement: string
          status?: string
          subject_id: string
          subject_type: string
          updated_at?: string
        }
        Update: {
          appellant_profile_id?: string
          assigned_at?: string | null
          assigned_reviewer_id?: string | null
          created_at?: string
          decision_at?: string
          id?: string
          original_decider_id?: string | null
          override_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          statement?: string
          status?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeals_appellant_profile_id_fkey"
            columns: ["appellant_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_assigned_reviewer_id_fkey"
            columns: ["assigned_reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_original_decider_id_fkey"
            columns: ["original_decider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_rules: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          domain: string
          reason: string | null
          rule: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          domain: string
          reason?: string | null
          rule: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          domain?: string
          reason?: string | null
          rule?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ftc_teams_cache: {
        Row: {
          city: string | null
          country: string | null
          district_code: string | null
          last_synced: string
          official_team_name: string | null
          organization: string | null
          region_code: string | null
          rookie_year: number | null
          source: string
          state: string | null
          team_name: string
          team_number: number
          verified_at: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          district_code?: string | null
          last_synced?: string
          official_team_name?: string | null
          organization?: string | null
          region_code?: string | null
          rookie_year?: number | null
          source?: string
          state?: string | null
          team_name: string
          team_number: number
          verified_at?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          district_code?: string | null
          last_synced?: string
          official_team_name?: string | null
          organization?: string | null
          region_code?: string | null
          rookie_year?: number | null
          source?: string
          state?: string | null
          team_name?: string
          team_number?: number
          verified_at?: string | null
        }
        Relationships: []
      }
      impact_report_snapshots: {
        Row: {
          closed_at: string | null
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          payload: Json
          payload_schema_version: number
          report_year: number
          scope: string
          sponsor_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          payload: Json
          payload_schema_version?: number
          report_year: number
          scope: string
          sponsor_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          payload?: Json
          payload_schema_version?: number
          report_year?: number
          scope?: string
          sponsor_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "impact_report_snapshots_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impact_report_snapshots_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impact_report_snapshots_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impact_report_snapshots_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          recipient_id: string
          submission_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id: string
          submission_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          submission_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_storage_deletions: {
        Row: {
          attempts: number
          bucket: string
          created_at: string
          deleted_at: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          path: string
          reason: string
        }
        Insert: {
          attempts?: number
          bucket: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          path: string
          reason: string
        }
        Update: {
          attempts?: number
          bucket?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          path?: string
          reason?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          admin_level: Database["public"]["Enums"]["admin_level"] | null
          age_confirmed_at: string | null
          city: string | null
          clerk_user_id: string | null
          coach_credentials_purged_at: string | null
          coach_credentials_url: string | null
          coach_verified: boolean
          coppa_acknowledged: boolean
          created_at: string
          date_of_birth: string | null
          denial_reason: string | null
          denied_at: string | null
          email: string
          full_name: string
          id: string
          pending_team_data: Json | null
          phone_number: string | null
          referral_source: string | null
          role: Database["public"]["Enums"]["user_role"]
          sponsor_id: string | null
          state: string | null
          tos_accepted: boolean
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          admin_level?: Database["public"]["Enums"]["admin_level"] | null
          age_confirmed_at?: string | null
          city?: string | null
          clerk_user_id?: string | null
          coach_credentials_purged_at?: string | null
          coach_credentials_url?: string | null
          coach_verified?: boolean
          coppa_acknowledged?: boolean
          created_at?: string
          date_of_birth?: string | null
          denial_reason?: string | null
          denied_at?: string | null
          email: string
          full_name: string
          id?: string
          pending_team_data?: Json | null
          phone_number?: string | null
          referral_source?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sponsor_id?: string | null
          state?: string | null
          tos_accepted?: boolean
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          admin_level?: Database["public"]["Enums"]["admin_level"] | null
          age_confirmed_at?: string | null
          city?: string | null
          clerk_user_id?: string | null
          coach_credentials_purged_at?: string | null
          coach_credentials_url?: string | null
          coach_verified?: boolean
          coppa_acknowledged?: boolean
          created_at?: string
          date_of_birth?: string | null
          denial_reason?: string | null
          denied_at?: string | null
          email?: string
          full_name?: string
          id?: string
          pending_team_data?: Json | null
          phone_number?: string | null
          referral_source?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sponsor_id?: string | null
          state?: string | null
          tos_accepted?: boolean
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
        ]
      }
      public_platform_stats: {
        Row: {
          dollars_matched_cents: number
          events_hosted: number
          id: boolean
          refreshed_at: string
          sponsors_active: number
          students_reached: number
          teams_supported: number
          volunteer_hours: number
        }
        Insert: {
          dollars_matched_cents?: number
          events_hosted?: number
          id?: boolean
          refreshed_at?: string
          sponsors_active?: number
          students_reached?: number
          teams_supported?: number
          volunteer_hours?: number
        }
        Update: {
          dollars_matched_cents?: number
          events_hosted?: number
          id?: boolean
          refreshed_at?: string
          sponsors_active?: number
          students_reached?: number
          teams_supported?: number
          volunteer_hours?: number
        }
        Relationships: []
      }
      request_throttle: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      sponsor_applications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_name: string
          contact_email: string
          contact_name: string
          created_at: string
          domain_match: string | null
          email_domain: string | null
          id: string
          message: string | null
          proposed_cap_cents: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          website: string | null
          website_domain: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_name: string
          contact_email: string
          contact_name: string
          created_at?: string
          domain_match?: string | null
          email_domain?: string | null
          id?: string
          message?: string | null
          proposed_cap_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          website?: string | null
          website_domain?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_name?: string
          contact_email?: string
          contact_name?: string
          created_at?: string
          domain_match?: string | null
          email_domain?: string | null
          id?: string
          message?: string | null
          proposed_cap_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          website?: string | null
          website_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_applications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_decision_proposals: {
        Row: {
          amount_cents: number
          closed_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          decision_note: string | null
          expires_at: string
          feedback: string | null
          id: string
          origin: string
          proposed_at: string
          proposed_by: string | null
          settled_amount_cents: number | null
          sponsor_id: string
          status: string
          submission_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          closed_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_note?: string | null
          expires_at: string
          feedback?: string | null
          id?: string
          origin?: string
          proposed_at?: string
          proposed_by?: string | null
          settled_amount_cents?: number | null
          sponsor_id: string
          status?: string
          submission_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          closed_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_note?: string | null
          expires_at?: string
          feedback?: string | null
          id?: string
          origin?: string
          proposed_at?: string
          proposed_by?: string | null
          settled_amount_cents?: number | null
          sponsor_id?: string
          status?: string
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_decision_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_decision_proposals_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_members: {
        Row: {
          clerk_membership_id: string | null
          clerk_org_id: string
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string | null
          profile_id: string
          role: string
          sponsor_id: string
          updated_at: string
        }
        Insert: {
          clerk_membership_id?: string | null
          clerk_org_id: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          profile_id: string
          role?: string
          sponsor_id: string
          updated_at?: string
        }
        Update: {
          clerk_membership_id?: string | null
          clerk_org_id?: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          profile_id?: string
          role?: string
          sponsor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_members_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_members_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_members_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsors: {
        Row: {
          approval_required_above_cents: number | null
          clerk_org_id: string | null
          company_name: string
          contact_email: string
          contact_name: string
          contact_title: string | null
          created_at: string
          funding_cap_cents: number
          funding_used_cents: number
          geo_states: string[] | null
          id: string
          industry: string | null
          logo_url: string | null
          notes: string | null
          search_vector: unknown
          source: Database["public"]["Enums"]["sponsor_source"]
          status: Database["public"]["Enums"]["sponsor_status"]
          updated_at: string
          website: string | null
        }
        Insert: {
          approval_required_above_cents?: number | null
          clerk_org_id?: string | null
          company_name: string
          contact_email: string
          contact_name: string
          contact_title?: string | null
          created_at?: string
          funding_cap_cents?: number
          funding_used_cents?: number
          geo_states?: string[] | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          notes?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["sponsor_source"]
          status?: Database["public"]["Enums"]["sponsor_status"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          approval_required_above_cents?: number | null
          clerk_org_id?: string | null
          company_name?: string
          contact_email?: string
          contact_name?: string
          contact_title?: string | null
          created_at?: string
          funding_cap_cents?: number
          funding_used_cents?: number
          geo_states?: string[] | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          notes?: string | null
          search_vector?: unknown
          source?: Database["public"]["Enums"]["sponsor_source"]
          status?: Database["public"]["Enums"]["sponsor_status"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      submission_access_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          submission_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          submission_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          submission_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_access_tokens_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_access_tokens_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_messages: {
        Row: {
          author_label: string
          author_profile_id: string | null
          author_role: Database["public"]["Enums"]["user_role"]
          author_token_id: string | null
          body: string
          created_at: string
          flagged_at: string | null
          flagged_by: string | null
          id: string
          rejected_reason: string | null
          released_at: string | null
          released_by: string | null
          status: string
          submission_id: string
        }
        Insert: {
          author_label: string
          author_profile_id?: string | null
          author_role: Database["public"]["Enums"]["user_role"]
          author_token_id?: string | null
          body: string
          created_at?: string
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          rejected_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
          submission_id: string
        }
        Update: {
          author_label?: string
          author_profile_id?: string | null
          author_role?: Database["public"]["Enums"]["user_role"]
          author_token_id?: string | null
          body?: string
          created_at?: string
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          rejected_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_messages_author_token_id_fkey"
            columns: ["author_token_id"]
            isOneToOne: false
            referencedRelation: "submission_access_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_messages_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_messages_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_messages_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_messages_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          admin_feedback: string | null
          created_at: string
          custom_pitch_alignment: string | null
          deleted_at: string | null
          expires_at: string | null
          id: string
          is_locked: boolean | null
          local_connection_notes: string | null
          requested_amount_cents: number
          resend_message_id: string | null
          reserved_amount_cents: number
          reviewed_at: string | null
          reviewed_by: string | null
          season: string | null
          sent_at: string | null
          specific_needs_statement: string | null
          sponsor_id: string
          status: Database["public"]["Enums"]["submission_status"]
          submitted_at: string | null
          team_id: string
          updated_at: string
          variant_label: string | null
        }
        Insert: {
          admin_feedback?: string | null
          created_at?: string
          custom_pitch_alignment?: string | null
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          is_locked?: boolean | null
          local_connection_notes?: string | null
          requested_amount_cents?: number
          resend_message_id?: string | null
          reserved_amount_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          season?: string | null
          sent_at?: string | null
          specific_needs_statement?: string | null
          sponsor_id: string
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          team_id: string
          updated_at?: string
          variant_label?: string | null
        }
        Update: {
          admin_feedback?: string | null
          created_at?: string
          custom_pitch_alignment?: string | null
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          is_locked?: boolean | null
          local_connection_notes?: string | null
          requested_amount_cents?: number
          resend_message_id?: string | null
          reserved_amount_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          season?: string | null
          sent_at?: string | null
          specific_needs_statement?: string | null
          sponsor_id?: string
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          team_id?: string
          updated_at?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_achievements: {
        Row: {
          award: string | null
          created_at: string
          description: string | null
          event_name: string
          id: string
          season: string | null
          team_id: string
        }
        Insert: {
          award?: string | null
          created_at?: string
          description?: string | null
          event_name: string
          id?: string
          season?: string | null
          team_id: string
        }
        Update: {
          award?: string | null
          created_at?: string
          description?: string | null
          event_name?: string
          id?: string
          season?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_achievements_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_verification_records: {
        Row: {
          checked_at: string
          claimed_organization: string | null
          claimed_team_name: string
          confidence: number
          ftc_team_number: number
          id: string
          name_score: number
          official_organization: string | null
          official_team_name: string | null
          organization_score: number | null
          outcome: string
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          profile_id: string | null
          source: string
          team_id: string | null
        }
        Insert: {
          checked_at?: string
          claimed_organization?: string | null
          claimed_team_name: string
          confidence?: number
          ftc_team_number: number
          id?: string
          name_score?: number
          official_organization?: string | null
          official_team_name?: string | null
          organization_score?: number | null
          outcome: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          profile_id?: string | null
          source: string
          team_id?: string | null
        }
        Update: {
          checked_at?: string
          claimed_organization?: string | null
          claimed_team_name?: string
          confidence?: number
          ftc_team_number?: number
          id?: string
          name_score?: number
          official_organization?: string | null
          official_team_name?: string | null
          organization_score?: number | null
          outcome?: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          profile_id?: string | null
          source?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_verification_records_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_verification_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_verification_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          budget_items: Json
          city: string | null
          coach_experience: string | null
          coach_photo_url: string | null
          community_endorsements: string | null
          community_interest_text: string | null
          created_at: string
          deleted_at: string | null
          events_hosted: number | null
          financial_ask_cents: number
          founded_year: number | null
          ftc_team_number: number | null
          github_link: string | null
          id: string
          logo_url: string | null
          media_no_minors_confirmed_at: string | null
          media_urls: Json
          mission_statement: string | null
          organization: string | null
          outreach_summary: string | null
          owner_id: string
          past_sponsors: string[]
          press_links: Json
          public: boolean
          seasons_competed: number | null
          seed_funding_goals_cents: number | null
          slug: string
          state: string | null
          status: Database["public"]["Enums"]["team_status"]
          student_interest_count: number | null
          students_reached: number | null
          subteam_breakdown: string | null
          sustainability_plan: string | null
          tagline: string | null
          tax_status: Database["public"]["Enums"]["tax_status_type"]
          team_name: string
          team_size: number | null
          technical_summary: string | null
          updated_at: string
          visual_pitch_items: Json
          volunteer_hours: number | null
          youtube_url: string | null
        }
        Insert: {
          budget_items?: Json
          city?: string | null
          coach_experience?: string | null
          coach_photo_url?: string | null
          community_endorsements?: string | null
          community_interest_text?: string | null
          created_at?: string
          deleted_at?: string | null
          events_hosted?: number | null
          financial_ask_cents?: number
          founded_year?: number | null
          ftc_team_number?: number | null
          github_link?: string | null
          id?: string
          logo_url?: string | null
          media_no_minors_confirmed_at?: string | null
          media_urls?: Json
          mission_statement?: string | null
          organization?: string | null
          outreach_summary?: string | null
          owner_id: string
          past_sponsors?: string[]
          press_links?: Json
          public?: boolean
          seasons_competed?: number | null
          seed_funding_goals_cents?: number | null
          slug: string
          state?: string | null
          status?: Database["public"]["Enums"]["team_status"]
          student_interest_count?: number | null
          students_reached?: number | null
          subteam_breakdown?: string | null
          sustainability_plan?: string | null
          tagline?: string | null
          tax_status?: Database["public"]["Enums"]["tax_status_type"]
          team_name: string
          team_size?: number | null
          technical_summary?: string | null
          updated_at?: string
          visual_pitch_items?: Json
          volunteer_hours?: number | null
          youtube_url?: string | null
        }
        Update: {
          budget_items?: Json
          city?: string | null
          coach_experience?: string | null
          coach_photo_url?: string | null
          community_endorsements?: string | null
          community_interest_text?: string | null
          created_at?: string
          deleted_at?: string | null
          events_hosted?: number | null
          financial_ask_cents?: number
          founded_year?: number | null
          ftc_team_number?: number | null
          github_link?: string | null
          id?: string
          logo_url?: string | null
          media_no_minors_confirmed_at?: string | null
          media_urls?: Json
          mission_statement?: string | null
          organization?: string | null
          outreach_summary?: string | null
          owner_id?: string
          past_sponsors?: string[]
          press_links?: Json
          public?: boolean
          seasons_competed?: number | null
          seed_funding_goals_cents?: number | null
          slug?: string
          state?: string | null
          status?: Database["public"]["Enums"]["team_status"]
          student_interest_count?: number | null
          students_reached?: number | null
          subteam_breakdown?: string | null
          sustainability_plan?: string | null
          tagline?: string | null
          tax_status?: Database["public"]["Enums"]["tax_status_type"]
          team_name?: string
          team_size?: number | null
          technical_summary?: string | null
          updated_at?: string
          visual_pitch_items?: Json
          volunteer_hours?: number | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions_ledger: {
        Row: {
          actor_type: string
          amount_cents: number
          created_at: string
          decision_type: string
          id: string
          sponsor_id: string
          submission_id: string | null
          team_id: string | null
        }
        Insert: {
          actor_type: string
          amount_cents: number
          created_at?: string
          decision_type: string
          id?: string
          sponsor_id: string
          submission_id?: string | null
          team_id?: string | null
        }
        Update: {
          actor_type?: string
          amount_cents?: number
          created_at?: string
          decision_type?: string
          id?: string
          sponsor_id?: string
          submission_id?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_ledger_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ledger_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ledger_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ledger_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ledger_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ledger_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_sponsor_capacity: {
        Row: {
          company_name: string | null
          funding_cap_cents: number | null
          funding_used_cents: number | null
          id: string | null
          remaining_cents: number | null
          status: Database["public"]["Enums"]["sponsor_status"] | null
          utilization_pct: number | null
        }
        Insert: {
          company_name?: string | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
          id?: string | null
          remaining_cents?: never
          status?: Database["public"]["Enums"]["sponsor_status"] | null
          utilization_pct?: never
        }
        Update: {
          company_name?: string | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
          id?: string | null
          remaining_cents?: never
          status?: Database["public"]["Enums"]["sponsor_status"] | null
          utilization_pct?: never
        }
        Relationships: []
      }
      v_sponsors_public: {
        Row: {
          company_name: string | null
          created_at: string | null
          funding_cap_cents: number | null
          funding_used_cents: number | null
          geo_states: string[] | null
          id: string | null
          industry: string | null
          logo_url: string | null
          status: Database["public"]["Enums"]["sponsor_status"] | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
          geo_states?: string[] | null
          id?: string | null
          industry?: string | null
          logo_url?: string | null
          status?: Database["public"]["Enums"]["sponsor_status"] | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
          geo_states?: string[] | null
          id?: string | null
          industry?: string | null
          logo_url?: string | null
          status?: Database["public"]["Enums"]["sponsor_status"] | null
          website?: string | null
        }
        Relationships: []
      }
      v_submission_summary: {
        Row: {
          admin_feedback: string | null
          company_name: string | null
          created_at: string | null
          id: string | null
          is_locked: boolean | null
          owner_id: string | null
          requested_amount_cents: number | null
          season: string | null
          sponsor_id: string | null
          status: Database["public"]["Enums"]["submission_status"] | null
          team_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_terminal_decision_atomic: {
        Args: {
          p_admin_id: string
          p_feedback: string
          p_new_status: string
          p_submission_id: string
        }
        Returns: Json
      }
      approve_submission_atomic: {
        Args: {
          p_admin_id: string
          p_amount_cents?: number
          p_submission_id: string
        }
        Returns: Json
      }
      check_throttle: {
        Args: { p_key: string; p_limit: number; p_window: string }
        Returns: boolean
      }
      close_impact_report_year: {
        Args: { p_actor_profile_id: string; p_year: number }
        Returns: Json
      }
      coach_owns_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      confirm_sponsor_decision_proposal: {
        Args: { p_approver_id: string; p_note?: string; p_proposal_id: string }
        Returns: Json
      }
      create_sponsor_decision_proposal: {
        Args: {
          p_amount_cents: number
          p_feedback?: string
          p_origin?: string
          p_proposed_by: string
          p_submission_id: string
        }
        Returns: Json
      }
      current_profile_id: { Args: never; Returns: string }
      current_sponsor_ids: { Args: never; Returns: string[] }
      current_sponsor_member_role: {
        Args: { p_sponsor_id: string }
        Returns: string
      }
      detect_capacity_drift: {
        Args: never
        Returns: {
          company_name: string
          drift_cents: number
          expected_used_cents: number
          funding_cap_cents: number
          funding_used_cents: number
          open_reservations_cents: number
          settled_ledger_cents: number
          sponsor_id: string
        }[]
      }
      distinct_audit_actions: {
        Args: never
        Returns: {
          action: string
        }[]
      }
      expire_overdue_submissions: { Args: never; Returns: Json }
      expire_stale_decision_proposals: { Args: never; Returns: Json }
      has_sponsor_permission: {
        Args: { p_min_role: string; p_sponsor_id: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_coach_verified: { Args: never; Returns: boolean }
      is_sponsor_org_member: {
        Args: { p_sponsor_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_trusted_server_context: { Args: never; Returns: boolean }
      record_sponsor_decision_atomic: {
        Args: {
          p_decision: string
          p_partial_amount_cents?: number
          p_token_hash: string
        }
        Returns: Json
      }
      refresh_public_platform_stats: { Args: never; Returns: Json }
      release_submission_reservation: {
        Args: {
          p_new_status: string
          p_reason?: string
          p_submission_id: string
        }
        Returns: Json
      }
      remint_submission_access_token: {
        Args: { p_admin_id: string; p_submission_id: string }
        Returns: Json
      }
      reopen_impact_report_year: {
        Args: { p_actor_profile_id: string; p_reason: string; p_year: number }
        Returns: Json
      }
      sponsor_audit_log: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          action: string
          actor_label: string
          amount_cents: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
        }[]
      }
      sponsor_auditable_actions: { Args: never; Returns: string[] }
      sponsor_can_view_team: { Args: { p_team_id: string }; Returns: boolean }
      sponsor_decide_submission_atomic: {
        Args: {
          p_amount_cents?: number
          p_decision: string
          p_feedback?: string
          p_sponsor_user_id: string
          p_submission_id: string
        }
        Returns: Json
      }
      sponsor_ids_for_profile: {
        Args: { p_profile_id: string }
        Returns: string[]
      }
      sponsor_member_role_rank: { Args: { p_role: string }; Returns: number }
      sponsor_owns_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      upsert_impact_snapshot: {
        Args: {
          p_actor_profile_id: string
          p_payload: Json
          p_report_year: number
          p_schema_version?: number
          p_scope: string
          p_sponsor_id: string
        }
        Returns: Json
      }
      void_match_atomic: {
        Args: { p_admin_id: string; p_reason: string; p_submission_id: string }
        Returns: Json
      }
    }
    Enums: {
      admin_level: "reviewer" | "super_admin"
      application_status: "pending" | "approved" | "rejected"
      payee_tax_classification:
        | "501c3_org"
        | "school_district"
        | "fiscal_sponsor"
        | "other_nonprofit"
        | "unincorporated"
      sponsor_source: "admin_added" | "public_optin"
      sponsor_status: "active" | "inactive" | "pending_review"
      submission_status:
        | "draft"
        | "pending"
        | "approved"
        | "declined"
        | "changes_requested"
        | "opened"
        | "bounced"
        | "delivered"
        | "expired"
        | "dispatched"
        | "withdrawn"
      tax_status_type: "501c3" | "School" | "None"
      team_status: "existing" | "incubator"
      user_role: "coach" | "admin" | "sponsor"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      admin_level: ["reviewer", "super_admin"],
      application_status: ["pending", "approved", "rejected"],
      payee_tax_classification: [
        "501c3_org",
        "school_district",
        "fiscal_sponsor",
        "other_nonprofit",
        "unincorporated",
      ],
      sponsor_source: ["admin_added", "public_optin"],
      sponsor_status: ["active", "inactive", "pending_review"],
      submission_status: [
        "draft",
        "pending",
        "approved",
        "declined",
        "changes_requested",
        "opened",
        "bounced",
        "delivered",
        "expired",
        "dispatched",
        "withdrawn",
      ],
      tax_status_type: ["501c3", "School", "None"],
      team_status: ["existing", "incubator"],
      user_role: ["coach", "admin", "sponsor"],
    },
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Hand-written convenience aliases.
//
// These are NOT emitted by `supabase gen types` and must be re-appended after
// every regeneration -- overwriting the file with a bare generated dump drops
// them and breaks a dozen component imports at once.
// ─────────────────────────────────────────────────────────────────────────────
export type Team = Database['public']['Tables']['teams']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type Submission = Database['public']['Tables']['submissions']['Row']
export type Sponsor = Database['public']['Tables']['sponsors']['Row']
export type TeamAchievement = Database['public']['Tables']['team_achievements']['Row']
export type SubmissionSummary = Database['public']['Views']['v_submission_summary']['Row']
