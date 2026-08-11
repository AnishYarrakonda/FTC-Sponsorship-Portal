import fs from 'fs'

const content = fs.readFileSync('lib/supabase/types.ts', 'utf-8')

const enumStr = `
      fulfillment_payment_method: "check" | "ach" | "wire" | "other"
      fulfillment_status:
        | "pledged"
        | "agreement_signed"
        | "payment_sent"
        | "payment_received"
        | "receipted"
        | "cancelled"
`

const tablesStr = `
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
          },
        ]
      }
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
          },
        ]
      }
`

// Only modify the first Enums: { which belongs to public schema
const enumParts = content.split('    Enums: {\n')
const finalContent1 = enumParts[0] + '    Enums: {\n' + enumStr + enumParts.slice(1).join('    Enums: {\n')

// Only modify the first Tables: { which belongs to public schema
const tableParts = finalContent1.split('    Tables: {\n')
const finalContent2 = tableParts[0] + '    Tables: {\n' + tablesStr + tableParts.slice(1).join('    Tables: {\n')

fs.writeFileSync('lib/supabase/types.ts', finalContent2)
