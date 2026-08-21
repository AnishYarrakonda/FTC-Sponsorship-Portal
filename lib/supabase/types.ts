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
      agreement_templates: {
        Row: {
          id: string
          key: string
          version: number
          title: string
          body: string
          consent_text: string
          merge_fields: string[]
          status: string
          needs_legal_review: boolean
          effective_from: string | null
          retired_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          version: number
          title: string
          body: string
          consent_text: string
          merge_fields?: string[]
          status?: string
          needs_legal_review?: boolean
          effective_from?: string | null
          retired_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          version?: number
          title?: string
          body?: string
          consent_text?: string
          merge_fields?: string[]
          status?: string
          needs_legal_review?: boolean
          effective_from?: string | null
          retired_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_signatures: {
        Row: {
          id: string
          template_id: string | null
          template_key: string
          template_version: number
          signer_profile_id: string | null
          signer_role: string
          signer_legal_name: string
          signer_email: string
          submission_id: string | null
          sponsor_id: string | null
          team_id: string | null
          entity_snapshot: Json
          typed_name: string
          signed_at: string
          ip_address: string
          user_agent: string
          document_hash: string
          document_storage_path: string
          consent_text_version: number
          consent_text_hash: string
          created_at: string
        }
        Insert: {
          id?: string
          template_id?: string | null
          template_key: string
          template_version: number
          signer_profile_id?: string | null
          signer_role: string
          signer_legal_name: string
          signer_email: string
          submission_id?: string | null
          sponsor_id?: string | null
          team_id?: string | null
          entity_snapshot?: Json
          typed_name: string
          signed_at?: string
          ip_address: string
          user_agent: string
          document_hash: string
          document_storage_path: string
          consent_text_version: number
          consent_text_hash: string
          created_at?: string
        }
        Update: {
          id?: string
          template_id?: string | null
          template_key?: string
          template_version?: number
          signer_profile_id?: string | null
          signer_role?: string
          signer_legal_name?: string
          signer_email?: string
          submission_id?: string | null
          sponsor_id?: string | null
          team_id?: string | null
          entity_snapshot?: Json
          typed_name?: string
          signed_at?: string
          ip_address?: string
          user_agent?: string
          document_hash?: string
          document_storage_path?: string
          consent_text_version?: number
          consent_text_hash?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_signatures_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_signatures_signer_profile_id_fkey"
            columns: ["signer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_signatures_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_signatures_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_signatures_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
      profiles: {
        Row: {
          address_line1: string | null
          admin_level: Database["public"]["Enums"]["admin_level"] | null
          age_confirmed_at: string | null
          city: string | null
          clerk_user_id: string | null
          coach_credentials_url: string | null
          coach_credentials_purged_at: string | null
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
          coach_credentials_url?: string | null
          coach_credentials_purged_at?: string | null
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
          coach_credentials_url?: string | null
          coach_credentials_purged_at?: string | null
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
            foreignKeyName: "sponsor_decision_proposals_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
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
      // Hand-added for migration 0086_coach_appeals.sql.
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
        ]
      }
      // Hand-added for migration 0088_impact_reports.sql. Regenerate with
      // `supabase gen types` once the migrations are applied.
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
            foreignKeyName: "impact_report_snapshots_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      public_platform_stats: {
        Row: {
          dollars_pledged_cents: number
          dollars_received_cents: number
          events_hosted: number
          id: boolean
          refreshed_at: string
          sponsors_active: number
          students_reached: number
          teams_supported: number
          volunteer_hours: number
        }
        Insert: {
          dollars_pledged_cents?: number
          dollars_received_cents?: number
          events_hosted?: number
          id?: boolean
          refreshed_at?: string
          sponsors_active?: number
          students_reached?: number
          teams_supported?: number
          volunteer_hours?: number
        }
        Update: {
          dollars_pledged_cents?: number
          dollars_received_cents?: number
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
      // Hand-added for migration 0087_recognition_tiers.sql. Regenerate with
      // `supabase gen types` once the migrations are applied.
      recognition_tiers: {
        Row: {
          archived_at: string | null
          benefits: string[]
          created_at: string
          description: string | null
          id: string
          max_amount_cents: number | null
          min_amount_cents: number
          name: string
          rank: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          benefits?: string[]
          created_at?: string
          description?: string | null
          id?: string
          max_amount_cents?: number | null
          min_amount_cents: number
          name: string
          rank: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          benefits?: string[]
          created_at?: string
          description?: string | null
          id?: string
          max_amount_cents?: number | null
          min_amount_cents?: number
          name?: string
          rank?: number
          updated_at?: string
        }
        Relationships: []
      }
      sponsor_recognition_awards: {
        Row: {
          amount_cents: number
          awarded_at: string
          benefits_snapshot: string[]
          created_at: string
          fulfillment_id: string
          id: string
          sponsor_id: string
          team_id: string | null
          tier_id: string | null
          tier_min_amount_cents_snapshot: number
          tier_name_snapshot: string
          tier_rank_snapshot: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          awarded_at?: string
          benefits_snapshot: string[]
          created_at?: string
          fulfillment_id: string
          id?: string
          sponsor_id: string
          team_id?: string | null
          tier_id?: string | null
          tier_min_amount_cents_snapshot: number
          tier_name_snapshot: string
          tier_rank_snapshot: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          awarded_at?: string
          benefits_snapshot?: string[]
          created_at?: string
          fulfillment_id?: string
          id?: string
          sponsor_id?: string
          team_id?: string | null
          tier_id?: string | null
          tier_min_amount_cents_snapshot?: number
          tier_name_snapshot?: string
          tier_rank_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_recognition_awards_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_recognition_awards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_recognition_awards_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "recognition_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      recognition_benefit_deliveries: {
        Row: {
          admin_void_reason: string | null
          admin_voided_at: string | null
          award_id: string
          benefit_type: string
          coach_note: string | null
          created_at: string
          delivered_at: string | null
          id: string
          no_minors_confirmed_at: string | null
          proof_uploaded_at: string | null
          proof_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_void_reason?: string | null
          admin_voided_at?: string | null
          award_id: string
          benefit_type: string
          coach_note?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          no_minors_confirmed_at?: string | null
          proof_uploaded_at?: string | null
          proof_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_void_reason?: string | null
          admin_voided_at?: string | null
          award_id?: string
          benefit_type?: string
          coach_note?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          no_minors_confirmed_at?: string | null
          proof_uploaded_at?: string | null
          proof_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_benefit_deliveries_award_id_fkey"
            columns: ["award_id"]
            isOneToOne: false
            referencedRelation: "sponsor_recognition_awards"
            referencedColumns: ["id"]
          },
        ]
      }
      // Hand-added for migration 0085_submission_qa_thread.sql. Regenerate with
      // `supabase gen types` once the migrations are applied.
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
            foreignKeyName: "submission_messages_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
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
      team_payout_profiles: {
        Row: {
          team_id: string
          legal_payee_name: string
          tax_classification: string
          ein_last4: string | null
          is_fiscally_sponsored: boolean
          fiscal_sponsor_name: string | null
          fiscal_sponsor_ein_last4: string | null
          mailing_address_line1: string | null
          mailing_address_line2: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_postal_code: string | null
          remittance_email: string | null
          w9_document_path: string | null
          w9_uploaded_at: string | null
          w9_verified_by: string | null
          w9_verified_at: string | null
          w9_rejected_reason: string | null
          w9_rejected_at: string | null
          w9_expires_at: string | null
          w9_renewal_notified_at: string | null
          w9_purged_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          team_id: string
          legal_payee_name: string
          tax_classification: string
          ein_last4?: string | null
          is_fiscally_sponsored?: boolean
          fiscal_sponsor_name?: string | null
          fiscal_sponsor_ein_last4?: string | null
          mailing_address_line1?: string | null
          mailing_address_line2?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_postal_code?: string | null
          remittance_email?: string | null
          w9_document_path?: string | null
          w9_uploaded_at?: string | null
          w9_verified_by?: string | null
          w9_verified_at?: string | null
          w9_rejected_reason?: string | null
          w9_rejected_at?: string | null
          w9_expires_at?: string | null
          w9_renewal_notified_at?: string | null
          w9_purged_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          team_id?: string
          legal_payee_name?: string
          tax_classification?: string
          ein_last4?: string | null
          is_fiscally_sponsored?: boolean
          fiscal_sponsor_name?: string | null
          fiscal_sponsor_ein_last4?: string | null
          mailing_address_line1?: string | null
          mailing_address_line2?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_postal_code?: string | null
          remittance_email?: string | null
          w9_document_path?: string | null
          w9_uploaded_at?: string | null
          w9_verified_by?: string | null
          w9_verified_at?: string | null
          w9_rejected_reason?: string | null
          w9_rejected_at?: string | null
          w9_expires_at?: string | null
          w9_renewal_notified_at?: string | null
          w9_purged_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_payout_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_payout_profiles_w9_verified_by_fkey"
            columns: ["w9_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
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
          override_reason: string | null
          overridden_at: string | null
          overridden_by: string | null
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
          override_reason?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
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
          override_reason?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          profile_id?: string | null
          source?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_verification_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
            foreignKeyName: "team_verification_records_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
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
          media_urls: Json
          media_no_minors_confirmed_at: string | null
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
          media_urls?: Json
          media_no_minors_confirmed_at?: string | null
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
          media_urls?: Json
          media_no_minors_confirmed_at?: string | null
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
      funding_capacity_releases: {
        Row: {
          amount_cents: number
          created_at: string
          fulfillment_id: string
          id: string
          reason: string | null
          released_by: string | null
          sponsor_id: string
          submission_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          fulfillment_id: string
          id?: string
          reason?: string | null
          released_by?: string | null
          sponsor_id: string
          submission_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          fulfillment_id?: string
          id?: string
          reason?: string | null
          released_by?: string | null
          sponsor_id?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funding_capacity_releases_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: true
            referencedRelation: "funding_fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsor_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_sponsors_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_capacity_releases_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_summary"
            referencedColumns: ["id"]
          },
        ]
      }
          funding_fulfillment_events: {
                      Row: {
                        actor_profile_id: string | null
                        actor_role: string
                        created_at: string
                        from_status: Database["public"]["Enums"]["fulfillment_status"] | null
                        fulfillment_id: string
                        id: string
                        metadata: Json
                        note: string | null
                        to_status: Database["public"]["Enums"]["fulfillment_status"]
                      }
                      Insert: {
                        actor_profile_id?: string | null
                        actor_role: string
                        created_at?: string
                        from_status?: Database["public"]["Enums"]["fulfillment_status"] | null
                        fulfillment_id: string
                        id?: string
                        metadata?: Json
                        note?: string | null
                        to_status: Database["public"]["Enums"]["fulfillment_status"]
                      }
                      Update: {
                        actor_profile_id?: string | null
                        actor_role?: string
                        created_at?: string
                        from_status?: Database["public"]["Enums"]["fulfillment_status"] | null
                        fulfillment_id?: string
                        id?: string
                        metadata?: Json
                        note?: string | null
                        to_status?: Database["public"]["Enums"]["fulfillment_status"]
                      }
                      Relationships: [
                        {
                          foreignKeyName: "funding_fulfillment_events_actor_profile_id_fkey"
                          columns: ["actor_profile_id"]
                          isOneToOne: false
                          referencedRelation: "profiles"
                          referencedColumns: ["id"]
                        },
                        {
                          foreignKeyName: "funding_fulfillment_events_fulfillment_id_fkey"
                          columns: ["fulfillment_id"]
                          isOneToOne: false
                          referencedRelation: "funding_fulfillments"
                          referencedColumns: ["id"]
                        }
                      ]
                    };
          funding_fulfillments: {
                      Row: {
                        agreement_signed_at: string | null
                        amount_cents: number
                        cancelled_at: string | null
                        cancelled_reason: string | null
                        created_at: string
                        expected_by: string | null
                        id: string
                        last_nudged_at: string | null
                        notes: string | null
                        payment_method: Database["public"]["Enums"]["fulfillment_payment_method"] | null
                        payment_received_at: string | null
                        payment_reference: string | null
                        payment_sent_at: string | null
                        pledged_at: string
                        receipted_at: string | null
                        sponsor_id: string
                        status: Database["public"]["Enums"]["fulfillment_status"]
                        submission_id: string | null
                        team_id: string | null
                        transaction_id: string
                        updated_at: string
                      }
                      Insert: {
                        agreement_signed_at?: string | null
                        amount_cents: number
                        cancelled_at?: string | null
                        cancelled_reason?: string | null
                        created_at?: string
                        expected_by?: string | null
                        id?: string
                        last_nudged_at?: string | null
                        notes?: string | null
                        payment_method?: Database["public"]["Enums"]["fulfillment_payment_method"] | null
                        payment_received_at?: string | null
                        payment_reference?: string | null
                        payment_sent_at?: string | null
                        pledged_at?: string
                        receipted_at?: string | null
                        sponsor_id: string
                        status?: Database["public"]["Enums"]["fulfillment_status"]
                        submission_id?: string | null
                        team_id?: string | null
                        transaction_id: string
                        updated_at?: string
                      }
                      Update: {
                        agreement_signed_at?: string | null
                        amount_cents?: number
                        cancelled_at?: string | null
                        cancelled_reason?: string | null
                        created_at?: string
                        expected_by?: string | null
                        id?: string
                        last_nudged_at?: string | null
                        notes?: string | null
                        payment_method?: Database["public"]["Enums"]["fulfillment_payment_method"] | null
                        payment_received_at?: string | null
                        payment_reference?: string | null
                        payment_sent_at?: string | null
                        pledged_at?: string
                        receipted_at?: string | null
                        sponsor_id?: string
                        status?: Database["public"]["Enums"]["fulfillment_status"]
                        submission_id?: string | null
                        team_id?: string | null
                        transaction_id?: string
                        updated_at?: string
                      }
                      Relationships: [
                        {
                          foreignKeyName: "funding_fulfillments_sponsor_id_fkey"
                          columns: ["sponsor_id"]
                          isOneToOne: false
                          referencedRelation: "sponsors"
                          referencedColumns: ["id"]
                        },
                        {
                          foreignKeyName: "funding_fulfillments_submission_id_fkey"
                          columns: ["submission_id"]
                          isOneToOne: false
                          referencedRelation: "submissions"
                          referencedColumns: ["id"]
                        },
                        {
                          foreignKeyName: "funding_fulfillments_team_id_fkey"
                          columns: ["team_id"]
                          isOneToOne: false
                          referencedRelation: "teams"
                          referencedColumns: ["id"]
                        },
                        {
                          foreignKeyName: "funding_fulfillments_transaction_id_fkey"
                          columns: ["transaction_id"]
                          isOneToOne: true
                          referencedRelation: "transactions_ledger"
                          referencedColumns: ["id"]
                        }
                      ]
                    };
      funding_receipt_counters: {
        Row: {
          last_value: number
          year: number
        }
        Insert: {
          last_value?: number
          year: number
        }
        Update: {
          last_value?: number
          year?: number
        }
        Relationships: []
      }
      funding_receipts: {
        Row: {
          amount_cents: number
          contribution_date: string
          copy_reviewed_at: string | null
          copy_version: string
          created_at: string
          document_html: string
          document_sha256: string
          emailed_at: string | null
          fulfillment_id: string
          goods_or_services_description: string | null
          goods_or_services_fmv_cents: number | null
          id: string
          issued_at: string
          issued_by: string | null
          payee_ein_last4: string | null
          payee_legal_name: string
          payee_tax_classification: string | null
          receipt_number: string
          sponsor_contact_email: string | null
          sponsor_id: string
          sponsor_legal_name: string
          status: Database["public"]["Enums"]["receipt_status"]
          superseded_by_receipt_id: string | null
          supersedes_receipt_id: string | null
          team_id: string | null
          transaction_id: string
          variant: Database["public"]["Enums"]["receipt_variant"]
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
        }
        Insert: {
          amount_cents: number
          contribution_date: string
          copy_reviewed_at?: string | null
          copy_version: string
          created_at?: string
          document_html: string
          document_sha256: string
          emailed_at?: string | null
          fulfillment_id: string
          goods_or_services_description?: string | null
          goods_or_services_fmv_cents?: number | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          payee_ein_last4?: string | null
          payee_legal_name: string
          payee_tax_classification?: string | null
          receipt_number: string
          sponsor_contact_email?: string | null
          sponsor_id: string
          sponsor_legal_name: string
          status?: Database["public"]["Enums"]["receipt_status"]
          superseded_by_receipt_id?: string | null
          supersedes_receipt_id?: string | null
          team_id?: string | null
          transaction_id: string
          variant: Database["public"]["Enums"]["receipt_variant"]
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Update: {
          amount_cents?: number
          contribution_date?: string
          copy_reviewed_at?: string | null
          copy_version?: string
          created_at?: string
          document_html?: string
          document_sha256?: string
          emailed_at?: string | null
          fulfillment_id?: string
          goods_or_services_description?: string | null
          goods_or_services_fmv_cents?: number | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          payee_ein_last4?: string | null
          payee_legal_name?: string
          payee_tax_classification?: string | null
          receipt_number?: string
          sponsor_contact_email?: string | null
          sponsor_id?: string
          sponsor_legal_name?: string
          status?: Database["public"]["Enums"]["receipt_status"]
          superseded_by_receipt_id?: string | null
          supersedes_receipt_id?: string | null
          team_id?: string | null
          transaction_id?: string
          variant?: Database["public"]["Enums"]["receipt_variant"]
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funding_receipts_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "funding_fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_superseded_by_receipt_id_fkey"
            columns: ["superseded_by_receipt_id"]
            isOneToOne: false
            referencedRelation: "funding_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_supersedes_receipt_id_fkey"
            columns: ["supersedes_receipt_id"]
            isOneToOne: false
            referencedRelation: "funding_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_receipts_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
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
          // Added by 0063_sponsors_coach_exposure.sql.
          geo_states: string[] | null
          funding_cap_cents: number | null
          funding_used_cents: number | null
          id: string | null
          industry: string | null
          logo_url: string | null
          status: Database["public"]["Enums"]["sponsor_status"] | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          geo_states?: string[] | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
          id?: string | null
          industry?: string | null
          logo_url?: string | null
          status?: Database["public"]["Enums"]["sponsor_status"] | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          geo_states?: string[] | null
          funding_cap_cents?: number | null
          funding_used_cents?: number | null
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
      // Hand-added for migration 0085_submission_qa_thread.sql. These two keep EXECUTE for
      // `authenticated` because the submission_messages RLS policies call them.
      coach_owns_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      sponsor_owns_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      distinct_audit_actions: {
        Args: Record<PropertyKey, never>
        Returns: { action: string }[]
      }
      // Hand-added for migration 0070_remint_submission_access_token.sql. Regenerate
      // with `supabase gen types` once the migrations are applied.
      remint_submission_access_token: {
        Args: { p_admin_id: string; p_submission_id: string }
        Returns: Json
      }
      current_profile_id: { Args: never; Returns: string }
      // Hand-added for migration 0082_sponsor_organizations.sql.
      current_sponsor_ids: { Args: never; Returns: string[] }
      is_sponsor_org_member: { Args: { p_sponsor_id: string }; Returns: boolean }
      // Hand-added for migration 0083_sponsor_roles_and_approvals.sql.
      sponsor_member_role_rank: { Args: { p_role: string }; Returns: number }
      current_sponsor_member_role: { Args: { p_sponsor_id: string }; Returns: string }
      has_sponsor_permission: {
        Args: { p_min_role: string; p_sponsor_id: string }
        Returns: boolean
      }
      create_sponsor_decision_proposal: {
        Args: {
          p_amount_cents: number
          p_feedback?: string
          p_origin?: string
          p_proposed_by: string | null
          p_submission_id: string
        }
        Returns: Json
      }
      confirm_sponsor_decision_proposal: {
        Args: { p_approver_id: string; p_note?: string; p_proposal_id: string }
        Returns: Json
      }
      expire_stale_decision_proposals: { Args: never; Returns: Json }
      expire_overdue_submissions: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      // Hand-added for migration 0084_admin_levels_and_capacity_audit.sql.
      is_super_admin: { Args: never; Returns: boolean }
      detect_capacity_drift: {
        Args: never
        Returns: {
          sponsor_id: string
          company_name: string
          funding_cap_cents: number
          funding_used_cents: number
          open_reservations_cents: number
          settled_ledger_cents: number
          released_capacity_cents: number
          expected_used_cents: number
          drift_cents: number
        }[]
      }
      is_coach_verified: { Args: never; Returns: boolean }
      record_sponsor_decision_atomic: {
        Args: {
          p_decision: string
          p_partial_amount_cents?: number
          p_token_hash: string
        }
        Returns: Json
      }
      release_submission_reservation: {
        Args: {
          p_new_status: string
          p_reason?: string
          p_submission_id: string
        }
        Returns: Json
      }
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
        record_fulfillment_transition: {
                    Args: {
                      p_fulfillment_id: string
                      p_actor_profile_id: string
                      p_to_status: Database["public"]["Enums"]["fulfillment_status"]
                      p_note?: string | null
                      p_payment_method?: Database["public"]["Enums"]["fulfillment_payment_method"] | null
                      p_payment_reference?: string | null
                      p_occurred_on?: string | null
                    }
                    Returns: {
                      ok: boolean
                      error?: string
                      status?: Database["public"]["Enums"]["fulfillment_status"]
                    }
                  };
      issue_funding_receipt: {
        Args: {
          p_fulfillment_id: string
          p_actor_profile_id: string | null
          p_variant: Database["public"]["Enums"]["receipt_variant"]
          p_payee_legal_name: string
          p_payee_ein_last4: string | null
          p_payee_tax_classification: string | null
          p_sponsor_legal_name: string
          p_sponsor_contact_email: string | null
          p_goods_or_services: string | null
          p_goods_or_services_fmv_cents: number | null
          p_document_html: string
          p_document_sha256: string
          p_copy_version: string
          p_copy_reviewed_at: string | null
        }
        Returns: Json
      }
      publish_agreement_version: {
        Args: {
          p_template_id: string
          p_actor_profile_id: string
        }
        Returns: Json
      }
      sign_agreement_atomic: {
        Args: {
          p_template_id: string
          p_signer_profile_id: string
          p_signer_role: string
          p_submission_id: string
          p_typed_name: string
          p_ip: string
          p_user_agent: string
          p_document_hash: string
          p_document_storage_path: string
          p_consent_text_hash: string
          p_entity_snapshot: Json
        }
        Returns: Json
      }
      agreement_is_signed: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      void_funding_receipt: {
        Args: {
          p_receipt_id: string
          p_actor_profile_id: string | null
          p_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      admin_level: "reviewer" | "super_admin"
      application_status: "pending" | "approved" | "rejected"
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
      tax_status_type: "501c3" | "School" | "None"
      team_status: "existing" | "incubator"
      user_role: "coach" | "admin" | "sponsor"
        fulfillment_payment_method: "check" | "ach" | "wire" | "other";
        fulfillment_status: "pledged" | "agreement_signed" | "payment_sent" | "payment_received" | "receipted" | "cancelled";
        receipt_status: "issued" | "voided";
        receipt_variant: "charitable_501c3" | "governmental_school" | "non_charitable";
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
      ],
      tax_status_type: ["501c3", "School", "None"],
      team_status: ["existing", "incubator"],
      user_role: ["coach", "admin", "sponsor"],
    },
  },
} as const

export type Team = Database['public']['Tables']['teams']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type Submission = Database['public']['Tables']['submissions']['Row']
export type Sponsor = Database['public']['Tables']['sponsors']['Row']
export type TeamAchievement = Database['public']['Tables']['team_achievements']['Row']
export type SubmissionSummary = Database['public']['Views']['v_submission_summary']['Row']
