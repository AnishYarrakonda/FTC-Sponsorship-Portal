import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
const sourceFile = project.addSourceFileAtPath('lib/supabase/types.ts');

const dbInterface = sourceFile.getTypeAliasOrThrow('Database');
const dbType = dbInterface.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);

const publicProp = dbType.getPropertyOrThrow('public').asKindOrThrow(SyntaxKind.PropertySignature);
const publicType = publicProp.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);

const tablesProp = publicType.getPropertyOrThrow('Tables').asKindOrThrow(SyntaxKind.PropertySignature);
const tablesType = tablesProp.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);

// Add funding_fulfillment_events
tablesType.addProperty({
    name: 'funding_fulfillment_events',
    type: `{
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
      }`
});

// Add funding_fulfillments
tablesType.addProperty({
    name: 'funding_fulfillments',
    type: `{
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
      }`
});

const enumsProp = publicType.getPropertyOrThrow('Enums').asKindOrThrow(SyntaxKind.PropertySignature);
const enumsType = enumsProp.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);

enumsType.addProperty({
    name: 'fulfillment_payment_method',
    type: '"check" | "ach" | "wire" | "other"'
});
enumsType.addProperty({
    name: 'fulfillment_status',
    type: '"pledged" | "agreement_signed" | "payment_sent" | "payment_received" | "receipted" | "cancelled"'
});

const functionsProp = publicType.getPropertyOrThrow('Functions').asKindOrThrow(SyntaxKind.PropertySignature);
const functionsType = functionsProp.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.TypeLiteral);

functionsType.addProperty({
    name: 'record_fulfillment_transition',
    type: `{
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
      }`
});

sourceFile.saveSync();
console.log('Types successfully patched with AST!');
